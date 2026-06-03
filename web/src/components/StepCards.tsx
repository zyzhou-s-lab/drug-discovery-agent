import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

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

function SessionCard(props: { label: string; events: StepEvent[] }) {
    const evs = props.events
    const result = evs.find((e) => e.type === 'result')
    const running = !result
    const [open, setOpen] = useState(running)          // expanded while running
    const wasRunning = useRef(running)
    useEffect(() => {
        // auto-collapse the session card once it finishes (running -> done edge)
        if (wasRunning.current && !running) setOpen(false)
        wasRunning.current = running
    }, [running])
    const isError = result?.is_error
    const start = evs[0]?.ts ?? 0
    const end = result?.ts ?? evs[evs.length - 1]?.ts ?? start
    const toolCount = evs.filter((e) => e.type === 'tool_use').length
    const thinkCount = evs.filter((e) => e.type === 'thinking').length
    const elapsed = fmtElapsed(end - start)
    const dotColor = running ? ORANGE : isError ? RED : GREEN
    const angle = ANGLE_LABEL[props.label] ?? props.label

    return (
        <Card id={`dd-session-${props.label}`} className="overflow-hidden scroll-mt-4">
            <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span
                    className={'h-2 w-2 shrink-0 rounded-full ' + (running ? 'animate-pulse' : '')}
                    style={{ background: dotColor }}
                />
                <span className="text-sm font-medium">会话 · {angle}</span>
                <span className="ml-auto flex items-center gap-2 text-xs text-[var(--app-hint)]">
                    <span>{toolCount} 工具 · {thinkCount} 思考</span>
                    {elapsed && <span>{elapsed}</span>}
                    {typeof result?.num_turns === 'number' && <span>{result.num_turns} 轮</span>}
                    {running && <span style={{ color: ORANGE }}>运行中</span>}
                    {isError && <span style={{ color: RED }}>错误</span>}
                    <span>{open ? '▾' : '▸'}</span>
                </span>
            </button>
            {open && <div className="flex flex-col gap-1.5 border-t border-[var(--app-border)] px-3 py-2">{timelineNodes(evs)}</div>}
        </Card>
    )
}

export function StepCards(props: { events: StepEvent[] }) {
    const groups = useMemo(() => {
        const order: string[] = []
        const by = new Map<string, StepEvent[]>()
        for (const e of props.events) {
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
                <SessionCard key={g.label} label={g.label} events={g.events} />
            ))}
        </div>
    )
}
