import { useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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
    const { server, tool } = splitTool(use.name ?? '')
    const label = TOOL_LABEL[tool]
    const inputStr = useMemo(
        () => (use.input == null ? '' : typeof use.input === 'string' ? use.input : JSON.stringify(use.input, null, 2)),
        [use.input]
    )
    const resultStr = result ? toText(result.content) : ''
    const isError = result?.is_error
    const status = !result ? '…' : isError ? '✗' : '✓'
    const statusColor = !result ? 'var(--app-hint)' : isError ? RED : GREEN

    return (
        <Card className="overflow-hidden">
            <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                <span style={{ color: statusColor }} className="w-3 shrink-0 text-center text-xs">
                    {status}
                </span>
                {server && <Badge>{server}</Badge>}
                <span className="font-mono text-sm">{tool}</span>
                {label && <span className="text-xs text-[var(--app-hint)]">{label}</span>}
                <span className="ml-auto text-xs text-[var(--app-hint)]">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
                <div className="space-y-2 px-3 pb-3">
                    {inputStr && (
                        <div>
                            <div className="mb-1 text-xs text-[var(--app-hint)]">参数</div>
                            <CodeBlock code={inputStr} language="json" maxHeight={220} scrollY />
                        </div>
                    )}
                    {result && (
                        <div>
                            <div className="mb-1 text-xs" style={{ color: isError ? statusColor : 'var(--app-hint)' }}>
                                {isError ? '错误' : '结果'}
                            </div>
                            <CodeBlock code={resultStr || '(空)'} language={looksJson(resultStr) ? 'json' : 'text'} maxHeight={260} scrollY />
                        </div>
                    )}
                </div>
            )}
        </Card>
    )
}

function timelineNodes(events: StepEvent[]): ReactNode[] {
    const results = new Map<string, StepEvent>()
    for (const e of events) if (e.type === 'tool_result' && e.tool_id) results.set(e.tool_id, e)

    const nodes: ReactNode[] = []
    for (const e of events) {
        if (e.type === 'thinking') nodes.push(<Reasoning key={e.seq} ev={e} />)
        else if (e.type === 'tool_use')
            nodes.push(<ToolCall key={e.seq} item={{ use: e, result: e.tool_id ? results.get(e.tool_id) : undefined }} />)
        else if (e.type === 'text' && e.text?.trim())
            nodes.push(
                <p key={e.seq} className="whitespace-pre-wrap px-2 text-sm">
                    {e.text}
                </p>
            )
        // session_start / result / tool_result(已并入) 不单独渲染
    }
    return nodes
}

function SessionCard(props: { label: string; events: StepEvent[]; defaultOpen: boolean }) {
    const [open, setOpen] = useState(props.defaultOpen)
    const evs = props.events
    const result = evs.find((e) => e.type === 'result')
    const running = !result
    const isError = result?.is_error
    const start = evs[0]?.ts ?? 0
    const end = result?.ts ?? evs[evs.length - 1]?.ts ?? start
    const toolCount = evs.filter((e) => e.type === 'tool_use').length
    const thinkCount = evs.filter((e) => e.type === 'thinking').length
    const elapsed = fmtElapsed(end - start)
    const dotColor = running ? ORANGE : isError ? RED : GREEN
    const angle = ANGLE_LABEL[props.label] ?? props.label

    return (
        <Card className="overflow-hidden">
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
    // expand running sessions, or all of them when there's only one
    const single = groups.length === 1

    return (
        <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">执行过程 · {groups.length} 个会话</div>
            {groups.map((g) => {
                const running = !g.events.some((e) => e.type === 'result')
                return <SessionCard key={g.label} label={g.label} events={g.events} defaultOpen={single || running} />
            })}
        </div>
    )
}
