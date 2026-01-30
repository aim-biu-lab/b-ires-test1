import { useEffect, useState } from 'react'
import clsx from 'clsx'
import LoadingSpinner from './LoadingSpinner'
import StageTimer, { getTimerVariant } from './StageTimer'

export interface TopBarStatus {
  type: 'loading' | 'success' | 'warning' | 'error' | 'info'
  message: string
  icon?: React.ReactNode
}

export interface TimerDisplayProps {
  // Remaining time in ms (for countdown) - null if no max_duration or completed
  remainingMs: number | null
  // Formatted remaining time string (e.g., "2:30")
  formattedRemaining: string
  // Formatted elapsed time string (e.g., "1:45")
  formattedElapsed: string
  // Whether to show the countdown timer
  showTimer: boolean
  // Whether to show elapsed time
  showElapsedTime: boolean
  // Progress percentage (0-100)
  progressPercent: number
  // Whether min duration has passed (affects next button state)
  minDurationPassed: boolean
  // Whether the timer has expired
  hasTimedOut: boolean
  // Whether countdown is active (stage not completed)
  isCountdownActive: boolean
}

interface TopBarProps {
  title?: string
  description?: string
  status?: TopBarStatus | null
  // Navigation
  onBack: () => void
  onNext: () => void
  canGoBack: boolean
  isSubmitting: boolean
  isLastStage: boolean
  // Whether current stage needs submission (not completed or data changed)
  needsSubmission: boolean
  // Whether we're showing feedback and waiting for user to click Next (feedback_delay = 0)
  isWaitingForManualAdvance?: boolean
  // Error animation trigger - increment to trigger shake
  errorTrigger?: number
  // Position: 'top' (default) or 'bottom' - when bottom, title/description are hidden
  position?: 'top' | 'bottom'
  // Progress info for displaying step indicator (used when position is 'bottom')
  progress?: { current: number; total: number; percentage: number }
  // Timer display props
  timer?: TimerDisplayProps
  // Preview mode - show unsubmit button
  previewMode?: boolean
  // Whether current stage is completed (for unsubmit button)
  isCurrentStageCompleted?: boolean
  // Callback for unsubmit action
  onUnsubmit?: () => void
  // Callback for reset session action (preview mode)
  onResetSession?: () => void
  // Debug mode - show debug fill button
  debugMode?: boolean
  // Callback for debug fill action
  onDebugFill?: () => void
}

