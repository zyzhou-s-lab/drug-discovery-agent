import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ddaApi } from '@/api/dda'
import type { ScopeResult } from '@/types/dda'

// deep-research stage-0 Scope: decompose a disease into characterization angles for review
// (scope-checkpoint). Background characterization, NOT target nomination.
// See docs/deep-research-port-plan.md.
export function ScopeDialog(props: {
    open: boolean
    onOpenChange: (v: boolean) => void
    initialDisease?: string
}) {
    const [disease, setDisease] = useState(props.initialDisease ?? '')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<ScopeResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    const run = async () => {
        const d = disease.trim()
        if (!d || loading) return
        setLoading(true)
        setError(null)
        setResult(null)
        try {
            const r = await ddaApi.scope(d)
            if (!r.angles?.length) setError(r.error || '未能拆解出角度,请重试')
            else setResult(r)
        } catch {
            setError('拆解失败,请稍后重试')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={(v) => !loading && props.onOpenChange(v)}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>研究内容 (Scope)</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <p className="text-xs text-[var(--app-hint)]">
                        背景刻画疾病(非靶点提名)。LLM 提出角度供你审阅 / 补充,后续检索据此展开。
                    </p>
                    <div className="flex gap-2">
                        <input
                            autoFocus
                            value={disease}
                            onChange={(e) => setDisease(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && run()}
                            placeholder="例如 dry AMD"
                            disabled={loading}
                            className="flex-1 rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)] disabled:opacity-60"
                        />
                        <Button size="sm" onClick={run} disabled={loading}>{loading ? '拆解中…' : '拆解'}</Button>
                    </div>
                    {error && <p className="text-sm text-[var(--app-badge-error-text,#dc2626)]">{error}</p>}
                    {result && (
                        <div className="flex flex-col gap-2">
                            <ol className="flex flex-col gap-2">
                                {result.angles.map((a, i) => (
                                    <li key={i} className="rounded-lg border border-[var(--app-border)] p-2.5">
                                        <div className="text-sm font-medium">{i + 1}. {a.label}</div>
                                        <div className="mt-0.5 break-words font-mono text-xs text-[var(--app-hint)]">{a.query}</div>
                                        {a.rationale && <div className="mt-1 text-xs text-[var(--app-fg)]">{a.rationale}</div>}
                                    </li>
                                ))}
                            </ol>
                            {result.budget && (
                                <p className="text-[10px] text-[var(--app-hint)]">tokens: {result.budget.spent_tokens}</p>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
