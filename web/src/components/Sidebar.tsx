import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Settings } from '@/components/Settings'
import { RenameDialog } from '@/components/RenameDialog'
import { runDisplayName } from '@/lib/runLabel'
import { useResizable } from '@/hooks/useResizable'
import { ddaApi } from '@/api/dda'
import type { CampaignSummary } from '@/types/dda'

const runLabel = runDisplayName

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

// HAPI's ChevronIcon: a › that rotates 90° to ⌄ when expanded
const ChevronIcon = (props: { collapsed: boolean }) => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
    >
        <polyline points="9 18 15 12 9 6" />
    </svg>
)
const GearIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
)
const PlusIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
)
const SearchIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
)
const PencilIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
)
const TrashIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
)

function NewRunDialog(props: {
    open: boolean
    onOpenChange: (v: boolean) => void
    initialDisease: string
    onStart: (disease: string, focus?: string) => void
}) {
    const [disease, setDisease] = useState(props.initialDisease)
    const [focus, setFocus] = useState('')
    const [seen, setSeen] = useState(props.initialDisease)
    const [checking, setChecking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    if (props.open && seen !== props.initialDisease) {
        setSeen(props.initialDisease)
        setDisease(props.initialDisease)
        setFocus('')
        setError(null)
    }
    // Validate the disease at submit time (intake gate): reject junk/non-disease input
    // here, BEFORE creating a run — instead of letting it enter the pipeline and exhaust.
    const submit = async () => {
        const d = disease.trim()
        if (!d || checking) return
        setChecking(true)
        setError(null)
        try {
            const res = await ddaApi.intakeCheck(d)
            if (!res.accepted) {
                setError(res.reason || '该输入不是可识别的疾病/适应症,请换一个真实疾病名。')
                return
            }
            // create the run under the canonical (OpenTargets-aligned) disease name, not the raw
            // user input — so "t2d" / "阿尔兹海默" display as "type 2 diabetes mellitus" etc.
            props.onStart(res.normalized_en?.trim() || d, focus.trim() || undefined)
            props.onOpenChange(false)
        } catch {
            setError('疾病名校验失败,请稍后重试。')
        } finally {
            setChecking(false)
        }
    }
    return (
        <Dialog open={props.open} onOpenChange={(v) => !checking && props.onOpenChange(v)}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>新建项目</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                        <input
                            autoFocus
                            value={disease}
                            onChange={(e) => {
                                setDisease(e.target.value)
                                if (error) setError(null)
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && submit()}
                            placeholder="输入疾病名"
                            disabled={checking}
                            className="rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)] disabled:opacity-60"
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs text-[var(--app-hint)]">你关心的问题 / 靶点发现方向(可选)</span>
                        <textarea
                            value={focus}
                            onChange={(e) => setFocus(e.target.value)}
                            placeholder="例:与肝纤维化消退相关的可成药靶点;或直接给一个候选靶点(如 PNPLA3)。留空则做疾病综述。"
                            disabled={checking}
                            rows={3}
                            className="resize-none rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)] disabled:opacity-60"
                        />
                    </label>
                    {error && (
                        <p className="text-sm text-[var(--app-badge-error-text,#dc2626)]">{error}</p>
                    )}
                    <div className="flex items-center justify-end gap-2">
                        {checking && <span className="text-xs text-[var(--app-hint)]">正在校验疾病名…</span>}
                        <Button variant="outline" size="sm" onClick={() => props.onOpenChange(false)} disabled={checking}>取消</Button>
                        <Button size="sm" onClick={submit} disabled={checking}>{checking ? '校验中…' : '确认'}</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

type Menu = { campaign: string; current: string; x: number; y: number }

export function Sidebar(props: {
    campaigns: CampaignSummary[] | null
    apiDown: boolean
    selected: string | null
    onSelect: (campaign: string) => void
    onStartRun: (disease: string, focus?: string) => void
    onMutate: (deleted?: string) => void
}) {
    // hapi useSidebarResize params (280/420/600) — faithful replication of upstream
    const { width, onPointerDown: onResize } = useResizable({ key: 'dd-left-w', def: 420, min: 280, max: 600, side: 'left' })
    const [search, setSearch] = useState('')
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [dialogDisease, setDialogDisease] = useState('')
    const [menu, setMenu] = useState<Menu | null>(null)
    const [renameTarget, setRenameTarget] = useState<{ campaign: string; current: string } | null>(null)

    useEffect(() => {
        if (!menu) return
        const close = () => setMenu(null)
        window.addEventListener('scroll', close, true)
        return () => window.removeEventListener('scroll', close, true)
    }, [menu])

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase()
        const filtered = (props.campaigns ?? []).filter(
            (c) => !q || (c.disease ?? '').toLowerCase().includes(q) || runLabel(c).toLowerCase().includes(q)
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
            if (n.has(d)) n.delete(d)
            else n.add(d)
            return n
        })
    const onDelete = async (campaign: string) => {
        if (!window.confirm(`删除运行「${campaign}」?该操作不可恢复(含其阶段状态与执行事件)。`)) return
        await ddaApi.remove(campaign)
        props.onMutate(campaign)
    }

    return (
        <aside
            // hapi mobile mechanism: the list pane is full-width + shown when no run is selected,
            // and hidden below lg once a run is open (the detail pane takes over). Desktop: resizable
            // column (width via CSS var so the `w-full` mobile rule and `lg:` desktop rule compose).
            style={{ ['--dd-sb-w']: `${width}px` } as Record<string, string>}
            className={`${props.selected ? 'hidden lg:flex' : 'flex'} relative w-full shrink-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-bg)] lg:w-[var(--dd-sb-w)]`}
        >
            <div onPointerDown={onResize} className="sidebar-resize-handle absolute inset-y-0 -right-0.5 z-20 hidden w-1.5 cursor-col-resize hover:bg-[var(--app-link-muted,rgba(0,0,0,0.12))] lg:block" />
            <div className="flex items-center justify-between px-3 py-2.5">
                <div className="text-sm">
                    <span className="font-semibold">TargetS</span>
                    <span className="ml-1 text-xs text-[var(--app-hint)]">{groups.length} 疾病 · {total} 项目</span>
                </div>
                <div className="flex items-center gap-1 text-[var(--app-hint)]">
                    <button onClick={() => setSettingsOpen(true)} title="设置" className="rounded p-1 hover:bg-[var(--app-subtle-bg)]"><GearIcon /></button>
                    <button onClick={() => openNew('')} title="新建项目" className="rounded p-1 hover:bg-[var(--app-subtle-bg)]"><PlusIcon /></button>
                </div>
            </div>

            <div className="px-3 pb-2">
                <div className="flex items-center gap-1.5 rounded-md border border-[var(--app-border)] px-2 py-1.5 text-[var(--app-hint)]">
                    <SearchIcon />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索疾病 / 运行…" className="w-full bg-transparent text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)]" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-3">
                {props.apiDown && <div className="px-2 py-1 text-xs text-[var(--app-badge-error-text)]">API 未连接</div>}
                {props.campaigns && total === 0 && <div className="px-2 py-2 text-xs text-[var(--app-hint)]">尚无运行,点右上 ＋ 新建。</div>}
                {groups.map((g) => {
                    const isCollapsed = collapsed.has(g.disease)
                    return (
                        <div key={g.disease} className="mb-1">
                            <div className="group flex items-center gap-1 rounded px-1 py-1 text-sm hover:bg-[var(--app-subtle-bg)]">
                                <button onClick={() => toggle(g.disease)} className="flex flex-1 items-center gap-1 text-left text-[var(--app-hint)]">
                                    <ChevronIcon collapsed={isCollapsed} />
                                    <span className="truncate font-medium text-[var(--app-fg)]">{g.disease}</span>
                                    <span className="text-xs">({g.runs.length})</span>
                                </button>
                                <button onClick={() => openNew(g.disease === '未分类' ? '' : g.disease)} title="为该疾病新建运行" className="rounded p-0.5 text-[var(--app-hint)] opacity-0 hover:bg-[var(--app-subtle-bg)] group-hover:opacity-100"><PlusIcon /></button>
                            </div>
                            {!isCollapsed &&
                                g.runs.map((c) => {
                                    const active = c.campaign === props.selected
                                    return (
                                        <button
                                            key={c.campaign}
                                            onClick={() => props.onSelect(c.campaign)}
                                            onContextMenu={(e) => {
                                                e.preventDefault()
                                                setMenu({ campaign: c.campaign, current: runLabel(c), x: e.clientX, y: e.clientY })
                                            }}
                                            className={'flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-left text-sm transition-colors ' + (active ? 'bg-[var(--app-subtle-bg)]' : 'hover:bg-[var(--app-subtle-bg)]')}
                                        >
                                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot(c) }} />
                                            <span className="flex-1 truncate">{runLabel(c)}</span>
                                            <span className="shrink-0 text-xs text-[var(--app-hint)]">{relTime(c.updated_at)}</span>
                                        </button>
                                    )
                                })}
                        </div>
                    )
                })}
            </div>

            {/* right-click context menu (HAPI SessionActionMenu pattern) */}
            {menu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
                    <div className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg" style={{ top: menu.y, left: menu.x }}>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">更多操作</div>
                        <button onClick={() => { setRenameTarget({ campaign: menu.campaign, current: menu.current }); setMenu(null) }} className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--app-subtle-bg)]"><PencilIcon /> 重命名</button>
                        <button onClick={() => { const c = menu.campaign; setMenu(null); onDelete(c) }} className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-500/10"><TrashIcon /> 删除</button>
                    </div>
                </>
            )}

            <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />
            <NewRunDialog open={dialogOpen} onOpenChange={setDialogOpen} initialDisease={dialogDisease} onStart={props.onStartRun} />
            <RenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} onDone={() => props.onMutate()} />
        </aside>
    )
}
