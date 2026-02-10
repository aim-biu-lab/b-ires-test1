import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../../lib/api'
import { eventQueue } from '../../lib/eventQueue'
import { useSessionStore } from '../../store/sessionStore'
import { ExternalTaskSocket, ExternalTaskState } from '../../lib/externalTaskSocket'

interface TopBarStatus {
  type: 'loading' | 'success' | 'warning' | 'error' | 'info'
  message: string
}

type CompletionMode = 'required' | 'optional' | 'manual'
type TimeoutAction = 'prompt' | 'skip' | 'retry' | 'fail'
type WindowMode = 'popup' | 'fullscreen' | 'tab'

interface ExternalTaskConfig {
  // Button configuration
  button_text?: string
  button_open_text?: string
  reopen_button_text?: string
  
  // Completion behavior
  completion_mode?: CompletionMode
  
  // Timeout configuration
  timeout_ms?: number
  timeout_action?: TimeoutAction
  allow_retry_on_timeout?: boolean
  max_retries?: number
  
  // Window management
  try_close_on_complete?: boolean
  window_mode?: WindowMode
  window_width?: number
  window_height?: number
  
  // UI messages
  waiting_message?: string
  completed_message?: string
  timeout_message?: string
  ready_text?: string
  ready_description?: string
  continue_button_text?: string
  
  // Pre-open block (optional block shown above the open button)
  pre_open_title?: string
  pre_open_description?: string  // Supports HTML formatting
  pre_open_block_width?: string  // If not set, uses block_width
  pre_open_confirmation_enabled?: boolean
  pre_open_confirmation_text?: string
  
  // Block layout
  block_width?: string
  
  // URL parameters
  pass_session_id?: boolean
  pass_stage_id?: boolean
  custom_params?: Record<string, string>
  
  // Reverse control
  enable_reverse_control?: boolean
  reverse_commands?: string[]
}

interface ExternalTaskBlockProps {
  targetUrl: string
  config?: ExternalTaskConfig
  stageId: string
  onComplete?: () => void
  data: Record<string, unknown>
  errors?: Record<string, string>
  onFieldChange: (fieldId: string, value: unknown) => void
  onStatusChange?: (status: TopBarStatus | null) => void
  readOnly?: boolean
}

const DEFAULT_CONFIG: ExternalTaskConfig = {
  button_text: 'Open Task',
  button_open_text: 'Task Opened',
  reopen_button_text: 'Reopen Task',
  completion_mode: 'required',
  timeout_ms: 0,
  timeout_action: 'prompt',
  allow_retry_on_timeout: true,
  max_retries: 3,
  try_close_on_complete: true,
  window_mode: 'popup',
  window_width: 1200,
  window_height: 800,
  waiting_message: 'Waiting for task completion...',
  completed_message: 'Task completed successfully!',
  timeout_message: 'Task timed out. Would you like to try again?',
  ready_text: 'Ready to start',
  ready_description: '',
  continue_button_text: 'Continue',
  pre_open_confirmation_enabled: false,
  pre_open_confirmation_text: 'I understand',
  block_width: '40%',
  pass_session_id: true,
  pass_stage_id: true,
  enable_reverse_control: false,
}

