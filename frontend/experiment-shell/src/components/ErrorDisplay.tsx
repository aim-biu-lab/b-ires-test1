interface ErrorDisplayProps {
  message: string
  onRetry?: () => void
}

export default function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  return (
    <div className="card max-w-md w-full text-center">
      <div className="mb-4">
        <div className="w-12 h-12 mx-auto bg-error-light rounded-full flex items-center justify-center">
          <svg
            className="w-6 h-6 text-error"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>

      <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
      <p className="text-text-secondary mb-4">{message}</p>

      {onRetry && (
        <button onClick={onRetry} className="btn btn-primary">
          Try Again
        </button>
      )}
    </div>
  )
}



