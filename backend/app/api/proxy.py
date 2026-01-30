"""
Proxy API for external content (to bypass X-Frame-Options)
"""
import logging
from typing import Optional
from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException, status, Query
from fastapi import Request
from fastapi.responses import Response
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Allowed domains for security (empty list means all domains allowed)
# Set this in your environment if you want to restrict which domains can be proxied
ALLOWED_PROXY_DOMAINS = settings.ALLOWED_PROXY_DOMAINS if hasattr(settings, 'ALLOWED_PROXY_DOMAINS') else []


def is_url_allowed(url: str) -> bool:
    """Check if URL is allowed to be proxied"""
    if not ALLOWED_PROXY_DOMAINS:
        return True  # All domains allowed if list is empty
    
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Remove port if present
        if ':' in domain:
            domain = domain.split(':')[0]
        
        return domain in [d.lower() for d in ALLOWED_PROXY_DOMAINS]
    except Exception:
        return False


@router.get("/api/proxy/content")
async def proxy_content(
    url: str = Query(..., description="URL to proxy"),
    request: Request = None,
):
    """
    Proxy external content to bypass X-Frame-Options restrictions.
    
    This endpoint fetches content from external URLs and removes/modifies
    security headers that prevent iframe embedding.
    
    WARNING: Only use this for trusted sources. Proxying content can expose
    your server to security risks.
    """
    # Validate URL
    if not url.startswith(('http://', 'https://')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL must start with http:// or https://"
        )
    
    # Check if domain is allowed
    if not is_url_allowed(url):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Domain not allowed for proxying. Allowed domains: {ALLOWED_PROXY_DOMAINS or 'all'}"
        )
    
    try:
        # Forward request headers (for cookies, auth, etc.)
        headers = {}
        
        # Forward user agent
        if request and "user-agent" in request.headers:
            headers["User-Agent"] = request.headers["user-agent"]
        
        # Forward referer
        if request and "referer" in request.headers:
            headers["Referer"] = request.headers["referer"]
        
        # Forward cookies if present
        if request and "cookie" in request.headers:
            headers["Cookie"] = request.headers["cookie"]
        
        # Fetch the content
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            
            # Get content (httpx automatically decompresses gzip/br/deflate)
            content = response.content
            content_type = response.headers.get("content-type", "text/html")
            
            # Build response headers (remove/modify security headers)
            response_headers = {}
            
            # Only copy content-type, NOT content-encoding or content-length
            # - content-encoding: httpx already decompressed the content
            # - content-length: we may modify the content, so length changes
            if "content-type" in response.headers:
                response_headers["content-type"] = response.headers["content-type"]
            
            # Set our own CSP that allows embedding
            response_headers["Content-Security-Policy"] = "frame-ancestors *;"
            
            # Handle relative URLs in HTML content
            if content_type.startswith("text/html"):
                try:
                    html_content = content.decode('utf-8', errors='ignore')
                    
                    # Add <base> tag to make relative URLs work
                    # This is more reliable than regex replacement
                    parsed_url = urlparse(url)
                    base_url = f"{parsed_url.scheme}://{parsed_url.netloc}"
                    
                    # Insert base tag after <head> or at the beginning
                    base_tag = f'<base href="{base_url}/" target="_self">'
                    
                    import re
                    if '<head>' in html_content.lower():
                        # Insert after <head>
                        html_content = re.sub(
                            r'(<head[^>]*>)',
                            rf'\1\n{base_tag}',
                            html_content,
                            count=1,
                            flags=re.IGNORECASE
                        )
                    elif '<html>' in html_content.lower():
                        # Insert after <html>
                        html_content = re.sub(
                            r'(<html[^>]*>)',
                            rf'\1\n<head>{base_tag}</head>',
                            html_content,
                            count=1,
                            flags=re.IGNORECASE
                        )
                    else:
                        # Prepend base tag
                        html_content = f'{base_tag}\n{html_content}'
                    
                    content = html_content.encode('utf-8')
                except Exception as e:
                    logger.warning(f"Failed to add base tag to HTML: {e}")
            
            return Response(
                content=content,
                media_type=content_type,
                headers=response_headers,
            )
    
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error proxying {url}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch content: {e.response.status_code}"
        )
    except httpx.RequestError as e:
        logger.error(f"Request error proxying {url}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to connect to target URL: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error proxying {url}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error: {str(e)}"
        )

