import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { eventQueue } from '../../lib/eventQueue'
import { useSessionStore } from '../../store/sessionStore'

// Types for answer badges
interface AnswerBadge {
  text: string
  color: 'green' | 'blue' | 'yellow' | 'red' | 'gray'
}

// Types for answer options
interface AnswerOption {
  id: string
  type: 'text' | 'image' | 'text_with_image' | 'html' | 'free_text'
  content: string
  subtext?: string
  explanation?: string
  label?: string
  badges?: AnswerBadge[]
  image_url?: string
  placeholder?: string
}

// Types for question
interface Question {
  type: 'text' | 'image' | 'video' | 'html'
  content: string
  subtext?: string
  image_url?: string
  video_url?: string
}

// Config types
interface MultipleChoiceConfig {
  layout?: 'single_column' | '2x2' | '2x3' | '3x2' | '3x3' | '3x4' | '4x3' | '4x4' | '5x5' | 'auto'
  correct_answer?: string | string[]
  allow_multiple_selection?: boolean
  lock_after_submit?: boolean
  show_correct_after_submit?: boolean
  show_explanation_after_submit?: boolean
  show_answer_explanations?: boolean
  show_answer_labels?: boolean
  label_style?: 'letter' | 'number' | 'none'
  randomize_order?: boolean
  track_score?: boolean
  show_score_to_participant?: boolean
  score_format?: string
}

interface MultipleChoiceBlockProps {
  question: Question
  answers: AnswerOption[]
  config?: MultipleChoiceConfig
  explanationBeforeSubmit?: string
  explanationAfterSubmit?: string
  stageId: string
  data: Record<string, unknown>
  errors?: Record<string, string>
  onFieldChange: (fieldId: string, value: unknown) => void
  readOnly?: boolean
}

// Badge color mapping - styled to match modern UI like in the reference image
const BADGE_COLORS: Record<string, string> = {
  green: 'bg-emerald-500 text-white',
  blue: 'bg-blue-500 text-white',
  yellow: 'bg-amber-400 text-amber-900',
  red: 'bg-red-500 text-white',
  purple: 'bg-purple-500 text-white',
  orange: 'bg-orange-500 text-white',
  gray: 'bg-slate-500 text-white',
}

// Generate label based on index and style
function generateLabel(index: number, style: 'letter' | 'number' | 'none'): string {
  if (style === 'none') return ''
  if (style === 'number') return String(index + 1)
  return String.fromCharCode(65 + index) // A, B, C, D...
}

