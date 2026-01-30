import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { eventQueue } from '../../lib/eventQueue'
import { useSessionStore } from '../../store/sessionStore'

interface AttentionCheckOption {
  value: string
  label: string
  isCorrect?: boolean
}

interface AttentionCheckBlockProps {
  question: string
  options: AttentionCheckOption[]
  correctAnswer: string
  config?: {
    allowRetry?: boolean
    maxAttempts?: number
    showFeedback?: boolean
    failureAction?: 'flag' | 'disqualify' | 'warn'
    feedbackDuration?: number
    randomizeOptions?: boolean
  }
  stageId: string
  onFieldChange: (fieldId: string, value: unknown) => void
  data: Record<string, unknown>
  readOnly?: boolean
}

export default function AttentionCheckBlock({
  question,
  options,
  correctAnswer,
  config = {},
  stageId,
  onFieldChange,
  data,
  readOnly = false,
}: AttentionCheckBlockProps) {
  const sessionId = useSessionStore((state) => state.sessionId)

  const {
    allowRetry = true,
    maxAttempts = 3,
    showFeedback = true,
    failureAction = 'flag',
    feedbackDuration = 2000,
    randomizeOptions = false,
  } = config

  const [selectedValue, setSelectedValue] = useState<string | null>(
    (data.response as string) || null
  )
  const [attempts, setAttempts] = useState<number>((data._attempts as number) || 0)
  const [showResult, setShowResult] = useState(false)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [isLocked, setIsLocked] = useState(false)

  // Randomize options if configured
  const [displayOptions] = useState<AttentionCheckOption[]>(() => {
    if (randomizeOptions) {
      return [...options].sort(() => Math.random() - 0.5)
    }
    return options
  })

  // Log event helper
  const logEvent = useCallback(
    (eventType: string, payload: Record<string, unknown> = {}) => {
      if (!sessionId) return
      eventQueue.addEvent({
        sessionId,
        eventType,
        stageId,
        blockId: 'attention_check',
        payload,
      })
    },
    [sessionId, stageId]
  )

  // Check if answer is correct
  const checkAnswer = useCallback(
    (value: string) => {
      // Check against correctAnswer or find option marked as correct
      const correct =
        value === correctAnswer ||
        options.find((opt) => opt.value === value)?.isCorrect === true

      return correct
    },
    [correctAnswer, options]
  )

  // Handle selection
  const handleSelect = (value: string) => {
    if (isLocked || readOnly) return

    setSelectedValue(value)
    const newAttempts = attempts + 1
    setAttempts(newAttempts)
    onFieldChange('_attempts', newAttempts)

    const correct = checkAnswer(value)
    setIsCorrect(correct)

    // Log the attempt
    logEvent('attention_check_attempt', {
      value,
      attempt: newAttempts,
      correct,
    })

    if (correct) {
      // Correct answer
      setShowResult(true)
      onFieldChange('response', value)
      onFieldChange('_passed', true)
      onFieldChange('_attempts_to_pass', newAttempts)

      logEvent('attention_check_passed', {
        attemptsUsed: newAttempts,
      })

      setIsLocked(true)
    } else {
      // Wrong answer
      setShowResult(true)

      if (!allowRetry || newAttempts >= maxAttempts) {
        // No more retries allowed
        onFieldChange('response', value)
        onFieldChange('_passed', false)
        onFieldChange('_failed', true)

        logEvent('attention_check_failed', {
          attemptsUsed: newAttempts,
          failureAction,
        })

        setIsLocked(true)

        // Handle failure action
        if (failureAction === 'disqualify') {
          onFieldChange('_disqualified', true)
        }
      } else {
        // Allow retry - hide feedback after duration
        setTimeout(() => {
          setShowResult(false)
          setSelectedValue(null)
          setIsCorrect(null)
        }, feedbackDuration)
      }
    }
  }

  // Restore state from data and handle readOnly
  useEffect(() => {
    if (readOnly || data._passed || data._failed) {
      setIsLocked(true)
      setSelectedValue(data.response as string)
      setIsCorrect(data._passed as boolean)
      setShowResult(Boolean(data._passed || data._failed))
    }
  }, [data, readOnly])

  return (
    <div className="space-y-6">
      {/* Question */}
      <div className="text-lg font-medium text-foreground">{question}</div>

      {/* Attempt counter (if retries allowed) */}
      {allowRetry && maxAttempts > 1 && !isLocked && (
        <div className="text-sm text-muted-foreground">
          Attempt {attempts + 1} of {maxAttempts}
        </div>
      )}

      {/* Options */}
      <div className="space-y-3">
        {displayOptions.map((option) => {
          const isSelected = selectedValue === option.value
          const isThisCorrect = checkAnswer(option.value)

          return (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              disabled={isLocked}
              className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all hover:scale-[1.01] active:scale-[0.99] ${
                isLocked
                  ? isSelected
                    ? isCorrect
                      ? 'border-success bg-success/10 text-success'
                      : 'border-error bg-error/10 text-error'
                    : showResult && showFeedback && isThisCorrect
                    ? 'border-success/50 bg-success/5'
                    : 'border-border bg-muted/50 text-muted-foreground'
                  : isSelected
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Radio circle */}
                <span
                  className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isLocked
                      ? isSelected
                        ? isCorrect
                          ? 'border-success bg-success'
                          : 'border-error bg-error'
                        : showResult && showFeedback && isThisCorrect
                        ? 'border-success'
                        : 'border-border'
                      : isSelected
                      ? 'border-primary bg-primary'
                      : 'border-border'
                  }`}
                >
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                  {!isSelected && showResult && showFeedback && isThisCorrect && (
                    <svg
                      className="w-3 h-3 text-success"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </span>

                {/* Label */}
                <span className="flex-1">{option.label}</span>

                {/* Feedback icon */}
                {isLocked && isSelected && (
                  <span className="flex-shrink-0">
                    {isCorrect ? (
                      <svg
                        className="w-5 h-5 text-success"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5 text-error"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Feedback message */}
      {showResult && showFeedback && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-lg ${
            isCorrect
              ? 'bg-success/10 border border-success/30'
              : 'bg-error/10 border border-error/30'
          }`}
        >
          <div className="flex items-start gap-3">
            {isCorrect ? (
              <>
                <svg
                  className="w-5 h-5 text-success flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-medium text-success">Correct!</p>
                  <p className="text-sm text-success/80">
                    Thank you for your attention.
                  </p>
                </div>
              </>
            ) : (
              <>
                <svg
                  className="w-5 h-5 text-error flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-medium text-error">
                    {isLocked ? 'Incorrect' : 'Not quite right'}
                  </p>
                  <p className="text-sm text-error/80">
                    {isLocked
                      ? failureAction === 'disqualify'
                        ? 'Unfortunately, you have not passed the attention check.'
                        : 'Please pay closer attention to the questions.'
                      : `Please try again. ${maxAttempts - attempts} attempt${
                          maxAttempts - attempts !== 1 ? 's' : ''
                        } remaining.`}
                  </p>
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Disqualification warning */}
      {Boolean(data._disqualified) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-lg bg-error/10 border border-error/30"
        >
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-error flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-medium text-error">Study Disqualification</p>
              <p className="text-sm text-error/80">
                You have been disqualified from this study due to failing the
                attention check. Your data will not be used.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}

