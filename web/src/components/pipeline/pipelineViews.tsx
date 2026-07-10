// Deep-research pipeline / stage views, extracted from App.tsx into named, prop-driven components
// (pencil.dev-friendly). StageRail / ScopeAngles / PhasesPanel / StageDetail / DeepResearchPage /
// DeepResearchBody. Behavior identical to the previous inline defs.
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/LoadingState'
import { StepCards, ToolMetrics } from '@/components/StepCards'
import { ddaApi } from '@/api/dda'
import { STATUS_VARIANT, STATUS_LABEL, STAGE_DESC, stageLabel } from '@/lib/reportShared'
import { CandidateCard } from '@/components/report/reportView'
import { useStageDetail, useStageEvents } from '@/hooks/useDda'
import type { CampaignStage, ReportResponse, ScopeAngle } from '@/types/dda'

// Map a live-progress status label (进行中 / 已暂停 / 完成 / 失败 …) to a Badge variant.
function extraBadgeVariant(label: string): 'default' | 'success' | 'warning' | 'destructive' {
    if (label === '完成') return 'success'
    if (label === '失败') return 'destructive'
    if (label.includes('中')) return 'warning' // 进行中 / 停止中
    return 'default' // 已暂停 / 已停止
}

export function StageRail(props: {
    stages: CampaignStage[]
    selected: string | null
    onSelect: (name: string) => void
    extra?: { id: string; label: string; badge?: string }[]
}) {
    // equal-sized buttons (fixed h/w); status badge sits inline to the right of the label
    const cls = (active: boolean) =>
        'flex h-11 w-40 items-center justify-between gap-2 rounded-lg border px-3 text-left transition-colors ' +
        (active
            ? 'border-[var(--app-button)] bg-[var(--app-subtle-bg)]'
            : 'border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)]')
    return (
        <div className="flex flex-wrap gap-2">
            {props.stages.map((s) => (
                <button key={s.name} onClick={() => props.onSelect(s.name)} className={cls(s.name === props.selected)}>
                    <span className="truncate text-sm font-medium">{stageLabel(s.name)}</span>
                    <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                </button>
            ))}
            {(props.extra || []).map((e) => (
                <button key={e.id} onClick={() => props.onSelect(e.id)} className={cls(e.id === props.selected)}>
                    <span className="truncate text-sm font-medium">{e.label}</span>
                    {e.badge && <Badge variant={extraBadgeVariant(e.badge)}>{e.badge}</Badge>}
                </button>
            ))}
        </div>
    )
}

// Scope angles (structured) + a control to add the user's own angle. Added angles are
// client-side for now; they will feed the Search phase (M2). (scope-checkpoint augment)
export function ScopeAngles(props: {
    serverAngles: ScopeAngle[]
    spentTokens?: number
    onSearch?: (angles: ScopeAngle[]) => void
    searchState?: 'none' | 'running' | 'stopping' | 'stopped' | 'done' | 'paused' | 'error'
}) {
    const [extra, setExtra] = useState<string[]>([])
    const [draft, setDraft] = useState('')
    const add = () => {
        const t = draft.trim()
        if (!t) return
        setExtra((x) => [...x, t])
        setDraft('')
    }
    const total = props.serverAngles.length + extra.length
    const running = props.searchState === 'running'
    const startSearch = () => {
        const merged: ScopeAngle[] = [
            ...props.serverAngles,
            ...extra.map((label) => ({ label, query: label })),
        ]
        props.onSearch?.(merged)
    }
    return (
        <Card className="p-4">
            <div className="mb-2 text-sm font-medium">
                研究方向 ({total})
                {props.spentTokens != null && (
                    <span className="ml-2 text-[10px] font-normal text-[var(--app-hint)]">tokens {props.spentTokens}</span>
                )}
            </div>
            <ol className="flex flex-col gap-2">
                {props.serverAngles.map((a, i) => (
                    <li key={`s${i}`} className="rounded-lg border border-[var(--app-border)] p-2.5">
                        <div className="text-sm font-medium">{i + 1}. {a.label}</div>
                        <div className="mt-0.5 break-words text-xs text-[var(--app-hint)]">{a.query}</div>
                        {a.rationale && <div className="mt-1 text-xs text-[var(--app-fg)]">{a.rationale}</div>}
                    </li>
                ))}
                {extra.map((label, i) => (
                    <li key={`u${i}`} className="rounded-lg border border-dashed border-[var(--app-border)] p-2.5">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <span>{props.serverAngles.length + i + 1}. {label}</span>
                            <span className="rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--app-hint)]">自定义</span>
                            <button
                                onClick={() => setExtra((x) => x.filter((_, j) => j !== i))}
                                className="ml-auto text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                            >删除</button>
                        </div>
                    </li>
                ))}
            </ol>
            <div className="mt-3 flex gap-2">
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && add()}
                    placeholder="添加一个自定义研究方向…"
                    className="flex-1 rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)]"
                />
                <Button size="sm" variant="outline" onClick={add}>添加方向</Button>
            </div>
            {props.onSearch && (
                <div className="mt-3 flex items-center gap-3 border-t border-[var(--app-border)] pt-3">
                    <Button size="sm" onClick={startSearch} disabled={running || total === 0}>
                        {running ? '检索中…' : props.searchState === 'done' ? '重新检索' : `开始检索（${total} 个方向）→`}
                    </Button>
                </div>
            )}
        </Card>
    )
}

