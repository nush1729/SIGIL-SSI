'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastVariant = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  message: string
  variant: ToastVariant
}

type ToastContextValue = {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const baseToastClass =
  'pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm'

const variantClassMap: Record<ToastVariant, string> = {
  success: 'border-emerald-300/35 bg-emerald-500/20 text-emerald-100',
  error: 'border-rose-300/35 bg-rose-500/20 text-rose-100',
  info: 'border-violet-300/35 bg-violet-500/20 text-violet-100',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const pushToast = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)

    setToasts((prev) => [...prev, { id, message, variant }])

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4200)
  }, [])

  const value = useMemo<ToastContextValue>(() => ({
    success: (message) => pushToast(message, 'success'),
    error: (message) => pushToast(message, 'error'),
    info: (message) => pushToast(message, 'info'),
  }), [pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-70 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className={`${baseToastClass} ${variantClassMap[toast.variant]}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)

  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}
