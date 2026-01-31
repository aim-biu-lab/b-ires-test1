import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSessionStore, LayoutConfig } from '../store/sessionStore'
import TopBar, { TopBarStatus, TimerDisplayProps } from './TopBar'
import HeaderPlaceholder from './HeaderPlaceholder'
import Sidebar from './Sidebar'
import StageRenderer from './StageRenderer'
import ReturnFromReferenceButton from './ReturnFromReferenceButton'
import OfflineBanner from './OfflineBanner'
import ToastContainer from './Toast'
import TimeoutDialog, { LockedOverlay } from './TimeoutDialog'
import { toast } from '../store/toastStore'
import { eventQueue } from '../lib/eventQueue'
import { useStageTimer, TimeoutAction } from '../hooks/useStageTimer'
import { generateDebugFillData } from '../lib/debugFillUtils'

// Default layout settings for form-based stages
const DEFAULT_FORM_LAYOUT: LayoutConfig = {
  max_width: '600px',
  align_horizontal: 'center',
  align_vertical: 'top',
  margin_top: '2rem',
}

// Stage types that should use form layout by default
const FORM_STAGE_TYPES = [
  'user_info',
  'participant_identity',
  'questionnaire',
  'consent_form',
  'likert_scale',
  'attention_check',
  'multiple_choice',
]

// Stage types that should fill the available space (no layout constraints)
const FULL_WIDTH_STAGE_TYPES = [
  'video_player',
  'iframe_sandbox',
  'external_task',
]

// Check if a stage type should use layout wrapper
function shouldUseLayoutWrapper(stageType: string, layout: LayoutConfig | undefined): boolean {
  // Full-width stages should not use layout wrapper unless explicitly configured
  if (FULL_WIDTH_STAGE_TYPES.includes(stageType) && !layout) {
    return false
  }
  // Form stages always use layout wrapper
  if (FORM_STAGE_TYPES.includes(stageType)) {
    return true
  }
  // Other stages use layout wrapper only if explicitly configured
  return !!layout
}

// Generate CSS styles from layout config
function getLayoutStyles(layout: LayoutConfig | undefined, stageType: string): React.CSSProperties {
  // Use default form layout for form-based stages if no layout specified
  const effectiveLayout = layout || (FORM_STAGE_TYPES.includes(stageType) ? DEFAULT_FORM_LAYOUT : {})
  
  const styles: React.CSSProperties = {}
  
  // Width settings
  if (effectiveLayout.width) {
    styles.width = effectiveLayout.width
  }
  if (effectiveLayout.max_width) {
    styles.maxWidth = effectiveLayout.max_width
  }
  if (effectiveLayout.min_width) {
    styles.minWidth = effectiveLayout.min_width
  }
  
  // Margin and padding
  if (effectiveLayout.margin_top) {
    styles.marginTop = effectiveLayout.margin_top
  }
  if (effectiveLayout.padding) {
    styles.padding = effectiveLayout.padding
  }
  
  return styles
}

// Generate CSS classes for alignment
function getLayoutClasses(layout: LayoutConfig | undefined, stageType: string): string {
  const effectiveLayout = layout || (FORM_STAGE_TYPES.includes(stageType) ? DEFAULT_FORM_LAYOUT : {})
  const classes: string[] = []
  
  // Horizontal alignment - affects the container
  switch (effectiveLayout.align_horizontal) {
    case 'left':
      classes.push('mr-auto')
      break
    case 'right':
      classes.push('ml-auto')
      break
    case 'center':
    default:
      classes.push('mx-auto')
      break
  }
  
  return classes.join(' ')
}