export function PhasesPanel(props: {
    events: import('@/types/dda').StepEvent[]
    status: string
    terminal?: boolean
}) {
    const phases: [string, string][] = [
        ['search', '检索'], ['fetch', '抓取'], ['verify', '核验'], ['synthesize', '汇总'],
    ]
    const prog: Record<string, { done: number; total: number }> = {}
    for (const e of props.events) {
        if (e.type === 'progress') prog[e.label] = { done: e.done ?? 0, total: e.total ?? 0 }
    }
    const ts = props.events.map((e) => e.ts).filter(Boolean)
    // tick every second while live so the header timer advances between events (not only on new ones)
    const [nowTs, setNowTs] = useState(() => Date.now() / 1000)
    useEffect(() => {
        if (props.terminal) return
        const id = setInterval(() => setNowTs(Date.now() / 1000), 1000)
        return () => clearInterval(id)
    }, [props.terminal])
    const elapsed = ts.length ? (props.terminal ? Math.max(...ts) : nowTs) - Math.min(...ts) : 0
    const fmt = (s: number) => {
        const m = Math.floor(s / 60), sec = Math.floor(s % 60)
        return m ? `${m}m${sec}s` : `${sec}s`
    }
    const agents = phases.reduce((n, [k]) => n + (prog[k]?.total ?? 0), 0)
    const statusLabel =
        props.status === 'done' ? '完成'
        : props.status === 'stopped' ? '已停止'
        : props.status === 'stopping' ? '停止中'
        : props.status === 'paused' ? '已暂停'
        : props.status === 'error' ? '失败'
        : '进行中'
    // #2: auto-open the first phase (检索) so its agent cards show on arrival
    const [openPhase, setOpenPhase] = useState<string | null>('search')
    const phaseEventsOf = (k: string) =>
        props.events.filter((e) => e.label === k || e.label.startsWith(k + ' · '))
    const sessionsOf = (k: string) =>
        new Set(phaseEventsOf(k).filter((e) => e.type !== 'progress').map((e) => e.label)).size
    const selEvents = openPhase ? phaseEventsOf(openPhase) : []
    return (
        <>
            <Card className="border border-[var(--app-border)] bg-[var(--app-bg)] p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    深度研究
                    <span className="text-[10px] font-normal text-[var(--app-hint)]">
                        {agents} agents{ts.length ? ` · ${fmt(elapsed)}` : ''} · {statusLabel}
                    </span>
                </div>
                <div className="flex flex-col gap-1.5">
                    {phases.map(([k, label]) => {
                        const total = prog[k]?.total ?? 0
                        const d = prog[k]?.done ?? 0
                        const complete = total > 0 && d >= total
                        const pct = total > 0 ? Math.min(100, Math.round((d / total) * 100)) : 0
                        const sessions = sessionsOf(k)
                        const open = openPhase === k
                        // a phase row is a SELECTOR; the selected phase's agent cards render in the
                        // detail area below the panel (master-detail), not inline.
                        return (
                            <button
                                key={k}
                                onClick={() => setOpenPhase(open ? null : k)}
                                disabled={sessions === 0}
                                className={'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors disabled:cursor-default '
                                    + (open
                                        ? 'bg-[var(--app-subtle-bg)] ring-1 ring-inset ring-[var(--app-button)] font-medium shadow-sm'
                                        : 'hover:bg-[var(--app-subtle-bg)]/60')}
                            >
                                <span className="w-3 text-[var(--app-button)]">{complete ? '✓' : d > 0 ? '·' : ''}</span>
                                <span className="w-10 text-left font-medium">{label}</span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--app-subtle-bg)]">
                                    <div className="h-full bg-[var(--app-button)] transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="w-16 text-right font-mono text-[var(--app-hint)]">{d}/{total || '—'}</span>
                                <span className="w-14 shrink-0 whitespace-nowrap text-right text-[10px] text-[var(--app-hint)]">{sessions > 0 ? `${sessions} 会话` : ''}</span>
                            </button>
                        )
                    })}
                </div>
            </Card>
            {openPhase && sessionsOf(openPhase) > 0 && (
                <StepCards events={selEvents} terminal={props.terminal} />
            )}
        </>
    )
}



