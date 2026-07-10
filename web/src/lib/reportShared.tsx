// Shared constants + pure helpers used across the deep-research report/pipeline components. Extracted
// from App.tsx so each component is a discrete, prop-driven unit (pencil.dev-friendly) instead of an
// inline blob. No React state here — just data, formatters, and a couple of tiny render helpers.
import type { DeepReport, StageStatus } from '@/types/dda'

export const STATUS_VARIANT: Record<StageStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
    queued: 'default',
    in_progress: 'warning',
    done: 'success',
    exhausted: 'destructive',
}

export const STATUS_LABEL: Record<StageStatus, string> = {
    queued: '排队中',
    in_progress: '进行中',
    done: '完成',
    exhausted: '未通过',
}

export const STAGE_LABEL: Record<string, string> = {
    'disease-overview': '研究内容',
    'target-hypothesis': '1 · 靶点假设',
    'literature-evidence': '2 · 文献证据',
    'target-selection': '3 · 靶点选定',
    'target-validation': '4 · 靶点验证',
}

export const STAGE_DESC: Record<string, string> = {
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

export const MODALITY_LABEL: Record<string, string> = {
    small_molecule: '小分子',
    peptide: '多肽',
    antibody: '抗体',
}

export const KIND_LABEL: Record<string, string> = {
    genetic: '遗传',
    expression: '表达',
    network: '网络',
    literature: '文献',
    perturbation: '扰动',
    safety: '安全',
    pathway: '通路',
    animal_model: '动物模型',
}

export const SCORE_LABEL: Record<string, string> = {
    association: '关联度',
    tractability: '可成药性',
    constraint: '遗传约束',
    safety: '安全性',
}

export const stageLabel = (name: string) => STAGE_LABEL[name] ?? name

export function fmtDur(s?: number): string {
    if (!s || s <= 0) return '—'
    const m = Math.floor(s / 60)
    return m ? `${m}m${s % 60}s` : `${s}s`
}

// resolve a source string (doi/url) to its numbered reference — mirrors engine present.ts cite()
export function refNFor(source: string, references?: DeepReport['references']): number | undefined {
    if (!references) return undefined
    const s = String(source).toLowerCase()
    for (const r of references) {
        if (r.doi && s.includes(String(r.doi).toLowerCase())) return r.n
        if (r.url && (s.includes(r.url) || String(r.url).includes(s))) return r.n
    }
    return undefined
}

export const confVariant = (c?: string) =>
    (c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'default') as 'success' | 'warning' | 'default'

// ── database-record helpers ──
// Classify a database record by the KIND of biological evidence its source provides — the data types
// used in drug-target identification/validation (Open Targets evidence framework + omics). Deterministic
// by source host (+ claim text fallback). Colors are light-theme accent pairs.
export const DB_BIO_TYPES: { test: RegExp; label: string; bg: string; fg: string }[] = [
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
export function dbBioType(source?: string, claim?: string): { label: string; bg: string; fg: string } {
    const s = `${source ?? ''} ${claim ?? ''}`
    for (const t of DB_BIO_TYPES) if (t.test.test(s)) return t
    return { label: '数据库记录', bg: '#f1f5f9', fg: '#64748b' }
}

// Parse a database record's raw blob (`[tool] {json}` blocks joined by \n---\n) into structured rows,
// dropping GraphQL-error payloads and non-objects — i.e. the tabulatable data (ontology terms, dataset
// listings…). Records whose raw is prose/errors yield [] → the card falls back to quote/claim text.
export function parseRawBlocks(raw?: string): { tool: string; rows: Record<string, unknown>[] }[] {
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
export const stripHtml = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
// structured-tool block names — a record carrying one of these is a first-class API result; its source
// host's other (web-scraped) records are redundant once a tool covers it.
export const DB_TOOL_BLOCKS = new Set(['get_opentarget_targets', 'get_cellxgene_datasets', 'get_hca_projects', 'mcp__lit__ontology_lookup'])
export const DB_SKIP_COLS = new Set(['raw', 'content', 'data', 'type', 'text', 'is_error', 'tool_use_id', 'abstract', 'citation_count', 'authors', 'iri'])
export const DB_PREFER_COLS = ['id', 'label', 'name', 'definition', 'dataset_id', 'title', 'disease', 'organism', 'tissue', 'assay', 'year', 'venue', 'ontology']
export function dbColumns(rows: Record<string, unknown>[]): string[] {
    const all = new Set<string>()
    for (const o of rows) for (const k of Object.keys(o)) if (!DB_SKIP_COLS.has(k) && o[k] != null && o[k] !== '' && o[k] !== false) all.add(k)
    return [...DB_PREFER_COLS.filter(c => all.has(c)), ...[...all].filter(c => !DB_PREFER_COLS.includes(c))]
}
export function dbCell(v: unknown) {
    if (v == null) return ''
    if (Array.isArray(v)) return v.map(x => x && typeof x === 'object' ? String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).name ?? JSON.stringify(x)) : String(x)).join(', ')
    if (typeof v === 'object') return JSON.stringify(v)
    const s = String(v)
    if (/^https?:\/\//.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">{s}</a>
    return stripHtml(s)
}
/** Drop web-scraped database records whose source host is already covered by a first-class API tool
 * (redundant); keep tool records + any host without a tool. */
export function pruneDbFacts(facts: NonNullable<DeepReport['databaseFacts']>): NonNullable<DeepReport['databaseFacts']> {
    const host = (s?: string) => { try { return new URL(s || '').hostname.replace(/^www\./, '') } catch { return '' } }
    const isTool = (raw?: string) => parseRawBlocks(raw).some(b => DB_TOOL_BLOCKS.has(b.tool))
    const toolHosts = new Set(facts.filter(d => isTool(d.raw)).map(d => host(d.source)))
    return facts.filter(d => isTool(d.raw) || !toolHosts.has(host(d.source)))
}

export function fmtRaw(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
        return raw
    }
}
