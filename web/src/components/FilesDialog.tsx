import { useEffect, useMemo, useState } from 'react'

import { CodeBlock } from '@/components/CodeBlock'
import { ddaApi } from '@/api/dda'

// Pipeline stage labels for file grouping
const STAGE_LABEL: Record<string, string> = {
    'disease-overview': '0 · 研究角度拆解',
    'target-hypothesis': '1 · 靶点假设',
    'literature-evidence': '2 · 文献证据',
    'target-selection': '3 · 靶点选定',
    'target-validation': '4 · 靶点验证',
    'deep-research': '深度检索',
}

// deepresearch/{step}/ folder labels (the per-sub-agent source-of-truth record)
const STEP_LABEL: Record<string, string> = {
    '01_scope': '① scope · 拆角度',
    '02_search': '② search · 检索',
    '03_fetch': '③ fetch · 抓取',
    '04_verify': '④ verify · 核查',
    '05_synthesize': '⑤ synthesize · 合成',
}

// Group sort rank: deepresearch steps first (source of truth), then derived assets, then event
// streams, then the report/status root files, then anything else.
function groupRank(stage: string): number {
    if (stage.startsWith('dr/')) return 0
    if (stage === 'assets') return 1
    if (stage.startsWith('ev/')) return 2
    if (stage === 'deep-research') return 3
    return 4
}

// Map a file path to its display group + label. deepresearch/ and assets/ each group by folder
// (not one group per file); events/report keep their existing grouping.
function fileStage(p: string): { stage: string; label: string } {
    const base = p.replace(/\\/g, '/')
    // deepresearch/{step}/… → one group per workflow step
    const drMatch = base.match(/^deepresearch\/([^/]+)\//)
    if (drMatch) {
        const step = drMatch[1]
        return { stage: 'dr/' + step, label: 'deepresearch · ' + (STEP_LABEL[step] || step) }
    }
    // assets/… → the derived compute-facing contract
    if (base.startsWith('assets/')) return { stage: 'assets', label: 'assets · 派生契约' }
    // events/{stage}.jsonl
    const evMatch = base.match(/^events\/(.+)\.jsonl$/)
    if (evMatch) {
        const s = evMatch[1]
        return { stage: 'ev/' + s, label: '事件流 · ' + (STAGE_LABEL[s] || s) }
    }
    // search_status.json / report.json → deep-research stage
    if (base === 'search_status.json' || base === 'report.json') {
        return { stage: 'deep-research', label: STAGE_LABEL['deep-research'] }
    }
    // stage-specific JSON files (e.g. disease-overview.json)
    const jsonMatch = base.match(/^(.+)\.json$/)
    if (jsonMatch && STAGE_LABEL[jsonMatch[1]]) {
        return { stage: jsonMatch[1], label: STAGE_LABEL[jsonMatch[1]] }
    }
    return { stage: '', label: '其他' }
}

// dda Files page (full-screen, HAPI Files-view analog): browse a run's on-disk
// artifact + event files; click to view content.
const BackChevron = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
)
const RefreshIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
)
const SearchIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
)
const FileIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
)
const CIRCLE_BTN = 'flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'

