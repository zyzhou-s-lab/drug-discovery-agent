import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/LoadingState'
import { StepCards } from '@/components/StepCards'
import { Sidebar } from '@/components/Sidebar'
import { SessionHeader } from '@/components/SessionHeader'
import { ChatPanel } from '@/components/ChatPanel'
import { SelectionPopup } from '@/components/SelectionPopup'
import { FilesPage } from '@/components/FilesDialog'

import { ddaApi, doiRef } from '@/api/dda'
import { useTheme } from '@/lib/settings'
import { useCampaigns, useCampaignView, useReport, useStageDetail, useStageEvents } from '@/hooks/useDda'
import type {
    CampaignStage,
    DeepReport,
    Evidence,
    Reference,
    ReferencesResponse,
    ReportResponse,
    ScopeAngle,
    StageStatus,
    TargetCandidate,
} from '@/types/dda'

const STATUS_VARIANT: Record<StageStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
    queued: 'default',
    in_progress: 'warning',
    done: 'success',
    exhausted: 'destructive',
}

const STATUS_LABEL: Record<StageStatus, string> = {
    queued: '排队中',
    in_progress: '进行中',
    done: '完成',
    exhausted: '未通过',
}

const STAGE_LABEL: Record<string, string> = {
    'disease-overview': '0 · 研究角度拆解',
    'target-hypothesis': '1 · 靶点假设',
    'literature-evidence': '2 · 文献证据',
    'target-selection': '3 · 靶点选定',
    'target-validation': '4 · 靶点验证',
}

const STAGE_DESC: Record<string, string> = {
    'disease-overview':
        'Deep-research Scope 阶段:把目标疾病拆解为多个互补的研究角度,每个角度是一条可检索的目标(限定维度与方法,不预设具体基因 / 蛋白 / 药物),作为后续文献检索与靶点提名的起点。',
    'target-hypothesis':
        '多角度(遗传 / 表达 / 网络 / 文献)并行从 OpenTargets 提名候选靶点(scatter-gather),按跨角度证据强度合并去重并排序。',
    'literature-evidence':
        '对上游候选用 Europe PMC 检索真实文献(可追溯 PMID),为每个候选补充文献支撑,严禁编造引用。',
    'target-selection':
        '对候选做三联评估(可成药性 / 遗传约束 / 安全性)+ 文献,综合打分选出最值得推进的靶点,并给出淘汰理由。',
    'target-validation':
        '多角度(遗传 / 扰动 / 表达 / 网络 / 安全)验证选定靶点。属 M4(本地重型计算),目前尚未实现。',
}

const MODALITY_LABEL: Record<string, string> = {
    small_molecule: '小分子',
    peptide: '多肽',
    antibody: '抗体',
}

const KIND_LABEL: Record<string, string> = {
    genetic: '遗传',
    expression: '表达',
    network: '网络',
    literature: '文献',
    perturbation: '扰动',
    safety: '安全',
    pathway: '通路',
    animal_model: '动物模型',
}

const SCORE_LABEL: Record<string, string> = {
    association: '关联度',
    tractability: '可成药性',
    constraint: '遗传约束',
    safety: '安全性',
}

const stageLabel = (name: string) => STAGE_LABEL[name] ?? name

function ScoreBar(props: { label: string; value: number }) {
    const pct = Math.round(Math.max(0, Math.min(1, props.value)) * 100)
    return (
        <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-[var(--app-hint)]">{SCORE_LABEL[props.label] ?? props.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--app-subtle-bg)]">
                <div className="h-full rounded-full bg-[var(--app-button)]" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums">{props.value.toFixed(2)}</span>
        </div>
    )
}

function EvidenceChip(props: { ev: Evidence }) {
    const { ev } = props
    const doi = doiRef(ev.ref, ev.source)
    const kind = KIND_LABEL[ev.kind] ?? ev.kind
    const body = (
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-0.5 text-xs">
            <span className="font-medium">{kind}</span>
            <span className="text-[var(--app-hint)]">· {doi ? `doi:${doi}` : ev.source}</span>
        </span>
    )
    return doi ? (
        <a
            href={`https://doi.org/${doi}`}
            target="_blank"
            rel="noreferrer"
            title={ev.detail || ev.source}
            className="hover:opacity-80"
        >
            {body}
        </a>
    ) : (
        <span title={ev.detail || ev.source}>{body}</span>
    )
}

