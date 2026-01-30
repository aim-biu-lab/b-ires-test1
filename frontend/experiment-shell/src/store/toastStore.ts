import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'confirmation'
export type ToastPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'bottom-center' | 'top-center'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number // ms, 0 = no auto-dismiss
  showProgress?: boolean
  onConfirm?: () => void
  onCancel?: () => void
  confirmLabel?: string
  cancelLabel?: string
}

interface ToastState {
  toasts: Toast[]
  position: ToastPosition
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
  clearAll: () => void
  setPosition: (position: ToastPosition) => void
}

const DEFAULT_DURATION = 4000

const generateId = () => `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  position: 'top-right',

  addToast: (toast) => {
    const id = generateId()
    const newToast: Toast = {
      id,
      duration: toast.type === 'confirmation' ? 0 : DEFAULT_DURATION,
      showProgress: toast.type !== 'confirmation',
      ...toast,
    }

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }))

    // Auto-dismiss if duration is set
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id)
      }, newToast.duration)
    }

    return id
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },

  clearAll: () => {
    set({ toasts: [] })
  },

  setPosition: (position) => {
    set({ position })
  },
}))

// Helper functions for common toast types
export const toast = {
  success: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'success', message, ...options }),

  error: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'error', message, duration: 5000, ...options }),

  warning: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'warning', message, ...options }),

  info: (message: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'message'>>) =>
    useToastStore.getState().addToast({ type: 'info', message, ...options }),

  confirm: (
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    options?: Partial<Omit<Toast, 'id' | 'type' | 'message' | 'onConfirm' | 'onCancel'>>
  ) =>
    useToastStore.getState().addToast({
      type: 'confirmation',
      message,
      onConfirm,
      onCancel,
      confirmLabel: options?.confirmLabel || 'Confirm',
      cancelLabel: options?.cancelLabel || 'Cancel',
      ...options,
    }),
}



