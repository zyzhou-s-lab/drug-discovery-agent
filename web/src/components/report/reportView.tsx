// Deep-research report view + all its cards, extracted from the App.tsx monolith into discrete,
// prop-driven named components (pencil.dev-friendly). Behavior identical to the previous inline blocks;
// the two former inline IIFEs (文献 / 数据库数据) are now real <LiteratureCard> / <DatabaseCard>.
import { type ReactNode, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Markdown } from '@/components/Markdown'
import { ddaApi, doiRef } from '@/api/dda'
import {
    SCORE_LABEL, KIND_LABEL, MODALITY_LABEL, fmtDur, refNFor, confVariant,
    dbBioType, parseRawBlocks, dbColumns, dbCell, stripHtml, pruneDbFacts, fmtRaw,
} from '@/lib/reportShared'
import type { DeepFinding, DeepReport, Evidence, Reference, ReferencesResponse, TargetCandidate } from '@/types/dda'

export function ScoreBar(props: { label: string; value: number }) {
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

export function EvidenceChip(props: { ev: Evidence }) {
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
        <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" title={ev.detail || ev.source} className="hover:opacity-80">
            {body}
        </a>
    ) : (
        <span title={ev.detail || ev.source}>{body}</span>
    )
}

export function CandidateCard(props: { c: TargetCandidate }) {
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

// a [N] citation chip linking to the bibliography entry; falls back to a raw link when unresolved
export function CitationChip(props: { source: string; references?: DeepReport['references'] }) {
    const n = refNFor(props.source, props.references)
    if (n != null)
        return (
            <a href={`#dd-ref-${n}`} className="inline-flex items-center rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-link,#2563eb)] no-underline hover:underline">
                [{n}]
            </a>
        )
    return (
        <a href={props.source} target="_blank" rel="noreferrer" className="break-all font-mono text-[10px] text-[var(--app-link,#2563eb)] hover:underline">
            {props.source}
        </a>
    )
}

export function ApaText(props: { s: string }) {
    // the venue is the only *italicised* span in an APA7 string — split on '*' pairs
    return <>{props.s.split('*').map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}</>
}

export function ReferenceItem(props: { r: Reference; anchorId?: string; badge?: ReactNode }) {
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
                    <a href={url} target="_blank" rel="noreferrer" className="text-[var(--app-link,#2563eb)] hover:underline">{url}</a>
                )}
            </span>
        </li>
    )
}

// one entry of the unified reference list: paper → APA7 (ReferenceItem); database/web → title + link
export function UnifiedRefItem(props: { r: { n: number; doi?: string; apa7?: string; title?: string; url?: string }; anchorId?: string; badge?: ReactNode }) {
    const { r } = props
    if (r.apa7) return <ReferenceItem r={{ n: r.n, doi: r.doi ?? '', apa7: r.apa7 }} anchorId={props.anchorId} badge={props.badge} />
    return (
        <li id={props.anchorId} className="flex scroll-mt-20 gap-2 text-sm leading-relaxed">
            {props.badge}
            <span className="shrink-0 text-[var(--app-hint)]">{r.n}.</span>
            <span>
                {r.title ? r.title + ' ' : ''}
                {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="break-all text-[var(--app-link,#2563eb)] hover:underline">{r.url}</a>
                )}
            </span>
        </li>
    )
}

