import { motion } from 'framer-motion'

interface AlreadyCompletedMessageProps {
  onStartAgain: () => void
  isLoading?: boolean
}

export default function AlreadyCompletedMessage({
  onStartAgain,
  isLoading = false,
}: AlreadyCompletedMessageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="card max-w-md w-full text-center"
      >
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto bg-success-light rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-semibold mb-2">Already Completed</h1>
        <p className="text-text-secondary mb-6">
          You have already completed this experiment. Thank you for your participation!
        </p>

        <div className="space-y-3">
          <button
            onClick={onStartAgain}
            disabled={isLoading}
            className="btn btn-primary w-full flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <span className="loading-spinner" />
            ) : (
              <>
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Start Again
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-text-muted text-center mt-4">
          You may close this window if you don't want to participate again.
        </p>
      </motion.div>
    </div>
  )
}



