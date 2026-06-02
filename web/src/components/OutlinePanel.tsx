import { useResizable } from '@/hooks/useResizable'
import type { CampaignStage } from '@/types/dda'

// Right-side outline (HAPI conversation-outline analog): a TOC of the run —
// stages, and under the selected stage its scatter sessions (jump on click).
// Symmetric with the left run-list sidebar.
const STAGE_LABEL: Record<string, string> = {
    'target-hypothesis': '1 · 靶点假设',
    'literature-evidence': '2 · 文献证据',
    'target-selection': '3 · 靶点选定',
    'target-validation': '4 · 靶点验证',
}
const ANGLE_LABEL: Record<string, string> = {
    genetic: '遗传',
    expression: '表达',
    network: '网络',
    literature: '文献',
    perturbation: '扰动',
    safety: '安全',
}

export function OutlinePanel(props: {
    stages: CampaignStage[]
    selected: string | null
    onSelectStage: (name: string) => void
    onScrollToSession: (label: string) => void
    onClose: () => void
}) {
    const { width, onPointerDown: onResize } = useResizable({ key: 'dd-right-w2', def: 400, min: 220, max: 520, side: 'right' })
    return (
        <aside style={{ width }} className="relative flex shrink-0 flex-col border-l border-[var(--app-border)]">
            <div onPointerDown={onResize} className="absolute inset-y-0 -left-0.5 z-20 w-1.5 cursor-col-resize hover:bg-[var(--app-link-muted,rgba(0,0,0,0.12))]" />
            <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-semibold">大纲</span>
                <button onClick={props.onClose} title="隐藏大纲" className="rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 text-sm">
                {props.stages.map((s) => {
                    const active = s.name === props.selected
                    return (
                        <div key={s.name} className="mb-0.5">
                            <button
                                onClick={() => props.onSelectStage(s.name)}
                                className={'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ' + (active ? 'bg-[var(--app-subtle-bg)] font-medium' : 'hover:bg-[var(--app-subtle-bg)]')}
                            >
                                {STAGE_LABEL[s.name] ?? s.name}
                            </button>
                            {active && s.scatter &&
                                s.angles.map((a) => (
                                    <button
                                        key={a}
                                        onClick={() => props.onScrollToSession(a)}
                                        className="flex w-full items-center gap-1.5 rounded-md py-1 pl-6 pr-2 text-left text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                    >
                                        会话 · {ANGLE_LABEL[a] ?? a}
                                    </button>
                                ))}
                        </div>
                    )
                })}
            </div>
        </aside>
    )
}