// canonical numbered bibliography from report.references, with #dd-ref-N anchors + verify status
export function ReportBibliography(props: { report: DeepReport }) {
    const refs = props.report.references ?? []
    // Only backs the narrative's <sup>N</sup> footnotes; without a narrative it's a redundant subset of
    // the 文献 card, so hide it. (When present() produced a narrative, keep it so anchors resolve.)
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

// campaign-level APA7 bibliography (fetched from the references endpoint)
export function Bibliography(props: { campaign: string }) {
    const [data, setData] = useState<ReferencesResponse | null>(null)
    useEffect(() => {
        let alive = true
        setData(null)
        ddaApi.references(props.campaign).then((d) => alive && setData(d)).catch(() => alive && setData(null))
        return () => { alive = false }
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

// one confirmed finding → header + citation chips + expandable evidence chain (quote/source/verdict)
export function FindingCard(props: { finding: DeepFinding; report: DeepReport; onJumpToAngle?: (angle: string) => void }) {
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
                <Badge variant="success" className="shrink-0">确认</Badge>
                <Badge variant={confVariant(f.confidence)} className="shrink-0">{f.confidence}</Badge>
                {f.angle && (
                    <button type="button" className="shrink-0" title="查看研究过程" onClick={() => props.onJumpToAngle?.(f.angle!)}>
                        <Badge variant="default" className="cursor-pointer hover:opacity-80">{f.angle} →</Badge>
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
                    <summary className="cursor-pointer text-[11px] text-[var(--app-hint)] hover:text-[var(--app-fg)]">证据链 ({facts.length})</summary>
                    <div className="mt-1.5 flex flex-col gap-1.5">
                        {facts.map((d, k) => (
                            <div key={k} className="rounded border border-[var(--app-border)] p-2 text-xs">
                                <div className="mb-1 flex items-center gap-1.5">
                                    <Badge variant={d.status === 'confirmed' ? 'success' : d.status === 'refuted' ? 'warning' : 'default'} className="text-[10px]">
                                        {d.status === 'confirmed' ? '已确认' : d.status === 'refuted' ? '已否决' : '未核验'}
                                    </Badge>
                                    {d.quality && (
                                        <span className="rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">{d.quality}</span>
                                    )}
                                    {d.doi && (
                                        <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer" className="truncate text-[var(--app-link,#2563eb)] hover:underline">doi:{d.doi}</a>
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

// run statistics (agents / tokens / elapsed / pipeline counts)
export function StudyOverviewCard(props: { report: DeepReport }) {
    const r = props.report, st = r.stats
    const metaItems: [string, string | number | undefined][] = st
        ? [
              ['子智能体', st.agentCalls], ['消耗 token', r.budget?.spent_tokens?.toLocaleString()], ['耗时', fmtDur(st.elapsedSec)],
              ['研究角度', st.angles], ['来源', st.sources], ['抽取声明', st.claims], ['进入核验', st.verified],
              ['确认', st.confirmed], ['否决', st.killed], ['最终发现', st.afterSynthesis],
          ]
        : []
    const items = metaItems.filter(([, v]) => v != null && v !== '')
    if (items.length === 0) return null
    return (
        <Card className="p-4">
            <div className="mb-2 text-sm font-medium">研究概览</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                {items.map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 border-b border-[var(--app-border)] pb-1">
                        <span className="text-[var(--app-hint)]">{k}</span>
                        <span className="font-medium tabular-nums">{v}</span>
                    </div>
                ))}
            </div>
        </Card>
    )
}

// polished narrative (Markdown) when present, else the structured 研究报告 fallback (findings by angle)
export function ResearchReportCard(props: { report: DeepReport }) {
    const r = props.report
    if (r.narrative) return <Card className="p-5"><Markdown text={r.narrative} linkCitations /></Card>
    if (!((r.findings?.length ?? 0) > 0 || r.summary || r.caveats || (r.openQuestions?.length ?? 0) > 0)) return null
    const groups: { angle: string; items: NonNullable<DeepReport['findings']> }[] = []
    for (const f of r.findings ?? []) {
        const a = f.angle || '未分类'
        const g = groups.find((x) => x.angle === a)
        if (g) g.items.push(f)
        else groups.push({ angle: a, items: [f] })
    }
    return (
        <Card className="flex flex-col gap-3 p-5">
            {(r.findings?.length ?? 0) > 0 ? (
                <div className="flex flex-col gap-3">
                    <div className="text-sm font-medium">研究报告</div>
                    {groups.map((g, gi) => (
                        <div key={gi}>
                            <div className="mb-1 text-sm font-medium">{gi + 1}. {g.angle}</div>
                            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                                {g.items.map((f, i) => (
                                    <li key={i}>
                                        <span className="text-[var(--app-hint)]">[{f.confidence}]</span> {f.claim}
                                        {f.evidence ? <span className="text-[var(--app-hint)]"> — {f.evidence}</span> : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            ) : r.summary ? (
                <div><div className="mb-1 text-sm font-medium">研究报告</div><Markdown text={r.summary} /></div>
            ) : null}
            {r.caveats && <div><div className="mb-1 text-sm font-medium">注意事项</div><Markdown text={r.caveats} /></div>}
            {(r.openQuestions?.length ?? 0) > 0 && (
                <div>
                    <div className="mb-1 text-sm font-medium">开放问题</div>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{r.openQuestions!.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </div>
            )}
        </Card>
    )
}

// one paper per card + our verify status (confirmed → refuted → uncited)
export function LiteratureCard(props: { literature?: DeepReport['literature'] }) {
    const literature = props.literature
    if (!literature || literature.length === 0) return null
    const order: Record<string, number> = { confirmed: 0, refuted: 1, uncited: 2 }
    const lit = [...literature].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
    const nC = lit.filter((l) => l.status === 'confirmed').length
    const nR = lit.filter((l) => l.status === 'refuted').length
    const nU = lit.filter((l) => l.status === 'uncited').length
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
}

// database/portal records: biological-type badge + structured table (Open Targets style) or prose
export function DatabaseCard(props: { facts?: DeepReport['databaseFacts'] }) {
    const dbFacts = pruneDbFacts(props.facts ?? [])
    if (dbFacts.length === 0) return null
    return (
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
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--app-subtle-bg)] text-[10px] font-medium text-[var(--app-hint)]">{i + 1}</span>
                                    <span style={{ background: bt.bg, color: bt.fg }} className="rounded-full px-2 py-0.5 text-[10px] font-medium">{bt.label}</span>
                                    {d.quality && <span className="rounded-full bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] text-[var(--app-hint)]">{d.quality}</span>}
                                </div>
                                <div className="flex items-center gap-2 truncate text-[11px]">
                                    {d.doi ? (
                                        <a href={`https://doi.org/${d.doi}`} target="_blank" rel="noreferrer" className="truncate text-[var(--app-link,#2563eb)] hover:underline">doi:{d.doi}</a>
                                    ) : d.source ? (
                                        <a href={d.source} target="_blank" rel="noreferrer" className="truncate text-[var(--app-link,#2563eb)] hover:underline">{d.source}</a>
                                    ) : null}
                                </div>
                            </div>
                            {(() => {
                                // only blocks that actually yield columns are renderable as tables; a [Bash] HTML dump
                                // under a `data` key yields none → fall through to quote/claim so the card is never blank.
                                const blocks = parseRawBlocks(d.raw).map((b) => ({ ...b, cols: dbColumns(b.rows) })).filter((b) => b.cols.length > 0)
                                if (blocks.length > 0) {
                                    return blocks.map((b, bi) => (
                                        <div key={bi} className={bi > 0 ? 'mt-2' : ''}>
                                            <div className="overflow-x-auto rounded-md border border-[var(--app-border)]">
                                                <table className="w-full text-xs">
                                                    <thead>
                                                        <tr className="border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-left text-[var(--app-hint)]">
                                                            {b.cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {b.rows.slice(0, 30).map((o, ri) => (
                                                            <tr key={ri} className="border-b border-[var(--app-border)] align-top last:border-0">
                                                                {b.cols.map((c) => <td key={c} className="px-2 py-1">{dbCell(o[c])}</td>)}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            {b.rows.length > 30 && <div className="mt-1 text-[10px] text-[var(--app-hint)]">…共 {b.rows.length} 行,仅显示前 30</div>}
                                        </div>
                                    ))
                                }
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
    )
}

// confirmed findings (expandable evidence chain) + refuted claims
export function ClaimSection(props: { report: DeepReport; onJumpToAngle?: (angle: string) => void }) {
    const r = props.report
    if (!((r.findings?.length ?? 0) > 0 || (r.refuted?.length ?? 0) > 0)) return null
    return (
        <Card className="p-4">
            <div className="mb-2 text-sm font-medium">
                Claim <span className="text-xs font-normal text-[var(--app-hint)]">(确认 {r.findings?.length ?? 0}, 否决 {r.refuted?.length ?? 0})</span>
            </div>
            <ul className="flex flex-col gap-2">
                {(r.findings ?? []).map((f, i) => (
                    <FindingCard key={`c${i}`} finding={f} report={r} onJumpToAngle={props.onJumpToAngle} />
                ))}
                {(r.refuted ?? []).map((c, i) => (
                    <li key={`r${i}`} className="rounded-lg border border-[var(--app-border)] p-2.5 opacity-70">
                        <div className="flex items-start gap-2">
                            <Badge variant="warning" className="shrink-0">否决</Badge>
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
    )
}

// top-level report view: composes the cards above
export function DeepReportView(props: { report: DeepReport; onJumpToAngle?: (angle: string) => void }) {
    const r = props.report
    return (
        <div className="flex flex-col gap-4">
            <StudyOverviewCard report={r} />
            <ResearchReportCard report={r} />
            <LiteratureCard literature={r.literature} />
            <DatabaseCard facts={r.databaseFacts} />
            <ClaimSection report={r} onJumpToAngle={props.onJumpToAngle} />
            <ReportBibliography report={r} />
        </div>
    )
}
