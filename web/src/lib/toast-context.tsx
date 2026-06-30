// Toast notifications (hapi parity, lib/toast-context.tsx). dda variant: drops hapi's session-
// specific fields (sessionId/url); renders a bottom-centered stack of the lifted ui/Toast component.
// Auto-dismiss after TOAST_DURATION_MS; ToastProvider also renders the stack so a single mount in
// main.tsx is enough. useToast() exposes addToast/removeToast to any component under the provider.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Toast } from '@/components/ui/Toast'

export type ToastItem = { id: string; title: string; body: string }
export type ToastContextValue = {
    toasts: ToastItem[]
    addToast: (toast: Omit<ToastItem, 'id'>) => void
    removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const TOAST_DURATION_MS = 6000
let _seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([])
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

    useEffect(
        () => () => {
            for (const timer of timersRef.current.values()) clearTimeout(timer)
            timersRef.current.clear()
        },
        [],
    )

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToast = useCallback(
        (toast: Omit<ToastItem, 'id'>) => {
            const id = `t${++_seq}`
            setToasts((prev) => [...prev, { id, ...toast }])
            timersRef.current.set(
                id,
                setTimeout(() => removeToast(id), TOAST_DURATION_MS),
            )
        },
        [removeToast],
    )

    const value = useMemo<ToastContextValue>(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast])

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div
                className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
            >
                {toasts.map((t) => (
                    <Toast key={t.id} title={t.title} body={t.body} onClose={() => removeToast(t.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    )
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used within ToastProvider')
    return ctx
}
