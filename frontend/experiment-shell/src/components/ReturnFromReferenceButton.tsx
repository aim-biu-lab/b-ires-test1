import { motion } from 'framer-motion'

interface ReturnFromReferenceButtonProps {
  returnStageLabel: string | null
  onReturn: () => void
  isLoading?: boolean
}

export default function ReturnFromReferenceButton({
  returnStageLabel,
  onReturn,
  isLoading = false,
}: ReturnFromReferenceButtonProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 p-4 bg-info/10 border border-info/30 rounded-lg"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-info/20 rounded-full flex items-center justify-center">
            <svg
              className="w-4 h-4 text-info"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Viewing Reference Material
            </p>
            <p className="text-xs text-muted-foreground">
              {returnStageLabel
                ? `Return to "${returnStageLabel}" when you're ready`
                : "Return to your previous question when you're ready"}
            </p>
          </div>
        </div>

        <button
          onClick={onReturn}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-info hover:bg-info/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Returning...
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z"
                />
              </svg>
              Return to Question
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}



