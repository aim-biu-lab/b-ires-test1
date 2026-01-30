import { useState, useEffect, useCallback, useRef } from 'react'
import { TimingConfig } from '../store/sessionStore'

export type TimeoutAction = 'auto_submit' | 'skip_stage' | 'lock_interface' | 'prompt'

export interface StageTimerState {
  // Elapsed time since stage started (in ms)
  elapsedMs: number
  // Remaining time until max_duration (in ms), null if no max_duration or completed stage
  remainingMs: number | null
  // Whether min_duration has passed (Next button can be enabled)
  minDurationPassed: boolean
  // Whether max_duration has been reached (timeout)
  hasTimedOut: boolean
  // Whether the interface should be locked (on_timeout: 'lock_interface')
  isLocked: boolean
  // Whether we should show the timeout prompt dialog
  showTimeoutPrompt: boolean
  // Formatted time string for display
  formattedRemaining: string
  formattedElapsed: string
  // Progress percentage for visual indicator (0-100)
  progressPercent: number
  // Whether countdown is active (not completed stage)
  isCountdownActive: boolean
}

export interface UseStageTimerOptions {
  timing?: TimingConfig
  stageId: string
  // Whether the stage is already completed (disables countdown/timeout)
  isStageCompleted?: boolean
  onTimeout?: (action: TimeoutAction) => void
  onMinDurationPassed?: () => void
}

export interface UseStageTimerReturn extends StageTimerState {
  // Actions
  dismissTimeoutPrompt: () => void
  resetTimer: () => void
}

// Format milliseconds to MM:SS or HH:MM:SS
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function useStageTimer({
  timing,
  stageId,
  isStageCompleted = false,
  onTimeout,
  onMinDurationPassed,
}: UseStageTimerOptions): UseStageTimerReturn {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [minDurationPassed, setMinDurationPassed] = useState(false)
  const [hasTimedOut, setHasTimedOut] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [showTimeoutPrompt, setShowTimeoutPrompt] = useState(false)
  
  const startTimeRef = useRef<number>(Date.now())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const minDurationFiredRef = useRef(false)
  const timeoutFiredRef = useRef(false)
  const prevStageIdRef = useRef<string | null>(null)
  
  const minDurationMs = timing?.min_duration_ms || 0
  const maxDurationMs = timing?.max_duration_ms || 0
  const showElapsedTime = timing?.show_elapsed_time || false
  const timeoutAction = (timing?.on_timeout || 'auto_submit') as TimeoutAction
  
  // Countdown is only active for non-completed stages with max_duration
  const isCountdownActive = !isStageCompleted && maxDurationMs > 0
  
  // Reset timer when stage changes
  useEffect(() => {
    if (prevStageIdRef.current !== stageId) {
      prevStageIdRef.current = stageId
      
      // Reset all state
      startTimeRef.current = Date.now()
      setElapsedMs(0)
      // For completed stages, skip min_duration check
      setMinDurationPassed(isStageCompleted || minDurationMs === 0)
      setHasTimedOut(false)
      setIsLocked(false)
      setShowTimeoutPrompt(false)
      minDurationFiredRef.current = isStageCompleted || minDurationMs === 0
      timeoutFiredRef.current = false
    }
  }, [stageId, minDurationMs, isStageCompleted])
  
  // Main timer interval
  useEffect(() => {
    // Determine if we need the timer at all
    const needsTimer = (
      // Need timer for min_duration check (only on non-completed stages)
      (!isStageCompleted && minDurationMs > 0) ||
      // Need timer for countdown (only on non-completed stages)
      isCountdownActive ||
      // Need timer for elapsed time display
      showElapsedTime
    )
    
    // Skip if no timing configured and no elapsed time display
    if (!timing || !needsTimer) {
      setMinDurationPassed(true)
      return
    }
    
    // Update every 100ms for smooth countdown
    intervalRef.current = setInterval(() => {
      const now = Date.now()
      const elapsed = now - startTimeRef.current
      setElapsedMs(elapsed)
      
      // Skip timeout/min_duration checks for completed stages
      if (isStageCompleted) return
      
      // Check min_duration
      if (minDurationMs > 0 && !minDurationFiredRef.current && elapsed >= minDurationMs) {
        minDurationFiredRef.current = true
        setMinDurationPassed(true)
        onMinDurationPassed?.()
      }
      
      // Check max_duration (timeout) - only if countdown is active
      if (isCountdownActive && !timeoutFiredRef.current && elapsed >= maxDurationMs) {
        timeoutFiredRef.current = true
        setHasTimedOut(true)
        
        // Handle timeout action
        switch (timeoutAction) {
          case 'lock_interface':
            setIsLocked(true)
            break
          case 'prompt':
            setShowTimeoutPrompt(true)
            break
          case 'auto_submit':
          case 'skip_stage':
            // These are handled by the parent component via onTimeout
            break
        }
        
        onTimeout?.(timeoutAction)
      }
    }, 100)
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [timing, minDurationMs, maxDurationMs, showElapsedTime, isCountdownActive, isStageCompleted, timeoutAction, onTimeout, onMinDurationPassed])
  
  // Calculate remaining time (null if countdown not active or stage completed)
  const remainingMs = isCountdownActive ? Math.max(0, maxDurationMs - elapsedMs) : null
  
  // Calculate progress percentage (for visual indicator)
  let progressPercent = 0
  if (maxDurationMs > 0) {
    progressPercent = Math.min(100, (elapsedMs / maxDurationMs) * 100)
  } else if (minDurationMs > 0) {
    progressPercent = Math.min(100, (elapsedMs / minDurationMs) * 100)
  }
  
  // Dismiss timeout prompt
  const dismissTimeoutPrompt = useCallback(() => {
    setShowTimeoutPrompt(false)
  }, [])
  
  // Reset timer (for retries or manual reset)
  const resetTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    setElapsedMs(0)
    setMinDurationPassed(minDurationMs === 0)
    setHasTimedOut(false)
    setIsLocked(false)
    setShowTimeoutPrompt(false)
    minDurationFiredRef.current = minDurationMs === 0
    timeoutFiredRef.current = false
  }, [minDurationMs])
  
  return {
    elapsedMs,
    remainingMs,
    minDurationPassed,
    hasTimedOut,
    isLocked,
    showTimeoutPrompt,
    formattedRemaining: remainingMs !== null ? formatTime(remainingMs) : '',
    formattedElapsed: formatTime(elapsedMs),
    progressPercent,
    isCountdownActive,
    dismissTimeoutPrompt,
    resetTimer,
  }
}

