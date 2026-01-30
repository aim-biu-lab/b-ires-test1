import clsx from 'clsx'

interface StageTimerProps {
  // Time display
  formattedTime: string
  // Whether we're showing remaining time (countdown) or elapsed time
  mode: 'countdown' | 'elapsed'
  // Progress percentage (0-100) for visual indicator
  progressPercent?: number
  // Visual style variants
  variant?: 'default' | 'warning' | 'danger' | 'minimal'
  // Size
  size?: 'sm' | 'md' | 'lg'
  // Show progress bar underneath
  showProgressBar?: boolean
  // Whether timer is in "urgent" state (< 30 seconds remaining)
  isUrgent?: boolean
  // Label to show before time
  label?: string
  // Custom class name
  className?: string
}

// Threshold in ms for warning state
const WARNING_THRESHOLD_MS = 60000 // 1 minute
// Threshold in ms for danger state  
const DANGER_THRESHOLD_MS = 30000 // 30 seconds

export function getTimerVariant(remainingMs: number | null): 'default' | 'warning' | 'danger' {
  if (remainingMs === null) return 'default'
  if (remainingMs <= DANGER_THRESHOLD_MS) return 'danger'
  if (remainingMs <= WARNING_THRESHOLD_MS) return 'warning'
  return 'default'
}

export default function StageTimer({
  formattedTime,
  mode,
  progressPercent = 0,
  variant = 'default',
  size = 'md',
  showProgressBar = false,
  isUrgent = false,
  label,
  className,
}: StageTimerProps) {
  // Size classes
  const sizeClasses = {
    sm: 'text-sm px-2 py-1',
    md: 'text-base px-3 py-1.5',
    lg: 'text-lg px-4 py-2',
  }
  
  // Variant classes
  const variantClasses = {
    default: 'bg-muted text-text-secondary',
    warning: 'bg-warning-light text-warning',
    danger: 'bg-error-light text-error',
    minimal: 'bg-transparent text-text-secondary',
  }
  
  // Icon based on variant
  const renderIcon = () => {
    if (mode === 'elapsed') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
          />
        </svg>
      )
    }
    
    // Countdown icon
    if (variant === 'danger') {
      return (
        <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
          />
        </svg>
      )
    }
    
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
        />
      </svg>
    )
  }

  return (
    <div className={clsx('flex flex-col items-center gap-1', className)}>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-full font-mono font-medium transition-colors duration-300',
          sizeClasses[size],
          variantClasses[variant],
          isUrgent && variant === 'danger' && 'animate-pulse'
        )}
      >
        {renderIcon()}
        {label && <span className="text-xs uppercase tracking-wider opacity-75">{label}</span>}
        <span className={clsx(
          'tabular-nums',
          variant === 'danger' && 'font-bold'
        )}>
          {formattedTime}
        </span>
      </div>
      
      {/* Progress bar */}
      {showProgressBar && (
        <div className="w-full h-1 bg-border rounded-full overflow-hidden">
          <div
            className={clsx(
              'h-full transition-all duration-100 ease-linear',
              variant === 'danger' && 'bg-error',
              variant === 'warning' && 'bg-warning',
              variant === 'default' && 'bg-primary'
            )}
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
        </div>
      )}
    </div>
  )
}

// Compact inline timer for embedding in other components
export function InlineTimer({
  formattedTime,
  variant = 'default',
  className,
}: Pick<StageTimerProps, 'formattedTime' | 'variant' | 'className'>) {
  const variantTextClasses = {
    default: 'text-text-secondary',
    warning: 'text-warning',
    danger: 'text-error',
    minimal: 'text-text-secondary',
  }
  
  return (
    <span 
      className={clsx(
        'inline-flex items-center gap-1 font-mono text-sm',
        variantTextClasses[variant],
        variant === 'danger' && 'font-semibold animate-pulse',
        className
      )}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
        />
      </svg>
      <span className="tabular-nums">{formattedTime}</span>
    </span>
  )
}


