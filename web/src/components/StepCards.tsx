import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CodeBlock } from '@/components/CodeBlock'
import type { StepEvent } from '@/types/dda'

// HAPI-style step cards, driven by the captured Agent SDK event stream
// (events.py). Each scatter angle = one boxed sub-session, rendered as its own
// collapsible "session card" (status + counts + elapsed + turns), mirroring how
// HAPI shows each agent session. We replicate HAPI's ToolCard/reasoning *design*;
// our events are already normalized so the chat-reducer's job is done server-side.

const ANGLE_LABEL: Record<string, string> = {
    genetic: '遗传',
    expression: '表达',
    network: '网络',
    literature: '文献',
    perturbation: '扰动',
    safety: '安全',
    selection: '选定',
    main: '主',
}

const TOOL_LABEL: Record<string, string> = {
    search_disease: '检索疾病',
    disease_associated_targets: '查关联靶点',
    search_literature: '检索文献',
    target_profile: '靶点画像',
    submit_result: '提交结果',
}

const ORANGE = 'var(--app-git-unstaged-color, #FF9500)'
const GREEN = 'var(--app-git-staged-color, #34C759)'
const RED = 'var(--app-badge-error-text)'

function splitTool(name: string): { server: string | null; tool: string } {
    const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/)
    if (m) return { server: m[1], tool: m[2] }
    return { server: null, tool: name }
}

function snakeToTitle(v: string): string {
    return v.split('_').filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ')
}

// HAPI's getInputStringAny: first non-empty string/number among the given keys.
function inputStr(input: unknown, keys: string[]): string | null {
    if (!input || typeof input !== 'object') return null
    const obj = input as Record<string, unknown>
    for (const k of keys) {
        const v = obj[k]
        if (typeof v === 'string' && v.trim()) return v
        if (typeof v === 'number') return String(v)
    }
    return null
}

// per-tool icons (inline SVG, mirrors HAPI's knownTools icon slot)
const SvgSearch = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
)
const SvgTarget = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
)
const SvgCheckSq = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
)
const SvgWrench = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 18l3 3 6.5-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.3-2.3 2.5-2.5z" /></svg>
)

const TOOL_ICON: Record<string, () => ReactNode> = {
    search_disease: SvgSearch,
    search_literature: SvgSearch,
    disease_associated_targets: SvgTarget,
    target_profile: SvgTarget,
    submit_result: SvgCheckSq,
}

// dda equivalent of HAPI's getToolPresentation: {icon, title, subtitle}
function presentation(name: string, input: unknown): { icon: ReactNode; title: string; subtitle: string | null } {
    const { tool } = splitTool(name)
    const arg = inputStr(input, ['name', 'symbol', 'query', 'sort_by', 'efo_id', 'pattern', 'command', 'disease', 'summary'])
    const Icon = TOOL_ICON[tool] ?? SvgWrench
    return {
        icon: <Icon />,
        title: TOOL_LABEL[tool] ?? snakeToTitle(tool),
        subtitle: arg ? `${tool} · ${arg}` : tool,
    }
}

// tool grouping (HAPI chat/toolGroups): consecutive same-kind calls collapse into a group
const TOOL_KIND: Record<string, string> = {
    search_disease: 'opentargets',
    disease_associated_targets: 'opentargets',
    target_profile: 'opentargets',
    search_literature: 'literature',
    submit_result: 'submit',
}
const KIND_TITLE: Record<string, string> = {
    opentargets: '查 OpenTargets',
    literature: '检索文献',
    submit: '提交结果',
}
function toolKind(name: string): string {
    const { server, tool } = splitTool(name)
    return TOOL_KIND[tool] ?? server ?? 'tool'
}

function toText(content: unknown): string {
    if (content == null) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
            .filter(Boolean)
            .join('\n')
    }
    try {
        return JSON.stringify(content, null, 2)
    } catch {
        return String(content)
    }
}

