import clsx from 'clsx'

// Interface for individual answer options with label and score
export interface LikertAnswerOption {
  label: string   // Visible label (e.g., "Strongly Agree")
  score: number   // Hidden score value (e.g., 5)
}

// Style configuration for the likert scale
export interface LikertStyleConfig {
  optionGap?: number       // Gap between options in pixels (default: 8)
  marginTop?: number       // Margin from top of question block in pixels
  marginBottom?: number    // Margin from bottom of options row in pixels
  optionPadding?: number   // Padding inside each option in pixels
}

interface LikertScaleBlockProps {
  // For backward compatibility: range-based auto-generation
  range?: [number, number]
  // New: explicit answer options with custom labels and scores
  options?: LikertAnswerOption[]
  value?: number
  onChange: (value: number) => void
  error?: string
  // Legacy labels (only used if options not provided)
  labels?: { low?: string; high?: string }
  // Toggle: show face images (disabled if more than 5 options)
  showFaces?: boolean
  // Toggle: show numeric score in addition to label
  showScore?: boolean
  readOnly?: boolean
  // Style configuration
  styleConfig?: LikertStyleConfig
}

// Default 5-point scale options (Strongly Disagree to Strongly Agree)
const DEFAULT_OPTIONS: LikertAnswerOption[] = [
  { label: 'Strongly Disagree', score: 1 },
  { label: 'Disagree', score: 2 },
  { label: 'Neutral', score: 3 },
  { label: 'Agree', score: 4 },
  { label: 'Strongly Agree', score: 5 },
]

// Face image mapping:
// - For 5 options: use faces 1-5 (skip the very sad face 0)
// - For 6 options: use faces 0-5 (full range)
// - For fewer options: interpolate within 1-5 range

export default function LikertScaleBlock({
  range,
  options,
  value,
  onChange,
  error,
  labels = { low: 'Strongly Disagree', high: 'Strongly Agree' },
  showFaces = true,
  showScore = false,
  readOnly = false,
  styleConfig = {},
}: LikertScaleBlockProps) {
  // Determine the actual options to use
  let actualOptions: LikertAnswerOption[]
  
  if (options && options.length > 0) {
    // Use explicit options
    actualOptions = options
  } else if (range) {
    // Generate options from range
    const [min, max] = range
    actualOptions = Array.from({ length: max - min + 1 }, (_, i) => ({
      label: String(min + i),
      score: min + i,
    }))
  } else {
    // Use default 5-point scale
    actualOptions = DEFAULT_OPTIONS
  }

  const optionCount = actualOptions.length
  // Disable faces if more than 5 options (we only have 6 face images: 0-5)
  const canShowFaces = showFaces && optionCount <= 5

  // Map option index to face index
  // For 5 or fewer options: use faces 1-5 (skip face 0)
  // For 6 options: use faces 0-5 (full range)
  const getFaceIndex = (index: number): number => {
    if (optionCount === 1) return 3 // neutral
    
    if (optionCount <= 5) {
      // Use faces 1-5 for standard 5-point or fewer scales
      // index 0 → face 1, index 4 → face 5
      const normalizedPosition = index / (optionCount - 1)
      return Math.round(normalizedPosition * 4) + 1
    } else {
      // Use faces 0-5 for 6-option scales (full range)
      const normalizedPosition = index / (optionCount - 1)
      return Math.round(normalizedPosition * 5)
    }
  }

  // Style defaults
  const gapPx = styleConfig.optionGap ?? 8
  const marginTopPx = styleConfig.marginTop ?? 0
  const marginBottomPx = styleConfig.marginBottom ?? 0
  const optionPaddingPx = styleConfig.optionPadding ?? 16

  return (
    <div 
      className="space-y-2"
      style={{ 
        marginTop: marginTopPx > 0 ? `${marginTopPx}px` : undefined,
      }}
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
                'flex-1 flex flex-col items-center gap-2 rounded-lg border-2 transition-all',
                isSelected
                  ? 'border-primary bg-primary-light scale-105'
                  : 'border-border hover:border-primary hover:bg-surface-elevated',
                readOnly && 'cursor-not-allowed opacity-70'
              )}
              style={{ padding: `${optionPaddingPx}px` }}
            >
              {/* Face image */}
              {canShowFaces && (
                <div className="w-12 h-12">
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
                'text-sm text-center leading-tight',
                isSelected ? 'text-primary font-medium' : 'text-text-secondary'
              )}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Legacy labels (only show if using range-based generation without explicit options) */}
      {!options && range && (
        <div className="flex justify-between text-sm text-text-secondary">
          <span>{labels.low}</span>
          <span>{labels.high}</span>
        </div>
      )}

      {error && <p className="text-sm text-error text-center">{error}</p>}
    </div>
  )
}
