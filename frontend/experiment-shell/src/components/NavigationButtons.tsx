import clsx from 'clsx'
import LoadingSpinner from './LoadingSpinner'

interface NavigationButtonsProps {
  onBack: () => void
  onNext: () => void
  canGoBack: boolean
  isSubmitting: boolean
  isLastStage: boolean
}

export default function NavigationButtons({
  onBack,
  onNext,
  canGoBack,
  isSubmitting,
  isLastStage,
}: NavigationButtonsProps) {
  return (
    <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
      {canGoBack ? (
        <button
          onClick={onBack}
          disabled={isSubmitting}
          className="btn btn-secondary"
        >
          <svg
            className="w-4 h-4 mr-2 inline"
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

      <button
        onClick={onNext}
        disabled={isSubmitting}
        className={clsx('btn btn-primary', isSubmitting && 'btn-disabled')}
      >
        {isSubmitting ? (
          <>
            <LoadingSpinner size="sm" className="mr-2" />
            Submitting...
          </>
        ) : isLastStage ? (
          'Complete'
        ) : (
          <>
            Continue
            <svg
              className="w-4 h-4 ml-2 inline"
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
        )}
      </button>
    </div>
  )
}



