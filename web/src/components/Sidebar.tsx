import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Settings } from '@/components/Settings'
import { useDefaultReal } from '@/lib/settings'
import type { CampaignSummary } from '@/types/dda'

function dot(c: CampaignSummary): string {
    if (c.exhausted > 0) return 'var(--app-git-deleted-color, #FF3B30)'
    if (c.done >= c.stages && c.stages > 0) return 'var(--app-git-staged-color, #34C759)'
    if (c.stages === 0) return 'var(--app-hint)'
    return 'var(--app-git-unstaged-color, #FF9500)'
}

function relTime(ts: number | null): string {
    if (!ts) return ''
    const s = Date.now() / 1000 - ts
    if (s < 60) return '刚刚'
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
    return `${Math.floor(s / 86400)} 天前`
}

const GearIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
)
const PlusIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12h14" />
    </svg>
)
const SearchIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
    </svg>
)

function NewRunDialog(props: {
    open: boolean
    onOpenChange: (v: boolean) => void
    initialDisease: string
    onStart: (disease: string, real: boolean) => void
}) {
    const [defaultReal] = useDefaultReal()
    const [disease, setDisease] = useState(props.initialDisease)
    const [real, setReal] = useState(defaultReal)
    // re-sync when reopened with a different prefill
    const [seen, setSeen] = useState(props.initialDisease)
    if (props.open && seen !== props.initialDisease) {
        setSeen(props.initialDisease)
        setDisease(props.initialDisease)
        setReal(defaultReal)
    }

    const submit = () => {
        const d = disease.trim()
        if (!d) return
        props.onStart(d, real)
        props.onOpenChange(false)
    }

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>新建项目 / 运行</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-[var(--app-hint)]">疾病(= 项目)</span>
                        <input
                            autoFocus
                            value={disease}
                            onChange={(e) => setDisease(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && submit()}
                            placeholder="例如 dry AMD"
                            className="rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)]"
                        />
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-[var(--app-hint)]">
                        <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} />
                        实时(调用 LLM + OpenTargets/EuropePMC,数分钟、有费用)
                    </label>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => props.onOpenChange(false)}>
                            取消
                        </Button>
                        <Button size="sm" onClick={submit}>
                            创建并运行
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function Sidebar(props: {
    campaigns: CampaignSummary[] | null
    apiDown: boolean
    selected: string | null
    onSelect: (campaign: string) => void
    onStartRun: (disease: string, real: boolean) => void
}) {
    const [search, setSearch] = useState('')
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [dialogDisease, setDialogDisease] = useState('')

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase()
        const filtered = (props.campaigns ?? []).filter(
            (c) => !q || (c.disease ?? '').toLowerCase().includes(q) || c.campaign.toLowerCase().includes(q)
        )
        const by = new Map<string, CampaignSummary[]>()
        for (const c of filtered) {
            const key = c.disease ?? '未分类'
            if (!by.has(key)) by.set(key, [])
            by.get(key)!.push(c)
        }
        return [...by.entries()]
            .map(([disease, runs]) => ({ disease, runs, last: Math.max(...runs.map((r) => r.updated_at ?? 0)) }))
            .sort((a, b) => b.last - a.last)
    }, [props.campaigns, search])

    const total = props.campaigns?.length ?? 0
    const openNew = (disease: string) => {
        setDialogDisease(disease)
        setDialogOpen(true)
    }
    const toggle = (d: string) =>
        setCollapsed((prev) => {
            const n = new Set(prev)
            n.has(d) ? n.delete(d) : n.add(d)
            return n
        })

    return (
        <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--app-border)]">
            {/* header */}
            <div className="flex items-center justify-between px-3 py-2.5">
                <div className="text-sm">
                    <span className="font-semibold">药物靶点发现</span>
                    <span className="ml-1 text-xs text-[var(--app-hint)]">
                        {total} 运行 · {groups.length} 疾病
                    </span>
                </div>
                <div className="flex items-center gap-1 text-[var(--app-hint)]">
                    <button onClick={() => setSettingsOpen(true)} title="设置" className="rounded p-1 hover:bg-[var(--app-subtle-bg)]">
                        <GearIcon />
                    </button>
                    <button onClick={() => openNew('')} title="新建项目" className="rounded p-1 hover:bg-[var(--app-subtle-bg)]">
                        <PlusIcon />
                    </button>
                </div>
            </div>

            {/* search */}
            <div className="px-3 pb-2">
                <div className="flex items-center gap-1.5 rounded-md border border-[var(--app-border)] px-2 py-1.5 text-[var(--app-hint)]">
                    <SearchIcon />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索疾病 / 运行…"
                        className="w-full bg-transparent text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)]"
                    />
                </div>
            </div>

            {/* groups */}
            <div className="flex-1 overflow-y-auto px-2 pb-3">
                {props.apiDown && <div className="px-2 py-1 text-xs text-[var(--app-badge-error-text)]">API 未连接</div>}
                {props.campaigns && total === 0 && (
                    <div className="px-2 py-2 text-xs text-[var(--app-hint)]">尚无运行,点右上 ＋ 新建。</div>
                )}
                {groups.map((g) => {
                    const isCollapsed = collapsed.has(g.disease)
                    return (
                        <div key={g.disease} className="mb-1">
                            <div className="group flex items-center gap-1 rounded px-1 py-1 text-sm hover:bg-[var(--app-subtle-bg)]">
                                <button onClick={() => toggle(g.disease)} className="flex flex-1 items-center gap-1 text-left">
                                    <span className="w-3 text-xs text-[var(--app-hint)]">{isCollapsed ? '▸' : '▾'}</span>
                                    <span className="truncate font-medium">{g.disease}</span>
                                    <span className="text-xs text-[var(--app-hint)]">({g.runs.length})</span>
                                </button>
                                <button
                                    onClick={() => openNew(g.disease === '未分类' ? '' : g.disease)}
                                    title="为该疾病新建运行"
                                    className="rounded p-0.5 text-[var(--app-hint)] opacity-0 hover:bg-[var(--app-subtle-bg)] group-hover:opacity-100"
                                >
                                    <PlusIcon />
                                </button>
                            </div>
                            {!isCollapsed &&
                                g.runs.map((c) => {
                                    const active = c.campaign === props.selected
                                    return (
                                        <button
                                            key={c.campaign}
                                            onClick={() => props.onSelect(c.campaign)}
                                            className={
                                                'flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-left text-sm transition-colors ' +
                                                (active ? 'bg-[var(--app-subtle-bg)]' : 'hover:bg-[var(--app-subtle-bg)]')
                                            }
                                        >
                                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot(c) }} />
                                            <span className="flex-1 truncate">{c.campaign}</span>
                                            <span className="shrink-0 text-xs text-[var(--app-hint)]">{relTime(c.updated_at)}</span>
                                        </button>
                                    )
                                })}
                        </div>
                    )
                })}
            </div>

            <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />
            <NewRunDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                initialDisease={dialogDisease}
                onStart={props.onStartRun}
            />
        </aside>
    )
}