function CandidateCard(props: { c: TargetCandidate }) {
    const { c } = props
    const scoreKeys = Object.keys(c.scores ?? {})
    return (
        <Card className="p-4">
            <div className="mb-1 flex items-center gap-2">
                <span className="text-base font-semibold">{c.symbol}</span>
                {c.modality && <Badge variant="success">{MODALITY_LABEL[c.modality] ?? c.modality}</Badge>}
                {c.name && <span className="truncate text-xs text-[var(--app-hint)]">{c.name}</span>}
            </div>
            {scoreKeys.length > 0 && (
                <div className="my-2 space-y-1">
                    {scoreKeys.map((k) => (
                        <ScoreBar key={k} label={k} value={c.scores[k]} />
                    ))}
                </div>
            )}
            {c.evidence && c.evidence.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                    {c.evidence.map((ev, i) => (
                        <EvidenceChip key={i} ev={ev} />
                    ))}
                </div>
            )}
            {c.rationale && <p className="text-sm text-[var(--app-fg)]">{c.rationale}</p>}
        </Card>
    )
}

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
    searchState?: 'none' | 'running' | 'stopping' | 'stopped' | 'done' | 'error'
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
                        <div className="mt-0.5 break-words font-mono text-xs text-[var(--app-hint)]">{a.query}</div>
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
    const elapsed = ts.length ? Math.max(...ts) - Math.min(...ts) : 0
    const fmt = (s: number) => {
        const m = Math.floor(s / 60), sec = Math.floor(s % 60)
        return m ? `${m}m${sec}s` : `${sec}s`
    }
    const agents = phases.reduce((n, [k]) => n + (prog[k]?.total ?? 0), 0)
    const statusLabel =
        props.status === 'done' ? '完成'
        : props.status === 'stopped' ? '已停止'
        : props.status === 'stopping' ? '停止中'
        : props.status === 'error' ? '失败'
        : '进行中'
    const [openPhase, setOpenPhase] = useState<string | null>(null)
    return (
        <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                深度检索
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
                    // this phase's agent sessions (labels "search · …" etc.); progress events
                    // (label === k) are dropped inside StepCards.
                    const phaseEvents = props.events.filter(
                        (e) => e.label === k || e.label.startsWith(k + ' · ')
                    )
                    const sessions = new Set(
                        phaseEvents.filter((e) => e.type !== 'progress').map((e) => e.label)
                    ).size
                    const open = openPhase === k
                    return (
                        <div key={k}>
                            <button
                                onClick={() => setOpenPhase(open ? null : k)}
                                disabled={sessions === 0}
                                className="flex w-full items-center gap-2 text-xs disabled:cursor-default"
                            >
                                <span className="w-3 text-[var(--app-button)]">{complete ? '✓' : d > 0 ? '·' : ''}</span>
                                <span className="w-10 text-left font-medium">{label}</span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--app-subtle-bg)]">
                                    <div className="h-full bg-[var(--app-button)] transition-all" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="w-12 text-right font-mono text-[var(--app-hint)]">{d}/{total || '—'}</span>
                                <span className="w-4 text-right text-[var(--app-hint)]">{sessions > 0 ? (open ? '▾' : '▸') : ''}</span>
                            </button>
                            {open && sessions > 0 && (
                                <div className="mt-1.5 pl-3">
                                    <StepCards events={phaseEvents} terminal={props.terminal} />
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </Card>
    )
}

