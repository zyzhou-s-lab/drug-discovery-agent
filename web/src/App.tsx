import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/LoadingState'
import { StepCards, ToolMetrics } from '@/components/StepCards'
import { Sidebar } from '@/components/Sidebar'
import { SessionHeader } from '@/components/SessionHeader'
import { ChatPanel } from '@/components/ChatPanel'
import { Markdown } from '@/components/Markdown'
import { SelectionPopup } from '@/components/SelectionPopup'
import { FilesPage } from '@/components/FilesDialog'

import { ddaApi, doiRef } from '@/api/dda'
import { useTheme } from '@/lib/settings'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useToast } from '@/lib/toast-context'
import { useCampaigns, useCampaignView, useReport, useStageDetail, useStageEvents } from '@/hooks/useDda'
import type {
    CampaignStage,
    DeepFinding,
    DeepReport,
    Evidence,
    Reference,
    ReferencesResponse,
    ReportResponse,
    ScopeAngle,
    StageStatus,
    TargetCandidate,
} from '@/types/dda'
import {
    STATUS_VARIANT, STATUS_LABEL, STAGE_LABEL, STAGE_DESC, MODALITY_LABEL, KIND_LABEL, SCORE_LABEL,
    stageLabel, fmtDur, refNFor, confVariant,
    DB_BIO_TYPES, dbBioType, parseRawBlocks, stripHtml, DB_TOOL_BLOCKS, DB_SKIP_COLS, DB_PREFER_COLS,
    dbColumns, dbCell, pruneDbFacts, fmtRaw,
} from '@/lib/reportShared'
import { DeepReportView, CandidateCard, Bibliography } from '@/components/report/reportView'



function StageRail(props: {
    stages: CampaignStage[]
    selected: string | null
    onSelect: (name: string) => void
    extra?: { id: string; label: string; badge?: string }[]
}) {
    const cls = (active: boolean) =>
        'flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ' +
        (active
            ? 'border-[var(--app-button)] bg-[var(--app-subtle-bg)]'
            : 'border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)]')
    return (
        <div className="flex flex-wrap gap-2">
            {props.stages.map((s) => (
                <button key={s.name} onClick={() => props.onSelect(s.name)} className={cls(s.name === props.selected)}>
                    <span className="text-sm font-medium">{stageLabel(s.name)}</span>
                    <span className="flex items-center gap-1.5">
                        <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                        {s.scatter && <span className="text-[10px] text-[var(--app-hint)]">并行 ×{s.angles.length}</span>}
                    </span>
                </button>
            ))}
            {(props.extra || []).map((e) => (
                <button key={e.id} onClick={() => props.onSelect(e.id)} className={cls(e.id === props.selected)}>
                    <span className="text-sm font-medium">{e.label}</span>
                    {e.badge && <span className="text-[10px] text-[var(--app-hint)]">{e.badge}</span>}
                </button>
            ))}
        </div>
    )
}

