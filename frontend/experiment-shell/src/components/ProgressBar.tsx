interface ProgressBarProps {
  current: number
  total: number
  percentage: number
}

export default function ProgressBar({ current, total, percentage }: ProgressBarProps) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">
          Step {current + 1} of {total}
        </span>
        <span className="text-sm font-medium text-text-primary">
          {Math.round(percentage)}%
        </span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}



