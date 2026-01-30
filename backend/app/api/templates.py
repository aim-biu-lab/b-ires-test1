"""
Stage templates API routes

Serves YAML templates from the experiments/ folder for use in the admin panel.
"""
import os
import logging
from typing import List
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
import yaml

from app.core.security import get_current_user
from app.models.user import UserInDB

logger = logging.getLogger(__name__)
router = APIRouter()

# Path to experiments folder
# In Docker: mounted at /app/experiments
# Locally: relative to this file at ../../../experiments
def get_experiments_dir() -> str:
    """Get the experiments directory path, works both in Docker and locally"""
    # First try Docker path
    docker_path = "/app/experiments"
    if os.path.exists(docker_path):
        return docker_path
    
    # Fall back to relative path (for local development)
    local_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "experiments")
    return os.path.abspath(local_path)

EXPERIMENTS_DIR = get_experiments_dir()


class TemplateMetadata(BaseModel):
    """Metadata for a stage template"""
    id: str
    name: str
    description: str
    category: str  # 'forms', 'content', 'surveys', 'tasks'
    filename: str


class TemplateResponse(BaseModel):
    """Full template response with YAML content"""
    id: str
    name: str
    description: str
    category: str
    filename: str
    yaml: str  # The stage YAML content (not including meta)


class TemplatesListResponse(BaseModel):
    """List of available templates"""
    templates: List[TemplateMetadata]


def load_template_file(filepath: str) -> dict | None:
    """Load and parse a YAML template file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = yaml.safe_load(f)
            return content
    except Exception as e:
        logger.warning(f"Failed to load template {filepath}: {e}")
        return None


def get_all_templates() -> List[dict]:
    """Scan experiments folder for template files and load their metadata"""
    templates = []
    
    if not os.path.exists(EXPERIMENTS_DIR):
        logger.warning(f"Experiments directory not found: {EXPERIMENTS_DIR}")
        return templates
    
    for filename in os.listdir(EXPERIMENTS_DIR):
        if filename.endswith('-template.yaml'):
            filepath = os.path.join(EXPERIMENTS_DIR, filename)
            content = load_template_file(filepath)
            
            if content and 'meta' in content:
                meta = content['meta']
                templates.append({
                    'id': meta.get('id', filename.replace('.yaml', '')),
                    'name': meta.get('name', filename),
                    'description': meta.get('description', ''),
                    'category': meta.get('category', 'forms'),
                    'filename': filename,
                    'content': content
                })
    
    return templates


@router.get("", response_model=TemplatesListResponse)
async def list_templates(
    current_user: UserInDB = Depends(get_current_user),
):
    """List all available stage templates"""
    templates = get_all_templates()
    
    return TemplatesListResponse(
        templates=[
            TemplateMetadata(
                id=t['id'],
                name=t['name'],
                description=t['description'],
                category=t['category'],
                filename=t['filename']
            )
            for t in templates
        ]
    )


@router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """Get a specific template by ID with its YAML content"""
    templates = get_all_templates()
    
    template = next((t for t in templates if t['id'] == template_id), None)
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found"
        )
    
    content = template['content']
    
    # Extract the stage YAML (without meta section)
    # If there's a 'stages' array, take the first stage
    # Otherwise, the content IS the stage (for backwards compatibility)
    if 'stages' in content and isinstance(content['stages'], list) and len(content['stages']) > 0:
        stage_content = content['stages'][0]
    else:
        # Remove meta and return the rest
        stage_content = {k: v for k, v in content.items() if k != 'meta'}
    
    # Convert back to YAML string
    stage_yaml = yaml.dump(stage_content, default_flow_style=False, allow_unicode=True, sort_keys=False)
    
    return TemplateResponse(
        id=template['id'],
        name=template['name'],
        description=template['description'],
        category=template['category'],
        filename=template['filename'],
        yaml=stage_yaml
    )