// Scope angles (structured) + a control to add the user's own angle. Added angles are
// client-side for now; they will feed the Search phase (M2). (scope-checkpoint augment)
function ScopeAngles(props: {
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

function PhasesPanel(props: {
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
function DeepResearchPage(props: { campaign: string; report: ReportResponse | null }) {
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

function DeepResearchBody(props: { campaign: string; report: ReportResponse | null }) {
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

function StageDetail(props: {
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


export function App() {
    useTheme() // apply persisted theme on load
    const isMobile = useIsMobile() // for the full-screen chat overlay on phones
    const { addToast } = useToast()

    const { campaigns, error: cErr, refetch } = useCampaigns()
    // `campaign` is URL-driven (hapi parity): '/' = index (no run), '/c/$campaign' = detail. Selecting
    // a run navigates (push), so back/forward, refresh-persist and deep-links work. No auto-open on
    // index — the list page is the landing, matching hapi's /sessions index.
    const navigate = useNavigate()
    const params = useParams({ strict: false }) as { campaign?: string }
    const campaign = params.campaign ?? null
    const setCampaign = (c: string | null) => {
        void (c ? navigate({ to: '/c/$campaign', params: { campaign: c } }) : navigate({ to: '/' }))
    }
    // Prune a dangling selection: if the campaign in the URL no longer exists after a refetch
    // (e.g. a delete), navigate back to the index so stale detail UI can't linger.
    useEffect(() => {
        if (campaign && campaigns && !campaigns.some((c) => c.campaign === campaign)) {
            setSelected(null)
            setCampaign(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaigns, campaign])

    const { view, error: vErr } = useCampaignView(campaign)
    const { report, refresh: refreshReport } = useReport(campaign)
    const searchState = report?.status.state ?? 'none'
    const [selected, setSelected] = useState<string | null>(null)
    const SEARCH_TAB = '__search__'   // 深度研究 (live progress)
    const REPORT_TAB = '__report__'   // 检索简报 (narrative + db data + claims)
    // when the report first lands, jump to the report tab — once per run
    const autoReportRun = useRef<number | undefined>(undefined)
    useEffect(() => {
        const run = report?.status.run
        if (report?.report && run != null && autoReportRun.current !== run && selected === SEARCH_TAB) {
            autoReportRun.current = run
            setSelected(REPORT_TAB)
        }
    }, [report?.report, report?.status.run, selected])
    const onStartSearch = (angles: ScopeAngle[]) => {
        if (!campaign) return
        ddaApi
            .startSearch(campaign, angles)
            .then(() => {
                setSelected(SEARCH_TAB)
                refreshReport()
            })
            .catch(() => {})
    }
    const onJumpToAngle = (angle: string) => {
        setSelected(SEARCH_TAB)
        window.setTimeout(() => {
            const key = angle.slice(0, 28)
            const el =
                document.getElementById(`dd-session-search · ${key}`) ??
                (Array.from(document.querySelectorAll('[id^="dd-session-"]')).find((e) => e.id.includes(angle.slice(0, 18))) as
                    | HTMLElement
                    | undefined) ??
                null
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 120)
    }
    const [chatOpen, setChatOpen] = useState(true)
    const [filesOpen, setFilesOpen] = useState<string | null>(null)
    const [pendingRefs, setPendingRefs] = useState<string[]>([])
    const addRef = (text: string) => {
        setPendingRefs((p) => [...p, text])
        setChatOpen(true)
    }
    useEffect(() => {
        if (!view) return
        const done = view.stages.filter((s) => s.status === 'done')
        const pick = done.length ? done[done.length - 1].name : view.stages[0]?.name ?? null
        setSelected((cur) => cur ?? pick)
    }, [view])

    const apiDown = Boolean(cErr || vErr)

    const selectedRun = campaign
        ? campaigns?.find((c) => c.campaign === campaign) ?? {
              campaign,
              disease: null,
              title: null,
              stages: 0,
              done: 0,
              exhausted: 0,
              updated_at: null,
          }
        : null

    const handleMutate = (deleted?: string) => {
        if (deleted && deleted === campaign) {
            setSelected(null)
            setCampaign(null)
        }
        refetch()
    }

    // real is always true now (the "实时" toggle was removed); the disease has already
    // passed the intake pre-check in the dialog, so skip_intake avoids a redundant gate.
    const startRun = (disease: string) => {
        const slug = disease.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run'
        const id = `${slug}-${Date.now().toString(36)}`
        ddaApi
            .startRun({ disease, campaign: id, real: true, skip_intake: true })
            .then(() => {
                setSelected(null)
                setCampaign(id)
                refetch()
                addToast({ title: '已新建运行', body: disease })
            })
            .catch(() => addToast({ title: '新建运行失败', body: '请稍后重试' }))
    }

    return (
        <div className="flex h-dvh w-full overflow-hidden" style={{ background: 'var(--app-bg)', color: 'var(--app-fg)' }}>
            {/* List pane (hapi mechanism): full-width on mobile when no run; hidden < lg once a run
                is open. Self-managed inside Sidebar via its `selected` prop. */}
            <Sidebar
                campaigns={campaigns}
                apiDown={apiDown}
                selected={campaign}
                onSelect={(c) => {
                    setSelected(null)
                    setCampaign(c)
                }}
                onStartRun={startRun}
                onMutate={handleMutate}
            />

            {/* Detail pane: hidden < lg when no run (the list shows), shown once a run is open. */}
            <main className={`${campaign ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col overflow-y-auto`}>
                {selectedRun && (
                    <SessionHeader
                        run={selectedRun}
                        onBack={() => {
                            setSelected(null)
                            setCampaign(null)
                        }}
                        onMutate={handleMutate}
                        onOpenFiles={() => setFilesOpen(campaign)}
                        onToggleChat={() => setChatOpen((v) => !v)}
                    />
                )}

                <div id="dd-main" className="mx-auto flex w-full max-w-content flex-col gap-5 p-4 lg:p-6">
                    {!campaign && (
                        <Card className="p-6 text-sm text-[var(--app-hint)]">
                            从左侧选择一个运行,或点右上 ＋ 新建一个疾病项目并运行。
                        </Card>
                    )}

                    {view && (
                        <StageRail
                            stages={view.stages}
                            selected={selected}
                            onSelect={setSelected}
                            extra={[
                                // 深度研究 = live progress tab
                                ...(searchState !== 'none'
                                    ? [{
                                          id: SEARCH_TAB,
                                          label: '深度研究',
                                          badge:
                                              searchState === 'running' ? '进行中'
                                              : searchState === 'stopping' ? '停止中'
                                              : searchState === 'stopped' ? '已停止'
                                              : searchState === 'done' ? '完成'
                                              : searchState === 'paused' ? '已暂停'
                                              : '失败',
                                      }]
                                    : []),
                                // 检索简报 = narrative + db data + claims
                                ...(report?.report ? [{ id: REPORT_TAB, label: '检索简报' }] : []),
                            ]}
                        />
                    )}

                    {campaign && selected === SEARCH_TAB && (
                        <DeepResearchPage campaign={campaign} report={report} />
                    )}
                    {campaign && selected === REPORT_TAB && report?.report && (
                        <DeepReportView report={report.report} onJumpToAngle={onJumpToAngle} />
                    )}
                    {campaign && selected && selected !== SEARCH_TAB && selected !== REPORT_TAB && (
                        <StageDetail
                            campaign={campaign}
                            stage={selected}
                            searchState={searchState}
                            onSearch={onStartSearch}
                        />
                    )}

                    {campaign && !report?.report && <Bibliography campaign={campaign} />}
                </div>
            </main>

            {chatOpen && campaign && (
                <div className={isMobile ? 'fixed inset-0 z-50 flex bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]' : 'contents'}>
                    <ChatPanel
                        mobile={isMobile}
                        key={`${campaign}-${report?.status.run ?? 'scope'}`}
                        campaign={campaign}
                        run={report?.status.run}
                        onClose={() => setChatOpen(false)}
                        attachments={pendingRefs}
                        onRemoveAttachment={(i) => setPendingRefs((p) => p.filter((_, j) => j !== i))}
                        onClearAttachments={() => setPendingRefs([])}
                    />
                </div>
            )}

            <SelectionPopup onAdd={addRef} />
            <FilesPage campaign={filesOpen} disease={campaigns?.find(c => c.campaign === filesOpen)?.disease ?? null} onClose={() => setFilesOpen(null)} />
        </div>
    )
}
