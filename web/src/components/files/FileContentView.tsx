// Structured renderer for the Files view (plan P1): instead of raw JSON, render each deepresearch/
// step and assets/ file by its shape — scope angles, search results, fetch claims, 3-vote verify,
// per-angle findings + merge, and the assets contracts. Anything unmapped (or invalid JSON) falls
// back to a generic recursive view, and a 原始 JSON toggle always shows the raw text.
import { type ReactElement, type ReactNode, useMemo, useState } from 'react'

import { CodeBlock } from '@/components/CodeBlock'
import { Badge } from '@/components/ui/badge'

const ENVELOPE = new Set(['campaign', 'step', 'key']) // self-describing noise — hide from people

const isUrl = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\//.test(s)
function tryParse(s: string): any | undefined {
    const t = s.trim()
    if (!(t.startsWith('{') || t.startsWith('['))) return undefined
    try {
        return JSON.parse(t)
    } catch {
        return undefined
    }
}

// ---- shared primitives ----
const BOX = 'rounded-lg border border-[var(--app-border)] p-3'
const MUTED = 'text-[var(--app-hint)]'

function LinkOut({ url, doi, label }: { url?: string; doi?: string; label?: string }) {
    const href = url || (doi ? `https://doi.org/${doi}` : undefined)
    const text = label || doi || url || ''
    if (!href) return text ? <span className="break-words">{text}</span> : null
    return (
        <a href={href} target="_blank" rel="noreferrer" className="break-words text-[var(--app-link,#2563eb)] hover:underline">
            {text}
        </a>
    )
}

function Pill({ children, variant }: { children: ReactNode; variant?: 'default' | 'success' | 'destructive' }) {
    return (
        <Badge variant={variant} className="text-[10px] font-normal">
            {children}
        </Badge>
    )
}

function enumPill(value: string | undefined, good?: string[], bad?: string[]) {
    if (!value) return null
    const v: 'default' | 'success' | 'destructive' = good?.includes(value) ? 'success' : bad?.includes(value) ? 'destructive' : 'default'
    return <Pill variant={v}>{value}</Pill>
}

function Quote({ text }: { text: string }) {
    if (!text) return null
    return <div className={`mt-1 border-l-2 border-[var(--app-border)] pl-2 text-xs italic ${MUTED}`}>{text}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <div className={`text-xs font-medium ${MUTED}`}>{label}</div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-sm">{children}</div>
        </div>
    )
}

function Count({ n, unit }: { n: number; unit: string }) {
    return <div className={`text-xs ${MUTED}`}>{n} {unit}</div>
}

// ---- per-type renderers ----
function ScopeView({ d }: { d: any }) {
    const angles: any[] = d.angles ?? []
    return (
        <div className="flex flex-col gap-3">
            {d.question && <Field label="研究问题">{d.question}</Field>}
            <Count n={d.count ?? angles.length} unit="个研究角度" />
            <ol className="flex flex-col gap-2">
                {angles.map((a, i) => (
                    <li key={i} className={BOX}>
                        <div className="text-sm font-medium">{i + 1}. {a.label}</div>
                        {a.query && <div className={`mt-1 text-xs ${MUTED}`}>{a.query}</div>}
                        {a.rationale && <div className="mt-1 text-xs">{a.rationale}</div>}
                    </li>
                ))}
            </ol>
        </div>
    )
}