// Dedicated page for the deep-research run (reached via the 检索简报 tab after 开始检索):
// phase tree + per-agent session cards + the cited report.
export function DeepResearchPage(props: { campaign: string; report: ReportResponse | null }) {
    const { detail } = useStageDetail(props.campaign, 'disease-overview')
    const angles = detail?.output?.data?.angles ?? []
    const state = props.report?.status.state ?? 'none'
    const active = state === 'running' || state === 'stopping'
    const terminal = state === 'done' || state === 'stopped' || state === 'error'
    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-end gap-2">
                {active && (
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={state === 'stopping'}
                        onClick={() => ddaApi.stopSearch(props.campaign).catch(() => {})}
                    >
                        {state === 'stopping' ? '停止中…' : '停止研究'}
                    </Button>
                )}
                {terminal && angles.length > 0 && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => ddaApi.startSearch(props.campaign, angles).catch(() => {})}
                    >
                        重新研究
                    </Button>
                )}
            </div>
            {/* key on the run id: a (re)start resets the event view (no mixed old/new cards) */}
            <DeepResearchBody
                key={props.report?.status.run ?? 'none'}
                campaign={props.campaign}
                report={props.report}
            />
        </div>
    )
}

export function DeepResearchBody(props: { campaign: string; report: ReportResponse | null }) {
    const { events } = useStageEvents(props.campaign, 'deep-research')
    const state = props.report?.status.state ?? 'none'
    const terminal = state === 'done' || state === 'stopped' || state === 'error' || state === 'paused'
    return (
        <>
            <PhasesPanel events={events} status={state} terminal={terminal} />
            {events.some(e => e.type === 'tool_error' || e.type === 'agent_retry' || e.type === 'agent_error') && (
                <details>
                    <summary className="cursor-pointer text-xs text-[var(--app-hint)]">工具调用详情</summary>
                    <ToolMetrics events={events} />
                </details>
            )}
            {state === 'error' && (
                <Card className="p-4 text-sm text-[var(--app-badge-error-text,#dc2626)]">
                    检索失败:{props.report?.status.error}
                </Card>
            )}
            {state === 'paused' && (
                <Card className="p-4 text-sm text-[var(--app-git-unstaged-color,#FF9500)]">
                    已暂停(provider 限流/配额耗尽,可稍后「重新研究」续跑){props.report?.status.reason ? `:${props.report.status.reason}` : ''}
                </Card>
            )}
            {/* report now lives in the Claim tab, not inline under progress */}
            {events.length === 0 && state === 'running' && (
                <Card className="p-4 text-sm text-[var(--app-hint)]">研究启动中,各 agent 会话稍候出现…</Card>
            )}
        </>
    )
}

