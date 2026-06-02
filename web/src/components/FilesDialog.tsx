import { useEffect, useState } from 'react'

import { CodeBlock } from '@/components/CodeBlock'
import { ddaApi } from '@/api/dda'

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
const CIRCLE_BTN = 'flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'

export function FilesPage(props: { campaign: string | null; onClose: () => void }) {
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

    if (!props.campaign) return null
    const campaign = props.campaign
    const openFile = (p: string) => {
        setSel(p)
        ddaApi.fileRaw(campaign, p).then((r) => setContent(r.content)).catch(() => setContent('(读取失败)'))
    }
    const filtered = files.filter((f) => !search || f.path.toLowerCase().includes(search.toLowerCase()))

    return (
        <div className="fixed inset-0 z-40 flex flex-col bg-[var(--app-bg)]" style={{ color: 'var(--app-fg)' }}>
            <header className="flex items-center gap-2 border-b border-[var(--app-border)] px-4 py-3">
                <button onClick={props.onClose} className={CIRCLE_BTN} title="返回"><BackChevron /></button>
                <div className="min-w-0">
                    <div className="text-lg font-semibold leading-tight">文件</div>
                    <div className="truncate text-xs text-[var(--app-hint)]">{root}</div>
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
                <div className="w-80 shrink-0 overflow-y-auto border-r border-[var(--app-border)] p-2">
                    {filtered.length === 0 && <div className="px-2 py-3 text-sm text-[var(--app-hint)]">无文件</div>}
                    {filtered.map((f) => (
                        <button
                            key={f.path}
                            onClick={() => openFile(f.path)}
                            className={'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ' + (sel === f.path ? 'bg-[var(--app-subtle-bg)]' : 'hover:bg-[var(--app-subtle-bg)]')}
                        >
                            <span className="truncate font-mono text-xs">{f.path}</span>
                            <span className="shrink-0 text-xs text-[var(--app-hint)]">{f.size}B</span>
                        </button>
                    ))}
                </div>
                <div className="min-w-0 flex-1 overflow-y-auto p-4">
                    {sel ? (
                        <>
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
