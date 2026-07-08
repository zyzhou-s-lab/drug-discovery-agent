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
    const value = typeof props.value === 'number' ? props.value : 0 // defensive: never .toFixed(undefined)
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
    return (
        <div className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-[var(--app-hint)]">{SCORE_LABEL[props.label] ?? props.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--app-subtle-bg)]">
                <div className="h-full rounded-full bg-[var(--app-button)]" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right tabular-nums">{value.toFixed(2)}</span>
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

function fmtDur(s?: number): string {
    if (!s || s <= 0) return '—'
    const m = Math.floor(s / 60)
    return m ? `${m}m${s % 60}s` : `${s}s`
}

// resolve a source string (doi/url) to its numbered reference — mirrors engine present.ts cite()
function refNFor(source: string, references?: DeepReport['references']): number | undefined {
    if (!references) return undefined
    const s = String(source).toLowerCase()
    for (const r of references) {
        if (r.doi && s.includes(String(r.doi).toLowerCase())) return r.n
        if (r.url && (s.includes(r.url) || String(r.url).includes(s))) return r.n
    }
    return undefined
}

const confVariant = (c?: string) =>
    (c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'default') as 'success' | 'warning' | 'default'

// a [N] citation chip linking to the bibliography entry; falls back to a raw link when unresolved
function CitationChip(props: { source: string; references?: DeepReport['references'] }) {
    const n = refNFor(props.source, props.references)
    if (n != null)
        return (
            <a
                href={`#dd-ref-${n}`}
                className="inline-flex items-center rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-link,#2563eb)] no-underline hover:underline"
            >
                [{n}]
            </a>
        )
    return (
        <a
            href={props.source}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-[10px] text-[var(--app-link,#2563eb)] hover:underline"
        >
            {props.source}
        </a>
    )
}

// canonical numbered bibliography from report.references, with #dd-ref-N anchors + verify status
function ReportBibliography(props: { report: DeepReport }) {
    const refs = props.report.references ?? []
    // This numbered bibliography only exists to back the narrative's <sup>N</sup> footnotes. Without a
    // narrative there are no superscripts referring to it → it's a redundant subset of the 文献 card, so
    // hide it. (When present() produced a narrative, keep it so the footnote anchors resolve.)
    if (refs.length === 0 || !props.report.narrative) return null
    const status = new Map<number, 'confirmed' | 'refuted'>()
    for (const f of props.report.findings ?? [])
        for (const s of f.sources ?? []) {
            const n = refNFor(s, refs)
            if (n != null && !status.has(n)) status.set(n, 'confirmed')
        }
    for (const c of props.report.refuted ?? []) {
        const n = refNFor(c.source, refs)
        if (n != null && !status.has(n)) status.set(n, 'refuted')
    }
    return (
        <Card className="p-4">
            <div className="mb-2 text-sm font-medium">
                参考文献 <span className="text-xs font-normal text-[var(--app-hint)]">({refs.length})</span>
            </div>
            <ol className="flex flex-col gap-1.5">
                {refs.map((r) => {
                    const stt = status.get(r.n)
                    const badge = stt ? (
                        <Badge variant={stt === 'confirmed' ? 'success' : 'warning'} className="mr-1.5 shrink-0 text-[10px]">
                            {stt === 'confirmed' ? '已确认' : '已否决'}
                        </Badge>
                    ) : null
                    return <UnifiedRefItem key={r.n} r={r} anchorId={`dd-ref-${r.n}`} badge={badge} />
                })}
            </ol>
        </Card>
    )
}

// pretty-print the raw multi-tool record dump for the "原始记录" toggle (best-effort)
// Classify a database record by the KIND of biological evidence its source provides — the data types
// used in drug-target identification/validation (Open Targets evidence framework + omics). Deterministic
// by source host (+ claim text fallback). Colors are light-theme accent pairs.
const DB_BIO_TYPES: { test: RegExp; label: string; bg: string; fg: string }[] = [
    { test: /clinicaltrials\.gov|chembl|drugbank|clinicaltrialsregister/i, label: '药物/临床', bg: '#dbeafe', fg: '#1d4ed8' },
    { test: /opentargets/i, label: '靶点关联', bg: '#f3e8ff', fg: '#7e22ce' },
    { test: /cellxgene|single-?cell|scrna|sc-rna/i, label: '表达·单细胞', bg: '#dcfce7', fg: '#15803d' },
    { test: /spatial|genomics\.cn|hmsma|stomics|stereo-?seq/i, label: '表达·空间组学', bg: '#d1fae5', fg: '#047857' },
    { test: /cellatlas|livercellatlas|tabula|humancellatlas|\batlas\b/i, label: '表达·细胞图谱', bg: '#ccfbf1', fg: '#0f766e' },
    { test: /genome\.jp|kegg|reactome|wikipathways|pathway/i, label: '通路/网络', bg: '#fef3c7', fg: '#b45309' },
    { test: /uniprot|rcsb|\bpdb\b|alphafold/i, label: '蛋白/结构', bg: '#cffafe', fg: '#0e7490' },
    { test: /gwas|gnomad/i, label: '遗传/关联', bg: '#e0e7ff', fg: '#4338ca' },
    { test: /gtex|expression.?atlas/i, label: '表达', bg: '#dcfce7', fg: '#15803d' },
    { test: /ebi\.ac\.uk|\bols\b|ols4|ontology|obolibrary|mondo|\befo\b|\bhp\b/i, label: '本体/注释', bg: '#f1f5f9', fg: '#475569' },
]
function dbBioType(source?: string, claim?: string): { label: string; bg: string; fg: string } {
    const s = `${source ?? ''} ${claim ?? ''}`
    for (const t of DB_BIO_TYPES) if (t.test.test(s)) return t
    return { label: '数据库记录', bg: '#f1f5f9', fg: '#64748b' }
}

// Parse a database record's raw blob (`[tool] {json}` blocks joined by \n---\n) into structured rows,
// dropping GraphQL-error payloads and non-objects — i.e. the tabulatable data (ontology terms, dataset
// listings…). Records whose raw is prose/errors yield [] → the card falls back to quote/claim text.
function parseRawBlocks(raw?: string): { tool: string; rows: Record<string, unknown>[] }[] {
    if (!raw) return []
    const out: { tool: string; rows: Record<string, unknown>[] }[] = []
    for (const blk of raw.split(/\n---\n/)) {
        const m = blk.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
        if (!m) continue
        try {
            const p = JSON.parse(m[2])
            const arr = Array.isArray(p) ? p : [p]
            const rows = arr.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o) && !('errors' in (o as object)))
            if (rows.length) out.push({ tool: m[1], rows })
        } catch { /* prose, not json */ }
    }
    return out
}
// strip HTML tags + collapse whitespace (scraped quotes sometimes carry raw <h1>/<div> markup)
const stripHtml = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
// structured-tool block names — a record carrying one of these is a first-class API result; its source
// host's other (web-scraped) records are redundant once a tool covers it.
const DB_TOOL_BLOCKS = new Set(['get_opentarget_targets', 'get_cellxgene_datasets', 'get_hca_projects', 'mcp__lit__ontology_lookup'])
const DB_SKIP_COLS = new Set(['raw', 'content', 'data', 'type', 'text', 'is_error', 'tool_use_id', 'abstract', 'citation_count', 'authors', 'iri'])
const DB_PREFER_COLS = ['id', 'label', 'name', 'definition', 'dataset_id', 'title', 'disease', 'organism', 'tissue', 'assay', 'year', 'venue', 'ontology']
function dbColumns(rows: Record<string, unknown>[]): string[] {
    const all = new Set<string>()
    for (const o of rows) for (const k of Object.keys(o)) if (!DB_SKIP_COLS.has(k) && o[k] != null && o[k] !== '' && o[k] !== false) all.add(k)
    return [...DB_PREFER_COLS.filter(c => all.has(c)), ...[...all].filter(c => !DB_PREFER_COLS.includes(c))]
}
function dbCell(v: unknown) {
    if (v == null) return ''
    if (Array.isArray(v)) return v.map(x => x && typeof x === 'object' ? String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).name ?? JSON.stringify(x)) : String(x)).join(', ')
    if (typeof v === 'object') return JSON.stringify(v)
    const s = String(v)
    if (/^https?:\/\//.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">{s}</a>
    return stripHtml(s)
}
/** Drop web-scraped database records whose source host is already covered by a first-class API tool
 * (redundant); keep tool records + any host without a tool. */
