import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// Generic draggable panel width (adapted from HAPI useSidebarResize).
// side='left'  -> handle on the panel's RIGHT edge, drag right = wider (left sidebar)
// side='right' -> handle on the panel's LEFT edge, drag left = wider (right panel)
export function useResizable(opts: { key: string; def: number; min: number; max: number; side: 'left' | 'right' }) {
    const clamp = useCallback((v: number) => Math.min(opts.max, Math.max(opts.min, v)), [opts.max, opts.min])
    const [width, setWidth] = useState(() => {
        const s = localStorage.getItem(opts.key)
        const n = s != null ? Number(s) : NaN
        return Number.isFinite(n) ? clamp(n) : opts.def
    })
    const [dragging, setDragging] = useState(false)
    const startX = useRef(0)
    const startW = useRef(0)
    const pid = useRef<number | null>(null)

    const onPointerDown = useCallback(
        (e: ReactPointerEvent) => {
            e.preventDefault()
            pid.current = e.pointerId
            startX.current = e.clientX
            startW.current = width
            setDragging(true)
        },
        [width]
    )

    useEffect(() => {
        if (!dragging) return
        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pid.current) return
            const delta = e.clientX - startX.current
            setWidth(clamp(startW.current + (opts.side === 'left' ? delta : -delta)))
        }
        const onUp = (e: PointerEvent) => {
            if (e.pointerId !== pid.current) return
            pid.current = null
            setDragging(false)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
        return () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', onUp)
            document.removeEventListener('pointercancel', onUp)
        }
    }, [dragging, clamp, opts.side])

    useEffect(() => {
        if (!dragging) localStorage.setItem(opts.key, String(width))
    }, [dragging, width, opts.key])

    useEffect(() => {
        document.body.style.userSelect = dragging ? 'none' : ''
        document.body.style.cursor = dragging ? 'col-resize' : ''
        return () => {
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
    }, [dragging])

    return { width, onPointerDown, dragging }
}
