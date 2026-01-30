import { useRef, useEffect, useState, useCallback } from 'react'
import { eventQueue } from '../../lib/eventQueue'
import { useSessionStore } from '../../store/sessionStore'

interface TopBarStatus {
  type: 'loading' | 'success' | 'warning' | 'error' | 'info'
  message: string
}

interface IframeSandboxBlockProps {
  source: string
  config?: Record<string, unknown>
  stageId: string
  onComplete?: () => void
  data: Record<string, unknown>
  errors?: Record<string, string>
  onFieldChange: (fieldId: string, value: unknown) => void
  onStatusChange?: (status: TopBarStatus | null) => void
}

// Message types for postMessage communication
interface IframeMessage {
  type: string
  payload?: unknown
}

interface IframeCompletionMessage extends IframeMessage {
  type: 'bires:complete'
  payload?: {
    data?: Record<string, unknown>
  }
}

interface IframeProgressMessage extends IframeMessage {
  type: 'bires:progress'
  payload: {
    progress: number
    metadata?: Record<string, unknown>
  }
}

interface IframeEventMessage extends IframeMessage {
  type: 'bires:event'
  payload: {
    eventType: string
    data?: Record<string, unknown>
  }
}

interface IframeReadyMessage extends IframeMessage {
  type: 'bires:ready'
}

interface IframeDataRequestMessage extends IframeMessage {
  type: 'bires:requestData'
}

type IncomingMessage =
  | IframeCompletionMessage
  | IframeProgressMessage
  | IframeEventMessage
  | IframeReadyMessage
  | IframeDataRequestMessage

const MESSAGE_ORIGIN_WILDCARD = '*'

