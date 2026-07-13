import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTheme, type Theme } from '@/lib/settings'
import { useTranslation } from '@/lib/use-translation'
import { ddaApi } from '@/api/dda'
import type { Capabilities, DdaConfig } from '@/types/dda'

function Segment<T extends string | boolean>(props: {
    value: T
    onChange: (v: T) => void
    options: { value: T; label: string }[]
}) {
    return (
        <div className="inline-flex rounded-md border border-[var(--app-border)] p-0.5">
            {props.options.map((o) => {
                const active = o.value === props.value
                return (
                    <button
                        key={String(o.value)}
                        onClick={() => props.onChange(o.value)}
                        className={
                            'rounded px-3 py-1 text-sm transition-colors ' +
                            (active
                                ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                                : 'text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]')
                        }
                    >
                        {o.label}
                    </button>
                )
            })}
        </div>
    )
}

function Row(props: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
                <div className="text-[15px] font-medium text-[var(--app-fg)]">{props.label}</div>
                {props.hint && <div className="mt-0.5 text-xs text-[var(--app-hint)]">{props.hint}</div>}
            </div>
            {props.children}
        </div>
    )
}

const inputCls =
    'w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-sm ' +
    'text-[var(--app-fg)] outline-none focus:border-[var(--app-button)]'

function Field(props: { label: string; hint?: string; children: ReactNode }) {
    return (
        <label className="block py-2">
            <div className="mb-1 text-sm font-medium">{props.label}</div>
            {props.hint && <div className="mb-1 text-xs text-[var(--app-hint)]">{props.hint}</div>}
            {props.children}
        </label>
    )
}

function Toggle(props: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            role="switch"
            aria-checked={props.checked}
            disabled={props.disabled}
            onClick={() => !props.disabled && props.onChange(!props.checked)}
            className={
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' +
                (props.checked ? 'bg-[var(--app-button)]' : 'bg-[var(--app-border)]') +
                (props.disabled ? ' cursor-not-allowed opacity-50' : '')
            }
        >
            <span
                className={
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform ' +
                    (props.checked ? 'translate-x-4' : 'translate-x-0.5')
                }
            />
        </button>
    )
}

type SettingsTab = 'general' | 'model' | 'run' | 'skills' | 'tools' | 'about'
const SETTINGS_NAV: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: '通用' },
    { id: 'model', label: '模型' },
    { id: 'run', label: '运行' },
    { id: 'skills', label: '技能' },
    { id: 'tools', label: '工具' },
    { id: 'about', label: '关于' },
]
const SETTINGS_TITLE: Record<SettingsTab, string> = {
    general: '通用', model: '模型', run: '运行', skills: '技能', tools: '工具', about: '关于',
}

// Dependency-free line icons (project has no icon lib — uses inline <svg>). 18px, inherit color.
function NavIcon({ id }: { id: SettingsTab }) {
    const p: Record<SettingsTab, ReactNode> = {
        general: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
        model: (<><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></>),
        run: (<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />),
        skills: (<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />),
        tools: (<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.6 7.6l-6.3 6.3a2.1 2.1 0 0 1-3-3l6.3-6.3a6 6 0 0 1 7.6-7.6l-3.1 3.1z" />),
        about: (<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>),
    }
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
            {p[id]}
        </svg>
    )
}