export default function ExternalTaskBlock({
  targetUrl,
  config: configProp,
  stageId,
  onComplete,
  data,
  errors,
  onFieldChange,
  onStatusChange,
  readOnly = false,
}: ExternalTaskBlockProps) {
  const sessionId = useSessionStore((state) => state.sessionId)
  
  // Merge config with defaults (memoized to prevent infinite re-render loops)
  const config = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...configProp }),
    [configProp]
  )
  
  // State - initialize with saved completion status if available
  const [taskToken, setTaskToken] = useState<string | null>(null)
  const [taskUrl, setTaskUrl] = useState<string | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [taskState, setTaskState] = useState<ExternalTaskState>(() => ({
    status: data._external_task_completed === true ? 'completed' : 'pending',
    progress: data._external_task_completed === true ? 100 : 0,
    currentStep: null,
    externalAppConnected: false,
    data: null,
  }))
  const [isInitializing, setIsInitializing] = useState(false)
  const [isWindowOpen, setIsWindowOpen] = useState(false)
  const [hasTimedOut, setHasTimedOut] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showTimeoutDialog, setShowTimeoutDialog] = useState(false)
  const [confirmationChecked, setConfirmationChecked] = useState(false)
  const [confirmationError, setConfirmationError] = useState(false)
  
  // Log event helper (defined early so refs can reference it)
  const logEvent = useCallback(
    (eventType: string, payload: Record<string, unknown> = {}) => {
      if (!sessionId) return
      eventQueue.addEvent({
        sessionId,
        eventType,
        stageId,
        blockId: 'external_task',
        payload,
      })
    },
    [sessionId, stageId]
  )

  // Refs
  const externalWindowRef = useRef<Window | null>(null)
  const socketRef = useRef<ExternalTaskSocket | null>(null)
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const windowCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completionHandledRef = useRef(data._external_task_completed === true)  // Initialize based on saved state
  const isCompletedRef = useRef(data._external_task_completed === true)  // Track completion for closures
  const logEventRef = useRef(logEvent)  // Ref to avoid stale closures in WebSocket handlers
  
  // Derived state - check both WebSocket status and previously saved completion flag
  const isCompleted = taskState.status === 'completed' || data._external_task_completed === true
  
  // Keep refs in sync with current values
  isCompletedRef.current = isCompleted
  logEventRef.current = logEvent
  
  // Ensure completionHandledRef is true if data indicates completion
  // This handles cases where the component re-renders after completion
  if (data._external_task_completed === true) {
    completionHandledRef.current = true
  }

  // Check if we're in preview mode (session ID starts with "preview-")
  const isPreviewMode = sessionId?.startsWith('preview-') ?? false

  // Initialize external task
  const initializeTask = useCallback(async () => {
    // Skip initialization in preview mode - there's no real backend session
    if (isPreviewMode) {
      console.log('[ExternalTask] Skipping init in preview mode')
      return
    }
    
    // Skip initialization if readOnly (already submitted) or already completed
    if (readOnly || data._external_task_completed) {
      console.log('[ExternalTask] Skipping init - stage already completed')
      return
    }
    
    if (!sessionId || isInitializing || taskToken) return
    
    setIsInitializing(true)
    setError(null)
    
    try {
      // Include platform_host so external apps can connect to the right WebSocket server
      const platformHost = window.location.host
      const response = await api.post(`/external-tasks/init?session_id=${sessionId}&platform_host=${encodeURIComponent(platformHost)}`, {
        stage_id: stageId,
        target_url: targetUrl,
        config: config,
      })
      
      const { task_token, target_url: fullUrl, ws_url } = response.data
      
      setTaskToken(task_token)
      setTaskUrl(fullUrl)
      setWsUrl(ws_url)
      
      logEvent('external_task_init', { taskToken: task_token })
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize task'
      setError(message)
      console.error('[ExternalTask] Init error:', err)
    } finally {
      setIsInitializing(false)
    }
  }, [sessionId, stageId, targetUrl, config, isInitializing, taskToken, logEvent, isPreviewMode, readOnly, data._external_task_completed])

  // Connect WebSocket
  useEffect(() => {
    if (!taskToken || !wsUrl) return
    
    const socket = new ExternalTaskSocket(taskToken, wsUrl)
    socketRef.current = socket
    
    // Handle status changes
    const unsubStatus = socket.onStatusChange((state) => {
      // Preserve completed state - once completed, NEVER allow reset to any other status
      // This is critical because:
      // 1. Socket reconnection sends initial 'pending' status
      // 2. External app disconnect can trigger status updates
      // 3. Race conditions between state updates
      setTaskState((prevState) => {
        // Once completed (via any source), stay completed forever
        if (prevState.status === 'completed') {
          // Only update non-status fields, keep status as 'completed'
          if (state.status !== 'completed') {
            console.log('[ExternalTask] Preserving completed state (prevState), ignoring:', state.status)
          }
          return { ...state, status: 'completed', progress: 100 }
        }
        
        // Also check refs for cases where prevState hasn't updated yet
        if (completionHandledRef.current && state.status !== 'completed') {
          console.log('[ExternalTask] Preserving completed state (ref), ignoring:', state.status)
          return { ...state, status: 'completed', progress: 100 }
        }
        
        return state
      })
      
      // Handle completion (pass closeWindow flag from external task)
      // Only handle if not already completed (use completionHandledRef as it's set synchronously)
      if (state.status === 'completed' && !completionHandledRef.current) {
        handleTaskCompleted(state.data, state.closeWindow)
      }
    })
    
    // Handle close_window_request from external task
    // This handles cross-domain window closing when window.close() doesn't work
    // Flow: Parent sends close command -> Child receives, calls _closeWindow() ->
    //       Child sends close_window_request via WebSocket -> Parent closes popup
    const unsubCloseRequest = socket.on('close_window_request', () => {
      console.log('[ExternalTask] Received close_window_request from external task via WebSocket')
      
      if (externalWindowRef.current && !externalWindowRef.current.closed) {
        try {
          externalWindowRef.current.close()
          setIsWindowOpen(false)
          logEventRef.current('external_task_window_closed_via_websocket', {})
        } catch (e) {
          console.log('[ExternalTask] Could not close window via WebSocket handler:', e)
        }
      }
    })
    
    // Connect
    socket.connect().catch((err) => {
      console.error('[ExternalTask] WebSocket connection error:', err)
    })
    
    return () => {
      unsubStatus()
      unsubCloseRequest()
      socket.disconnect()
      socketRef.current = null
    }
  }, [taskToken, wsUrl])  // Removed logEvent - using ref instead to prevent socket recreation

  // Sync taskState with data._external_task_completed
  // This ensures the UI always reflects the saved completion state
  useEffect(() => {
    if (data._external_task_completed === true && taskState.status !== 'completed') {
      console.log('[ExternalTask] Syncing state with saved completion flag')
      setTaskState((prev) => ({ ...prev, status: 'completed', progress: 100 }))
    }
  }, [data._external_task_completed, taskState.status])

  // Initialize task on mount
  useEffect(() => {
    initializeTask()
  }, []) // Only run once on mount

  // Handle task completion
  const handleTaskCompleted = useCallback((completionData: Record<string, unknown> | null, closeWindow?: boolean) => {
    // Guard against double completion (can happen with WebSocket reconnects or React re-renders)
    if (completionHandledRef.current) {
      console.log('[ExternalTask] Completion already handled, skipping')
      return
    }
    completionHandledRef.current = true
    
    // Clear timeout
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current)
      timeoutTimerRef.current = null
    }
    
    // Store completion data
    onFieldChange('_external_task_completed', true)
    onFieldChange('_external_task_completion_time', Date.now())
    if (completionData) {
      onFieldChange('_external_task_data', completionData)
    }
    
    logEvent('external_task_complete', { data: completionData, closeWindow })
    
    // Close external window if:
    // - closeWindow flag is true (sent by external task in complete message), OR
    // - config.try_close_on_complete is enabled
    const shouldCloseWindow = closeWindow || config.try_close_on_complete
    
    if (shouldCloseWindow && externalWindowRef.current) {
      console.log('[ExternalTask] Closing external task window', { closeWindow, configClose: config.try_close_on_complete })
      
      try {
        // Close window directly - this works because parent opened the window
        externalWindowRef.current.close()
        setIsWindowOpen(false)
        logEvent('external_task_window_closed_on_complete', {})
      } catch (e) {
        console.log('[ExternalTask] Could not close window:', e)
        
        // Fallback: Send close command via WebSocket
        socketRef.current?.sendClose()
      }
    }
    
    // Note: We no longer auto-advance here. User must click "Continue" button.
  }, [config.try_close_on_complete, onFieldChange, logEvent])

  // Open external window
  const openExternalWindow = useCallback(() => {
    if (!taskUrl) return
    
    let windowFeatures = ''
    
    switch (config.window_mode) {
      case 'fullscreen':
        // Use screen dimensions for fullscreen
        windowFeatures = `width=${screen.width},height=${screen.height},left=0,top=0`
        break
      case 'popup':
        // Centered popup
        const left = (screen.width - (config.window_width || 1200)) / 2
        const top = (screen.height - (config.window_height || 800)) / 2
        windowFeatures = `width=${config.window_width},height=${config.window_height},left=${left},top=${top}`
        break
      case 'tab':
        // No features = new tab
        windowFeatures = ''
        break
    }
    
    const newWindow = window.open(taskUrl, '_blank', windowFeatures)
    
    if (newWindow) {
      externalWindowRef.current = newWindow
      setIsWindowOpen(true)
      
      logEvent('external_task_window_opened', {
        windowMode: config.window_mode,
      })
      
      // Start checking if window is closed
      if (windowCheckIntervalRef.current) {
        clearInterval(windowCheckIntervalRef.current)
      }
      
      windowCheckIntervalRef.current = setInterval(() => {
        if (newWindow.closed) {
          setIsWindowOpen(false)
          logEvent('external_task_window_closed', {})
          
          if (windowCheckIntervalRef.current) {
            clearInterval(windowCheckIntervalRef.current)
            windowCheckIntervalRef.current = null
          }
        }
      }, 500)
      
      // Start timeout timer if configured
      if (config.timeout_ms && config.timeout_ms > 0) {
        startTimeoutTimer()
      }
    } else {
      setError('Could not open external window. Please check your popup blocker settings.')
    }
  }, [taskUrl, config, logEvent])

  // Handle open button click with confirmation check
  const handleOpenClick = useCallback(() => {
    if (config.pre_open_confirmation_enabled && !confirmationChecked) {
      setConfirmationError(true)
      return
    }
    openExternalWindow()
  }, [config.pre_open_confirmation_enabled, confirmationChecked, openExternalWindow])

  // Start timeout timer
  const startTimeoutTimer = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current)
    }
    
    timeoutTimerRef.current = setTimeout(() => {
      handleTimeout()
    }, config.timeout_ms)
  }, [config.timeout_ms])

  // Handle timeout
  const handleTimeout = useCallback(() => {
    if (isCompleted) return
    
    setHasTimedOut(true)
    logEvent('external_task_timeout', { action: config.timeout_action })
    
    switch (config.timeout_action) {
      case 'prompt':
        setShowTimeoutDialog(true)
        break
      case 'skip':
        // Allow proceeding without completion
        onFieldChange('_external_task_timed_out', true)
        if (onComplete) {
          onComplete()
        }
        break
      case 'retry':
        if (config.max_retries === 0 || retryCount < (config.max_retries || 3)) {
          handleRetry()
        } else {
          setShowTimeoutDialog(true)
        }
        break
      case 'fail':
        setError('Task timed out. Please contact the researcher.')
        break
    }
  }, [isCompleted, config.timeout_action, config.max_retries, retryCount, logEvent, onFieldChange, onComplete])

  // Handle retry
  const handleRetry = useCallback(async () => {
    if (!taskToken) return
    
    setShowTimeoutDialog(false)
    setHasTimedOut(false)
    setError(null)
    completionHandledRef.current = false  // Reset completion guard for retry
    
    try {
      await api.post(`/external-tasks/${taskToken}/retry`)
      setRetryCount((prev) => prev + 1)
      
      // Reset task state
      setTaskState({
        status: 'pending',
        progress: 0,
        currentStep: null,
        externalAppConnected: false,
        data: null,
      })
      
      logEvent('external_task_retry', { retryCount: retryCount + 1 })
      
      // Send restart command to external app
      socketRef.current?.sendRestart()
      
      // Reopen window if closed
      if (!isWindowOpen || externalWindowRef.current?.closed) {
        openExternalWindow()
      }
      
      // Restart timeout timer
      if (config.timeout_ms && config.timeout_ms > 0) {
        startTimeoutTimer()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retry task'
      setError(message)
    }
  }, [taskToken, retryCount, isWindowOpen, config.timeout_ms, logEvent, openExternalWindow, startTimeoutTimer])

  // Handle manual complete
  const handleManualComplete = useCallback(async () => {
    if (!taskToken) return
    
    try {
      await api.post(`/external-tasks/${taskToken}/manual-complete`)
      
      onFieldChange('_external_task_completed', true)
      onFieldChange('_external_task_manual_complete', true)
      onFieldChange('_external_task_completion_time', Date.now())
      
      logEvent('external_task_manual_complete', {})
      
      setTaskState((prev) => ({ ...prev, status: 'completed' }))
      
      if (onComplete) {
        onComplete()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark as complete'
      setError(message)
    }
  }, [taskToken, onFieldChange, logEvent, onComplete])

  // Handle skip (for optional mode)
  const handleSkip = useCallback(() => {
    onFieldChange('_external_task_skipped', true)
    logEvent('external_task_skip', {})
    
    if (onComplete) {
      onComplete()
    }
  }, [onFieldChange, logEvent, onComplete])

  // Update top bar status
  useEffect(() => {
    if (!onStatusChange) return
    
    if (error) {
      onStatusChange({ type: 'error', message: 'External task error' })
    } else if (isCompleted) {
      onStatusChange({ type: 'success', message: config.completed_message || 'Task completed!' })
    } else if (hasTimedOut) {
      onStatusChange({ type: 'warning', message: 'Task timed out' })
    } else if (taskState.externalAppConnected) {
      onStatusChange({ type: 'info', message: config.waiting_message || 'Task in progress...' })
    } else if (isWindowOpen) {
      onStatusChange({ type: 'loading', message: 'Waiting for external app...' })
    } else if (isInitializing) {
      onStatusChange({ type: 'loading', message: 'Initializing...' })
    } else {
      onStatusChange(null)
    }
  }, [error, isCompleted, hasTimedOut, taskState.externalAppConnected, isWindowOpen, isInitializing, config, onStatusChange])

  // Listen for postMessage close requests from external task windows
  // This handles cross-domain window closing when window.close() doesn't work
  useEffect(() => {
    // Extract origin from targetUrl to build allowed origins list
    const getAllowedOrigins = (): string[] => {
      const origins: string[] = [
        'http://localhost:8080',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
      ]
      
      // Add the targetUrl's origin if it's a valid URL
      try {
        const url = new URL(targetUrl)
        if (url.origin && !origins.includes(url.origin)) {
          origins.push(url.origin)
        }
      } catch {
        // targetUrl might be a relative URL or invalid, skip
      }
      
      // Also add the taskUrl's origin when available
      if (taskUrl) {
        try {
          const url = new URL(taskUrl)
          if (url.origin && !origins.includes(url.origin)) {
            origins.push(url.origin)
          }
        } catch {
          // taskUrl might be invalid, skip
        }
      }
      
      return origins
    }
    
    const handlePostMessage = (event: MessageEvent) => {
      const allowedOrigins = getAllowedOrigins()
      
      // Validate the message is from an allowed origin
      if (!allowedOrigins.includes(event.origin)) {
        return // Ignore messages from unknown origins
      }
      
      // Handle close request
      if (event.data && event.data.type === 'external_task_close') {
        console.log('[ExternalTask] Received close request from external task via postMessage')
        
        if (externalWindowRef.current && !externalWindowRef.current.closed) {
          try {
            externalWindowRef.current.close()
            setIsWindowOpen(false)
            logEvent('external_task_window_closed_via_postmessage', {
              origin: event.origin,
            })
          } catch (e) {
            console.log('[ExternalTask] Could not close window via postMessage handler:', e)
          }
        }
      }
    }
    
    window.addEventListener('message', handlePostMessage)
    
    return () => {
      window.removeEventListener('message', handlePostMessage)
    }
  }, [targetUrl, taskUrl, logEvent])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current)
      }
      if (windowCheckIntervalRef.current) {
        clearInterval(windowCheckIntervalRef.current)
      }
    }
  }, [])

  // Determine button text
  const getButtonText = () => {
    if (isWindowOpen && !externalWindowRef.current?.closed) {
      return config.button_open_text || 'Task Opened'
    }
    if (taskState.externalAppConnected || taskState.status !== 'pending') {
      return config.reopen_button_text || 'Reopen Task'
    }
    return config.button_text || 'Open Task'
  }

  // Check if can retry
  const canRetry = config.max_retries === 0 || retryCount < (config.max_retries || 3)

  // Pre-open block visibility
  const hasPreOpenBlock = !!(config.pre_open_title || config.pre_open_description)
  
  // Whether confirmation is required but not yet given
  const needsConfirmation = config.pre_open_confirmation_enabled && !confirmationChecked

  // Width for the pre-open block
  const preOpenBlockWidth = config.pre_open_block_width || config.block_width || '40%'

  // Preview mode UI
  if (isPreviewMode) {
    return (
      <div className="flex flex-col items-center" style={{ marginTop: '5vh' }}>
        {/* Pre-open block preview */}
        {hasPreOpenBlock && (
          <div
            className="mb-6 p-6 bg-surface border border-border rounded-lg"
            style={{ width: preOpenBlockWidth, minWidth: '280px' }}
          >
            {config.pre_open_title && (
              <h3 className="text-lg font-semibold mb-3">{config.pre_open_title}</h3>
            )}
            {config.pre_open_description && (
              <div
                className="text-sm text-text-muted prose prose-sm max-w-none [&_a]:text-primary [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: config.pre_open_description }}
              />
            )}
            {config.pre_open_confirmation_enabled && (
              <div className={`mt-4 pt-4 border-t transition-colors ${confirmationError && !confirmationChecked ? 'border-error' : 'border-border'}`}>
                <label className={`flex items-start gap-3 cursor-pointer select-none rounded-lg p-3 -m-3 transition-colors ${confirmationError && !confirmationChecked ? 'bg-error/10' : ''}`}>
                  <input
                    type="checkbox"
                    checked={confirmationChecked}
                    onChange={(e) => {
                      setConfirmationChecked(e.target.checked)
                      if (e.target.checked) setConfirmationError(false)
                    }}
                    className={`mt-0.5 h-5 w-5 rounded border-2 text-primary focus:ring-primary shrink-0 transition-colors ${confirmationError && !confirmationChecked ? 'border-error' : 'border-border'}`}
                  />
                  <span className={`text-sm font-medium ${confirmationError && !confirmationChecked ? 'text-error' : ''}`}>
                    {config.pre_open_confirmation_text || 'I understand'}
                  </span>
                </label>
                {confirmationError && !confirmationChecked && (
                  <p className="text-xs text-error mt-2 ml-8">Please confirm before proceeding</p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-6" style={{ width: config.block_width || '40%', minWidth: '280px' }}>
          <div className="p-6 bg-surface border border-border rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full bg-surface-elevated" />
              <span className="text-sm text-text-muted">{config.ready_text || 'Ready to start'} (Preview)</span>
            </div>
            {config.ready_description && (
              <p className="text-sm text-text-muted mb-4">
                {config.ready_description}
              </p>
            )}
            <p className="text-sm text-text-muted mb-4">
              External task functionality is disabled in preview mode. In a real session, this would open an external window to: <code className="text-xs bg-surface-elevated px-1 py-0.5 rounded">{targetUrl}</code>
            </p>
            <button
              onClick={() => {
                if (needsConfirmation) {
                  setConfirmationError(true)
                  return
                }
              }}
              className="w-full py-3 px-6 rounded-lg font-medium bg-primary text-white cursor-not-allowed opacity-50"
            >
              {config.button_text || 'Open Task'} (Preview)
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center" style={{ marginTop: '5vh' }}>
      {/* Pre-open block (optional, shown above the main card when not completed) */}
      {hasPreOpenBlock && !isCompleted && (
        <div
          className="mb-6 p-6 bg-surface border border-border rounded-lg"
          style={{ width: preOpenBlockWidth, minWidth: '280px' }}
        >
          {config.pre_open_title && (
            <h3 className="text-lg font-semibold mb-3">{config.pre_open_title}</h3>
          )}
          {config.pre_open_description && (
            <div
              className="text-sm text-text-muted prose prose-sm max-w-none [&_a]:text-primary [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: config.pre_open_description }}
            />
          )}
          {config.pre_open_confirmation_enabled && (
            <div className={`mt-4 pt-4 border-t transition-colors ${confirmationError && !confirmationChecked ? 'border-error' : 'border-border'}`}>
              <label className={`flex items-start gap-3 cursor-pointer select-none rounded-lg p-3 -m-3 transition-colors ${confirmationError && !confirmationChecked ? 'bg-error/10' : ''}`}>
                <input
                  type="checkbox"
                  checked={confirmationChecked}
                  onChange={(e) => {
                    setConfirmationChecked(e.target.checked)
                    if (e.target.checked) setConfirmationError(false)
                  }}
                  className={`mt-0.5 h-5 w-5 rounded border-2 text-primary focus:ring-primary shrink-0 transition-colors ${confirmationError && !confirmationChecked ? 'border-error' : 'border-border'}`}
                />
                <span className={`text-sm font-medium ${confirmationError && !confirmationChecked ? 'text-error' : ''}`}>
                  {config.pre_open_confirmation_text || 'I understand'}
                </span>
              </label>
              {confirmationError && !confirmationChecked && (
                <p className="text-xs text-error mt-2 ml-8">Please confirm before proceeding</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-6" style={{ width: config.block_width || '40%', minWidth: '280px' }}>
        {/* Error display */}
        {error && (
          <div className="p-4 bg-error/10 border border-error rounded-lg text-error">
            <p className="font-medium">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Main content */}
        <div className="p-6 bg-surface border border-border rounded-lg">
          {/* Status indicator */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-3 h-3 rounded-full ${
                isCompleted
                  ? 'bg-success'
                  : taskState.externalAppConnected
                  ? 'bg-primary animate-pulse'
                  : isWindowOpen
                  ? 'bg-warning'
                  : 'bg-surface-elevated'
              }`}
            />
            <span className="text-sm text-text-muted">
              {isCompleted
                ? 'Completed'
                : taskState.externalAppConnected
                ? 'External app connected'
                : isWindowOpen
                ? 'Window opened, waiting for connection...'
                : config.ready_text || 'Ready to start'}
            </span>
          </div>

          {/* Ready description */}
          {!isCompleted && !isWindowOpen && !taskState.externalAppConnected && config.ready_description && (
            <p className="text-sm text-text-muted mb-4">
              {config.ready_description}
            </p>
          )}

          {/* Progress bar */}
          {taskState.progress > 0 && !isCompleted && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-text-muted mb-1">
                <span>Progress</span>
                <span>{taskState.progress}%</span>
              </div>
              <div className="h-2 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${taskState.progress}%` }}
                />
              </div>
              {taskState.currentStep && (
                <p className="text-xs text-text-muted mt-1">
                  Current step: {taskState.currentStep}
                </p>
              )}
            </div>
          )}

          {/* Open button - hide when completed or readOnly */}
          {!isCompleted && !readOnly && (
            <button
              onClick={handleOpenClick}
              disabled={!taskUrl || isInitializing}
              className={`w-full py-3 px-6 rounded-lg font-medium transition-colors ${
                isWindowOpen && !externalWindowRef.current?.closed
                  ? 'bg-surface-elevated text-text-muted cursor-default'
                  : 'bg-primary text-white hover:bg-primary/90'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isInitializing ? 'Initializing...' : getButtonText()}
            </button>
          )}

          {/* Completed message */}
          {isCompleted && (
            <>
              <div className="p-4 bg-success/10 border border-success rounded-lg text-success">
                <p className="font-medium">{config.completed_message}</p>
                {taskState.data && '{}' !== JSON.stringify(taskState.data, null, 2) && (
                  <pre className="mt-2 text-xs text-text-muted overflow-auto">
                    {JSON.stringify(taskState.data, null, 2)}
                  </pre>
                )}
              </div>
              
              {/* Continue button - only show if not readOnly */}
              {!readOnly && onComplete && (
                <button
                  onClick={onComplete}
                  className="mt-4 w-full py-3 px-6 rounded-lg font-medium bg-primary text-white hover:bg-primary/90 transition-colors"
                >
                  {config.continue_button_text || 'Continue'}
                </button>
              )}
            </>
          )}

          {/* Manual complete button */}
          {config.completion_mode === 'manual' && !isCompleted && (
            <button
              onClick={handleManualComplete}
              className="mt-4 w-full py-2 px-4 border border-border rounded-lg text-sm hover:bg-surface-elevated transition-colors"
            >
              Mark as Done
            </button>
          )}

          {/* Skip button for optional mode */}
          {config.completion_mode === 'optional' && !isCompleted && (
            <button
              onClick={handleSkip}
              className="mt-4 w-full py-2 px-4 text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              Skip this task
            </button>
          )}

          {/* Retry info */}
          {retryCount > 0 && (
            <p className="mt-2 text-xs text-text-muted text-center">
              Retry attempt: {retryCount}
              {config.max_retries && config.max_retries > 0 && ` / ${config.max_retries}`}
            </p>
          )}
        </div>

        {/* Reverse control buttons (if enabled) */}
        {config.enable_reverse_control && taskState.externalAppConnected && !isCompleted && (
          <div className="p-4 bg-surface-elevated/50 border border-border rounded-lg">
            <p className="text-sm font-medium mb-3">Task Controls</p>
            <div className="flex flex-wrap gap-2">
              {config.reverse_commands?.includes('restart') && (
                <button
                  onClick={() => socketRef.current?.sendRestart()}
                  className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-elevated transition-colors"
                >
                  Restart
                </button>
              )}
              {config.reverse_commands?.includes('pause') && (
                <button
                  onClick={() => socketRef.current?.sendPause()}
                  className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-elevated transition-colors"
                >
                  Pause
                </button>
              )}
              {config.reverse_commands?.includes('resume') && (
                <button
                  onClick={() => socketRef.current?.sendResume()}
                  className="px-3 py-1.5 text-sm border border-border rounded hover:bg-surface-elevated transition-colors"
                >
                  Resume
                </button>
              )}
            </div>
          </div>
        )}

        {/* Timeout dialog */}
        {showTimeoutDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface border border-border rounded-lg p-6 max-w-md mx-4 shadow-lg">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Task Timed Out</h3>
              <p className="text-text-muted mb-4">
                {config.timeout_message}
              </p>
              <div className="flex gap-3">
                {config.allow_retry_on_timeout && canRetry && (
                  <button
                    onClick={handleRetry}
                    className="flex-1 py-2 px-4 bg-primary text-text-inverse rounded-lg hover:bg-primary-hover transition-colors"
                  >
                    Try Again
                  </button>
                )}
                {config.completion_mode !== 'required' && (
                  <button
                    onClick={() => {
                      setShowTimeoutDialog(false)
                      handleSkip()
                    }}
                    className="flex-1 py-2 px-4 border border-border rounded-lg hover:bg-surface-elevated transition-colors"
                  >
                    Skip
                  </button>
                )}
                {!canRetry && config.completion_mode === 'required' && (
                  <p className="text-sm text-error">
                    Maximum retries exceeded. Please contact the researcher.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Validation error */}
        {errors?._external_task_completed && (
          <p className="text-sm text-error font-medium">
            {errors._external_task_completed}
          </p>
        )}
      </div>
    </div>
  )
}


