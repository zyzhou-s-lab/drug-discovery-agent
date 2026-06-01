import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { CodeBlock } from '@/components/CodeBlock'
import { LoadingState } from '@/components/LoadingState'
import { StepCards } from '@/components/StepCards'
import { Sidebar } from '@/components/Sidebar'

import { ddaApi, pubmedId } from '@/api/dda'
import { useTheme } from '@/lib/settings'
import { useCampaigns, useCampaignView, useStageDetail, useStageEvents } from '@/hooks/useDda'
import type { CampaignStage, Evidence, StageStatus, TargetCandidate } from '@/types/dda'

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
    exhausted: '已耗尽',
}

const STAGE_LABEL: Record<string, string> = {
    'target-hypothesis': '1 · 靶点假设',
    'literature-evidence': '2 · 文献证据',
    'target-selection': '3 · 靶点选定',
    'target-validation': '4 · 靶点验证',
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
    const pmid = pubmedId(ev.ref, ev.source)
    const kind = KIND_LABEL[ev.kind] ?? ev.kind
    const body = (
        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-2 py-0.5 text-xs">
            <span className="font-medium">{kind}</span>
            <span className="text-[var(--app-hint)]">· {pmid ? `PMID:${pmid}` : ev.source}</span>
        </span>
    )
    return pmid ? (
        <a
            href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
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
    const scoreKeys = Object.keys(c.scores)
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
            {c.evidence.length > 0 && (
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
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {props.stages.map((s) => {
                const active = s.name === props.selected
                return (
                    <button
                        key={s.name}
                        onClick={() => props.onSelect(s.name)}
                        className={
                            'flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors ' +
                            (active
                                ? 'border-[var(--app-button)] bg-[var(--app-subtle-bg)]'
                                : 'border-[var(--app-border)] hover:bg-[var(--app-subtle-bg)]')
                        }
                    >
                        <span className="text-sm font-medium">{stageLabel(s.name)}</span>
                        <span className="flex items-center gap-1.5">
                            <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                            {s.scatter && <span className="text-[10px] text-[var(--app-hint)]">扇出 ×{s.angles.length}</span>}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

function StageDetail(props: { campaign: string; stage: string }) {
    const { detail, loading } = useStageDetail(props.campaign, props.stage)
    const { events } = useStageEvents(props.campaign, props.stage)
    const rawJson = useMemo(
        () => (detail?.output ? JSON.stringify(detail.output, null, 2) : ''),
        [detail]
    )
    if (loading && !detail) return <LoadingState label={`正在加载 ${stageLabel(props.stage)}…`} />
    if (!detail) return null

    return (
        <div className="flex flex-col gap-4">
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
                            {detail.verdict.converged ? '已收敛' : '未收敛'}
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
                    <p className="text-sm text-[var(--app-hint)]">{detail.output.summary}</p>
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {detail.output.candidates.map((c) => (
                            <CandidateCard key={c.symbol} c={c} />
                        ))}
                    </div>
                    {detail.output.open_questions.length > 0 && (
                        <Card className="p-4">
                            <p className="mb-1 text-sm font-medium">开放问题</p>
                            <ul className="list-disc pl-5 text-sm text-[var(--app-hint)]">
                                {detail.output.open_questions.map((q, i) => (
                                    <li key={i}>{q}</li>
                                ))}
                            </ul>
                        </Card>
                    )}
                    <CodeBlock code={rawJson} language="json" title={`${stageLabel(props.stage)} · 原始 NodeOutput`} collapseLongContent />
                </>
            ) : events.length === 0 ? (
                <Card className="p-4 text-sm text-[var(--app-hint)]">
                    {detail.status === 'in_progress'
                        ? '正在运行中,执行步骤会实时出现…'
                        : detail.status === 'exhausted'
                          ? '多次尝试后未收敛(查看 uvicorn 日志排查)。'
                          : '暂无产出。靶点验证为 M4,尚未实现。'}
                    (状态:{STATUS_LABEL[detail.status]})
                </Card>
            ) : null}
        </div>
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
    const [selected, setSelected] = useState<string | null>(null)
    useEffect(() => {
        if (!view) return
        const done = view.stages.filter((s) => s.status === 'done')
        const pick = done.length ? done[done.length - 1].name : view.stages[0]?.name ?? null
        setSelected((cur) => cur ?? pick)
    }, [view])

    const apiDown = Boolean(cErr || vErr)

    const startRun = (disease: string, real: boolean) => {
        const slug = disease.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'run'
        const id = `${slug}-${Date.now().toString(36)}`
        ddaApi
            .startRun({ disease, campaign: id, real })
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
            />

            <main className="flex-1 overflow-y-auto p-6">
                <div className="mx-auto flex max-w-content flex-col gap-5">
                    <header>
                        <h1 className="text-lg font-semibold">{campaign ?? '发现段流水线'}</h1>
                        <p className="text-sm text-[var(--app-hint)]">
                            实时模式 · 阶段 1–3 = M1–M3b,阶段 4 = M4(未实现)。点阶段查看执行过程 / 候选 / 证据 / 评审。
                        </p>
                    </header>

                    {!campaign && (
                        <Card className="p-6 text-sm text-[var(--app-hint)]">
                            从左侧选择一个运行,或点右上 ＋ 新建一个疾病项目并运行。
                        </Card>
                    )}

                    {view && <StageRail stages={view.stages} selected={selected} onSelect={setSelected} />}

                    {campaign && selected && <StageDetail campaign={campaign} stage={selected} />}
                </div>
            </main>
        </div>
    )
}