export default function MultipleChoiceBlock({
  question,
  answers,
  config = {},
  explanationBeforeSubmit,
  explanationAfterSubmit,
  stageId,
  data,
  errors = {},
  onFieldChange,
  readOnly = false,
}: MultipleChoiceBlockProps) {
  const sessionId = useSessionStore((state) => state.sessionId)

  const {
    layout = 'single_column',
    correct_answer,
    allow_multiple_selection = false,
    lock_after_submit = true,
    show_correct_after_submit = false,
    show_explanation_after_submit = false,
    show_answer_explanations = false,
    show_answer_labels = true,
    label_style = 'letter',
    randomize_order = false,
    track_score = false,
    show_score_to_participant = false,
    score_format = 'Correct: {{correct}} of {{total}}',
  } = config

  // State
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>(
    (data.selected_answers as string[]) || []
  )
  const [freeTextValues, setFreeTextValues] = useState<Record<string, string>>(
    (data.free_text_values as Record<string, string>) || {}
  )
  
  // Only consider submitted if the _submitted flag is explicitly true
  // Having a selection does NOT mean submitted - user may have selected but not clicked submit
  const [isSubmitted, setIsSubmitted] = useState<boolean>(
    Boolean(data._submitted)
  )
  const [startTime] = useState<number>(Date.now())
  
  // Ref to track if we've already logged the submit event (prevents duplicate logging)
  // This is synchronous unlike state, so it prevents race conditions in useEffect
  const hasLoggedSubmitRef = useRef<boolean>(Boolean(data._submitted))

  // Randomize answers if configured (only on initial render)
  const displayAnswers = useMemo(() => {
    if (randomize_order && !isSubmitted) {
      return [...answers].sort(() => Math.random() - 0.5)
    }
    return answers
  }, [answers, randomize_order, isSubmitted])

  // Normalize correct_answer to array
  const correctAnswerIds = useMemo(() => {
    if (!correct_answer) return []
    return Array.isArray(correct_answer) ? correct_answer : [correct_answer]
  }, [correct_answer])

  // Check if a specific answer is correct
  const isAnswerCorrect = useCallback(
    (answerId: string) => correctAnswerIds.includes(answerId),
    [correctAnswerIds]
  )

  // Check if the user's selection is correct
  const isSelectionCorrect = useMemo(() => {
    if (correctAnswerIds.length === 0) return null // No correct answer defined
    
    if (allow_multiple_selection) {
      // For multiple selection, all correct answers must be selected and no incorrect ones
      const selectedSet = new Set(selectedAnswers)
      const correctSet = new Set(correctAnswerIds)
      
      if (selectedSet.size !== correctSet.size) return false
      for (const id of selectedSet) {
        if (!correctSet.has(id)) return false
      }
      return true
    } else {
      // For single selection
      return selectedAnswers.length === 1 && correctAnswerIds.includes(selectedAnswers[0])
    }
  }, [selectedAnswers, correctAnswerIds, allow_multiple_selection])

  // Log event helper
  const logEvent = useCallback(
    (eventType: string, payload: Record<string, unknown> = {}) => {
      if (!sessionId) return
      eventQueue.addEvent({
        sessionId,
        eventType,
        stageId,
        blockId: 'multiple_choice',
        payload,
      })
    },
    [sessionId, stageId]
  )

  // Handle answer selection
  const handleSelectAnswer = (answerId: string) => {
    // Block changes if readOnly or submitted AND lock is enabled
    if (readOnly || (isSubmitted && lock_after_submit)) return

    let newSelectedAnswers: string[]

    if (allow_multiple_selection) {
      // Toggle selection for multiple selection mode
      if (selectedAnswers.includes(answerId)) {
        newSelectedAnswers = selectedAnswers.filter((id) => id !== answerId)
        logEvent('multiple_choice_deselect', { answer_id: answerId })
      } else {
        newSelectedAnswers = [...selectedAnswers, answerId]
        logEvent('multiple_choice_select', { answer_id: answerId })
      }
    } else {
      // Replace selection for single selection mode
      newSelectedAnswers = [answerId]
      logEvent('multiple_choice_select', { answer_id: answerId })
    }

    setSelectedAnswers(newSelectedAnswers)
    onFieldChange('selected_answers', newSelectedAnswers)
    onFieldChange('response', newSelectedAnswers.length === 1 ? newSelectedAnswers[0] : newSelectedAnswers)
  }

  // Handle free text input
  const handleFreeTextChange = (answerId: string, value: string) => {
    // Block changes if readOnly or submitted AND lock is enabled
    if (readOnly || (isSubmitted && lock_after_submit)) return

    const newFreeTextValues = { ...freeTextValues, [answerId]: value }
    setFreeTextValues(newFreeTextValues)
    onFieldChange('free_text_values', newFreeTextValues)

    logEvent('multiple_choice_free_text', {
      answer_id: answerId,
      value_length: value.length,
    })
  }

  // Mark as submitted when data changes (from parent)
  useEffect(() => {
    // Use ref check to prevent duplicate logging - ref is synchronous unlike state
    if (data._submitted && !hasLoggedSubmitRef.current) {
      // Immediately mark as logged to prevent race conditions
      hasLoggedSubmitRef.current = true
      setIsSubmitted(true)
      
      const timeToAnswer = Date.now() - startTime
      
      // Log submission
      logEvent('multiple_choice_submit', {
        selected_answers: selectedAnswers,
        free_text_values: freeTextValues,
        correct_answer: correct_answer,
        is_correct: isSelectionCorrect,
        time_to_answer_ms: timeToAnswer,
      })

      // Store correctness for score tracking
      if (track_score && isSelectionCorrect !== null) {
        onFieldChange('_is_correct', isSelectionCorrect)
      }
    }
  }, [data._submitted, selectedAnswers, freeTextValues, correct_answer, isSelectionCorrect, logEvent, onFieldChange, startTime, track_score])

  // Get grid classes based on layout
  const getGridClasses = () => {
    switch (layout) {
      case '2x2':
        return 'grid grid-cols-1 sm:grid-cols-2 gap-4'
      case '2x3':
        return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
      case '3x2':
        return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
      case '3x3':
        return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
      case '3x4':
        return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
      case '4x3':
        return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
      case '4x4':
        return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
      case '5x5':
        return 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3'
      case 'auto':
        const count = answers.length
        if (count <= 2) return 'grid grid-cols-1 sm:grid-cols-2 gap-4'
        if (count <= 4) return 'grid grid-cols-1 sm:grid-cols-2 gap-4'
        if (count <= 6) return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
        if (count <= 8) return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
        return 'grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3'
      case 'single_column':
      default:
        return 'flex flex-col gap-3'
    }
  }

  // Render question content
  const renderQuestion = () => {
    switch (question.type) {
      case 'image':
        return (
          <div className="space-y-3">
            {question.content && (
              <div className="text-lg font-medium text-foreground">{question.content}</div>
            )}
            {question.image_url && (
              <img
                src={question.image_url}
                alt="Question"
                className="max-w-full h-auto rounded-lg shadow-md mx-auto"
              />
            )}
            {question.subtext && (
              <p className="text-sm text-muted-foreground">{question.subtext}</p>
            )}
          </div>
        )

      case 'video':
        return (
          <div className="space-y-3">
            {question.content && (
              <div className="text-lg font-medium text-foreground">{question.content}</div>
            )}
            {question.video_url && (
              <div className="aspect-video w-full max-w-2xl mx-auto">
                {question.video_url.includes('youtube.com') || question.video_url.includes('youtu.be') ? (
                  <iframe
                    src={question.video_url.replace('watch?v=', 'embed/')}
                    className="w-full h-full rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video
                    src={question.video_url}
                    controls
                    className="w-full h-full rounded-lg"
                  />
                )}
              </div>
            )}
            {question.subtext && (
              <p className="text-sm text-muted-foreground">{question.subtext}</p>
            )}
          </div>
        )

      case 'html':
        return (
          <div className="space-y-3">
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: question.content }}
            />
            {question.subtext && (
              <p className="text-sm text-muted-foreground">{question.subtext}</p>
            )}
          </div>
        )

      case 'text':
      default:
        return (
          <div className="space-y-2">
            <div className="text-lg font-medium text-foreground">{question.content}</div>
            {question.subtext && (
              <p className="text-sm text-muted-foreground">{question.subtext}</p>
            )}
          </div>
        )
    }
  }

  // Render answer option
  const renderAnswer = (answer: AnswerOption, index: number) => {
    const isSelected = selectedAnswers.includes(answer.id)
    const showCorrectness = isSubmitted && show_correct_after_submit && correctAnswerIds.length > 0
    const isThisCorrect = isAnswerCorrect(answer.id)
    const label = answer.label || (show_answer_labels ? generateLabel(index, label_style) : '')

    // Determine styling based on state
    let borderClass = 'border-slate-200'
    let bgClass = 'bg-white'
    let shadowClass = 'shadow-sm'
    
    if (showCorrectness) {
      if (isSelected) {
        if (isThisCorrect) {
          borderClass = 'border-emerald-400'
          bgClass = 'bg-emerald-50/50'
          shadowClass = 'shadow-emerald-100'
        } else {
          borderClass = 'border-red-400'
          bgClass = 'bg-red-50/50'
          shadowClass = 'shadow-red-100'
        }
      } else if (isThisCorrect) {
        borderClass = 'border-emerald-300'
        bgClass = 'bg-emerald-50/30'
      }
    } else if (isSelected) {
      borderClass = 'border-primary'
      bgClass = 'bg-primary/5'
      shadowClass = 'shadow-md'
    }

    const isFreeText = answer.type === 'free_text'

    // Determine if the button should be disabled
    const isLocked = readOnly || (isSubmitted && lock_after_submit)
    const isInteractive = !isLocked

    return (
      <motion.button
        key={answer.id}
        type="button"
        onClick={() => handleSelectAnswer(answer.id)}
        disabled={isLocked}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05 }}
        className={`
          relative text-left p-5 rounded-2xl border transition-all h-full
          ${borderClass} ${bgClass} ${shadowClass}
          ${isInteractive ? 'hover:border-primary/60 hover:shadow-md cursor-pointer' : 'cursor-default'}
          ${isLocked && !showCorrectness ? 'opacity-80' : ''}
        `}
      >
        {/* Header row with label and badges */}
        <div className="flex items-start justify-between mb-3">
          {/* Label (A, B, C, D) */}
          {label && (
            <span
              className={`
                text-2xl font-bold tracking-tight
                ${isSelected 
                  ? showCorrectness 
                    ? isThisCorrect 
                      ? 'text-emerald-600' 
                      : 'text-red-600'
                    : 'text-primary'
                  : 'text-primary'
                }
              `}
            >
              {label}
            </span>
          )}

          {/* Badges - positioned top right */}
          {answer.badges && answer.badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {answer.badges.map((badge, badgeIndex) => (
                <span
                  key={badgeIndex}
                  className={`
                    px-2.5 py-1 text-xs font-bold rounded-md uppercase tracking-wide
                    ${BADGE_COLORS[badge.color] || BADGE_COLORS.gray}
                  `}
                >
                  {badge.text}
                </span>
              ))}
            </div>
          )}

          {/* Correctness indicator - when no badges */}
          {showCorrectness && (!answer.badges || answer.badges.length === 0) && (
            <span className="flex-shrink-0">
              {isSelected ? (
                isThisCorrect ? (
                  <CheckCircleIcon className="w-6 h-6 text-emerald-500" />
                ) : (
                  <XCircleIcon className="w-6 h-6 text-red-500" />
                )
              ) : isThisCorrect ? (
                <CheckCircleIcon className="w-6 h-6 text-emerald-400" />
              ) : null}
            </span>
          )}
        </div>

        {/* Divider line under label */}
        <div className={`h-px mb-4 ${isSelected ? 'bg-primary/20' : 'bg-slate-200'}`} />

        {/* Content area */}
        <div className="space-y-3">
          {/* Main content */}
          {answer.type === 'image' && answer.image_url ? (
            <div className="space-y-3">
              <img
                src={answer.image_url}
                alt={answer.content}
                className="w-full h-auto rounded-xl"
              />
              {answer.content && (
                <p className="text-lg font-bold text-slate-800">{answer.content}</p>
              )}
            </div>
          ) : answer.type === 'text_with_image' && answer.image_url ? (
            <div className="space-y-3">
              <p className="text-lg font-bold text-slate-800">{answer.content}</p>
              <img
                src={answer.image_url}
                alt={answer.content}
                className="w-full h-auto rounded-xl"
              />
            </div>
          ) : answer.type === 'html' ? (
            <div
              className="prose prose-slate prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: answer.content }}
            />
          ) : isFreeText ? (
            <div className="space-y-3">
              <p className="text-lg font-bold text-slate-800">{answer.content}</p>
              {isSelected && isInteractive && (
                <input
                  type="text"
                  value={freeTextValues[answer.id] || ''}
                  onChange={(e) => {
                    e.stopPropagation()
                    handleFreeTextChange(answer.id, e.target.value)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={answer.placeholder || 'Enter your answer...'}
                  className="w-full px-4 py-2.5 text-sm border border-slate-300 rounded-xl
                    bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              )}
              {isSelected && isLocked && freeTextValues[answer.id] && (
                <p className="text-sm text-slate-500 italic">
                  "{freeTextValues[answer.id]}"
                </p>
              )}
            </div>
          ) : (
            <p className="text-lg font-bold text-slate-800 leading-relaxed">{answer.content}</p>
          )}

          {/* Subtext */}
          {answer.subtext && (
            <p className="text-sm text-slate-500">{answer.subtext}</p>
          )}

          {/* Per-answer explanation (after submit) - styled like in the image */}
          {isSubmitted && show_answer_explanations && answer.explanation && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 pl-4 border-l-4 border-slate-200"
            >
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                Explanation
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                {answer.explanation}
              </p>
            </motion.div>
          )}
        </div>
      </motion.button>
    )
  }

  // Format score string
  const formatScore = (format: string, correct: number, total: number) => {
    return format
      .replace('{{correct}}', String(correct))
      .replace('{{total}}', String(total))
  }

  // Get all stage data from session store for score aggregation
  const allStageData = useSessionStore((state) => state.stageData)
  const visibleStages = useSessionStore((state) => state.visibleStages)

  // Get score from session store (aggregating across all multiple_choice stages)
  const score = useMemo(() => {
    if (!track_score || !show_score_to_participant) return null
    if (!isSubmitted) return null
    
    // Find all multiple_choice stages and aggregate their scores
    const mcStages = visibleStages.filter(s => s.type === 'multiple_choice')
    
    let correct = 0
    let total = 0
    
    for (const mcStage of mcStages) {
      const stageData = allStageData[mcStage.id]
      if (!stageData) continue
      
      // Only count stages that have been submitted
      if (!stageData._submitted) continue
      
      total++
      if (stageData._is_correct === true) {
        correct++
      }
    }
    
    // Include current stage if submitted
    if (total === 0) {
      // Fallback: just show this question's result
      return { correct: isSelectionCorrect ? 1 : 0, total: 1 }
    }
    
    return { correct, total }
  }, [track_score, show_score_to_participant, isSubmitted, isSelectionCorrect, allStageData, visibleStages])

  return (
    <div className="space-y-6">
      {/* Question */}
      <div className="space-y-4">
        {renderQuestion()}
      </div>

      {/* Pre-submit explanation */}
      {!isSubmitted && explanationBeforeSubmit && (
        <div
          className="p-4 rounded-lg bg-muted/50 border border-border prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: explanationBeforeSubmit }}
        />
      )}

      {/* Answer options */}
      <div className={getGridClasses()}>
        {displayAnswers.map((answer, index) => renderAnswer(answer, index))}
      </div>

      {/* Validation error message */}
      {errors.selected_answers && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-700 text-center">{errors.selected_answers}</p>
        </div>
      )}

      {/* Post-submit feedback */}
      <AnimatePresence>
        {isSubmitted && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-4"
          >
            {/* Correctness feedback */}
            {show_correct_after_submit && isSelectionCorrect !== null && (
              <div
                className={`
                  p-4 rounded-lg border
                  ${isSelectionCorrect
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  {isSelectionCorrect ? (
                    <>
                      <CheckCircleIcon className="w-6 h-6 text-emerald-600" />
                      <div>
                        <p className="font-medium text-emerald-800">Correct!</p>
                        <p className="text-sm text-emerald-700">
                          Great job, you selected the right answer.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircleIcon className="w-6 h-6 text-red-600" />
                      <div>
                        <p className="font-medium text-red-800">Incorrect</p>
                        <p className="text-sm text-red-700">
                          The correct answer has been highlighted.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Score display */}
            {score && (
              <div className="text-center py-2">
                <span className="px-4 py-2 rounded-full bg-primary/10 text-primary font-medium">
                  {formatScore(score_format, score.correct, score.total)}
                </span>
              </div>
            )}

            {/* Main explanation */}
            {show_explanation_after_submit && explanationAfterSubmit && (
              <div
                className="p-4 rounded-lg bg-sky-50 border border-sky-200 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: explanationAfterSubmit }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Icons
function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  )
}

