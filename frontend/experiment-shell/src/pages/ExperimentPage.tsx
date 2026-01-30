import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useSessionStore } from '../store/sessionStore'
import ExperimentShell from '../components/ExperimentShell'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorDisplay from '../components/ErrorDisplay'
import SessionResumeDialog from '../components/SessionResumeDialog'
import AlreadyCompletedMessage from '../components/AlreadyCompletedMessage'
import { api } from '../lib/api'
import { createHotEditReceiver, HotEditReceiver } from '../lib/hot-edit-receiver'
import { toast } from '../store/toastStore'

export default function ExperimentPage() {
  const { experimentId } = useParams()
  const [searchParams] = useSearchParams()
  const [isFetchingExperiments, setIsFetchingExperiments] = useState(false)
  const [resolvedExpId, setResolvedExpId] = useState<string | null>(null)
  const [urlParams, setUrlParams] = useState<Record<string, string>>({})
  const initRef = useRef(false)
  const hotEditReceiverRef = useRef<HotEditReceiver | null>(null)
  const refreshToastIdRef = useRef<string | null>(null)
  
  const {
    sessionId,
    sessionStatus,
    currentStage,
    progress,
    isLoading,
    error,
    previewMode,
    pendingRefresh,
    startSession,
    recoverSession,
    confirmResumeSession,
    startNewSession,
    clearError,
    initPreviewMode,
    updatePreviewConfig,
    setPendingRefresh,
    exitPreviewMode,
  } = useSessionStore()

  // Check if this is a preview mode request
  const isPreviewRequest = searchParams.get('preview') === 'hot-edit'
  const previewExpId = searchParams.get('exp')

  // Handle refresh action for structural changes
  const handleRefresh = useCallback(() => {
    const { previewConfig } = useSessionStore.getState()
    if (previewConfig && previewExpId) {
      // Re-initialize preview mode with current config
      initPreviewMode(previewExpId, previewConfig)
      setPendingRefresh(false)
      // Dismiss the refresh toast if it exists
      if (refreshToastIdRef.current) {
        useSessionStore.getState()
        refreshToastIdRef.current = null
      }
      toast.success('Preview refreshed with latest changes')
    }
  }, [previewExpId, initPreviewMode, setPendingRefresh])

  // Show toast when pendingRefresh changes to true
  useEffect(() => {
    if (pendingRefresh && previewMode && !refreshToastIdRef.current) {
      refreshToastIdRef.current = toast.confirm(
        'Structural changes detected. Refresh to see the updated experiment structure.',
        handleRefresh,
        () => {
          refreshToastIdRef.current = null
        },
        {
          confirmLabel: 'Refresh Now',
          cancelLabel: 'Later',
        }
      )
    }
  }, [pendingRefresh, previewMode, handleRefresh])

  // Initialize preview mode
  useEffect(() => {
    if (!isPreviewRequest || !previewExpId) return
    if (initRef.current) return
    initRef.current = true

    // Create the hot edit receiver
    const receiver = createHotEditReceiver(previewExpId)
    hotEditReceiverRef.current = receiver

    receiver.open({
      onConfigUpdate: (config, isStructuralChange) => {
        // Check if preview mode is already initialized
        const { previewMode } = useSessionStore.getState()
        if (!previewMode && previewExpId) {
          // First config received - initialize preview mode
          initPreviewMode(previewExpId, config)
        } else {
          // Subsequent updates - just update the config
          updatePreviewConfig(config, isStructuralChange)
        }
      },
      onEditorClosed: () => {
        toast.warning('Editor disconnected. Changes will no longer sync.')
      },
      onConnected: () => {
        toast.info('Preview Mode Active - Changes will appear automatically', {
          duration: 5000,
        })
      },
    })

    // Cleanup on unmount
    return () => {
      if (hotEditReceiverRef.current) {
        hotEditReceiverRef.current.close()
        hotEditReceiverRef.current = null
      }
      exitPreviewMode()
      // Reset initRef so effect can run again after React Strict Mode remount
      initRef.current = false
    }
  }, [isPreviewRequest, previewExpId, initPreviewMode, updatePreviewConfig, exitPreviewMode])

  // Normal session initialization (non-preview mode)
  useEffect(() => {
    // Skip if preview mode
    if (isPreviewRequest) return
    
    // Prevent double initialization in React strict mode
    if (initRef.current) return
    initRef.current = true

    const initSession = async () => {
      let expId = experimentId || searchParams.get('exp')
      
      // If no experiment ID provided, fetch published experiments
      if (!expId) {
        setIsFetchingExperiments(true)
        try {
          const response = await api.get('/experiments/public?limit=1')
          const publishedExperiments = response.data
          
          if (publishedExperiments && publishedExperiments.length > 0) {
            // Use the first (most recently published) experiment
            expId = publishedExperiments[0].experiment_id
          } else {
            // No published experiments - this will be handled by startSession
            expId = ''
          }
        } catch (err) {
          // Error fetching experiments - will be handled by startSession
          expId = ''
        } finally {
          setIsFetchingExperiments(false)
        }
      }
      
      // Convert URL params to object
      const params: Record<string, string> = {}
      searchParams.forEach((value, key) => {
        params[key] = value
      })
      
      setResolvedExpId(expId)
      setUrlParams(params)

      // Check if we have an existing session to recover
      const storedSessionId = sessionId

      if (storedSessionId) {
        // Try to recover existing session - this will set sessionStatus appropriately
        await recoverSession(storedSessionId)
      } else {
        // Start new session
        if (expId) {
          await startSession(expId, params)
        }
      }
    }

    initSession()
  }, [experimentId, searchParams, isPreviewRequest])

  const handleResume = () => {
    confirmResumeSession()
  }

  const handleStartOver = async () => {
    if (resolvedExpId) {
      await startNewSession(resolvedExpId, urlParams)
    }
  }

  // Preview mode: waiting for config
  if (isPreviewRequest && !previewMode && !currentStage) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <LoadingSpinner size="lg" />
        <p className="text-text-secondary">Waiting for editor connection...</p>
        <p className="text-text-tertiary text-sm">Make sure hot edit mode is enabled in the editor</p>
      </div>
    )
  }

  if (isLoading || isFetchingExperiments) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error && !previewMode) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <ErrorDisplay
          message={error}
          onRetry={() => {
            clearError()
            window.location.reload()
          }}
        />
      </div>
    )
  }

  // Show resume dialog for sessions with progress (not in preview mode)
  if (sessionStatus === 'pending_resume' && currentStage && !previewMode) {
    return (
      <SessionResumeDialog
        progress={progress.percentage}
        onResume={handleResume}
        onStartOver={handleStartOver}
        isLoading={isLoading}
      />
    )
  }

  // Show already completed message (not in preview mode)
  if (sessionStatus === 'completed' && !previewMode) {
    return (
      <AlreadyCompletedMessage
        onStartAgain={handleStartOver}
        isLoading={isLoading}
      />
    )
  }

  if (!currentStage) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-secondary">No experiment found</p>
      </div>
    )
  }

  return <ExperimentShell />
}