function pruneDbFacts(facts: NonNullable<DeepReport['databaseFacts']>): NonNullable<DeepReport['databaseFacts']> {
    const host = (s?: string) => { try { return new URL(s || '').hostname.replace(/^www\./, '') } catch { return '' } }
    const isTool = (raw?: string) => parseRawBlocks(raw).some(b => DB_TOOL_BLOCKS.has(b.tool))
    const toolHosts = new Set(facts.filter(d => isTool(d.raw)).map(d => host(d.source)))
    return facts.filter(d => isTool(d.raw) || !toolHosts.has(host(d.source)))
}

function fmtRaw(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
        return raw
    }
}

// one confirmed finding → header + citation chips + expandable evidence chain (quote/source/verdict)
function FindingCard(props: { finding: DeepFinding; report: DeepReport; onJumpToAngle?: (angle: string) => void }) {
    const { finding: f, report: r } = props
    const facts = (r.databaseFacts ?? []).filter((d) => {
        const keys = [d.doi, d.source].filter(Boolean).map((x) => String(x).toLowerCase())
        return (f.sources ?? []).some((s) => {
            const sl = s.toLowerCase()
            return keys.some((k) => sl.includes(k) || k.includes(sl))
        })
    })
    return (
        <li className="rounded-lg border border-[var(--app-border)] p-2.5">
            <div className="flex flex-wrap items-start gap-2">
                <Badge variant="success" className="shrink-0">
                    确认
                </Badge>
                <Badge variant={confVariant(f.confidence)} className="shrink-0">
                    {f.confidence}
                </Badge>
                {f.angle && (
                    <button type="button" className="shrink-0" title="查看研究过程" onClick={() => props.onJumpToAngle?.(f.angle!)}>
                        <Badge variant="default" className="cursor-pointer hover:opacity-80">
                            {f.angle} →
                        </Badge>
                    </button>
                )}
                <span className="text-sm font-medium">{f.claim}</span>
            </div>
            {f.evidence && <div className="mt-1 text-xs text-[var(--app-hint)]">{f.evidence}</div>}
            {(f.sources?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-[var(--app-hint)]">来源</span>
                    {f.sources.map((s, j) => (
                        <CitationChip key={j} source={s} references={r.references} />
                    ))}
                    {f.vote && <span className="text-[10px] text-[var(--app-hint)]">· 票 {f.vote}</span>}
                </div>
            )}
            {facts.length > 0 && (
                <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] text-[var(--app-hint)] hover:text-[var(--app-fg)]">
                        证据链 ({facts.length})
                    </summary>
                    <div className="mt-1.5 flex flex-col gap-1.5">
                        {facts.map((d, k) => (
                            <div key={k} className="rounded border border-[var(--app-border)] p-2 text-xs">
                                <div className="mb-1 flex items-center gap-1.5">
                                    <Badge
                                        variant={d.status === 'confirmed' ? 'success' : d.status === 'refuted' ? 'warning' : 'default'}
                                        className="text-[10px]"
                                    >
                                        {d.status === 'confirmed' ? '已确认' : d.status === 'refuted' ? '已否决' : '未核验'}
                                    </Badge>
                                    {d.quality && (
                                        <span className="rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">
                                            {d.quality}
                                        </span>
                                    )}
                                    {d.doi && (
                                        <a
                                            href={`https://doi.org/${d.doi}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="truncate text-[var(--app-link,#2563eb)] hover:underline"
                                        >
                                            doi:{d.doi}
                                        </a>
                                    )}
                                </div>
                                {d.quote && <div className="leading-relaxed">"{d.quote}"</div>}
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </li>
    )
}

function DeepReportView(props: { report: DeepReport; onJumpToAngle?: (angle: string) => void }) {
    const r = props.report
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
            {/* presentation layer: polished Chinese narrative — <sup> citations link to the bibliography */}
            {r.narrative && (
                <Card className="p-5">
                    <Markdown text={r.narrative} linkCitations />
                </Card>
            )}
            {/* fallback: narrative is best-effort ("" on MiMo 429/overload) — render structured fields */}
            {!r.narrative && ((r.findings?.length ?? 0) > 0 || r.summary || r.caveats || (r.openQuestions?.length ?? 0) > 0) && (
                <Card className="flex flex-col gap-3 p-5">
                    {(r.findings?.length ?? 0) > 0 ? (
                        <div className="flex flex-col gap-3">
                            <div className="text-sm font-medium">研究报告</div>
                            {(() => {
                                const groups: { angle: string; items: typeof r.findings }[] = []
                                r.findings.forEach((f) => {
                                    const a = f.angle || '未分类'
                                    const g = groups.find((x) => x.angle === a)
                                    if (g) g.items.push(f)
                                    else groups.push({ angle: a, items: [f] })
                                })
                                return groups.map((g, gi) => (
                                    <div key={gi}>
                                        <div className="mb-1 text-sm font-medium">
                                            {gi + 1}. {g.angle}
                                        </div>
                                        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                                            {g.items.map((f, i) => (
                                                <li key={i}>
                                                    <span className="text-[var(--app-hint)]">[{f.confidence}]</span> {f.claim}
                                                    {f.evidence ? <span className="text-[var(--app-hint)]"> — {f.evidence}</span> : null}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))
                            })()}
                        </div>
                    ) : r.summary ? (
                        <div>
                            <div className="mb-1 text-sm font-medium">研究报告</div>
                            <Markdown text={r.summary} />
                        </div>
                    ) : null}
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
                                {r.openQuestions!.map((q, i) => (
                                    <li key={i}>{q}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>
            )}
            {/* literature cards: one paper per card + our verify status (confirmed → refuted → uncited) */}
            {r.literature && r.literature.length > 0 && (() => {
                const order: Record<string, number> = { confirmed: 0, refuted: 1, uncited: 2 }
                const lit = [...r.literature].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
                const nC = lit.filter(l => l.status === 'confirmed').length
                const nR = lit.filter(l => l.status === 'refuted').length
                const nU = lit.filter(l => l.status === 'uncited').length
                const surname = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n
                const byline = (l: typeof lit[number]) => [
                    l.authors?.length ? l.authors.slice(0, 2).map(surname).join(', ') + (l.authors.length > 2 ? ', et al.' : '') : '',
                    l.venue, l.year || '',
                ].filter(Boolean).join(' · ')
                const meta = (s: string): ['success' | 'warning' | 'default', string] =>
                    s === 'confirmed' ? ['success', '已确认'] : s === 'refuted' ? ['warning', '已否决'] : ['default', '未引用']
                return (
                    <Card className="p-4">
                        <div className="mb-3 text-sm font-medium">文献 <span className="text-xs font-normal text-[var(--app-hint)]">({lit.length} · {nC} 已确认 · {nR} 已否决 · {nU} 未引用)</span></div>
                        <div className="flex flex-col gap-2">
                            {lit.map((l, i) => {
                                const [variant, label] = meta(l.status)
                                return (
                                    <div key={i} className="rounded-lg border border-[var(--app-border)] p-3">
                                        <div className="mb-1 flex items-start justify-between gap-2">
                                            <a href={`https://doi.org/${l.doi}`} target="_blank" rel="noreferrer" className="text-[15px] font-semibold leading-snug text-[var(--app-link,#2563eb)] hover:underline">{l.title}</a>
                                            <Badge variant={variant} className="shrink-0 text-[10px]">{label}{l.vote ? ` ${l.vote}` : ''}</Badge>
                                        </div>
                                        <div className="mb-2 text-xs text-[var(--app-hint)]">{byline(l)}</div>
                                        {l.claim
                                            ? <div className="rounded-md bg-[var(--app-subtle-bg)] px-3 py-2 text-sm leading-relaxed">"{l.claim}"</div>
                                            : <div className="rounded-md bg-[var(--app-subtle-bg)] px-3 py-2 text-sm italic text-[var(--app-hint)]">检索到但未被报告引用(候选证据)</div>}
                                        <div className="mt-2 text-[11px] text-[var(--app-hint)]">
                                            <a href={`https://doi.org/${l.doi}`} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">doi:{l.doi}</a>
                                            {l.angle && <span> · 报告角度:{l.angle}</span>}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </Card>
                )
            })()}
            {/* database records: structured fields (claim/quote/source/doi/quality/status); raw behind a toggle */}
            {(() => { const dbFacts = pruneDbFacts(r.databaseFacts ?? []); return dbFacts.length > 0 && (
                <Card className="p-4">
                    <div className="mb-3 text-sm font-medium">
                        数据库数据 <span className="text-xs font-normal text-[var(--app-hint)]">({dbFacts.length} 条记录)</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        {dbFacts.map((d, i) => {
                            const bt = dbBioType(d.source, d.claim)
                            return (
                                <div key={i} className="rounded-lg border border-[var(--app-border)] p-3">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--app-subtle-bg)] text-[10px] font-medium text-[var(--app-hint)]">
                                                {i + 1}
                                            </span>
                                            <span style={{ background: bt.bg, color: bt.fg }} className="rounded-full px-2 py-0.5 text-[10px] font-medium">
                                                {bt.label}
                                            </span>
                                            {d.quality && (
                                                <span className="rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">
                                                    {d.quality}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 truncate text-[11px]">
                                            {d.doi ? (
                                                <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer" className="truncate text-[var(--app-link,#2563eb)] hover:underline">
                                                    doi:{d.doi}
                                                </a>
                                            ) : d.source ? (
                                                <a href={d.source} target="_blank" rel="noreferrer" className="truncate text-[var(--app-link,#2563eb)] hover:underline">
                                                    {d.source}
                                                </a>
                                            ) : null}
                                        </div>
                                    </div>
                                    {(() => {
                                        // only blocks that actually yield columns are renderable as tables; a block whose
                                        // fields are all skipped (e.g. a [Bash] HTML dump under a `data` key) yields none →
                                        // fall through to the quote/claim prose so the card is never blank.
                                        const blocks = parseRawBlocks(d.raw)
                                            .map(b => ({ ...b, cols: dbColumns(b.rows) }))
                                            .filter(b => b.cols.length > 0)
                                        if (blocks.length > 0) {
                                            // structured record → render each data block as a table (Open Targets style)
                                            return blocks.map((b, bi) => {
                                                const cols = b.cols
                                                return (
                                                    <div key={bi} className={bi > 0 ? 'mt-2' : ''}>
                                                        <div className="overflow-x-auto rounded-md border border-[var(--app-border)]">
                                                            <table className="w-full text-xs">
                                                                <thead>
                                                                    <tr className="border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-left text-[var(--app-hint)]">
                                                                        {cols.map(c => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {b.rows.slice(0, 30).map((o, ri) => (
                                                                        <tr key={ri} className="border-b border-[var(--app-border)] align-top last:border-0">
                                                                            {cols.map(c => <td key={c} className="px-2 py-1">{dbCell(o[c])}</td>)}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                        {b.rows.length > 30 && <div className="mt-1 text-[10px] text-[var(--app-hint)]">…共 {b.rows.length} 行,仅显示前 30</div>}
                                                    </div>
                                                )
                                            })
                                        }
                                        // prose record (no structured JSON) → clean quote + claim, no cramped labels
                                        return (
                                            <>
                                                {d.quote && <div className="text-sm leading-relaxed">"{stripHtml(d.quote)}"</div>}
                                                {d.claim && <div className="mt-1.5 border-l-2 border-[var(--app-border)] pl-2 text-xs text-[var(--app-hint)]">{stripHtml(d.claim)}</div>}
                                            </>
                                        )
                                    })()}
                                    {d.raw && (
                                        <details className="mt-2">
                                            <summary className="cursor-pointer text-[11px] text-[var(--app-hint)] hover:text-[var(--app-fg)]">原始记录</summary>
                                            <pre className="mt-1.5 max-h-80 overflow-auto rounded bg-[var(--app-code-bg)] p-2 text-[11px] leading-relaxed">{fmtRaw(d.raw)}</pre>
                                        </details>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </Card>
            )})()}
            {/* claim section: confirmed findings (expandable evidence chain) + refuted claims */}
            {((r.findings?.length ?? 0) > 0 || (r.refuted?.length ?? 0) > 0) && (
                <Card className="p-4">
                    <div className="mb-2 text-sm font-medium">
                        Claim{' '}
                        <span className="text-xs font-normal text-[var(--app-hint)]">
                            (确认 {r.findings?.length ?? 0}, 否决 {r.refuted?.length ?? 0})
                        </span>
                    </div>
                    <ul className="flex flex-col gap-2">
                        {(r.findings ?? []).map((f, i) => (
                            <FindingCard key={`c${i}`} finding={f} report={r} onJumpToAngle={props.onJumpToAngle} />
                        ))}
                        {(r.refuted ?? []).map((c, i) => (
                            <li key={`r${i}`} className="rounded-lg border border-[var(--app-border)] p-2.5 opacity-70">
                                <div className="flex items-start gap-2">
                                    <Badge variant="warning" className="shrink-0">
                                        否决
                                    </Badge>
                                    <span className="text-sm">{c.claim}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--app-hint)]">
                                    <span>票 {c.vote}</span>
                                    {c.source && <CitationChip source={c.source} references={r.references} />}
                                </div>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            {/* single canonical bibliography (report.references) with #dd-ref-N anchors */}
            <ReportBibliography report={r} />
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

function ApaText(props: { s: string }) {
    // the venue is the only *italicised* span in an APA7 string — split on '*' pairs
    return (
        <>
            {props.s.split('*').map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}
        </>
    )
}

function ReferenceItem(props: { r: Reference; anchorId?: string; badge?: ReactNode }) {
    const { r } = props
    const url = `https://doi.org/${r.doi}`
    const cut = r.apa7.lastIndexOf(url)
    const head = cut >= 0 ? r.apa7.slice(0, cut) : r.apa7
    return (
        <li id={props.anchorId} className="flex scroll-mt-20 gap-2 text-sm leading-relaxed">
            {props.badge}
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
function UnifiedRefItem(props: { r: { n: number; doi?: string; apa7?: string; title?: string; url?: string }; anchorId?: string; badge?: ReactNode }) {
    const { r } = props
    if (r.apa7) return <ReferenceItem r={{ n: r.n, doi: r.doi ?? '', apa7: r.apa7 }} anchorId={props.anchorId} badge={props.badge} />
    return (
        <li id={props.anchorId} className="flex scroll-mt-20 gap-2 text-sm leading-relaxed">
            {props.badge}
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
