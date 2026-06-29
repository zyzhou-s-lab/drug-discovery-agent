import { useRef, useState } from 'react'

import { ddaApi } from '@/api/dda'
import { useConfig } from '@/hooks/useDda'
import { RenameDialog } from '@/components/RenameDialog'
import { runDisplayName } from '@/lib/runLabel'
import type { CampaignSummary } from '@/types/dda'

// dda session header — full replica of HAPI's SessionHeader:
// circular back button + two-line title/subtitle (agent + model) + kebab menu.
const BackChevron = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
    </svg>
)
const MoreVertical = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
    </svg>
)
const FilesIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
    </svg>
)
const ChatIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </svg>
)

const MenuIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
)

const CIRCLE_BTN =
    'flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]'

export function SessionHeader(props: {
    run: CampaignSummary
    onBack: () => void
    onMutate: (deleted?: string) => void
    onOpenFiles: () => void
    onToggleChat: () => void
    onOpenNav?: () => void // mobile: open the run-list drawer (hidden on desktop)
}) {
    const { config } = useConfig()
    const { run } = props
    const title = runDisplayName(run)
    const kebabRef = useRef<HTMLButtonElement>(null)
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
    const [renameTarget, setRenameTarget] = useState<{ campaign: string; current: string } | null>(null)

    const openMenu = () => {
        const r = kebabRef.current?.getBoundingClientRect()
        if (r) setMenu({ x: r.right - 180, y: r.bottom + 4 })
    }
    const onDelete = async () => {
        if (!window.confirm(`删除运行「${title}」?该操作不可恢复(含其阶段状态与执行事件)。`)) return
        await ddaApi.remove(run.campaign)
        props.onMutate(run.campaign)
    }

    return (
        <header className="sticky top-0 z-10 border-b border-[var(--app-border)] bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
            <div className="mx-auto flex max-w-content items-center gap-2 px-4 py-3 sm:px-6">
                {props.onOpenNav && (
                    <button type="button" onClick={props.onOpenNav} className={CIRCLE_BTN + ' lg:hidden'} title="运行列表" aria-label="运行列表">
                        <MenuIcon />
                    </button>
                )}
                <button type="button" onClick={props.onBack} className={CIRCLE_BTN} title="返回">
                    <BackChevron />
                </button>

                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{title}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                        <span className="inline-flex items-center gap-1">
                            <span className="inline-flex h-4 items-center rounded bg-[#f59e0b] px-1 text-[9px] font-bold text-white">DD</span>
                            dd-agent
                        </span>
                        {run.disease && <span>{run.disease}</span>}
                        {config?.model && <span>model: {config.model}</span>}
                    </div>
                </div>

                <button type="button" onClick={props.onOpenFiles} className={CIRCLE_BTN} title="文件">
                    <FilesIcon />
                </button>
                <button type="button" onClick={props.onToggleChat} className={CIRCLE_BTN} title="对话">
                    <ChatIcon />
                </button>
                <button
                    ref={kebabRef}
                    type="button"
                    onClick={openMenu}
                    className={CIRCLE_BTN}
                    title="更多操作"
                    aria-haspopup="menu"
                    aria-expanded={menu != null}
                >
                    <MoreVertical />
                </button>
            </div>

            {menu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
                    <div className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg" style={{ top: menu.y, left: menu.x }}>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">更多操作</div>
                        <button onClick={() => { setRenameTarget({ campaign: run.campaign, current: title }); setMenu(null) }} className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-[var(--app-subtle-bg)]">重命名</button>
                        <button onClick={() => { setMenu(null); onDelete() }} className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-500/10">删除</button>
                    </div>
                </>
            )}

            <RenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} onDone={() => props.onMutate()} />
        </header>
    )
}
