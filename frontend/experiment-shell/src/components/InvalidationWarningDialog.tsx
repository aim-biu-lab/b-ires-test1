import { motion, AnimatePresence } from 'framer-motion'

interface InvalidationWarningDialogProps {
  isOpen: boolean
  invalidatedStages: string[]
  stageLabels: Record<string, string>
  onConfirm: () => void
  onCancel: () => void
}

export default function InvalidationWarningDialog({
  isOpen,
  invalidatedStages,
  stageLabels,
  onConfirm,
  onCancel,
}: InvalidationWarningDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onCancel}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="bg-background border border-border rounded-xl shadow-xl max-w-md w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-border bg-warning/5">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-warning/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-warning"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      Editing Will Clear Responses
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      This action cannot be undone
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="px-6 py-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Changing your answer here will invalidate and clear your responses to the
                  following stages that depend on this answer:
                </p>

                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {invalidatedStages.map((stageId) => (
                    <div
                      key={stageId}
                      className="flex items-center gap-2 px-3 py-2 bg-error/5 border border-error/20 rounded-lg"
                    >
                      <svg
                        className="w-4 h-4 text-error flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                      <span className="text-sm text-foreground">
                        {stageLabels[stageId] || stageId}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-muted-foreground mt-4">
                  You will need to re-answer these questions after making your change.
                </p>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-end gap-3">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm font-medium text-foreground bg-background border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Keep Current Answer
                </button>
                <button
                  onClick={onConfirm}
                  className="px-4 py-2 text-sm font-medium text-white bg-warning hover:bg-warning/90 rounded-lg transition-colors"
                >
                  Edit Anyway
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}



