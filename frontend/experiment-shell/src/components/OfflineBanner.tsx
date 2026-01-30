import { motion, AnimatePresence } from 'framer-motion'

interface OfflineBannerProps {
  isOffline: boolean
  isSyncing: boolean
  pendingSubmissions: number
  onSync: () => void
}

export default function OfflineBanner({
  isOffline,
  isSyncing,
  pendingSubmissions,
  onSync,
}: OfflineBannerProps) {
  const showBanner = isOffline || pendingSubmissions > 0

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div
            className={`px-4 py-3 ${
              isOffline
                ? 'bg-warning/10 border-b border-warning/30'
                : 'bg-info/10 border-b border-info/30'
            }`}
          >
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {isOffline ? (
                  <>
                    <div className="flex-shrink-0 w-6 h-6 bg-warning/20 rounded-full flex items-center justify-center">
                      <svg
                        className="w-3.5 h-3.5 text-warning"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-warning-foreground">
                        You're offline
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Your responses will be saved locally and synced when you reconnect
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex-shrink-0 w-6 h-6 bg-info/20 rounded-full flex items-center justify-center">
                      {isSyncing ? (
                        <div className="w-3 h-3 border-2 border-info border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg
                          className="w-3.5 h-3.5 text-info"
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
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-info-foreground">
                        {isSyncing ? 'Syncing...' : `${pendingSubmissions} response${pendingSubmissions !== 1 ? 's' : ''} pending`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isSyncing
                          ? 'Please wait while we sync your responses'
                          : 'Click sync to submit your saved responses'}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {!isOffline && pendingSubmissions > 0 && !isSyncing && (
                <button
                  onClick={onSync}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-info bg-info/10 hover:bg-info/20 border border-info/30 rounded-lg transition-colors"
                >
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Sync Now
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}



