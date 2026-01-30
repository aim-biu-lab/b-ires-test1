import { QuestionConfig } from '../../store/sessionStore'
import clsx from 'clsx'

// Likert scale answer option interface (matching LikertScaleBlock)
interface LikertAnswerOption {
  label: string
  score: number
}

// Likert scale style config interface (snake_case from YAML)
interface LikertStyleConfigYaml {
  option_gap?: number
  margin_top?: number
  margin_bottom?: number
  option_padding?: number
}

interface QuestionnaireBlockProps {
  questions: QuestionConfig[]
  data: Record<string, unknown>
  errors: Record<string, string>
  onFieldChange: (fieldId: string, value: unknown) => void
  readOnly?: boolean
}

export default function QuestionnaireBlock({
  questions,
  data,
  errors,
  onFieldChange,
  readOnly = false,
}: QuestionnaireBlockProps) {
  return (
    <div className="space-y-6">
      {questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          value={data[question.id]}
          error={errors[question.id]}
          onChange={(value) => onFieldChange(question.id, value)}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

interface QuestionFieldProps {
  question: QuestionConfig
  value: unknown
  error?: string
  onChange: (value: unknown) => void
  readOnly?: boolean
}

// Default 5-point scale options (Strongly Disagree to Strongly Agree)
const DEFAULT_LIKERT_OPTIONS: LikertAnswerOption[] = [
  { label: 'Strongly Disagree', score: 1 },
  { label: 'Disagree', score: 2 },
  { label: 'Neutral', score: 3 },
  { label: 'Agree', score: 4 },
  { label: 'Strongly Agree', score: 5 },
]

function QuestionField({ question, value, error, onChange, readOnly = false }: QuestionFieldProps) {
  const disabledClass = readOnly ? 'opacity-70 cursor-not-allowed' : ''
  
  // Get margin from question config (CSS value like "10px", "20px 0 10px 0")
  const inputMargin = question.margin as string | undefined
  const inputStyle = inputMargin ? { margin: inputMargin } : undefined
  
  const renderInput = () => {
    switch (question.type) {
      case 'text':
        return (
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            placeholder={question.placeholder as string}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'textarea':
        return (
          <textarea
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input min-h-[120px]', error && 'input-error', disabledClass)}
            placeholder={question.placeholder as string}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'number':
        return (
          <input
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => !readOnly && onChange(e.target.valueAsNumber)}
            min={question.min as number}
            max={question.max as number}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'email':
        return (
          <input
            type="email"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )

      case 'select':
        return (
          <select
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          >
            <option value="">Select an option...</option>
            {question.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )

      case 'radio':
        return (
          <div className="space-y-2" style={inputStyle}>
            {question.options?.map((option) => (
              <label
                key={option.value}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-lg border border-border transition-colors select-none',
                  readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-surface-elevated'
                )}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => !readOnly && onChange(option.value)}
                  className="w-4 h-4 text-primary focus:ring-primary"
                  disabled={readOnly}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        )

      case 'checkbox':
        const selectedValues = (value as string[]) || []
        return (
          <div className="space-y-2" style={inputStyle}>
            {question.options?.map((option) => (
              <label
                key={option.value}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-lg border border-border transition-colors select-none',
                  readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-surface-elevated'
                )}
              >
                <input
                  type="checkbox"
                  value={option.value}
                  checked={selectedValues.includes(option.value)}
                  onChange={(e) => {
                    if (readOnly) return
                    if (e.target.checked) {
                      onChange([...selectedValues, option.value])
                    } else {
                      onChange(selectedValues.filter((v) => v !== option.value))
                    }
                  }}
                  className="w-4 h-4 rounded text-primary focus:ring-primary"
                  disabled={readOnly}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        )

      case 'likert_scale':
        // Get configuration from question
        const likertOptions = question.likert_options as LikertAnswerOption[] | undefined
        const showFaces = question.show_faces !== false // default true
        const showScore = question.show_score === true // default false
        const styleConfigYaml = question.style_config as LikertStyleConfigYaml | undefined
        
        // Determine actual options to use
        let actualOptions: LikertAnswerOption[]
        
        if (likertOptions && likertOptions.length > 0) {
          actualOptions = likertOptions
        } else if (question.range) {
          const [min, max] = question.range
          actualOptions = Array.from({ length: max - min + 1 }, (_, i) => ({
            label: String(min + i),
            score: min + i,
          }))
        } else {
          actualOptions = DEFAULT_LIKERT_OPTIONS
        }
        
        const optionCount = actualOptions.length
        // Disable faces if more than 5 options
        const canShowFaces = showFaces && optionCount <= 5
        
        // Map option index to face index
        // For 5 or fewer options: use faces 1-5 (skip face 0)
        // For 6 options: use faces 0-5 (full range)
        const getFaceIndex = (index: number): number => {
          if (optionCount === 1) return 3 // neutral
          
          if (optionCount <= 5) {
            // Use faces 1-5 for standard 5-point or fewer scales
            const normalizedPosition = index / (optionCount - 1)
            return Math.round(normalizedPosition * 4) + 1
          } else {
            // Use faces 0-5 for 6-option scales
            const normalizedPosition = index / (optionCount - 1)
            return Math.round(normalizedPosition * 5)
          }
        }
        
        // Style defaults (convert snake_case from YAML to values)
        const gapPx = styleConfigYaml?.option_gap ?? 8
        const marginTopPx = styleConfigYaml?.margin_top ?? 0
        const marginBottomPx = styleConfigYaml?.margin_bottom ?? 0
        const optionPaddingPx = styleConfigYaml?.option_padding ?? 16
        
        // Combine likert-specific margins with general margin prop
        const likertWrapperStyle: React.CSSProperties = {
          ...(inputMargin ? { margin: inputMargin } : {}),
          marginTop: marginTopPx > 0 ? `${marginTopPx}px` : undefined,
        }
        
        return (
          <div 
            className="space-y-2"
            style={likertWrapperStyle}
          >
            <div 
              className="flex justify-between"
              style={{ 
                gap: `${gapPx}px`,
                marginBottom: marginBottomPx > 0 ? `${marginBottomPx}px` : undefined,
              }}
            >
              {actualOptions.map((option, index) => {
                const isSelected = value === option.score
                return (
                  <button
                    key={option.score}
                    type="button"
                    onClick={() => !readOnly && onChange(option.score)}
                    disabled={readOnly}
                    className={clsx(
                      'flex-1 flex flex-col items-center gap-2 rounded-lg border-2 transition-all select-none',
                      isSelected
                        ? 'border-primary bg-primary-light scale-105'
                        : 'border-border hover:border-primary hover:bg-surface-elevated',
                      readOnly && 'cursor-not-allowed opacity-70'
                    )}
                    style={{ padding: `${optionPaddingPx}px` }}
                  >
                    {/* Face image */}
                    {canShowFaces && (
                      <div className="w-10 h-10">
                        <img 
                          src={`/faces/${getFaceIndex(index)}.svg`}
                          alt=""
                          className="w-full h-full"
                        />
                      </div>
                    )}
                    
                    {/* Score number (optional) */}
                    {showScore && (
                      <span className={clsx(
                        'text-lg font-semibold',
                        isSelected ? 'text-primary' : 'text-text-primary'
                      )}>
                        {option.score}
                      </span>
                    )}
                    
                    {/* Label text */}
                    <span className={clsx(
                      'text-xs text-center leading-tight',
                      isSelected ? 'text-primary font-medium' : 'text-text-secondary'
                    )}>
                      {option.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )

      default:
        return (
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => !readOnly && onChange(e.target.value)}
            className={clsx('input', error && 'input-error', disabledClass)}
            disabled={readOnly}
            style={inputStyle}
          />
        )
    }
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-text-primary font-medium">
          {question.text}
          {question.required !== false && <span className="text-error ml-1 select-none">*</span>}
        </span>
      </label>
      {renderInput()}
      {error && <p className="text-sm text-error select-none">{error}</p>}
    </div>
  )
}
