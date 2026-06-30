import { useEffect, useRef, useState } from 'react'

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

function fmtDur(s?: number): string {
    if (!s || s <= 0) return '—'
    const m = Math.floor(s / 60)
    return m ? `${m}m${s % 60}s` : `${s}s`
}

function DeepReportView(props: { report: DeepReport }) {
    const r = props.report
    const confVariant = (c: string) => (c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'default') as
        'success' | 'warning' | 'default'
    const st = r.stats
    const metaItems: [string, string | number | undefined][] = st
        ? [
              ['子智能体', st.agentCalls],
              ['消耗 token', r.budget?.spent_tokens?.toLocaleString()],
              ['耗时', fmtDur(st.elapsedSec)],
              ['研究角度', st.angles],
              ['来源', st.sources],
              ['抽取声明', st.claims],
              ['进入核验', st.verified],
              ['确认', st.confirmed],
              ['否决', st.killed],
              ['最终发现', st.afterSynthesis],
          ]
        : []
    return (
        <div className="flex flex-col gap-4">
            {/* meta card: run statistics (agents / tokens / elapsed / pipeline counts) */}
            {metaItems.filter(([, v]) => v != null && v !== '').length > 0 && (
                <Card className="p-4">
                    <div className="mb-2 text-sm font-medium">研究概览</div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                        {metaItems
                            .filter(([, v]) => v != null && v !== '')
                            .map(([k, v]) => (
                                <div key={k} className="flex items-baseline justify-between gap-2 border-b border-[var(--app-border)] pb-1">
                                    <span className="text-[var(--app-hint)]">{k}</span>
                                    <span className="font-medium tabular-nums">{v}</span>
                                </div>
                            ))}
                    </div>
                </Card>
            )}
            {/* presentation layer: polished Chinese narrative (api._present_report), shown first */}
            {r.narrative && (
                <Card className="p-5">
                    <Markdown text={r.narrative} />
                </Card>
            )}
            {/* fallback: the narrative is best-effort and silently yields "" on MiMo 429/overload
                (api.py _present_report). When it's missing, the structured fields are still computed —
                render summary / caveats / openQuestions so the report isn't a near-blank page. */}
            {!r.narrative && (r.summary || r.caveats || (r.openQuestions?.length ?? 0) > 0) && (
                <Card className="flex flex-col gap-3 p-5">
                    {r.summary && (
                        <div>
                            <div className="mb-1 text-sm font-medium">摘要</div>
                            <Markdown text={r.summary} />
                        </div>
                    )}
                    {r.caveats && (
                        <div>
                            <div className="mb-1 text-sm font-medium">注意事项</div>
                            <Markdown text={r.caveats} />
                        </div>
                    )}
                    {(r.openQuestions?.length ?? 0) > 0 && (
                        <div>
                            <div className="mb-1 text-sm font-medium">开放问题</div>
                            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                                {r.openQuestions!.map((q, i) => <li key={i}>{q}</li>)}
                            </ul>
                        </div>
                    )}
                </Card>
            )}
            {/* raw database records: per-card structured data + APA7 references */}
            {r.databaseFacts && r.databaseFacts.length > 0 && (() => {
                const SKIP_TOOLS = new Set(['Bash', 'WebFetch', 'WebSearch', 'Read', 'Write', 'Edit', 'Glob', 'Grep'])
                const parseRawAll = (raw: string): { tool: string; data: unknown }[] => {
                    const blocks = raw.split(/\n---\n/)
                    const result: { tool: string; data: unknown }[] = []
                    for (const blk of blocks) {
                        const m = blk.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
                        if (!m) continue
                        try {
                            const parsed = JSON.parse(m[2])
                            const data = Array.isArray(parsed) ? parsed : [parsed]
                            const isEmpty = data.length === 0
                            if (!isEmpty) result.push({ tool: m[1], data })
                        } catch { /* not json */ }
                    }
                    return result
                }
                const SKIP2 = new Set(['content', 'data', 'bash', 'type', 'text', 'is_error', 'tool_use_id', 'abstract', 'citation_count', 'authors'])
                const ontologyWebUrl = (obj: Record<string, unknown>): string => {
                    const ont = String(obj.ontology || obj.ontology_name || '').toLowerCase()
                    const rawId = String(obj.obo_id || obj.id || obj.short_form || '')
                    if (ont && rawId) return `https://www.ebi.ac.uk/ols4/ontologies/${ont}/terms?obo_id=${encodeURIComponent(rawId)}`
                    if (obj.iri) return String(obj.iri)
                    return ''
                }
                // DOI → verification status map from findings and refuted
                const doiStatus = new Map<string, { status: string; confidence: string }>()
                for (const f of (r.findings ?? [])) {
                    for (const s of (f.sources ?? [])) {
                        const doi = s.replace(/^https?:\/\/doi\.org\//, '')
                        if (doi) doiStatus.set(doi.toLowerCase(), { status: 'confirmed', confidence: f.confidence })
                    }
                }
                for (const c of (r.refuted ?? [])) {
                    const doi = (c.source || '').replace(/^https?:\/\/doi\.org\//, '')
                    if (doi) doiStatus.set(doi.toLowerCase(), { status: 'refuted', confidence: '' })
                }
                // Format author: "Deke Jiang" → "Jiang, D."
                const fmtAuthor = (name: string): string => {
                    const parts = name.trim().split(/\s+/)
                    if (parts.length < 2) return name
                    const last = parts[parts.length - 1]
                    const initials = parts.slice(0, -1).map(p =>
                        p.length <= 2 || /\./.test(p) ? p.charAt(0).toUpperCase() + '.' : p.charAt(0).toUpperCase() + '.'
                    )
                    return `${last}, ${initials.join(' ')}`
                }
                // APA7 formatter: all authors (year). Title. Venue. DOI
                const fmtApa7 = (ref: Record<string, unknown>): string => {
                    const authors = ref.authors as string[] | undefined
                    const year = String(ref.year || 'n.d.')
                    const title = String(ref.title || '')
                    const venue = String(ref.venue || '')
                    const doi = String(ref.doi || '')
                    let authStr = ''
                    if (authors && authors.length > 0) {
                        const formatted = authors.map(fmtAuthor)
                        if (formatted.length > 20) {
                            authStr = formatted.slice(0, 19).join(', ') + ', ... ' + formatted[formatted.length - 1]
                        } else {
                            authStr = formatted.length <= 2
                                ? formatted.join(' & ')
                                : formatted.slice(0, -1).join(', ') + ' & ' + formatted[formatted.length - 1]
                        }
                    }
                    let s = ''
                    if (authStr) s += authStr + ' '
                    s += `(${year}). ${title}.`
                    if (venue) s += ` ${venue}.`
                    if (doi) s += ` https://doi.org/${doi}`
                    return s
                }
                // collect all literature refs across all facts for the global references card
                const allRefs: { doi: string; apa7: string; status: string; confidence: string }[] = []
                {
                    const refMap = new Map<string, { doi: string; apa7: string; status: string; confidence: string; hasAuthors: boolean }>()
                    for (const d of r.databaseFacts!) {
                        const blocks = d.raw ? parseRawAll(d.raw as string) : []
                        for (const b of blocks) {
                            if (!/search_literature|get_paper/.test(b.tool)) continue
                            const arr = Array.isArray(b.data) ? b.data as Record<string, unknown>[] : [b.data as Record<string, unknown>]
                            for (const item of arr) {
                                if (!item || typeof item !== 'object') continue
                                const doi = String((item as Record<string, unknown>).doi || '')
                                if (!doi) continue
                                const key = doi.toLowerCase()
                                const hasAuthors = ((item as Record<string, unknown>).authors as unknown[])?.length > 0
                                const existing = refMap.get(key)
                                // prefer entry with authors
                                if (existing && existing.hasAuthors && !hasAuthors) continue
                                const st = doiStatus.get(key)
                                refMap.set(key, {
                                    doi,
                                    apa7: fmtApa7(item as Record<string, unknown>),
                                    status: st?.status || 'unverified',
                                    confidence: st?.confidence || '',
                                    hasAuthors,
                                })
                            }
                        }
                    }
                    allRefs.push(...refMap.values())
                }
                return (
                    <>
                    {allRefs.length > 0 && (
                        <Card className="p-4">
                            <div className="mb-2 text-sm font-medium">参考文献 <span className="text-xs font-normal text-[var(--app-hint)]">({allRefs.length})</span></div>
                            <ol className="list-decimal pl-5 flex flex-col gap-1.5">
                                {allRefs.map((ref, ri) => {
                                    const stLabel = ref.status === 'confirmed' ? '已确认' : ref.status === 'refuted' ? '已否决' : '未核验'
                                    const stVariant = ref.status === 'confirmed' ? 'success' : ref.status === 'refuted' ? 'warning' : 'default'
                                    return (
                                        <li key={ri} className="text-xs leading-relaxed">
                                            <Badge variant={stVariant as 'success' | 'warning' | 'default'} className="mr-1.5 text-[10px]">{stLabel}</Badge>
                                            <span>{ref.apa7}</span>
                                            {ref.confidence && <span className="ml-1 text-[var(--app-hint)]">({ref.confidence})</span>}
                                        </li>
                                    )
                                })}
                            </ol>
                        </Card>
                    )}
                    <Card className="p-4">
                        <div className="mb-3 text-sm font-medium">数据库数据 <span className="text-xs font-normal text-[var(--app-hint)]">({r.databaseFacts.length} 条原始记录)</span></div>
                        <div className="flex flex-col gap-2">
                            {r.databaseFacts.map((d, i) => {
                                const sv = d.status === 'confirmed' ? 'success' : d.status === 'refuted' ? 'warning' : 'default'
                                const sl = d.status === 'confirmed' ? '已确认' : d.status === 'refuted' ? '已否决' : '未核验'
                                const src = d.source || ''
                                const allBlocks = d.raw ? parseRawAll(d.raw as string) : []
                                // find which blocks this fact's quote matches
                                const matchedBlocks = (() => {
                                    if (allBlocks.length === 0) return []
                                    const qText = (d.quote || d.claim || '').toLowerCase()
                                    const qTokens = qText.split(/[\s,;:]+/).filter((t: string) => t.length > 3)
                                    if (qTokens.length === 0) return allBlocks.filter(b => !SKIP_TOOLS.has(b.tool))
                                    // find blocks that match the quote
                                    const result: { tool: string; data: unknown }[] = []
                                    for (const b of allBlocks) {
                                        const content = JSON.stringify(b.data).toLowerCase()
                                        const blockScore = qTokens.filter((t: string) => content.includes(t)).length
                                        if (blockScore < 2) continue
                                        // filter records within the block to only those matching the quote
                                        const arr = Array.isArray(b.data) ? b.data as Record<string, unknown>[] : [b.data as Record<string, unknown>]
                                        const filtered = arr.filter(obj => {
                                            const objStr = JSON.stringify(obj).toLowerCase()
                                            return qTokens.filter((t: string) => objStr.includes(t)).length >= 1
                                        })
                                        result.push({ ...b, data: filtered.length > 0 ? filtered : arr })
                                    }
                                    return result.length > 0 ? result : allBlocks.filter(b => !SKIP_TOOLS.has(b.tool))
                                })()
                                const blocks = matchedBlocks.filter(b => !SKIP_TOOLS.has(b.tool) && !/search_literature|get_paper|submit_claims/.test(b.tool))
                                return (
                                    <div key={i} className="rounded-lg border border-[var(--app-border)] overflow-hidden">
                                        {/* Section 1: 搜索描述 */}
                                        <div className="p-3">
                                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--app-subtle-bg)] text-[10px] font-medium text-[var(--app-hint)]">{i + 1}</span>
                                                    <Badge variant={sv as 'success' | 'warning' | 'default'} className="text-[10px]">{sl}</Badge>
                                                    {d.quality && <span className="rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">{d.quality}</span>}
                                                </div>
                                                <div className="flex items-center gap-2 truncate text-[11px]">
                                                    {d.doi && <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer" className="truncate text-[var(--app-link,#2563eb)] hover:underline">doi:{d.doi}</a>}
                                                </div>
                                            </div>
                                            {d.quote && <><div className="mb-1 text-[10px] font-medium text-[var(--app-hint)]">原文引用</div><div className="mb-2 text-sm leading-relaxed">"{d.quote}"</div></>}
                                            <div className="mb-1 text-[10px] font-medium text-[var(--app-hint)]">提取摘要</div>
                                            <div className="border-l-2 border-[var(--app-border)] pl-2 text-xs text-[var(--app-hint)]">{d.claim}</div>
                                        </div>
                                        {/* Section 2: 格式化输出 */}
                                        {blocks.length > 0 && (
                                            <div className="border-t border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-3">
                                                {blocks.map((b, bi) => {
                                                    const arr = Array.isArray(b.data) ? b.data as Record<string, unknown>[] : [b.data as Record<string, unknown>]
                                                    const valid = arr.filter(o => o && typeof o === 'object' && Object.keys(o).length > 0)
                                                    if (valid.length === 0) return null
                                                    const prefer = ['id', 'label', 'ontology', 'definition', 'doi', 'title', 'year', 'venue', 'iri', 'obo_id', 'short_form', 'ontology_name', 'tldr']
                                                    const allCols = new Set<string>()
                                                    for (const obj of valid) {
                                                        for (const k of Object.keys(obj)) {
                                                            if (!SKIP2.has(k) && obj[k] != null && obj[k] !== '' && obj[k] !== false) allCols.add(k)
                                                        }
                                                    }
                                                    const cols = [...prefer.filter(c => allCols.has(c)), ...[...allCols].filter(c => !prefer.includes(c))]
                                                    if (cols.length === 0) return null
                                                    const renderCell = (obj: Record<string, unknown>, k: string) => {
                                                        const v = obj[k]
                                                        if (v == null) return ''
                                                        const display = Array.isArray(v) ? v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
                                                        if (k === 'doi') return <a href={`https://doi.org/${display}`} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">{display}</a>
                                                        if (k === 'iri') return <a href={display} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">{display}</a>
                                                        const ols = ontologyWebUrl(obj)
                                                        if (k === 'id' && ols && ols !== String(obj.iri || '')) return <a href={ols} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">{display}</a>
                                                        return display
                                                    }
                                                    return (
                                                        <div key={bi} className={bi > 0 ? 'mt-2.5 pt-2.5 border-t border-[var(--app-border)]' : ''}>
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-xs">
                                                                    <thead>
                                                                        <tr className="border-b border-[var(--app-border)] text-left text-[var(--app-hint)]">
                                                                            {cols.map(c => <th key={c} className="px-1.5 py-1 font-medium whitespace-nowrap">{c}</th>)}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {valid.map((obj, oi) => (
                                                                            <tr key={oi} className="border-b border-dashed border-[var(--app-border)] last:border-solid align-top">
                                                                                {cols.map(c => <td key={c} className="max-w-[200px] px-1.5 py-1 break-words">{renderCell(obj as Record<string, unknown>, c)}</td>)}
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </Card>
                    </>
                )
            })()}
            {/* unified Claim section: confirmed findings + refuted claims */}
            {((r.findings?.length ?? 0) > 0 || (r.refuted?.length ?? 0) > 0) && (
                <Card className="p-4">
                    <div className="mb-2 text-sm font-medium">Claim <span className="text-xs font-normal text-[var(--app-hint)]">
                        (确认 {(r.findings?.length ?? 0)}, 否决 {(r.refuted?.length ?? 0)})
                    </span></div>
                    <ul className="flex flex-col gap-2">
                        {(r.findings ?? []).map((f, i) => (
                            <li key={`c${i}`} className="rounded-lg border border-[var(--app-border)] p-2.5">
                                <div className="flex items-start gap-2">
                                    <Badge variant="success" className="shrink-0">确认</Badge>
                                    <Badge variant={confVariant(f.confidence)} className="shrink-0">{f.confidence}</Badge>
                                    {f.angle && <Badge variant="default" className="shrink-0">{f.angle}</Badge>}
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
                        {(r.refuted ?? []).map((c, i) => (
                            <li key={`r${i}`} className="rounded-lg border border-[var(--app-border)] p-2.5 opacity-70">
                                <div className="flex items-start gap-2">
                                    <Badge variant="warning" className="shrink-0">否决</Badge>
                                    <span className="text-sm">{c.claim}</span>
                                </div>
                                <div className="mt-1 text-xs text-[var(--app-hint)]">票: {c.vote}</div>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
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
    const terminal = state === 'done' || state === 'stopped' || state === 'error'
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

// one entry of the unified reference list: paper → APA7 (ReferenceItem); database/web → title + link
function UnifiedRefItem(props: { r: { n: number; doi?: string; apa7?: string; title?: string; url?: string } }) {
    const { r } = props
    if (r.apa7) return <ReferenceItem r={{ n: r.n, doi: r.doi ?? '', apa7: r.apa7 }} />
    return (
        <li className="flex gap-2 text-sm leading-relaxed">
            <span className="shrink-0 text-[var(--app-hint)]">{r.n}.</span>
            <span>
                {r.title ? r.title + ' ' : ''}
                {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="break-all text-[var(--app-link,#2563eb)] hover:underline">
                        {r.url}
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
                        <DeepReportView report={report.report} />
                    )}
                    {campaign && selected && selected !== SEARCH_TAB && selected !== REPORT_TAB && (
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