// Generate wrapper classes for vertical alignment
function getVerticalAlignClasses(layout: LayoutConfig | undefined, stageType: string): string {
  const effectiveLayout = layout || (FORM_STAGE_TYPES.includes(stageType) ? DEFAULT_FORM_LAYOUT : {})
  const classes: string[] = ['h-full', 'flex', 'flex-col']
  
  switch (effectiveLayout.align_vertical) {
    case 'upper-third':
      // Position at ~25% from top (halfway between top and middle)
      // Uses before:after = 1:3 ratio for positioning
      classes.push("before:content-[''] before:flex-[1_1_0%] after:content-[''] after:flex-[3_1_0%]")
      break
    case 'middle':
      classes.push('justify-center')
      break
    case 'lower-third':
      // Position at ~75% from top (halfway between middle and bottom)
      // Uses before:after = 3:1 ratio for positioning
      classes.push("before:content-[''] before:flex-[3_1_0%] after:content-[''] after:flex-[1_1_0%]")
      break
    case 'bottom':
      classes.push('justify-end')
      break
    case 'top':
    default:
      classes.push('justify-start')
      break
  }
  
  return classes.join(' ')
}

export default function ExperimentShell() {
  const {
    sessionId,
    currentStage,
    visibleStages,
    completedStageIds,
    progress,
    stageData,
    isSubmitting,
    isOffline,
    isSyncing,
    pendingSubmissions,
    isOnReferenceStage,
    returnStageLabel,
    shellConfig,
    previewMode,
    debugMode,
    submitStage,
    setStageData,
    returnFromJump,
    syncPendingSubmissions,
    jumpToStage,
    stageNeedsSubmission,
    isStageLockedForReturn,
    unsubmitStage,
    resetPreviewSession,
  } = useSessionStore()

  // Get navigation bar position from shell config (default: 'top')
  const navBarPosition = shellConfig?.navigation_bar?.position || 'top'
  const showHeaderPlaceholder = shellConfig?.navigation_bar?.show_header_placeholder !== false

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [blockStatus, setBlockStatus] = useState<TopBarStatus | null>(null)
  const [errorTrigger, setErrorTrigger] = useState(0)
  const [isShowingFeedback, setIsShowingFeedback] = useState(false)
  const previousStageIdRef = useRef<string | null>(null)

  // Handle timeout actions from the stage timer
  const handleTimeout = useCallback((action: TimeoutAction) => {
    if (!currentStage) return
    
    // Log the timeout event
    if (sessionId) {
      eventQueue.addEvent({
        sessionId,
        eventType: 'timeout',
        stageId: currentStage.id,
        payload: {
          action,
          stageType: currentStage.type,
        },
      })
    }
    
    // Handle different timeout actions
    switch (action) {
      case 'auto_submit':
        // Submit the stage with current data
        const currentData = stageData[currentStage.id] || {}
        submitStage(currentStage.id, { ...currentData, _timed_out: true })
        break
      case 'skip_stage':
        // Submit empty data and move to next stage
        submitStage(currentStage.id, { _timed_out: true, _skipped: true })
        break
      // 'lock_interface' and 'prompt' are handled by the timer state (isLocked, showTimeoutPrompt)
    }
  }, [currentStage, sessionId, stageData, submitStage])

  // Check if stage is already completed (for timer behavior)
  const isCurrentStageCompleted = currentStage ? completedStageIds.includes(currentStage.id) : false

  // Stage timer hook
  const stageTimer = useStageTimer({
    timing: currentStage?.timing,
    stageId: currentStage?.id || '',
    isStageCompleted: isCurrentStageCompleted,
    onTimeout: handleTimeout,
    onMinDurationPassed: () => {
      // Optional: could show a toast or update UI when min duration passes
    },
  })

  // Log stage_view event when stage changes and clear status
  useEffect(() => {
    if (sessionId && currentStage && currentStage.id !== previousStageIdRef.current) {
      previousStageIdRef.current = currentStage.id
      
      // Clear block status and feedback state when stage changes
      setBlockStatus(null)
      setIsShowingFeedback(false)
      
      eventQueue.addEvent({
        sessionId,
        eventType: 'stage_view',
        stageId: currentStage.id,
        payload: {
          stageType: currentStage.type,
          stageLabel: currentStage.label,
        },
      })
    }
  }, [sessionId, currentStage])

  // Callback for blocks to report their status to the top bar
  const handleBlockStatusChange = useCallback((status: TopBarStatus | null) => {
    setBlockStatus(status)
  }, [])

  // Handle stage navigation - jump directly
  const handleStageJump = useCallback(
    async (stageId: string) => {
      await jumpToStage(stageId)
    },
    [jumpToStage]
  )

  if (!currentStage) return null

  const currentStageData = stageData[currentStage.id] || {}

  // Check if stage is read-only (completed and not editable after submit)
  const isStageCompleted = completedStageIds.includes(currentStage.id)
  const isEditableAfterSubmit = currentStage.editable_after_submit === true
  const isStageReadOnly = isStageCompleted && !isEditableAfterSubmit

  const handleFieldChange = (fieldId: string, value: unknown) => {
    setStageData(currentStage.id, fieldId, value)
    // Clear validation error for this field
    if (validationErrors[fieldId]) {
      setValidationErrors((prev) => {
        const next = { ...prev }
        delete next[fieldId]
        return next
      })
    }
  }

  const validateStage = (): { isValid: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {}

    if (currentStage.type === 'questionnaire' && currentStage.questions) {
      for (const question of currentStage.questions) {
        if (question.required !== false && !currentStageData[question.id]) {
          errors[question.id] = 'This field is required'
        }
      }
    }

    if (currentStage.type === 'user_info' && currentStage.fields) {
      for (const field of currentStage.fields) {
        if (field.required !== false && !currentStageData[field.field]) {
          errors[field.field] = 'This field is required'
        }
      }
    }

    // Validate participant_identity stages - only check enabled fields
    if (currentStage.type === 'participant_identity' && currentStage.fields) {
      for (const field of currentStage.fields) {
        // Skip disabled fields
        if (field.enabled === false) continue
        
        // Only validate if required is explicitly true (default is false for participant_identity)
        if (field.required === true) {
          const value = currentStageData[field.field]
          if (!value || (typeof value === 'string' && !value.trim())) {
            errors[field.field] = 'This field is required'
          }
        }
        
        // Validate regex pattern if present and field has value
        if (field.validation && currentStageData[field.field]) {
          const regex = new RegExp(field.validation)
          const value = String(currentStageData[field.field])
          if (!regex.test(value)) {
            errors[field.field] = field.validation_message || 'Invalid format'
          }
        }
      }
    }

    // Validate iframe_sandbox stages - require completion unless explicitly disabled
    if (currentStage.type === 'iframe_sandbox') {
      const requireCompletion = currentStage.config?.require_completion !== false
      if (requireCompletion && !currentStageData._iframe_completed) {
        errors._iframe_completed = 'Please complete the task before continuing'
      }
    }

    // Validate video_player stages - check mandatory and require_complete
    if (currentStage.type === 'video_player') {
      const isMandatory = currentStage.mandatory === true
      const requireComplete = currentStage.config?.require_complete === true
      
      if ((isMandatory || requireComplete) && !currentStageData._video_completed) {
        errors._video_completed = 'Please watch the video completely before continuing'
      }
    }

    // Validate multiple_choice stages - require selection by default
    if (currentStage.type === 'multiple_choice') {
      const config = currentStage.config as { required?: boolean } | undefined
      // Default to required unless explicitly set to false
      const isRequired = config?.required !== false && currentStage.mandatory !== false
      
      if (isRequired) {
        const selectedAnswers = currentStageData.selected_answers as string[] | undefined
        if (!selectedAnswers || selectedAnswers.length === 0) {
          errors.selected_answers = 'Please select an answer before continuing'
        }
      }
    }

    // Validate likert_scale stages - require selection by default
    if (currentStage.type === 'likert_scale') {
      // Default to required unless mandatory is explicitly set to false
      const isRequired = currentStage.mandatory !== false
      
      if (isRequired) {
        const response = currentStageData.response
        if (response === undefined || response === null) {
          errors.response = 'Please select a rating before continuing'
        }
      }
    }

    setValidationErrors(errors)
    return { isValid: Object.keys(errors).length === 0, errors }
  }

  // Default delay duration in seconds for showing feedback before navigation
  const DEFAULT_FEEDBACK_DELAY_SECONDS = 1.5

  // Get the feedback delay in milliseconds from stage config (0 = manual advance)
  const getFeedbackDelayMs = useCallback((): number => {
    if (!currentStage) return DEFAULT_FEEDBACK_DELAY_SECONDS * 1000
    
    if (currentStage.type === 'multiple_choice') {
      const config = currentStage.config as Record<string, unknown> | undefined
      const delaySeconds = config?.feedback_delay as number | undefined
      // Use configured delay if present, otherwise default
      return (delaySeconds ?? DEFAULT_FEEDBACK_DELAY_SECONDS) * 1000
    }
    
    return DEFAULT_FEEDBACK_DELAY_SECONDS * 1000
  }, [currentStage])

  // Check if the current stage should show feedback with a delay
  const shouldShowFeedbackDelay = useCallback(() => {
    if (!currentStage) return false
    
    // Multiple choice with show_correct_after_submit enabled
    if (currentStage.type === 'multiple_choice') {
      const config = currentStage.config as Record<string, unknown> | undefined
      return config?.show_correct_after_submit === true
    }
    
    return false
  }, [currentStage])

  // Check if we're waiting for manual advance (feedback_delay = 0 and already showing feedback)
  const isWaitingForManualAdvance = useMemo(() => {
    if (!currentStage || !shouldShowFeedbackDelay()) return false
    const feedbackDelayMs = getFeedbackDelayMs()
    // Manual advance mode when delay is 0 and stage has been submitted (showing feedback)
    return feedbackDelayMs === 0 && currentStageData._submitted === true
  }, [currentStage, shouldShowFeedbackDelay, getFeedbackDelayMs, currentStageData._submitted])

  // Check if current stage needs submission
  const needsSubmission = currentStage ? stageNeedsSubmission(currentStage.id) : true

  const handleSubmit = async () => {
    // If stage doesn't need submission (already submitted and no changes), just navigate to next stage
    if (!needsSubmission) {
      const currentIndex = visibleStages.findIndex((s) => s.id === currentStage.id)
      if (currentIndex < visibleStages.length - 1) {
        const nextStage = visibleStages[currentIndex + 1]
        await jumpToStage(nextStage.id)
      }
      return
    }

    const { isValid, errors } = validateStage()
    
    if (!isValid) {
      // Trigger error animation on Continue button
      setErrorTrigger((prev) => prev + 1)
      
      // Show toast notification with first error message
      const errorMessages = Object.values(errors)
      if (errorMessages.length > 0) {
        // Show specific error message based on type
        const firstError = errorMessages[0]
        toast.error(firstError)
      }
      return
    }

    // Check if we need to show feedback before navigating
    if (shouldShowFeedbackDelay() && !currentStageData._submitted && !isShowingFeedback) {
      // Mark that we're showing feedback (prevents double-clicks)
      setIsShowingFeedback(true)
      
      // Set _submitted flag to trigger feedback display in the block
      setStageData(currentStage.id, '_submitted', true)
      
      const feedbackDelayMs = getFeedbackDelayMs()
      
      if (feedbackDelayMs === 0) {
        // Manual advance mode - don't auto-navigate, user must click Next
        setIsShowingFeedback(false)
        return
      }
      
      // Wait for the user to see the feedback
      await new Promise((resolve) => setTimeout(resolve, feedbackDelayMs))
      
      setIsShowingFeedback(false)
    }

    await submitStage(currentStage.id, currentStageData)
  }

  const handleBack = async () => {
    // Find previous stage in visible stages
    const currentIndex = visibleStages.findIndex((s) => s.id === currentStage.id)
    if (currentIndex > 0) {
      const prevStage = visibleStages[currentIndex - 1]
      // Jump to previous stage if it's completed (with invalidation check)
      if (completedStageIds.includes(prevStage.id)) {
        await handleStageJump(prevStage.id)
      }
    }
  }

  const canGoBack = () => {
    const currentIndex = visibleStages.findIndex((s) => s.id === currentStage.id)
    if (currentIndex <= 0) return false
    
    const prevStage = visibleStages[currentIndex - 1]
    if (!prevStage) return false
    
    // In preview mode, allow navigating to any previous stage
    if (previewMode) return true
    
    // Check if previous stage is completed
    if (!completedStageIds.includes(prevStage.id)) return false
    
    // Check if previous stage is locked for return
    if (isStageLockedForReturn(prevStage.id)) return false
    
    return true
  }

  // Determine the title and description for the top bar
  // Use stage-specific values if available, otherwise fall back to label
  const topBarTitle = currentStage.title || currentStage.label
  const topBarDescription = currentStage.description

  // Calculate if current stage is the last stage based on actual position in visibleStages
  // (not progress.current, which doesn't update when jumping back)
  const currentStageIndex = visibleStages.findIndex((s) => s.id === currentStage.id)
  const isLastStage = currentStageIndex === visibleStages.length - 1

  // Timer display props for the TopBar
  const timerDisplayProps: TimerDisplayProps | undefined = currentStage?.timing ? {
    remainingMs: stageTimer.remainingMs,
    formattedRemaining: stageTimer.formattedRemaining,
    formattedElapsed: stageTimer.formattedElapsed,
    showTimer: currentStage.timing.show_timer || false,
    showElapsedTime: currentStage.timing.show_elapsed_time || false,
    progressPercent: stageTimer.progressPercent,
    minDurationPassed: stageTimer.minDurationPassed,
    hasTimedOut: stageTimer.hasTimedOut,
    isCountdownActive: stageTimer.isCountdownActive,
  } : undefined

  // Handle unsubmit action (preview mode only)
  const handleUnsubmit = useCallback(() => {
    if (currentStage && previewMode) {
      unsubmitStage(currentStage.id)
    }
  }, [currentStage, previewMode, unsubmitStage])

  // Handle reset session action (preview mode only)
  const handleResetSession = useCallback(async () => {
    if (previewMode) {
      await resetPreviewSession()
    }
  }, [previewMode, resetPreviewSession])

  // Handle debug fill action (debug mode only)
  const handleDebugFill = useCallback(async () => {
    if (!debugMode || !currentStage) return

    // Generate debug data for the current stage
    const debugData = generateDebugFillData(currentStage)

    // Set all the generated data to the stage
    for (const [fieldId, value] of Object.entries(debugData)) {
      setStageData(currentStage.id, fieldId, value)
    }

    // Small delay to ensure state updates, then submit
    await new Promise(resolve => setTimeout(resolve, 50))

    // Submit with the generated data merged with any existing data
    const mergedData = { ...stageData[currentStage.id], ...debugData }
    await submitStage(currentStage.id, mergedData)
  }, [debugMode, currentStage, setStageData, stageData, submitStage])

  // Common TopBar props
  const topBarProps = {
    title: topBarTitle,
    description: topBarDescription,
    status: blockStatus,
    onBack: handleBack,
    onNext: handleSubmit,
    canGoBack: canGoBack(),
    isSubmitting: isSubmitting || isShowingFeedback,
    isLastStage: isLastStage,
    needsSubmission: needsSubmission && !isWaitingForManualAdvance,
    isWaitingForManualAdvance: isWaitingForManualAdvance,
    errorTrigger: errorTrigger,
    progress: progress,
    timer: timerDisplayProps,
    // Preview mode props
    previewMode: previewMode,
    isCurrentStageCompleted: isCurrentStageCompleted,
    onUnsubmit: handleUnsubmit,
    onResetSession: handleResetSession,
    // Debug mode props
    debugMode: debugMode,
    onDebugFill: handleDebugFill,
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Offline/Sync Banner */}
      <OfflineBanner
        isOffline={isOffline}
        isSyncing={isSyncing}
        pendingSubmissions={pendingSubmissions}
        onSync={syncPendingSubmissions}
      />

      {/* Top position: TopBar with navigation OR Header Placeholder when nav is at bottom */}
      {navBarPosition === 'top' ? (
        <div className="flex-shrink-0">
          <TopBar {...topBarProps} />
        </div>
      ) : showHeaderPlaceholder ? (
        <div className="flex-shrink-0">
          <HeaderPlaceholder
            title={topBarTitle}
            description={topBarDescription}
            status={blockStatus}
          />
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar with progress */}
        <Sidebar
          stages={visibleStages}
          currentStageId={currentStage.id}
          completedStageIds={completedStageIds}
          progress={progress}
          onStageClick={handleStageJump}
          hideProgressIndicator={navBarPosition === 'bottom'}
          isStageLockedForReturn={isStageLockedForReturn}
          previewMode={previewMode}
        />

        {/* Main Content - Expanded to fill available space */}
        <main className="flex-1 overflow-y-auto min-h-0">
          {/* Conditionally apply padding - full-width stages need minimal/no padding */}
          <div className={`h-full ${FULL_WIDTH_STAGE_TYPES.includes(currentStage.type) && !currentStage.layout ? 'p-2' : 'p-4 md:p-6'}`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStage.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="h-full"
              >
                {/* Return to Question button (when on reference stage) */}
                {isOnReferenceStage && (
                  <ReturnFromReferenceButton
                    returnStageLabel={returnStageLabel}
                    onReturn={returnFromJump}
                    isLoading={isSubmitting}
                  />
                )}

                {/* Stage Content - with or without layout wrapper */}
                {shouldUseLayoutWrapper(currentStage.type, currentStage.layout) ? (
                  <div className={getVerticalAlignClasses(currentStage.layout, currentStage.type)}>
                    <div 
                      className={getLayoutClasses(currentStage.layout, currentStage.type)}
                      style={getLayoutStyles(currentStage.layout, currentStage.type)}
                    >
                      <StageRenderer
                        stage={currentStage}
                        data={currentStageData}
                        errors={validationErrors}
                        onFieldChange={handleFieldChange}
                        onAutoComplete={handleSubmit}
                        onStatusChange={handleBlockStatusChange}
                        readOnly={isStageReadOnly}
                      />
                    </div>
                  </div>
                ) : (
                  <StageRenderer
                    stage={currentStage}
                    data={currentStageData}
                    errors={validationErrors}
                    onFieldChange={handleFieldChange}
                    onAutoComplete={handleSubmit}
                    onStatusChange={handleBlockStatusChange}
                    readOnly={isStageReadOnly}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Bottom position: Navigation bar at the bottom */}
      {navBarPosition === 'bottom' && (
        <div className="flex-shrink-0">
          <TopBar {...topBarProps} position="bottom" />
        </div>
      )}

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Timeout Dialog - shown when on_timeout: 'prompt' */}
      <TimeoutDialog
        isOpen={stageTimer.showTimeoutPrompt}
        title="Time's Up"
        message="You have run out of time for this section. Would you like to submit your current response?"
        allowContinue={true}
        allowSkip={true}
        onContinue={() => {
          stageTimer.dismissTimeoutPrompt()
          // Submit current data
          if (currentStage) {
            const currentData = stageData[currentStage.id] || {}
            submitStage(currentStage.id, { ...currentData, _timed_out: true })
          }
        }}
        onSkip={() => {
          stageTimer.dismissTimeoutPrompt()
          // Skip the stage
          if (currentStage) {
            submitStage(currentStage.id, { _timed_out: true, _skipped: true })
          }
        }}
        onDismiss={stageTimer.dismissTimeoutPrompt}
        variant="warning"
      />

      {/* Locked Overlay - shown when on_timeout: 'lock_interface' */}
      {stageTimer.isLocked && (
        <LockedOverlay message="Time has expired for this section. Your response will be submitted automatically." />
      )}
    </div>
  )
}

