import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTheme, type Theme } from '@/lib/settings'
import { useTranslation } from '@/lib/use-translation'
import { ddaApi } from '@/api/dda'
import type { DdaConfig } from '@/types/dda'

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
        <div className="flex items-center justify-between gap-4 py-2">
            <div>
                <div className="text-sm font-medium">{props.label}</div>
                {props.hint && <div className="text-xs text-[var(--app-hint)]">{props.hint}</div>}
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

export function Settings(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [theme, setTheme] = useTheme()
    const { locale, setLocale } = useTranslation()
    const [config, setConfig] = useState<DdaConfig | null>(null)

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

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>设置</DialogTitle>
                </DialogHeader>

                <div className="max-h-[70vh] overflow-y-auto pr-1">
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

                    {/* Model endpoint + deep-research knobs (persisted server-side, applied to env) */}
                    <div className="mt-3 border-t border-[var(--app-divider)] pt-2">
                        <div className="py-1 text-sm font-semibold">模型 / 运行参数</div>
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
                        <div className="flex gap-3">
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
                        <div className="mt-2 flex items-center gap-3">
                            <Button onClick={save} disabled={saving || !config}>
                                {saving ? '保存中…' : '保存'}
                            </Button>
                            {msg && (
                                <span
                                    className={
                                        'text-xs ' +
                                        (msg.kind === 'ok' ? 'text-[var(--app-hint)]' : 'text-red-500')
                                    }
                                >
                                    {msg.text}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="mt-3 rounded-md bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">
                        <div className="mb-1 font-medium text-[var(--app-fg)]">连接 / 关于</div>
                        <div>后端 API:Vite 代理 /api → 127.0.0.1:8099</div>
                        <div>
                            实时运行:
                            {config ? (config.real_available ? '可用' : '不可用(缺 SDK 或密钥)') : '…'}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