function looksJson(s: string): boolean {
    const t = s.trim()
    return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function fmtElapsed(s: number): string {
    if (s <= 0) return ''
    if (s < 1) return '<1s'
    if (s < 60) return `${Math.round(s)}s`
    const m = Math.floor(s / 60)
    return `${m}m${Math.round(s % 60)}s`
}

type ToolItem = { use: StepEvent; result?: StepEvent }

// HAPI ToolStatusIcon: circle-check (completed) / circle-x (error) / spinner (running)
const STATUS_COLOR: Record<'completed' | 'error' | 'running', string> = {
    completed: 'text-emerald-600',
    error: 'text-red-600',
    running: 'text-amber-500',
}
function ToolStatusIcon(props: { state: 'completed' | 'error' | 'running' }) {
    const cls = `h-3.5 w-3.5 shrink-0 ${STATUS_COLOR[props.state]}`
    if (props.state === 'completed')
        return (
            <svg className={cls} viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        )
    if (props.state === 'error')
        return (
            <svg className={cls} viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    return (
        <svg className={`${cls} animate-spin`} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
        </svg>
    )
}
function SummaryBadge(props: { className: string; text: string }) {
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${props.className}`}>{props.text}</span>
}
function GroupChevron(props: { open: boolean }) {
    return (
        <svg className={`h-4 w-4 shrink-0 text-[var(--app-hint)] transition-transform duration-200 ${props.open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function Reasoning(props: { ev: StepEvent }) {
    const [open, setOpen] = useState(false)
    const text = props.ev.text ?? ''
    const firstLine = text.replace(/\s+/g, ' ').slice(0, 120)
    return (
        <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]"
        >
            <span className="flex items-center gap-1.5">
                <span>{open ? '▾' : '▸'}</span>
                <span className="font-medium">思考</span>
                {!open && <span className="truncate italic opacity-80">{firstLine}…</span>}
            </span>
            {open && <p className="whitespace-pre-wrap pl-4 italic leading-relaxed">{text}</p>}
        </button>
    )
}

function ToolCall(props: { item: ToolItem }) {
    const { use, result } = props.item
    const [open, setOpen] = useState(false)
    const pres = useMemo(() => presentation(use.name ?? '', use.input), [use.name, use.input])
    const inputJson = useMemo(
        () => (use.input == null ? '' : typeof use.input === 'string' ? use.input : JSON.stringify(use.input, null, 2)),
        [use.input]
    )
    const resultStr = result ? toText(result.content) : ''
    const isError = result?.is_error
    const iconState: 'completed' | 'error' | 'running' = !result ? 'running' : isError ? 'error' : 'completed'

    return (
        // click the whole card -> modal with full params/result (HAPI ToolCard pattern)
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-[16px] border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-left transition-colors hover:bg-[var(--app-subtle-bg)]">
                    <ToolStatusIcon state={iconState} />
                    <span className="shrink-0 text-[var(--app-tool-card-accent,var(--app-hint))]">{pres.icon}</span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{pres.title}</span>
                        {pres.subtitle && (
                            <span className="block truncate font-mono text-xs text-[var(--app-tool-card-subtitle,var(--app-hint))]">
                                {pres.subtitle}
                            </span>
                        )}
                    </span>
                    <span className="shrink-0 text-[var(--app-hint)]" aria-hidden>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M15 3h6v6M21 3l-8 8M9 21H3v-6M3 21l8-8" />
                        </svg>
                    </span>
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{pres.title}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[70vh] space-y-3 overflow-y-auto">
                    {pres.subtitle && (
                        <div className="font-mono text-xs text-[var(--app-tool-card-subtitle,var(--app-hint))]">{pres.subtitle}</div>
                    )}
                    {inputJson && (
                        <div>
                            <div className="mb-1 text-xs text-[var(--app-hint)]">参数</div>
                            <CodeBlock code={inputJson} language="json" maxHeight={300} scrollY />
                        </div>
                    )}
                    {result && (
                        <div>
                            <div className="mb-1 text-xs" style={{ color: isError ? RED : 'var(--app-hint)' }}>
                                {isError ? '错误' : '结果'}
                            </div>
                            <CodeBlock code={resultStr || '(空)'} language={looksJson(resultStr) ? 'json' : 'text'} maxHeight={400} scrollY />
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function ToolGroup(props: { kind: string; items: ToolItem[] }) {
    const [open, setOpen] = useState(false)
    const { items } = props
    const n = items.length
    const anyError = items.some((it) => it.result?.is_error)
    const allDone = items.every((it) => it.result)
    const title = KIND_TITLE[props.kind] ?? snakeToTitle(props.kind)
    // same grey frame (p-2, no border) as a single tool call; the header is a
    // white inner card identical in border/radius/inset to a ToolCall so the
    // collapsed group bar lines up exactly with single-tool cards.
    return (
        <div
            className={
                'rounded-[20px] bg-[var(--app-tool-group-bg,var(--app-subtle-bg))] p-2 ' +
                // when expanded, an enclosing border wraps the child tool cards;
                // collapsed it's just the white header card (aligned with single tools)
                (open ? 'border border-[var(--app-tool-card-border,var(--app-border))]' : '')
            }
        >
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2 rounded-[16px] border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-left transition-colors hover:bg-[var(--app-subtle-bg)]"
            >
                <GroupChevron open={open} />
                <span className="shrink-0 text-[var(--app-tool-card-accent,var(--app-hint))]">
                    <SvgWrench />
                </span>
                <span className="truncate text-sm font-medium">{title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {anyError ? (
                        <SummaryBadge className="bg-red-500/10 text-red-600" text="有错误" />
                    ) : allDone ? null : (
                        <SummaryBadge className="bg-amber-500/10 text-amber-700" text="运行中" />
                    )}
                    <SummaryBadge className="bg-[var(--app-subtle-bg)] text-[var(--app-hint)]" text={`${n} 个操作`} />
                </span>
            </button>
            {open && (
                <div className="flex flex-col gap-2 pt-2">
                    {items.map((it) => (
                        <ToolCall key={it.use.seq} item={it} />
                    ))}
                </div>
            )}
        </div>
    )
}

function timelineNodes(events: StepEvent[]): ReactNode[] {
    const results = new Map<string, StepEvent>()
    for (const e of events) if (e.type === 'tool_result' && e.tool_id) results.set(e.tool_id, e)

    // linearize to thinking / text / tool items
    type Item =
        | { kind: 'thinking' | 'text'; ev: StepEvent }
        | { kind: 'tool'; tool: ToolItem }
    const items: Item[] = []
    for (const e of events) {
        if (e.type === 'thinking') items.push({ kind: 'thinking', ev: e })
        else if (e.type === 'text' && e.text?.trim()) items.push({ kind: 'text', ev: e })
        else if (e.type === 'tool_use')
            items.push({ kind: 'tool', tool: { use: e, result: e.tool_id ? results.get(e.tool_id) : undefined } })
        // session_start / result / tool_result(已并入) 不单独渲染
    }

    // group consecutive same-kind tool calls (>=2) into a ToolGroup (HAPI rule)
    const nodes: ReactNode[] = []
    let i = 0
    while (i < items.length) {
        const it = items[i]
        if (it.kind === 'tool') {
            const k = toolKind(it.tool.use.name ?? '')
            const run: ToolItem[] = []
            while (i < items.length) {
                const cur = items[i]
                if (cur.kind !== 'tool') break
                if (toolKind(cur.tool.use.name ?? '') !== k) break
                run.push(cur.tool)
                i += 1
            }
            if (run.length >= 2) nodes.push(<ToolGroup key={`g-${run[0].use.seq}`} kind={k} items={run} />)
            else
                // single tool call: wrap in the same grey frame as a group so it
                // reads as a card (grey frame + white interior), like TaskUpdate
                nodes.push(
                    <div key={run[0].use.seq} className="rounded-[20px] bg-[var(--app-tool-group-bg,var(--app-subtle-bg))] p-2">
                        <ToolCall item={run[0]} />
                    </div>
                )
        } else if (it.kind === 'thinking') {
            nodes.push(<Reasoning key={it.ev.seq} ev={it.ev} />)
            i += 1
        } else {
            nodes.push(
                <p key={it.ev.seq} className="whitespace-pre-wrap px-2 text-sm">
                    {it.ev.text}
                </p>
            )
            i += 1
        }
    }
    return nodes
}

function SessionCard(props: { label: string; events: StepEvent[]; terminal?: boolean }) {
    const evs = props.events
    // 429/socket retries emit several result events per agent; the LAST is authoritative (an early
    // failed attempt must NOT make a since-recovered agent show as errored). Tokens sum across attempts.
    const resultEvents = evs.filter((e) => e.type === 'result')
    const result = resultEvents[resultEvents.length - 1]
    const retries = Math.max(0, resultEvents.length - 1)
    // an agent with no result event is only "running" while the run is live; once the run is
    // terminal (done/stopped/error) such a session was interrupted, not still running.
    const [open, setOpen] = useState(false)            // #3: collapsed by default
    // an agent "succeeded" if it landed its submit_* call (tool_result = "recorded") OR its last result
    // is clean — even if a ResultMessage is_error (it then hit max_turns / a retried 429).
    const submitIds = new Set(
        evs.filter((e) => e.type === 'tool_use' && (e.name ?? '').includes('submit_')).map((e) => e.tool_id)
    )
    const submitOk = evs.some((e) => e.type === 'tool_result' && e.tool_id != null && submitIds.has(e.tool_id) && !e.is_error)
    const succeeded = submitOk || (Boolean(result) && !result?.is_error)
    const live = !props.terminal
    // a failed result WHILE the run is still live is most likely a mid-retry (run_agent re-attempts
    // transient 429/socket) — keep it "running"; only finalize as 错误 once the whole run is terminal.
    const isError = !succeeded && Boolean(result?.is_error) && !live
    const interrupted = !succeeded && !result && !live
    const running = !succeeded && !isError && !interrupted
    const retrying = running && Boolean(result?.is_error)
    const start = evs[0]?.ts ?? 0
    const end = result?.ts ?? evs[evs.length - 1]?.ts ?? start
    const toolCount = evs.filter((e) => e.type === 'tool_use').length
    const thinkCount = evs.filter((e) => e.type === 'thinking').length
    // #4: live timer — re-render every second while the session is still running
    const [now, setNow] = useState(() => Date.now() / 1000)
    useEffect(() => {
        if (!running) return
        const id = setInterval(() => setNow(Date.now() / 1000), 1000)
        return () => clearInterval(id)
    }, [running])
    const elapsed = fmtElapsed((running ? now : end) - start)
    const dotColor = running ? ORANGE : isError ? RED : GREEN
    const angle = ANGLE_LABEL[props.label] ?? props.label
    const promptText = (evs.find((e) => e.type === 'session_start')?.prompt ?? '').trim()
    const outcome = (result?.result ?? '').trim()
    const tokens = resultEvents.reduce((n, e) => n + (e.tokens ?? 0), 0) || undefined

    return (
        <Card id={`dd-session-${props.label}`} className="overflow-hidden scroll-mt-4">
            <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                    {running && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                              style={{ background: dotColor }} />
                    )}
                    <span className="relative h-2.5 w-2.5 rounded-full" style={{ background: dotColor }} />
                </span>
                <span className="text-sm font-medium">会话 · {angle}</span>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-xs text-[var(--app-hint)]">
                    <span>{toolCount} 次工具调用 · {thinkCount} 次思考</span>
                    {typeof tokens === 'number' && tokens > 0 && <span>{(tokens / 1000).toFixed(1)}k tokens</span>}
                    {elapsed && <span>{elapsed}</span>}
                    {typeof result?.num_turns === 'number' && <span>{result.num_turns} 轮</span>}
                    {retries > 0 && !running && <span style={{ color: ORANGE }}>重试 {retries}</span>}
                    {retrying && <span style={{ color: ORANGE }}>重试中…</span>}
                    {running && !retrying && <span style={{ color: ORANGE }}>运行中</span>}
                    {interrupted && <span>已中断</span>}
                    {isError && <span style={{ color: RED }}>错误</span>}
                    <GroupChevron open={open} />
                </span>
            </button>
            {open && (
                <div className="flex flex-col gap-2 border-t border-[var(--app-border)] px-3 py-2">
                    {promptText && (
                        <details className="text-xs">
                            <summary className="cursor-pointer text-[var(--app-hint)]">Prompt</summary>
                            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-[var(--app-subtle-bg)] p-2 text-[11px] leading-relaxed">{promptText}</pre>
                        </details>
                    )}
                    {(toolCount > 0 || thinkCount > 0) && (
                        <div className="flex flex-col gap-1.5">{timelineNodes(evs)}</div>
                    )}
                    {outcome && (
                        <div>
                            <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">结果</div>
                            <p className="whitespace-pre-wrap text-sm">{outcome}</p>
                        </div>
                    )}
                </div>
            )}
        </Card>
    )
}

export function StepCards(props: { events: StepEvent[]; terminal?: boolean }) {
    const groups = useMemo(() => {
        const order: string[] = []
        const by = new Map<string, StepEvent[]>()
        for (const e of props.events) {
            // 'progress' events are phase counters for PhasesPanel, not agent sessions —
            // they'd otherwise create empty "会话 · search/fetch/…" cards (0 tools, 运行中).
            if (e.type === 'progress') continue
            if (!by.has(e.label)) {
                by.set(e.label, [])
                order.push(e.label)
            }
            by.get(e.label)!.push(e)
        }
        return order.map((label) => ({ label, events: by.get(label)! }))
    }, [props.events])

    if (props.events.length === 0) return null
    return (
        <div className="flex flex-col gap-2">
            {groups.map((g) => (
                <SessionCard key={g.label} label={g.label} events={g.events} terminal={props.terminal} />
            ))}
        </div>
    )
}


// ToolMetrics: compact aggregate of the deep-research engine's tool/agent diagnostics, mirroring
// the server's /stages/{stage}/metrics aggregation (api.stage_metrics) but computed client-side
// from the same event stream. Rendered inside the "工具调用详情" panel (App.tsx) when any
// tool_error / agent_retry / agent_error event exists.
export function ToolMetrics(props: { events: StepEvent[] }) {
    const { calls, toolErrors, retries, agentErrors } = useMemo(() => {
        const idToName = new Map<string, string>()
        for (const e of props.events) {
            if (e.type === 'tool_use' && e.tool_id) idToName.set(e.tool_id, e.name || '')
        }
        const calls = new Map<string, { success: number; error: number }>()
        const toolErrors: StepEvent[] = []
        const retries: StepEvent[] = []
        const agentErrors: StepEvent[] = []
        for (const e of props.events) {
            if (e.type === 'tool_result') {
                const name = idToName.get(e.tool_id || '') || '?'
                const c = calls.get(name) || { success: 0, error: 0 }
                if (e.is_error) c.error += 1; else c.success += 1
                calls.set(name, c)
            } else if (e.type === 'tool_error') toolErrors.push(e)
            else if (e.type === 'agent_retry') retries.push(e)
            else if (e.type === 'agent_error') agentErrors.push(e)
        }
        return { calls: [...calls.entries()], toolErrors, retries, agentErrors }
    }, [props.events])

    return (
        <Card className="mt-1 flex flex-col gap-3 p-3 text-xs">
            {calls.length > 0 && (
                <div>
                    <div className="mb-1 font-medium text-[var(--app-hint)]">工具调用</div>
                    <div className="flex flex-col gap-0.5">
                        {calls.map(([name, c]) => (
                            <div key={name} className="flex items-baseline justify-between gap-2">
                                <span className="min-w-0 break-words font-mono">{name}</span>
                                <span className="shrink-0 tabular-nums text-[var(--app-hint)]">
                                    ✓ {c.success}{c.error > 0 ? ` · ✗ ${c.error}` : ''}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {toolErrors.length > 0 && (
                <div>
                    <div className="mb-1 font-medium text-[var(--app-badge-error-text,#dc2626)]">工具错误 ({toolErrors.length})</div>
                    <ul className="flex flex-col gap-0.5">
                        {toolErrors.map((e, i) => (
                            <li key={i} className="break-words">
                                <span className="font-mono">{e.tool || '?'}</span>
                                <span className="text-[var(--app-hint)]">{e.label ? ` · ${e.label}` : ''}</span>
                                {e.error ? <span className="text-[var(--app-hint)]">: {e.error}</span> : null}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {retries.length > 0 && (
                <div>
                    <div className="mb-1 font-medium text-[var(--app-hint)]">重试 ({retries.length})</div>
                    <ul className="flex flex-col gap-0.5">
                        {retries.map((e, i) => (
                            <li key={i} className="break-words text-[var(--app-hint)]">
                                {e.label || '?'} · 第 {e.attempt ?? '?'}/{e.max_retries ?? '?'} 次
                                {e.reason ? ` · ${e.reason}` : ''}
                                {e.backoff_sec != null ? ` · 退避 ${e.backoff_sec}s` : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {agentErrors.length > 0 && (
                <div>
                    <div className="mb-1 font-medium text-[var(--app-badge-error-text,#dc2626)]">放弃 ({agentErrors.length})</div>
                    <ul className="flex flex-col gap-0.5">
                        {agentErrors.map((e, i) => (
                            <li key={i} className="break-words">
                                <span>{e.label || '?'}</span>
                                <span className="text-[var(--app-hint)]">{e.attempts != null ? ` · ${e.attempts} 次尝试后` : ''}</span>
                                {e.last_error ? <span className="text-[var(--app-hint)]">: {e.last_error}</span> : null}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </Card>
    )
}