export default function TopBar({
  title,
  description,
  status,
  onBack,
  onNext,
  canGoBack,
  isSubmitting,
  isLastStage,
  needsSubmission,
  isWaitingForManualAdvance = false,
  errorTrigger = 0,
  position = 'top',
  progress,
  timer,
  previewMode = false,
  isCurrentStageCompleted = false,
  onUnsubmit,
  onResetSession,
  debugMode = false,
  onDebugFill,
}: TopBarProps) {
  const isBottomPosition = position === 'bottom'
  const [isShaking, setIsShaking] = useState(false)
  const [showErrorStyle, setShowErrorStyle] = useState(false)
  
  // Determine if Next button should be disabled due to min_duration
  const isMinDurationBlocking = timer && !timer.minDurationPassed && !timer.hasTimedOut
  
  // Get timer variant for styling
  const timerVariant = timer ? getTimerVariant(timer.remainingMs) : 'default'
  
  // Trigger shake animation when errorTrigger changes
  useEffect(() => {
    if (errorTrigger > 0) {
      setIsShaking(true)
      setShowErrorStyle(true)
      
      // Remove shake class after animation
      const shakeTimer = setTimeout(() => {
        setIsShaking(false)
      }, 500)
      
      // Remove error style after a brief delay
      const styleTimer = setTimeout(() => {
        setShowErrorStyle(false)
      }, 1000)
      
      return () => {
        clearTimeout(shakeTimer)
        clearTimeout(styleTimer)
      }
    }
  }, [errorTrigger])

  return (
    <div className={clsx(
      'z-40 bg-surface shadow-sm',
      isBottomPosition ? 'sticky bottom-0 border-t border-border' : 'sticky top-0 border-b border-border'
    )}>
      <div className="flex items-center">
        {/* Logo section - matches sidebar width for alignment (only shown at top position) */}
        {!isBottomPosition && (
          <div className="hidden md:flex w-64 flex-shrink-0 items-center px-4 py-3 border-r border-border bg-surface">
            <span className="text-xl font-bold text-primary tracking-tight">
              B-IRES
            </span>
          </div>
        )}
        
        {/* Step indicator for bottom position (aligns with sidebar) */}
        {isBottomPosition && (
          <div className="hidden md:flex w-64 flex-shrink-0 items-center justify-between px-4 py-3 border-r border-border bg-surface">
            {progress && (
              <>
                <span className="text-sm font-medium text-text-primary">
                  Step {progress.current + 1} of {progress.total}
                </span>
                <span className="text-sm font-semibold text-primary">
                  {Math.round(progress.percentage)}%
                </span>
              </>
            )}
          </div>
        )}

        {/* Main top bar content */}
        <div className="flex-1 flex items-center justify-between px-4 py-3 gap-4">
          {/* Left: Back button */}
          <div className="flex-shrink-0 w-24">
            {canGoBack ? (
              <button
                onClick={onBack}
                disabled={isSubmitting}
                className="btn btn-secondary btn-sm flex items-center gap-1"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back
              </button>
            ) : (
              <div />
            )}
          </div>

          {/* Center: Title, description, timer, and status (only shown at top position) */}
          {!isBottomPosition && (
            <div className="flex-1 flex flex-col items-center justify-center min-w-0">
              {/* Title & Description */}
              {(title || description) && (
                <div className="text-center">
                  {title && (
                    <h1 className="text-lg font-semibold text-text-primary truncate max-w-md">
                      {title}
                    </h1>
                  )}
                  {description && (
                    <p className="text-sm text-text-secondary mt-0.5 truncate max-w-lg">
                      {description}
                    </p>
                  )}
                </div>
              )}

              {/* Timer display - Countdown and/or Elapsed time */}
              {(timer?.showTimer && timer.isCountdownActive && timer.formattedRemaining) || timer?.showElapsedTime ? (
                <div className="mt-1 flex items-center gap-3">
                  {/* Countdown timer (only if active and not on completed stage) */}
                  {timer?.showTimer && timer.isCountdownActive && timer.formattedRemaining && (
                    <StageTimer
                      formattedTime={timer.formattedRemaining}
                      mode="countdown"
                      variant={timerVariant}
                      size="sm"
                      progressPercent={timer.progressPercent}
                      isUrgent={timerVariant === 'danger'}
                      label="Remaining"
                    />
                  )}
                  {/* Elapsed time (always shows if configured) */}
                  {timer?.showElapsedTime && (
                    <StageTimer
                      formattedTime={timer.formattedElapsed}
                      mode="elapsed"
                      variant="minimal"
                      size="sm"
                      label="Elapsed"
                    />
                  )}
                </div>
              ) : null}

              {/* Status message */}
              {status && (
                <div
                  className={clsx(
                    'flex items-center gap-2 text-sm mt-1 px-3 py-1 rounded-full',
                    status.type === 'loading' && 'text-text-secondary bg-muted',
                    status.type === 'success' && 'text-success bg-success-light',
                    status.type === 'warning' && 'text-warning bg-warning-light',
                    status.type === 'error' && 'text-error bg-error-light',
                    status.type === 'info' && 'text-info bg-info-light'
                  )}
                >
                  {/* Default icons based on type */}
                  {status.type === 'loading' && !status.icon && (
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  )}
                  {status.type === 'success' && !status.icon && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {status.type === 'warning' && !status.icon && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {status.type === 'error' && !status.icon && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {status.type === 'info' && !status.icon && (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {status.icon}
                  <span>{status.message}</span>
                </div>
              )}
            </div>
          )}
          
          {/* Center spacer for bottom position */}
          {isBottomPosition && <div className="flex-1" />}

          {/* Right: Reset, Unsubmit (preview mode) and Next/Continue button */}
          <div className="flex-shrink-0 flex justify-end gap-2">
            {/* Reset Session button - only in preview mode */}
            {previewMode && onResetSession && (
              <button
                onClick={onResetSession}
                disabled={isSubmitting}
                className="btn btn-sm btn-secondary flex items-center gap-1 text-error border-error hover:bg-error/10"
                title="Reset session completely - clear all progress and start over"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
            {/* Unsubmit button - only in preview mode when stage is completed */}
            {previewMode && isCurrentStageCompleted && onUnsubmit && (
              <button
                onClick={onUnsubmit}
                disabled={isSubmitting}
                className="btn btn-sm btn-secondary flex items-center gap-1 text-warning border-warning hover:bg-warning/10"
                title="Reset this stage to unsubmitted state"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                <span className="hidden sm:inline">Unsubmit</span>
              </button>
            )}
            {/* Debug Fill button - only in debug mode when stage needs submission */}
            {debugMode && needsSubmission && onDebugFill && (
              <button
                onClick={onDebugFill}
                disabled={isSubmitting}
                className="btn btn-sm btn-secondary flex items-center gap-1 text-info border-info hover:bg-info/10"
                title="Fill with random/default values and submit (debug mode)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="hidden sm:inline">Debug Fill</span>
              </button>
            )}
            <button
              onClick={onNext}
              disabled={isSubmitting || isMinDurationBlocking}
              className={clsx(
                'btn btn-sm flex items-center gap-1 transition-all duration-200',
                (isSubmitting || isMinDurationBlocking) && 'btn-disabled',
                showErrorStyle 
                  ? 'bg-error hover:bg-error text-white ring-2 ring-error ring-offset-2' 
                  : 'btn-primary',
                isShaking && 'animate-shake'
              )}
              title={isMinDurationBlocking ? 'Please wait before continuing' : undefined}
            >
              {isSubmitting ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="hidden sm:inline">Submitting...</span>
                </>
              ) : isMinDurationBlocking ? (
                <>
                  <svg 
                    className="w-4 h-4 animate-spin" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
                    />
                  </svg>
                  <span className="hidden sm:inline">Wait...</span>
                </>
              ) : isLastStage ? (
                'Complete'
              ) : isWaitingForManualAdvance || !needsSubmission ? (
                <>
                  Next
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </>
              ) : (
                'Submit'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