export function FilesPage(props: { campaign: string | null; disease: string | null; onClose: () => void }) {
    const [files, setFiles] = useState<{ path: string; size: number }[]>([])
    const [root, setRoot] = useState('')
    const [search, setSearch] = useState('')
    const [sel, setSel] = useState<string | null>(null)
    const [content, setContent] = useState('')

    const load = (c: string) => ddaApi.files(c).then((r) => { setFiles(r.files); setRoot(r.root) }).catch(() => setFiles([]))
    useEffect(() => {
        if (!props.campaign) return
        setSel(null); setContent(''); setSearch('')
        load(props.campaign)
    }, [props.campaign])

    // memoize so `grouped`'s [filtered] dep is stable across renders (a fresh array each render
    // would defeat its useMemo entirely); recompute only when files or the search term change.
    const filtered = useMemo(
        () => files.filter((f) => !search || f.path.toLowerCase().includes(search.toLowerCase())),
        [files, search],
    )

    // Group files by stage for structured display
    const grouped = useMemo(() => {
        const map = new Map<string, { label: string; items: { path: string; size: number; fileName: string }[] }>()
        for (const f of filtered) {
            const { stage, label } = fileStage(f.path)
            if (!map.has(stage)) map.set(stage, { label, items: [] })
            const fileName = f.path.split('/').pop() || f.path.split('\\').pop() || f.path
            map.get(stage)!.items.push({ ...f, fileName })
        }
        // order groups: deepresearch steps (01→05) → assets → events → report/status → other
        return [...map.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[0].localeCompare(b[0]))
    }, [filtered])

    if (!props.campaign) return null
    const campaign = props.campaign
    const openFile = (p: string) => {
        setSel(p)
        ddaApi.fileRaw(campaign, p).then((r) => setContent(r.content)).catch(() => setContent('(读取失败)'))
    }

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes}B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    }

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-[var(--app-bg)]" style={{ color: 'var(--app-fg)' }}>
            <header className="flex items-center gap-2 border-b border-[var(--app-border)] px-4 py-3">
                <button onClick={props.onClose} className={CIRCLE_BTN} title="返回"><BackChevron /></button>
                <div className="min-w-0">
                    <div className="text-lg font-semibold leading-tight">文件</div>
                    <div className="truncate text-xs text-[var(--app-hint)]">{props.disease || campaign}</div>
                </div>
                <button onClick={() => load(campaign)} className={CIRCLE_BTN + ' ml-auto'} title="刷新"><RefreshIcon /></button>
            </header>

            <div className="border-b border-[var(--app-border)] px-4 py-2.5">
                <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-md bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-hint)]">
                    <SearchIcon />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索文件…" className="w-full bg-transparent text-sm text-[var(--app-fg)] outline-none placeholder:text-[var(--app-hint)]" />
                </div>
            </div>

            <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
                {/* list pane: full-width on mobile; hidden < lg once a file is open (content takes over) */}
                <div className={(sel ? 'hidden lg:block' : 'block') + ' w-full shrink-0 overflow-y-auto border-r border-[var(--app-border)] lg:w-80'}>
                    {filtered.length === 0 && <div className="px-4 py-3 text-sm text-[var(--app-hint)]">无文件</div>}
                    {grouped.map(([stage, group]) => (
                        <div key={stage} className="border-b border-[var(--app-border)] last:border-b-0">
                            <div className="sticky top-0 z-10 bg-[var(--app-secondary-bg)] px-4 py-2 text-xs font-medium text-[var(--app-hint)]">
                                {group.label}
                            </div>
                            {group.items.map((f) => (
                                <button
                                    key={f.path}
                                    onClick={() => openFile(f.path)}
                                    className={'flex w-full items-center gap-2 px-4 py-2 text-left transition-colors ' + (sel === f.path ? 'bg-[var(--app-subtle-bg)]' : 'hover:bg-[var(--app-subtle-bg)]')}
                                >
                                    <FileIcon />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm">{f.fileName}</div>
                                        <div className="text-[11px] text-[var(--app-hint)]">{formatSize(f.size)}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
                {/* content pane: hidden < lg until a file is picked, then full-screen with a back button */}
                <div className={(sel ? 'flex' : 'hidden lg:flex') + ' min-w-0 flex-1 flex-col overflow-y-auto p-4'}>
                    {sel ? (
                        <>
                            <button
                                type="button"
                                onClick={() => setSel(null)}
                                className="mb-2 flex items-center gap-1 self-start text-sm text-[var(--app-hint)] hover:text-[var(--app-fg)] lg:hidden"
                            >
                                ‹ 返回文件列表
                            </button>
                            <div className="mb-2 truncate font-mono text-xs text-[var(--app-hint)]">{sel}</div>
                            <CodeBlock code={content || '…'} language={sel.endsWith('.json') ? 'json' : 'text'} maxHeight={100000} scrollY />
                        </>
                    ) : (
                        <div className="px-2 py-3 text-sm text-[var(--app-hint)]">选择左侧文件查看内容。</div>
                    )}
                </div>
            </div>
        </div>
    )
}