function SearchView({ d }: { d: any }) {
    const results: any[] = d.results ?? []
    return (
        <div className="flex flex-col gap-3">
            {d.angle && <Field label="角度">{d.angle}</Field>}
            {d.query && <div className={`text-xs ${MUTED}`}>{d.query}</div>}
            <Count n={d.count ?? results.length} unit="条结果" />
            <ul className="flex flex-col gap-2">
                {results.map((r, i) => (
                    <li key={i} className={BOX}>
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            {enumPill(r.source_type)}
                            {enumPill(r.relevance, ['high'])}
                        </div>
                        <div className="text-sm font-medium"><LinkOut url={r.url} doi={r.doi} label={r.title} /></div>
                        {r.snippet && <div className={`mt-1 text-xs ${MUTED}`}>{r.snippet}</div>}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function FetchView({ d }: { d: any }) {
    const claims: any[] = d.claims ?? []
    return (
        <div className="flex flex-col gap-3">
            <div className={BOX}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    {enumPill(d.source_type)}
                    {enumPill(d.sourceQuality, ['primary'], ['unreliable'])}
                    {d.angle && <span className={`text-xs ${MUTED}`}>{d.angle}</span>}
                </div>
                <div className="text-sm font-medium"><LinkOut url={d.url} doi={d.doi} label={d.title} /></div>
            </div>
            <Count n={claims.length} unit="条论断" />
            <ul className="flex flex-col gap-2">
                {claims.map((c, i) => (
                    <li key={i} className={BOX}>
                        <div className="flex items-start justify-between gap-2">
                            <div className="text-sm">{c.claim}</div>
                            {enumPill(c.importance, ['central'])}
                        </div>
                        {c.quote && <Quote text={c.quote} />}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function VerifyView({ d }: { d: any }) {
    const verdicts: any[] = d.verdicts ?? []
    return (
        <div className="flex flex-col gap-3">
            <div className={BOX}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Pill variant={d.survives ? 'success' : 'destructive'}>{d.survives ? '✓ 通过' : '✗ 否决'}</Pill>
                    {d.vote && <span className={`text-xs ${MUTED}`}>投票 {d.vote}</span>}
                </div>
                <div className="text-sm">{d.claim}</div>
                {d.quote && <Quote text={d.quote} />}
                {d.source && <div className="mt-1 text-xs"><LinkOut url={d.source} doi={d.doi} /></div>}
            </div>
            <Count n={verdicts.length} unit="票" />
            <ul className="flex flex-col gap-2">
                {verdicts.map((v, i) => (
                    <li key={i} className={BOX}>
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            <Pill variant={v.refuted ? 'destructive' : 'success'}>{v.refuted ? '否决' : '支持'}</Pill>
                            {enumPill(v.confidence, ['high'], ['low'])}
                        </div>
                        {v.evidence && <div className="text-xs">{v.evidence}</div>}
                        {v.counterSource && <div className="mt-1 text-xs"><LinkOut url={v.counterSource} label={v.counterSource} /></div>}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function FindingCard({ f }: { f: any }) {
    return (
        <div className={BOX}>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {f.angle && <span className={`text-xs ${MUTED}`}>{f.angle}</span>}
                {enumPill(f.confidence, ['high'], ['low'])}
            </div>
            <div className="text-sm font-medium">{f.claim}</div>
            {f.evidence && <div className="mt-1.5 whitespace-pre-wrap text-xs">{f.evidence}</div>}
            {Array.isArray(f.sources) && f.sources.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                    {f.sources.map((s: string, i: number) => (
                        <li key={i} className="text-xs"><LinkOut url={s} label={s} /></li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function SynthesizeView({ d }: { d: any }) {
    // merge.json carries summary/caveats/openQuestions; a per-angle file is a single finding
    if (d.summary != null || d.caveats != null || d.openQuestions != null) {
        const oq: any[] = d.openQuestions ?? []
        return (
            <div className="flex flex-col gap-3">
                {d.summary && <Field label="综合">{d.summary}</Field>}
                {d.caveats && <Field label="注意事项">{d.caveats}</Field>}
                {oq.length > 0 && (
                    <div>
                        <div className={`text-xs font-medium ${MUTED}`}>待解问题</div>
                        <ul className="mt-0.5 list-disc pl-5 text-sm">{oq.map((q, i) => <li key={i}>{q}</li>)}</ul>
                    </div>
                )}
            </div>
        )
    }
    return <FindingCard f={d} />
}

// ---- assets/ ----
function SourcesView({ d }: { d: any }) {
    const sources: any[] = d.sources ?? []
    const refs: any[] = d.references ?? []
    return (
        <div className="flex flex-col gap-3">
            {d.question && <Field label="研究问题">{d.question}</Field>}
            <Count n={sources.length} unit="个来源" />
            <ul className="flex flex-col gap-1">
                {sources.map((s, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                        {enumPill(s.quality, ['primary'], ['unreliable'])}
                        {s.angle && <span className={MUTED}>{s.angle}</span>}
                        <LinkOut url={s.url} />
                        {typeof s.claimCount === 'number' && <span className={MUTED}>· {s.claimCount} claims</span>}
                    </li>
                ))}
            </ul>
            {refs.length > 0 && (
                <div>
                    <div className={`mb-1 text-xs font-medium ${MUTED}`}>参考文献</div>
                    <ol className="flex flex-col gap-1">
                        {refs.map((r, i) => (
                            <li key={i} className="text-xs">
                                <span className={MUTED}>[{r.n ?? i + 1}]</span>{' '}
                                {r.apa7 ? <span className="break-words">{r.apa7}</span> : <LinkOut url={r.url} doi={r.doi} label={r.title} />}
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    )
}

function FactsView({ d }: { d: any }) {
    const facts: any[] = d.facts ?? []
    return (
        <div className="flex flex-col gap-3">
            <Count n={facts.length} unit="条数据库记录" />
            <ul className="flex flex-col gap-2">
                {facts.map((f, i) => (
                    <li key={i} className={BOX}>
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            {enumPill(f.status, ['confirmed'], ['refuted'])}
                            <LinkOut url={f.source} doi={f.doi} />
                        </div>
                        <div className="text-sm">{f.claim}</div>
                        {f.quote && <Quote text={f.quote} />}
                        {f.raw && (
                            <details className="mt-1">
                                <summary className={`cursor-pointer text-xs ${MUTED}`}>原始记录</summary>
                                <div className="mt-1"><GenericJson value={tryParse(f.raw) ?? f.raw} /></div>
                            </details>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function VerifiedView({ d }: { d: any }) {
    const confirmed: any[] = d.confirmed ?? []
    const refuted: any[] = d.refuted ?? []
    const Section = ({ title, items, variant }: { title: string; items: any[]; variant: 'success' | 'destructive' }) =>
        items.length === 0 ? null : (
            <div>
                <div className="mb-1 flex items-center gap-2"><Pill variant={variant}>{title}</Pill><span className={`text-xs ${MUTED}`}>{items.length}</span></div>
                <ul className="flex flex-col gap-2">
                    {items.map((c, i) => (
                        <li key={i} className={BOX}>
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">{c.vote && <span className={`text-xs ${MUTED}`}>投票 {c.vote}</span>}<LinkOut url={c.source} /></div>
                            <div className="text-sm">{c.claim}</div>
                            {c.quote && <Quote text={c.quote} />}
                        </li>
                    ))}
                </ul>
            </div>
        )
    return (
        <div className="flex flex-col gap-3">
            <Section title="✓ 确认" items={confirmed} variant="success" />
            <Section title="✗ 否决" items={refuted} variant="destructive" />
        </div>
    )
}

function FindingsView({ d }: { d: any }) {
    const findings: any[] = d.findings ?? []
    return (
        <div className="flex flex-col gap-3">
            <Count n={findings.length} unit="条发现" />
            <div className="flex flex-col gap-2">{findings.map((f, i) => <FindingCard key={i} f={f} />)}</div>
        </div>
    )
}

// ---- generic recursive fallback ----
function GenericJson({ value }: { value: any }): ReactElement {
    if (value === null || value === undefined) return <span className={MUTED}>—</span>
    if (typeof value === 'string') {
        if (isUrl(value)) return <LinkOut url={value} label={value} />
        const j = tryParse(value)
        if (j) return <GenericJson value={j} />
        return <span className="whitespace-pre-wrap break-words">{value}</span>
    }
    if (typeof value !== 'object') return <span>{String(value)}</span>
    if (Array.isArray(value)) {
        if (value.length === 0) return <span className={MUTED}>[]</span>
        return (
            <ul className="flex flex-col gap-1">
                {value.map((v, i) => (
                    <li key={i} className="rounded border border-[var(--app-border)] p-2"><GenericJson value={v} /></li>
                ))}
            </ul>
        )
    }
    const entries = Object.entries(value).filter(([k]) => !ENVELOPE.has(k))
    return (
        <div className="flex flex-col gap-1.5">
            {entries.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7rem_1fr] gap-2">
                    <span className={`text-xs font-medium ${MUTED}`}>{k}</span>
                    <div className="min-w-0 text-sm"><GenericJson value={v} /></div>
                </div>
            ))}
        </div>
    )
}

// ---- dispatch ----
function pickRenderer(path: string): ((d: any) => ReactNode) | null {
    const p = path.replace(/\\/g, '/')
    if (p.includes('/deepresearch/01_scope/')) return (d) => <ScopeView d={d} />
    if (p.includes('/deepresearch/02_search/')) return (d) => <SearchView d={d} />
    if (p.includes('/deepresearch/03_fetch/')) return (d) => <FetchView d={d} />
    if (p.includes('/deepresearch/04_verify/')) return (d) => <VerifyView d={d} />
    if (p.includes('/deepresearch/05_synthesize/')) return (d) => <SynthesizeView d={d} />
    if (p.endsWith('assets/sources.json')) return (d) => <SourcesView d={d} />
    if (p.endsWith('assets/database_facts.json')) return (d) => <FactsView d={d} />
    if (p.endsWith('assets/verified.json')) return (d) => <VerifiedView d={d} />
    if (p.endsWith('assets/findings.json')) return (d) => <FindingsView d={d} />
    return null
}

export function FileContentView({ path, content }: { path: string; content: string }) {
    const [raw, setRaw] = useState(false)
    const parsed = useMemo(() => (path.endsWith('.json') ? tryParse(content) : undefined), [path, content])
    const renderer = parsed !== undefined ? pickRenderer(path) : null
    // any valid JSON can at least use the generic view; .jsonl / non-JSON go straight to raw
    const structured = parsed !== undefined
    const body = !structured || raw
        ? <CodeBlock code={content || '…'} language={path.endsWith('.json') || path.endsWith('.jsonl') ? 'json' : 'text'} maxHeight={100000} scrollY />
        : renderer
            ? renderer(parsed)
            : <GenericJson value={parsed} />

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <div className={`truncate font-mono text-xs ${MUTED}`}>{path}</div>
                {structured && (
                    <button
                        type="button"
                        onClick={() => setRaw((r) => !r)}
                        className={`shrink-0 rounded border border-[var(--app-border)] px-2 py-0.5 text-xs ${MUTED} hover:bg-[var(--app-subtle-bg)]`}
                    >
                        {raw ? '格式化' : '原始 JSON'}
                    </button>
                )}
            </div>
            {body}
        </div>
    )
}
