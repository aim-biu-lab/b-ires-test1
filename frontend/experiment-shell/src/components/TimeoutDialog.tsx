import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'

interface TimeoutDialogProps {
  isOpen: boolean
  title?: string
  message?: string
  // Available actions
  allowContinue?: boolean  // Continue anyway (submits partial data)
  allowExtend?: boolean    // Request more time (if supported)
  allowSkip?: boolean      // Skip this stage
  // Action handlers
  onContinue?: () => void
  onExtend?: () => void
  onSkip?: () => void
  onDismiss?: () => void
  // Styling
  variant?: 'warning' | 'error'
}

export default function TimeoutDialog({
  isOpen,
  title = 'Time\'s Up',
  message = 'You have run out of time for this section.',
  allowContinue = true,
  allowExtend = false,
  allowSkip = false,
  onContinue,
  onExtend,
  onSkip,
  onDismiss,
  variant = 'warning',
}: TimeoutDialogProps) {
  // Count available actions
  const actionCount = [allowContinue, allowExtend, allowSkip].filter(Boolean).length
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onDismiss}
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
              className={clsx(
                'bg-surface rounded-lg shadow-xl max-w-md w-full p-6',
                'border-t-4',
                variant === 'error' ? 'border-error' : 'border-warning'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Icon */}
              <div className="flex justify-center mb-4">
                <div 
                  className={clsx(
                    'w-16 h-16 rounded-full flex items-center justify-center',
                    variant === 'error' ? 'bg-error-light' : 'bg-warning-light'
                  )}
                >
                  <svg 
                    className={clsx(
                      'w-8 h-8',
                      variant === 'error' ? 'text-error' : 'text-warning'
                    )}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
                    />
                  </svg>
                </div>
              </div>
              
              {/* Title */}
              <h2 className="text-xl font-semibold text-text-primary text-center mb-2">
                {title}
              </h2>
              
              {/* Message */}
              <p className="text-text-secondary text-center mb-6">
                {message}
              </p>
              
              {/* Actions */}
              <div className={clsx(
                'flex gap-3',
                actionCount === 1 ? 'justify-center' : 'flex-col sm:flex-row'
              )}>
                {allowExtend && (
                  <button
                    onClick={onExtend}
                    className="btn btn-secondary flex-1"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6" 
                      />
                    </svg>
                    Request More Time
                  </button>
                )}
                
                {allowSkip && (
                  <button
                    onClick={onSkip}
                    className="btn btn-secondary flex-1"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M13 5l7 7-7 7M5 5l7 7-7 7" 
                      />
                    </svg>
                    Skip This Section
                  </button>
                )}
                
                {allowContinue && (
                  <button
                    onClick={onContinue}
                    className={clsx(
                      'btn flex-1',
                      variant === 'error' ? 'bg-error hover:bg-error/90 text-white' : 'btn-primary'
                    )}
                  >
                    Submit & Continue
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M9 5l7 7-7 7" 
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// Locked interface overlay - shown when on_timeout: 'lock_interface'
export function LockedOverlay({
  message = 'Time has expired. The interface is now locked.',
}: {
  message?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 bg-surface/90 backdrop-blur-sm z-40 flex flex-col items-center justify-center"
    >
      <div className="text-center p-6 max-w-md">
        {/* Lock icon */}
        <div className="w-16 h-16 rounded-full bg-error-light flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
            />
          </svg>
        </div>
        
        <h3 className="text-lg font-semibold text-error mb-2">Time Expired</h3>
        <p className="text-text-secondary">{message}</p>
      </div>
    </motion.div>
  )
}


