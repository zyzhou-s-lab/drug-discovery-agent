import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/Markdown'
import { useResizable } from '@/hooks/useResizable'
import { ddaApi } from '@/api/dda'

type Msg = { role: 'user' | 'assistant'; content: string; refs?: string[] }

const QuoteIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-60">
        <path d="M7 7h4v6a4 4 0 0 1-4 4v-2a2 2 0 0 0 2-2H7zM15 7h4v6a4 4 0 0 1-4 4v-2a2 2 0 0 0 2-2h-2z" />
    </svg>
)

const preview = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

// Right-side /btw side-chat about the current run (grounded in its stage outputs),
// streamed. Selections added via "加入对话" arrive as `attachments` and are quoted
// into the next message.
export function ChatPanel(props: {
    campaign: string
    onClose: () => void
    attachments: string[]
    onRemoveAttachment: (i: number) => void
    onClearAttachments: () => void
}) {
    const { width, onPointerDown } = useResizable({ key: 'dd-right-w2', def: 400, min: 220, max: 520, side: 'right' })
    // per-run history persisted in localStorage (App keys this component by campaign,
    // so it remounts on run switch and there's no stale-write race).
    const STORE_KEY = `dd-chat-${props.campaign}`
    const [messages, setMessages] = useState<Msg[]>(() => {
        try {
            const s = localStorage.getItem(STORE_KEY)
            return s ? (JSON.parse(s) as Msg[]) : []
        } catch {
            return []
        }
    })
    const [input, setInput] = useState('')
    const [pending, setPending] = useState(false)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-60)))
        } catch {
            /* ignore quota / private mode */
        }
    }, [messages, STORE_KEY])
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, pending])

    const canSend = !pending && (input.trim().length > 0 || props.attachments.length > 0)

    const send = async () => {
        if (!canSend) return
        const q = input.trim()
        const refs = props.attachments
        const userMsg: Msg = { role: 'user', content: q, refs: refs.length ? refs : undefined }
        const base: Msg[] = [...messages, userMsg]
        setMessages([...base, { role: 'assistant', content: '' }])
        setInput('')
        props.onClearAttachments()
        setPending(true)
        // augment each user turn with its quoted refs so the LLM sees the cited content
        const apiMsgs = base.map((m) =>
            m.role === 'user' && m.refs?.length
                ? {
                      role: 'user',
                      content:
                          '引用页面内容:\n' +
                          m.refs.map((r) => '> ' + r.replace(/\n/g, '\n> ')).join('\n\n') +
                          '\n\n' +
                          (m.content || '请解释/分析上面引用的内容。'),
                  }
                : { role: m.role, content: m.content }
        )
        try {
            await ddaApi.chatStream(props.campaign, apiMsgs, (chunk) => {
                setMessages((prev) => {
                    const copy = prev.slice()
                    copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + chunk }
                    return copy
                })
            })
        } catch (e) {
            setMessages((prev) => {
                const copy = prev.slice()
                copy[copy.length - 1] = { role: 'assistant', content: `(出错: ${String(e)})` }
                return copy
            })
        } finally {
            setPending(false)
        }
    }

    return (
        <aside style={{ width }} className="relative flex shrink-0 flex-col border-l border-[var(--app-border)]">
            <div onPointerDown={onPointerDown} className="absolute inset-y-0 -left-0.5 z-20 w-1.5 cursor-col-resize hover:bg-[var(--app-link-muted,rgba(0,0,0,0.12))]" />
            <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-semibold">对话</span>
                <div className="flex items-center gap-1">
                    {messages.length > 0 && (
                        <button onClick={() => setMessages([])} title="清空对话" className="rounded px-1.5 py-1 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]">清空</button>
                    )}
                    <button onClick={props.onClose} title="关闭" className="rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]">✕</button>
                </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
                {messages.length === 0 && (
                    <div className="text-xs leading-relaxed text-[var(--app-hint)]">
                        针对当前运行提问,例如:
                        <div className="mt-1 space-y-0.5">
                            <div>· 为什么这个阶段没收敛?</div>
                            <div>· 哪个候选靶点更值得推进?为什么?</div>
                        </div>
                        <div className="mt-2">选中页面上的文字 → 点「加入对话」可作为引用。</div>
                    </div>
                )}
                {messages.map((m, i) => {
                    const streaming = pending && i === messages.length - 1 && m.role === 'assistant'
                    return (
                        <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                            <div
                                className={
                                    'max-w-[88%] rounded-2xl px-3 py-2 text-sm ' +
                                    (m.role === 'user'
                                        ? 'whitespace-pre-wrap bg-[var(--app-chat-user-bg)] text-[var(--app-chat-user-fg)]'
                                        : 'bg-[var(--app-subtle-bg)]')
                                }
                            >
                                {m.refs?.length ? (
                                    <div className="mb-1 flex flex-col gap-1">
                                        {m.refs.map((r, k) => (
                                            <span key={k} className="block truncate rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] opacity-80">
                                                “{preview(r.replace(/\s+/g, ' '), 48)}”
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                                {m.role === 'assistant' ? (
                                    m.content ? (
                                        <Markdown text={m.content} />
                                    ) : streaming ? (
                                        <span className="text-[var(--app-hint)]">思考中…</span>
                                    ) : null
                                ) : (
                                    m.content
                                )}
                                {streaming && m.content && <span className="ml-0.5 inline-block animate-pulse align-middle">▋</span>}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="border-t border-[var(--app-border)] p-2">
                {props.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                        {props.attachments.map((r, i) => (
                            <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-xs">
                                <QuoteIcon />
                                <span className="truncate font-mono">{preview(r.replace(/\s+/g, ' '), 24)}</span>
                                <span className="shrink-0 text-[var(--app-hint)]">({r.length}字)</span>
                                <button onClick={() => props.onRemoveAttachment(i)} className="shrink-0 text-[var(--app-hint)] hover:text-[var(--app-fg)]">✕</button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                send()
                            }
                        }}
                        rows={2}
                        placeholder="问点什么…(Enter 发送 / Shift+Enter 换行)"
                        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-[var(--app-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--app-button)]"
                    />
                    <Button size="sm" onClick={send} disabled={!canSend}>发送</Button>
                </div>
            </div>
        </aside>
    )
}