function DeepReportView(props: { report: DeepReport }) {
    const r = props.report
    const confVariant = (c: string) => (c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'default') as
        'success' | 'warning' | 'default'
    return (
        <Card className="p-4">
            <div className="mb-2 text-sm font-medium">检索简报</div>
            {r.summary && <p className="text-sm leading-relaxed">{r.summary}</p>}
            {r.findings?.length > 0 && (
                <ol className="mt-3 flex flex-col gap-2">
                    {r.findings.map((f, i) => (
                        <li key={i} className="rounded-lg border border-[var(--app-border)] p-2.5">
                            <div className="flex items-start gap-2">
                                <Badge variant={confVariant(f.confidence)}>{f.confidence}</Badge>
                                <span className="text-sm font-medium">{f.claim}</span>
                            </div>
                            {f.evidence && <div className="mt-1 text-xs text-[var(--app-hint)]">{f.evidence}</div>}
                            {f.sources?.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                    {f.sources.map((s, j) => (
                                        <a key={j} href={s} target="_blank" rel="noreferrer"
                                           className="break-all font-mono text-[10px] text-[var(--app-link,#2563eb)] hover:underline">{s}</a>
                                    ))}
                                </div>
                            )}
                        </li>
                    ))}
                </ol>
            )}
            {r.caveats && (
                <p className="mt-3 text-xs text-[var(--app-hint)]"><span className="font-medium">注意:</span> {r.caveats}</p>
            )}
            {r.openQuestions && r.openQuestions.length > 0 && (
                <div className="mt-3">
                    <p className="mb-1 text-sm font-medium">开放问题</p>
                    <ul className="list-disc pl-5 text-sm text-[var(--app-hint)]">
                        {r.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                </div>
            )}
            {r.references && r.references.length > 0 && (
                <div className="mt-3">
                    <p className="mb-1 text-sm font-medium">参考文献</p>
                    <ol className="flex flex-col gap-1.5">
                        {r.references.map((ref) => (
                            <ReferenceItem key={ref.n} r={{ n: ref.n, doi: ref.doi, apa7: ref.apa7 }} />
                        ))}
                    </ol>
                </div>
            )}
            {r.dbSources && r.dbSources.length > 0 && (
                <div className="mt-3">
                    <p className="mb-1 text-sm font-medium">数据库来源</p>
                    <ul className="flex flex-col gap-0.5">
                        {r.dbSources.map((s, i) => (
                            <li key={i} className="text-xs">
                                <a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">
                                    {s.title || s.url}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {r.webSources && r.webSources.length > 0 && (
                <div className="mt-3">
                    <p className="mb-1 text-sm font-medium">网络来源</p>
                    <ul className="flex flex-col gap-0.5">
                        {r.webSources.map((s, i) => (
                            <li key={i} className="text-xs">
                                <a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">
                                    {s.title || s.url}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {r.refuted && r.refuted.length > 0 && (
                <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-[var(--app-hint)]">被对抗式核验否决的 claim（{r.refuted.length}）</summary>
                    <ul className="mt-1 list-disc pl-5 text-xs text-[var(--app-hint)]">
                        {r.refuted.map((c, i) => <li key={i}>{c.claim}（票 {c.vote}）</li>)}
                    </ul>
                </details>
            )}
            {r.stats && (
                <p className="mt-3 border-t border-[var(--app-border)] pt-2 text-[10px] text-[var(--app-hint)]">
                    角度 {r.stats.angles} · 源 {r.stats.sources} · claims {r.stats.claims} · 确认 {r.stats.confirmed} · 否决 {r.stats.killed}
                    {r.budget?.spent_tokens != null && ` · tokens ${r.budget.spent_tokens}`}
                </p>
            )}
        </Card>
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
                        {state === 'stopping' ? '停止中…' : '停止检索'}
                    </Button>
                )}
                {terminal && angles.length > 0 && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => ddaApi.startSearch(props.campaign, angles).catch(() => {})}
                    >
                        重新检索
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
    const terminal = state === 'done' || state === 'stopped' || state === 'error'
    return (
        <>
            <PhasesPanel events={events} status={state} terminal={terminal} />
            {state === 'error' && (
                <Card className="p-4 text-sm text-[var(--app-badge-error-text,#dc2626)]">
                    检索失败:{props.report?.status.error}
                </Card>
            )}
            {props.report?.report && <DeepReportView report={props.report.report} />}
            {events.length === 0 && state === 'running' && (
                <Card className="p-4 text-sm text-[var(--app-hint)]">检索启动中,各 agent 会话稍候出现…</Card>
            )}
        </>
    )
}

function StageDetail(props: {
    campaign: string
    stage: string
    searchState?: 'none' | 'running' | 'stopping' | 'stopped' | 'done' | 'error'
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
            {detail.verdict && (
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

function ApaText(props: { s: string }) {
    // the venue is the only *italicised* span in an APA7 string — split on '*' pairs
    return (
        <>
            {props.s.split('*').map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}
        </>
    )
}

function ReferenceItem(props: { r: Reference }) {
    const { r } = props
    const url = `https://doi.org/${r.doi}`
    const cut = r.apa7.lastIndexOf(url)
    const head = cut >= 0 ? r.apa7.slice(0, cut) : r.apa7
    return (
        <li className="flex gap-2 text-sm leading-relaxed">
            <span className="shrink-0 text-[var(--app-hint)]">{r.n}.</span>
            <span>
                <ApaText s={head} />
                {cut >= 0 && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--app-link,#2563eb)] hover:underline"
                    >
                        {url}
                    </a>
                )}
            </span>
        </li>
    )
}

function Bibliography(props: { campaign: string }) {
    const [data, setData] = useState<ReferencesResponse | null>(null)
    useEffect(() => {
        let alive = true
        setData(null)
        ddaApi
            .references(props.campaign)
            .then((d) => alive && setData(d))
            .catch(() => alive && setData(null))
        return () => {
            alive = false
        }
    }, [props.campaign])

    if (!data || data.count === 0) return null
    return (
        <Card className="p-4">
            <div className="mb-2 text-sm font-medium">参考文献 (APA7) · {data.count} 篇</div>
            <ol className="space-y-2">
                {data.references.map((r) => (
                    <ReferenceItem key={r.doi} r={r} />
                ))}
            </ol>
            {data.unresolved.length > 0 && (
                <p className="mt-2 text-xs text-[var(--app-hint)]">
                    {data.unresolved.length} 个 DOI 未能解析:{data.unresolved.join(', ')}
                </p>
            )}
        </Card>
    )
}

export function App() {
    useTheme() // apply persisted theme on load

    const { campaigns, error: cErr, refetch } = useCampaigns()
    const [campaign, setCampaign] = useState<string | null>(null)
    useEffect(() => {
        if (!campaign && campaigns && campaigns.length > 0) setCampaign(campaigns[0].campaign)
    }, [campaigns, campaign])

    const { view, error: vErr } = useCampaignView(campaign)
    const { report, refresh: refreshReport } = useReport(campaign)
    const searchState = report?.status.state ?? 'none'
    const [selected, setSelected] = useState<string | null>(null)
    const SEARCH_TAB = '__search__'
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
            })
            .catch(() => {})
    }

    return (
        <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--app-bg)', color: 'var(--app-fg)' }}>
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

            <main className="flex-1 overflow-y-auto">
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

                <div id="dd-main" className="mx-auto flex max-w-content flex-col gap-5 p-6">
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
                            extra={
                                searchState !== 'none'
                                    ? [{
                                          id: SEARCH_TAB,
                                          label: '检索简报',
                                          badge:
                                              searchState === 'running' ? '进行中'
                                              : searchState === 'stopping' ? '停止中'
                                              : searchState === 'stopped' ? '已停止'
                                              : searchState === 'done' ? '完成'
                                              : '失败',
                                      }]
                                    : []
                            }
                        />
                    )}

                    {campaign && selected === SEARCH_TAB && (
                        <DeepResearchPage campaign={campaign} report={report} />
                    )}
                    {campaign && selected && selected !== SEARCH_TAB && (
                        <StageDetail
                            campaign={campaign}
                            stage={selected}
                            searchState={searchState}
                            onSearch={onStartSearch}
                        />
                    )}

                    {campaign && <Bibliography campaign={campaign} />}
                </div>
            </main>

            {chatOpen && campaign && (
                <ChatPanel
                    key={campaign}
                    campaign={campaign}
                    onClose={() => setChatOpen(false)}
                    attachments={pendingRefs}
                    onRemoveAttachment={(i) => setPendingRefs((p) => p.filter((_, j) => j !== i))}
                    onClearAttachments={() => setPendingRefs([])}
                />
            )}

            <SelectionPopup onAdd={addRef} />
            <FilesPage campaign={filesOpen} onClose={() => setFilesOpen(null)} />
        </div>
    )
}