export function StageDetail(props: {
    campaign: string
    stage: string
    searchState?: 'none' | 'running' | 'stopping' | 'stopped' | 'done' | 'paused' | 'error'
    onSearch?: (angles: ScopeAngle[]) => void
}) {
    const { detail, loading } = useStageDetail(props.campaign, props.stage)
    const { events } = useStageEvents(props.campaign, props.stage)
    if (loading && !detail) return <LoadingState label={`正在加载 ${stageLabel(props.stage)}…`} />
    if (!detail) return null

    return (
        <div className="flex flex-col gap-4">
            {STAGE_DESC[props.stage] && (
                <Card className="p-4">
                    <div className="mb-1 text-sm font-medium">{stageLabel(props.stage)}</div>
                    <p className="text-sm leading-relaxed text-[var(--app-hint)]">{STAGE_DESC[props.stage]}</p>
                </Card>
            )}
            {detail.status === 'in_progress' && (
                <div className="flex items-center gap-2 text-sm text-[var(--app-hint)]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--app-git-unstaged-color,#FF9500)]" />
                    运行中 —— 实时步骤见下方
                </div>
            )}
            {detail.verdict && typeof detail.verdict.score === 'number' && (
                <Card className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                        <Badge variant={detail.verdict.converged ? 'success' : 'destructive'}>
                            {detail.verdict.converged ? '已通过' : '未通过'}
                        </Badge>
                        <span className="text-sm text-[var(--app-hint)]">
                            评审分 {detail.verdict.score.toFixed(2)} · {detail.attempts} 次尝试
                        </span>
                    </div>
                    {detail.verdict.reasons.length > 0 && (
                        <ul className="list-disc pl-5 text-sm">
                            {detail.verdict.reasons.map((r, i) => (
                                <li key={i}>{r}</li>
                            ))}
                        </ul>
                    )}
                    {detail.verdict.missing.length > 0 && (
                        <p className="mt-2 text-xs text-[var(--app-hint)]">缺失:{detail.verdict.missing.join(';')}</p>
                    )}
                </Card>
            )}

            {events.length > 0 && <StepCards events={events} />}

            {detail.output ? (
                <>
                    {/* summary hidden when structured angles are present (it just restates the task) */}
                    {!(detail.output.data?.angles?.length) && detail.output.summary && (
                        <p className="text-sm text-[var(--app-hint)]">{detail.output.summary}</p>
                    )}
                    {detail.output.data?.angles && detail.output.data.angles.length > 0 && (
                        <ScopeAngles
                            serverAngles={detail.output.data.angles}
                            spentTokens={detail.output.data.budget?.spent_tokens}
                            searchState={props.searchState}
                            onSearch={props.onSearch}
                        />
                    )}
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {(detail.output.candidates ?? []).map((c) => (
                            <CandidateCard key={c.symbol} c={c} />
                        ))}
                    </div>
                    {detail.output.open_questions && detail.output.open_questions.length > 0 && (
                        <Card className="p-4">
                            <p className="mb-1 text-sm font-medium">开放问题</p>
                            <ul className="list-disc pl-5 text-sm text-[var(--app-hint)]">
                                {detail.output.open_questions.map((q, i) => (
                                    <li key={i}>{q}</li>
                                ))}
                            </ul>
                        </Card>
                    )}
                </>
            ) : events.length === 0 ? (
                <Card className="p-4 text-sm text-[var(--app-hint)]">
                    {detail.status === 'in_progress'
                        ? '正在运行中,执行步骤会实时出现…'
                        : detail.status === 'exhausted'
                          ? '多次尝试后仍未通过评审(查看 uvicorn 日志排查)。'
                          : '暂无产出。靶点验证为 M4,尚未实现。'}
                    (状态:{STATUS_LABEL[detail.status]})
                </Card>
            ) : null}
        </div>
    )
}