export default function IframeSandboxBlock({
  source,
  config,
  stageId,
  onComplete,
  data,
  errors,
  onFieldChange,
  onStatusChange,
}: IframeSandboxBlockProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const sessionId = useSessionStore((state) => state.sessionId)
  const stageData = useSessionStore((state) => state.stageData)
  const currentStage = useSessionStore((state) => state.currentStage)

  const [isReady, setIsReady] = useState(false)
  const [iframeProgress, setIframeProgress] = useState(0)
  const [hasCompleted, setHasCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useProxy, setUseProxy] = useState(false)
  const [proxyAttempted, setProxyAttempted] = useState(false)

  // Config options
  const heightConfig = (config?.height as string) || '600px'
  const widthConfig = (config?.width as string) || '100%'
  const allowFullscreen = (config?.allow_fullscreen as boolean) ?? true
  const allowClipboard = (config?.allow_clipboard as boolean) ?? false
  const timeout = (config?.timeout_ms as number) || 0
  const autoComplete = (config?.auto_complete as boolean) ?? false
  const requiredFields = (config?.required_fields as string[]) || []
  const autoUseProxy = (config?.auto_use_proxy as boolean) ?? true

  // Check if we should use full viewport dimensions
  const isFullWidth = widthConfig === '100%'
  const isFullHeight = heightConfig === '100%'
  
  // Calculate dimensions - for 100%, use viewport-relative calculations
  // Full width: viewport width minus sidebar (256px) and padding (2rem)
  // Full height: viewport height minus top bar (~70px) and padding (~2rem)
  const width = isFullWidth ? 'calc(100vw - 256px - 2rem)' : widthConfig
  const height = isFullHeight ? 'calc(100vh - 100px)' : heightConfig

  // Log event helper (defined early so it can be used in other hooks)
  const logEvent = useCallback(
    (eventType: string, payload: Record<string, unknown> = {}) => {
      if (!sessionId) return
      eventQueue.addEvent({
        sessionId,
        eventType,
        stageId,
        blockId: 'iframe_sandbox',
        payload,
      })
    },
    [sessionId, stageId]
  )

  // Check if URL is external
  const isExternalUrl = useCallback((url: string): boolean => {
    try {
      const urlObj = new URL(url, window.location.origin)
      return urlObj.origin !== window.location.origin
    } catch {
      return false
    }
  }, [])

  // Determine if we should use proxy initially
  useEffect(() => {
    if (autoUseProxy && isExternalUrl(source) && !proxyAttempted) {
      setUseProxy(true)
      setProxyAttempted(true)
      logEvent('iframe_using_proxy', { source, reason: 'auto_for_external' })
    }
  }, [source, autoUseProxy, isExternalUrl, proxyAttempted, logEvent])

  // Report status changes to parent (top bar)
  useEffect(() => {
    if (!onStatusChange) return

    if (error) {
      onStatusChange({
        type: 'error',
        message: 'Unable to load content',
      })
    } else if (hasCompleted) {
      onStatusChange({
        type: 'success',
        message: 'Task completed',
      })
    } else if (!isReady) {
      onStatusChange({
        type: 'loading',
        message: 'Loading external task...',
      })
    } else {
      // Task is ready but not completed - clear status or show info
      onStatusChange(null)
    }
  }, [error, hasCompleted, isReady, onStatusChange])

  // Send message to iframe
  const sendMessageToIframe = useCallback(
    (message: IframeMessage) => {
      if (!iframeRef.current?.contentWindow) return

      try {
        // Determine target origin from source URL
        let targetOrigin = MESSAGE_ORIGIN_WILDCARD
        try {
          const sourceUrl = new URL(source, window.location.origin)
          targetOrigin = sourceUrl.origin
        } catch {
          // Keep wildcard if URL parsing fails
        }

        iframeRef.current.contentWindow.postMessage(message, targetOrigin)
      } catch (err) {
        console.error('[IframeSandbox] Failed to send message:', err)
      }
    },
    [source]
  )

  // Send initial config and context to iframe
  const sendInitialContext = useCallback(() => {
    sendMessageToIframe({
      type: 'bires:init',
      payload: {
        stageId,
        sessionId,
        config: config || {},
        previousData: stageData[stageId] || {},
        currentStageLabel: currentStage?.label,
      },
    })
  }, [sendMessageToIframe, stageId, sessionId, config, stageData, currentStage])

  // Handle incoming messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin
      // When using proxy, messages come from our own origin
      // When direct, messages come from the source origin
      const isFromOwnOrigin = event.origin === window.location.origin
      
      if (!isFromOwnOrigin) {
        // Check if it matches the original source URL
        try {
          const sourceUrl = new URL(source, window.location.origin)
          if (event.origin !== sourceUrl.origin) {
            // Skip messages from unknown origins
            return
          }
        } catch {
          // If URL parsing fails, be more permissive but log warning
          console.warn('[IframeSandbox] Could not validate message origin')
        }
      }

      const message = event.data as IncomingMessage

      if (!message || typeof message.type !== 'string') {
        return
      }

      // Only handle bires: prefixed messages
      if (!message.type.startsWith('bires:')) {
        return
      }

      switch (message.type) {
        case 'bires:ready':
          setIsReady(true)
          logEvent('iframe_ready')
          sendInitialContext()
          break

        case 'bires:complete':
          handleCompletion(message as IframeCompletionMessage)
          break

        case 'bires:progress':
          handleProgress(message as IframeProgressMessage)
          break

        case 'bires:event':
          handleCustomEvent(message as IframeEventMessage)
          break

        case 'bires:requestData':
          handleDataRequest()
          break

        default:
          console.warn('[IframeSandbox] Unknown message type:', (message as IframeMessage).type)
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [source, logEvent, sendInitialContext])

  // Handle completion message
  const handleCompletion = useCallback(
    (message: IframeCompletionMessage) => {
      if (hasCompleted) return

      setHasCompleted(true)
      const responseData = message.payload?.data || {}

      // Store iframe response data
      Object.entries(responseData).forEach(([key, value]) => {
        onFieldChange(key, value)
      })

      // Mark as completed
      onFieldChange('_iframe_completed', true)
      onFieldChange('_iframe_completion_time', Date.now())

      logEvent('iframe_complete', { responseData })

      if (autoComplete && onComplete) {
        onComplete()
      }
    },
    [hasCompleted, onFieldChange, logEvent, autoComplete, onComplete]
  )

  // Handle progress message
  const handleProgress = useCallback(
    (message: IframeProgressMessage) => {
      const { progress, metadata } = message.payload
      setIframeProgress(Math.min(100, Math.max(0, progress)))

      logEvent('iframe_progress', { progress, metadata })
    },
    [logEvent]
  )

  // Handle custom event message
  const handleCustomEvent = useCallback(
    (message: IframeEventMessage) => {
      const { eventType, data: eventData } = message.payload

      // Use standardized iframe_custom event type, with the actual type in payload
      logEvent('iframe_custom', { customEventType: eventType, ...eventData })
    },
    [logEvent]
  )

  // Handle data request from iframe
  const handleDataRequest = useCallback(() => {
    sendMessageToIframe({
      type: 'bires:data',
      payload: {
        stageData: stageData[stageId] || {},
        allStageData: stageData,
        currentData: data,
      },
    })
  }, [sendMessageToIframe, stageData, stageId, data])

  // Timeout handler
  useEffect(() => {
    if (!timeout || timeout <= 0) return

    const timeoutId = setTimeout(() => {
      if (!hasCompleted) {
        logEvent('iframe_timeout', { timeoutMs: timeout })
        setError(`Task timed out after ${timeout / 1000} seconds`)

        // Auto-complete on timeout if configured
        if (autoComplete && onComplete) {
          onFieldChange('_iframe_timed_out', true)
          onComplete()
        }
      }
    }, timeout)

    return () => clearTimeout(timeoutId)
  }, [timeout, hasCompleted, logEvent, autoComplete, onComplete, onFieldChange])

  // Get the actual iframe source (with proxy if needed)
  const getIframeSource = useCallback((): string => {
    if (useProxy) {
      const encodedUrl = encodeURIComponent(source)
      return `/api/proxy/content?url=${encodedUrl}`
    }
    return source
  }, [source, useProxy])

  // Handle iframe error (X-Frame-Options, CSP, etc.)
  const handleIframeError = useCallback(() => {
    // If we're not using proxy and haven't tried it, try proxy
    if (!useProxy && !proxyAttempted && isExternalUrl(source)) {
      setProxyAttempted(true)
      setUseProxy(true)
      setError(null) // Clear any previous error
      logEvent('iframe_proxy_fallback', { originalSource: source })
    } else {
      setError(
        'This website cannot be embedded in an iframe due to security restrictions (X-Frame-Options). ' +
        'The website owner has blocked embedding. Please contact the website administrator or use a different source.'
      )
      logEvent('iframe_blocked', { source, reason: 'X-Frame-Options' })
    }
  }, [source, isExternalUrl, useProxy, proxyAttempted, logEvent])

  // Log iframe load
  const handleIframeLoad = useCallback(() => {
    logEvent('iframe_loaded', { source: getIframeSource(), proxied: useProxy })

    // Check if iframe actually loaded content (detect X-Frame-Options blocking)
    setTimeout(() => {
      try {
        const iframe = iframeRef.current
        if (iframe && iframe.contentWindow) {
          // Try to access iframe content - if blocked, this will throw
          // Note: This is a best-effort detection, may not catch all cases
          try {
            // Accessing contentWindow.location will throw if blocked by X-Frame-Options
            const iframeLocation = iframe.contentWindow.location.href
            if (iframeLocation === 'about:blank' || iframeLocation === '') {
              // Iframe is blocked
              handleIframeError()
              return
            }
          } catch (e) {
            // Cross-origin or blocked - this is expected for external sites
            // We can't reliably detect X-Frame-Options blocking from JavaScript
            // The browser console will show the error, but we can't catch it programmatically
          }
        }
      } catch (e) {
        // Ignore errors during detection
      }

      // Send a ready probe after load
      sendMessageToIframe({ type: 'bires:ping' })
    }, 100)
  }, [logEvent, getIframeSource, useProxy, sendMessageToIframe, handleIframeError])

  // Build sandbox attribute
  // Note: fullscreen is NOT a valid sandbox token - it's controlled via the 'allow' attribute instead
  const buildSandboxPermissions = () => {
    const permissions = ['allow-scripts', 'allow-same-origin', 'allow-forms']

    if (allowClipboard) {
      permissions.push('allow-clipboard-read', 'allow-clipboard-write')
    }

    return permissions.join(' ')
  }

  // Validate completion before allowing navigation
  const isValid = () => {
    if (requiredFields.length === 0) return true

    for (const field of requiredFields) {
      if (!data[field]) return false
    }

    return true
  }

  return (
    <div className="space-y-4">
      {/* Progress bar (if iframe reports progress) */}
      {iframeProgress > 0 && !hasCompleted && (
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${iframeProgress}%` }}
          />
        </div>
      )}

      {/* Error details - shown inline when there's an error, since top bar only shows brief message */}
      {error && (
        <div className="p-4 bg-error/10 border border-error rounded-lg text-error text-sm space-y-2">
          <p className="font-medium">Unable to load content</p>
          <p>{error}</p>
          {isExternalUrl(source) && !useProxy && autoUseProxy && !proxyAttempted && (
            <button
              onClick={() => {
                setProxyAttempted(true)
                setUseProxy(true)
                setError(null)
              }}
              className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 text-sm"
            >
              Try using proxy
            </button>
          )}
        </div>
      )}

      {/* Iframe container */}
      <div 
        className="rounded-lg overflow-hidden border border-border relative"
        style={{ 
          width,
          marginLeft: isFullWidth ? 'calc((100% - (100vw - 256px - 2rem)) / 2)' : undefined,
          maxWidth: isFullWidth ? 'none' : undefined,
        }}
      >
        <iframe
          ref={iframeRef}
          src={getIframeSource()}
          className="w-full bg-white"
          style={{ height }}
          sandbox={buildSandboxPermissions()}
          allow={allowFullscreen ? 'fullscreen' : ''}
          title={currentStage?.label || 'External Task'}
          onLoad={handleIframeLoad}
        />

        {/* Overlay when loading */}
        {!isReady && !error && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-sm" />
        )}
      </div>

      {/* Validation error (shown after attempting to continue) */}
      {errors?._iframe_completed && (
        <p className="text-sm text-error font-medium">
          {errors._iframe_completed}
        </p>
      )}

      {/* Validation warning (shown proactively) */}
      {!isValid() && !hasCompleted && !errors?._iframe_completed && (
        <p className="text-sm text-warning">
          Please complete the task above before continuing.
        </p>
      )}
    </div>
  )
}