export function Settings(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [theme, setTheme] = useTheme()
    const { locale, setLocale } = useTranslation()
    const [config, setConfig] = useState<DdaConfig | null>(null)
    const [caps, setCaps] = useState<Capabilities | null>(null)
    const [expanded, setExpanded] = useState<Record<string, boolean>>({})
    const [tab, setTab] = useState<SettingsTab>('general')

    // toggle a tool: optimistic update, then persist (re-fetch on failure to resync)
    const toggleTool = (name: string, enabled: boolean) => {
        setCaps((c) =>
            c && {
                ...c,
                toolGroups: c.toolGroups.map((g) => ({
                    ...g,
                    tools: g.tools.map((t) => (t.name === name ? { ...t, enabled } : t)),
                })),
            },
        )
        ddaApi.gateTool(name, enabled).then(setCaps).catch(() => ddaApi.capabilities().then(setCaps).catch(() => {}))
    }

    // editable form state (model endpoint + deep-research knobs)
    const [model, setModel] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [concurrency, setConcurrency] = useState('6')
    const [maxClaims, setMaxClaims] = useState('25')
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

    const hydrate = (c: DdaConfig) => {
        setConfig(c)
        setModel(c.model ?? '')
        setBaseUrl(c.base_url ?? '')
        setApiKey(c.api_key ?? '') // round-tripped: prefill so wholesale save keeps it
        setConcurrency(String(c.concurrency))
        setMaxClaims(String(c.max_claims))
    }

    useEffect(() => {
        if (props.open) {
            setMsg(null)
            ddaApi.config().then(hydrate).catch(() => setConfig(null))
            ddaApi.capabilities().then(setCaps).catch(() => setCaps(null))
        }
    }, [props.open])

    const save = () => {
        const c = Number(concurrency)
        const m = Number(maxClaims)
        if (!Number.isInteger(c) || c < 1 || c > 32 || !Number.isInteger(m) || m < 1 || m > 80) {
            setMsg({ kind: 'err', text: '并发上限 1–32,核验条数 1–80(整数)' })
            return
        }
        setSaving(true)
        setMsg(null)
        ddaApi
            .saveConfig({
                model,
                base_url: baseUrl,
                api_key: apiKey, // full value (prefilled then maybe edited); wholesale overwrite
                concurrency: c,
                max_claims: m,
            })
            .then((c) => {
                hydrate(c)
                setMsg({ kind: 'ok', text: '已保存 · 下次运行生效' })
            })
            .catch((e) => setMsg({ kind: 'err', text: `保存失败:${e.message ?? e}` }))
            .finally(() => setSaving(false))
    }

    // sections show/hide by the left-nav selection; save persists model+run knobs together.
    const persistTab = tab === 'model' || tab === 'run'
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogTitle className="sr-only">设置</DialogTitle>

                <div className="flex min-h-[420px] gap-6">
                    {/* left category nav (codex-style directory) */}
                    <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-[var(--app-divider)] pr-3">
                        {SETTINGS_NAV.map((n) => (
                            <button
                                key={n.id}
                                onClick={() => setTab(n.id)}
                                className={
                                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ' +
                                    (tab === n.id
                                        ? 'bg-[var(--app-subtle-bg)] font-medium text-[var(--app-fg)]'
                                        : 'font-normal text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]')
                                }
                            >
                                <span className="text-[var(--app-hint)]"><NavIcon id={n.id} /></span>
                                {n.label}
                            </button>
                        ))}
                    </nav>

                    {/* right content pane */}
                    <div className="flex min-w-0 flex-1 flex-col">
                        <h2 className="mb-4 border-b border-[var(--app-divider)] pb-3 text-lg font-semibold text-[var(--app-fg)]">{SETTINGS_TITLE[tab]}</h2>
                        <div className="max-h-[56vh] overflow-y-auto pr-1">
                        {tab === 'general' && (
                            <div className="divide-y divide-[var(--app-divider)]">
                                <Row label="外观">
                                    <Segment<Theme>
                                        value={theme}
                                        onChange={setTheme}
                                        options={[
                                            { value: 'light', label: '浅色' },
                                            { value: 'dark', label: '深色' },
                                        ]}
                                    />
                                </Row>
                                <Row label="语言 / Language">
                                    <Segment
                                        value={locale}
                                        onChange={(v) => setLocale(v as 'zh-CN' | 'en')}
                                        options={[
                                            { value: 'zh-CN', label: '中文' },
                                            { value: 'en', label: 'English' },
                                        ]}
                                    />
                                </Row>
                            </div>
                        )}

                        {tab === 'model' && (
                            <div>
                                <Field label="模型 Model" hint="如 deepseek-chat · mimo-v2.5-pro · claude-opus-4-8">
                                    <input
                                        className={inputCls}
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        placeholder="(默认)"
                                        spellCheck={false}
                                    />
                                </Field>
                                <Field label="Base URL" hint="Anthropic 兼容端点;留空 = 官方 Anthropic">
                                    <input
                                        className={inputCls}
                                        value={baseUrl}
                                        onChange={(e) => setBaseUrl(e.target.value)}
                                        placeholder="https://api.deepseek.com/anthropic"
                                        spellCheck={false}
                                    />
                                </Field>
                                <Field
                                    label="API Key"
                                    hint={config?.api_key_set ? '已设置 · 清空并保存即移除' : '未设置'}
                                >
                                    <input
                                        className={inputCls}
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="sk-…"
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </Field>
                            </div>
                        )}

                        {tab === 'run' && (
                            <div>
                                <Field label="并发上限" hint="深度研究时同时并行运行的 agent 数(检索/抓取/核验等)。调大更快,但更耗额度、更易触发限流。(DD_DR_CONC · 1–32)">
                                    <input
                                        className={inputCls}
                                        type="number"
                                        min={1}
                                        max={32}
                                        value={concurrency}
                                        onChange={(e) => setConcurrency(e.target.value)}
                                    />
                                </Field>
                                <Field label="核验条数" hint="送入「3 票对抗核验」的论断条数上限,按相关性取前 N 条。调大核验更全面,但 LLM 调用更多(每条 ×3 票)。(DD_DR_MAX_CLAIMS · 1–80)">
                                    <input
                                        className={inputCls}
                                        type="number"
                                        min={1}
                                        max={80}
                                        value={maxClaims}
                                        onChange={(e) => setMaxClaims(e.target.value)}
                                    />
                                </Field>
                            </div>
                        )}

                        {tab === 'skills' && (
                            caps?.skills?.length ? (
                                <div className="flex flex-col gap-2">
                                    {caps.skills.map((s) => (
                                        <div key={s.name} className="rounded-md border border-[var(--app-border)] px-3 py-2">
                                            <div className="text-sm font-medium">{s.name}</div>
                                            <div className="mt-0.5 text-xs text-[var(--app-hint)]">{s.desc}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-2 text-sm text-[var(--app-hint)]">
                                    暂无技能。该流水线目前以固定阶段(scope → search → fetch → verify → synthesize)编排下方「工具」里的 MCP 工具,尚未引入模型自主调用的 skill。
                                </div>
                            )
                        )}

                        {tab === 'tools' && (
                            <div className="flex flex-col gap-4">
                                {(caps?.toolGroups ?? []).map((g) => (
                                    <div key={g.server}>
                                        <div className="mb-1.5 flex items-center gap-2">
                                            <span className="text-sm font-semibold">{g.label}</span>
                                            <span className="rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--app-hint)]">
                                                {g.kind.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="divide-y divide-[var(--app-divider)] overflow-hidden rounded-md border border-[var(--app-border)]">
                                            {g.tools.map((t) => {
                                                const open = !!expanded[t.name]
                                                return (
                                                    <div key={t.name}>
                                                        <div className="flex items-center gap-2 px-3 py-2">
                                                            <button
                                                                onClick={() => setExpanded((e) => ({ ...e, [t.name]: !open }))}
                                                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                                            >
                                                                <span
                                                                    className={
                                                                        'text-[9px] text-[var(--app-hint)] transition-transform ' +
                                                                        (open ? 'rotate-90' : '')
                                                                    }
                                                                >
                                                                    ▶
                                                                </span>
                                                                <span className="min-w-0">
                                                                    <span className={'font-mono text-xs ' + (t.enabled ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)] line-through')}>
                                                                        {t.name}
                                                                    </span>
                                                                    <span className="mt-0.5 block truncate text-xs text-[var(--app-hint)]">{t.desc}</span>
                                                                </span>
                                                            </button>
                                                            <Toggle
                                                                checked={t.enabled}
                                                                disabled={t.required}
                                                                onChange={(v) => toggleTool(t.name, v)}
                                                            />
                                                        </div>
                                                        {open && (
                                                            <div className="border-t border-[var(--app-divider)] bg-[var(--app-subtle-bg)] px-3 py-2">
                                                                <div className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--app-fg)]">{t.desc}</div>
                                                                <div className="mb-1 text-[11px] font-medium text-[var(--app-hint)]">参数</div>
                                                                {t.params.length ? (
                                                                    <div className="flex flex-col gap-0.5">
                                                                        {t.params.map((p) => (
                                                                            <div key={p.name} className="font-mono text-[11px] text-[var(--app-fg)]">
                                                                                {p.name}:{' '}
                                                                                <span className="text-[var(--app-hint)]">
                                                                                    {p.type}
                                                                                    {p.required ? ' · 必填' : ''}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-[11px] text-[var(--app-hint)]">无参数</div>
                                                                )}
                                                                {t.required && (
                                                                    <div className="mt-1 text-[11px] text-[var(--app-hint)]">核心工具,不可禁用</div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))}
                                {!caps && <div className="py-2 text-sm text-[var(--app-hint)]">加载中…</div>}
                            </div>
                        )}

                        {tab === 'about' && (
                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">
                                <div className="mb-1 font-medium text-[var(--app-fg)]">连接 / 关于</div>
                                <div>后端 API:Vite 代理 /api → 127.0.0.1:8099</div>
                                <div>
                                    实时运行:
                                    {config ? (config.real_available ? '可用' : '不可用(缺 SDK 或密钥)') : '…'}
                                </div>
                            </div>
                        )}
                        </div>
                    </div>
                </div>

                {/* footer: save applies to 模型 + 运行 (外观/语言 即时生效) */}
                <div className="mt-4 flex items-center gap-3 border-t border-[var(--app-divider)] pt-3">
                    {persistTab && (
                        <>
                            <Button onClick={save} disabled={saving || !config}>
                                {saving ? '保存中…' : '保存'}
                            </Button>
                            {msg && (
                                <span
                                    className={
                                        'text-xs ' + (msg.kind === 'ok' ? 'text-[var(--app-hint)]' : 'text-red-500')
                                    }
                                >
                                    {msg.text}
                                </span>
                            )}
                        </>
                    )}
                    <span className="ml-auto text-xs text-[var(--app-hint)]">
                        {persistTab
                            ? '改完点保存 · 下次运行生效'
                            : tab === 'general'
                              ? '外观 / 语言即时生效'
                              : tab === 'tools'
                                ? '工具开关 · 下次运行生效'
                                : ''}
                    </span>
                </div>
            </DialogContent>
        </Dialog>
    )
}
