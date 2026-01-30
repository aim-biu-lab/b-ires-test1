import { useEffect, useState, useCallback, forwardRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useToastStore, Toast as ToastType, ToastPosition } from '../store/toastStore'
import clsx from 'clsx'

// Icons for different toast types
const ToastIcon = ({ type }: { type: ToastType['type'] }) => {
  switch (type) {
    case 'success':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      )
    case 'error':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clipRule="evenodd"
          />
        </svg>
      )
    case 'warning':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      )
    case 'info':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
      )
    case 'confirmation':
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      )
  }
}

// Sidebar width constant (matches the sidebar in ExperimentShell)
const SIDEBAR_WIDTH = 256

// Get position styles for the container (positioned within main content area)
const getPositionStyles = (position: ToastPosition): React.CSSProperties => {
  const baseStyles: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    pointerEvents: 'none',
  }
  
  switch (position) {
    case 'bottom-left':
      return { ...baseStyles, bottom: '1rem', left: `${SIDEBAR_WIDTH + 16}px` }
    case 'bottom-right':
      return { ...baseStyles, bottom: '1rem', right: '1rem' }
    case 'top-left':
      return { ...baseStyles, top: '5rem', left: `${SIDEBAR_WIDTH + 16}px` } // Account for top bar
    case 'top-right':
      return { ...baseStyles, top: '5rem', right: '1rem' }
    case 'bottom-center':
      return { 
        ...baseStyles, 
        bottom: '1rem', 
        left: `calc(${SIDEBAR_WIDTH}px + (100vw - ${SIDEBAR_WIDTH}px) / 2)`,
        transform: 'translateX(-50%)',
      }
    case 'top-center':
      return { 
        ...baseStyles, 
        top: '5rem', 
        left: `calc(${SIDEBAR_WIDTH}px + (100vw - ${SIDEBAR_WIDTH}px) / 2)`,
        transform: 'translateX(-50%)',
      }
  }
}

// Get animation variants based on position
const getAnimationVariants = (position: ToastPosition) => {
  const isLeft = position.includes('left')
  const isRight = position.includes('right')
  const isTop = position.includes('top')
  
  const initialX = isLeft ? -100 : isRight ? 100 : 0
  const initialY = isTop ? -50 : 50
  
  return {
    initial: { 
      opacity: 0, 
      x: initialX, 
      y: !isLeft && !isRight ? initialY : 0,
      scale: 0.9,
    },
    animate: { 
      opacity: 1, 
      x: 0, 
      y: 0,
      scale: 1,
    },
    exit: { 
      opacity: 0, 
      x: initialX, 
      y: !isLeft && !isRight ? initialY : 0,
      scale: 0.9,
      transition: { duration: 0.2 },
    },
  }
}

// Single toast item component - wrapped with forwardRef for framer-motion AnimatePresence
const ToastItem = forwardRef<HTMLDivElement, { toast: ToastType; position: ToastPosition }>(
  function ToastItem({ toast, position }, ref) {
  const { removeToast } = useToastStore()
  const [progress, setProgress] = useState(100)
  
  const handleClose = useCallback(() => {
    removeToast(toast.id)
  }, [removeToast, toast.id])
  
  const handleConfirm = useCallback(() => {
    toast.onConfirm?.()
    handleClose()
  }, [toast, handleClose])
  
  const handleCancel = useCallback(() => {
    toast.onCancel?.()
    handleClose()
  }, [toast, handleClose])
  
  // Progress bar animation
  useEffect(() => {
    if (!toast.showProgress || !toast.duration || toast.duration <= 0) return
    
    const startTime = Date.now()
    const duration = toast.duration
    
    const updateProgress = () => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      
      if (remaining > 0) {
        requestAnimationFrame(updateProgress)
      }
    }
    
    const animationId = requestAnimationFrame(updateProgress)
    return () => cancelAnimationFrame(animationId)
  }, [toast.duration, toast.showProgress])
  
  const variants = getAnimationVariants(position)
  
  const typeStyles = {
    success: 'bg-[#166534] text-white border-[#22c55e]',
    error: 'bg-[#991b1b] text-white border-[#ef4444]',
    warning: 'bg-[#854d0e] text-white border-[#f59e0b]',
    info: 'bg-[#1e40af] text-white border-[#3b82f6]',
    confirmation: 'bg-surface text-text-primary border-border',
  }
  
  const progressStyles = {
    success: 'bg-white/30',
    error: 'bg-white/30',
    warning: 'bg-white/30',
    info: 'bg-white/30',
    confirmation: 'bg-primary/30',
  }
  
  return (
    <motion.div
      ref={ref}
      layout
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className={clsx(
        'pointer-events-auto relative overflow-hidden',
        'min-w-[320px] max-w-[420px]',
        'rounded-lg border shadow-lg',
        'backdrop-blur-sm',
        typeStyles[toast.type]
      )}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <ToastIcon type={toast.type} />
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{toast.message}</p>
          
          {/* Confirmation buttons */}
          {toast.type === 'confirmation' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleConfirm}
                className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-white hover:bg-primary-hover transition-colors"
              >
                {toast.confirmLabel || 'Confirm'}
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs font-medium rounded bg-transparent border border-border hover:bg-surface-elevated transition-colors"
              >
                {toast.cancelLabel || 'Cancel'}
              </button>
            </div>
          )}
        </div>
        
        {/* Close button */}
        <button
          onClick={handleClose}
          className="flex-shrink-0 p-1 rounded hover:bg-white/20 transition-colors"
          aria-label="Close notification"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* Progress bar */}
      {toast.showProgress && toast.duration && toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1">
          <div
            className={clsx('h-full transition-none', progressStyles[toast.type])}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </motion.div>
  )
})

// Toast container component - renders all active toasts
export default function ToastContainer() {
  const { toasts, position } = useToastStore()
  
  // Reverse order for bottom positions so newest appears at bottom
  const isBottom = position.includes('bottom')
  const orderedToasts = isBottom ? [...toasts].reverse() : toasts
  
  return (
    <div style={getPositionStyles(position)}>
      <AnimatePresence mode="popLayout">
        {orderedToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} position={position} />
        ))}
      </AnimatePresence>
    </div>
  )
}

