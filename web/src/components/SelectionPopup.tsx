import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// "Add to Chat ⌘L"-style popup: appears above a text selection made inside the
// main content area (#dd-main); clicking (or ⌘L) sends the selected text up.
export function SelectionPopup(props: { onAdd: (text: string) => void }) {
    const [pop, setPop] = useState<{ x: number; y: number; text: string } | null>(null)

    useEffect(() => {
        const compute = () => {
            const sel = window.getSelection()
            const text = sel?.toString().trim() ?? ''
            if (!text || !sel || sel.rangeCount === 0) {
                setPop(null)
                return
            }
            const container = document.getElementById('dd-main')
            if (container && sel.anchorNode && !container.contains(sel.anchorNode)) {
                setPop(null) // only for selections in the main content
                return
            }
            const rect = sel.getRangeAt(0).getBoundingClientRect()
            if (rect.width === 0 && rect.height === 0) {
                setPop(null)
                return
            }
            setPop({ x: rect.left + rect.width / 2, y: rect.top, text })
        }
        const onUp = () => window.setTimeout(compute, 0)
        const onSelChange = () => {
            if (!window.getSelection()?.toString().trim()) setPop(null)
        }
        document.addEventListener('mouseup', onUp)
        document.addEventListener('selectionchange', onSelChange)
        return () => {
            document.removeEventListener('mouseup', onUp)
            document.removeEventListener('selectionchange', onSelChange)
        }
    }, [])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
                const t = window.getSelection()?.toString().trim()
                if (t) {
                    e.preventDefault()
                    props.onAdd(t)
                    setPop(null)
                    window.getSelection()?.removeAllRanges()
                }
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [props.onAdd])

    if (!pop) return null
    return createPortal(
        <button
            onMouseDown={(e) => e.preventDefault()} // keep the selection alive until click fires
            onClick={() => {
                props.onAdd(pop.text)
                setPop(null)
                window.getSelection()?.removeAllRanges()
            }}
            style={{ position: 'fixed', left: pop.x, top: pop.y - 10, transform: 'translate(-50%, -100%)' }}
            className="z-[60] flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-1.5 text-sm shadow-lg transition-colors hover:bg-[var(--app-subtle-bg)]"
        >
            加入对话
            <kbd className="rounded border border-[var(--app-border)] px-1 text-[10px] text-[var(--app-hint)]">⌘L</kbd>
        </button>,
        document.body
    )
}
