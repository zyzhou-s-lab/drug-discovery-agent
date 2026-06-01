import { useEffect, useState, type ReactNode } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDefaultReal, useTheme, type Theme } from '@/lib/settings'
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

export function Settings(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [theme, setTheme] = useTheme()
    const [defaultReal, setDefaultReal] = useDefaultReal()
    const { locale, setLocale } = useTranslation()
    const [config, setConfig] = useState<DdaConfig | null>(null)

    useEffect(() => {
        if (props.open) ddaApi.config().then(setConfig).catch(() => setConfig(null))
    }, [props.open])

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>设置</DialogTitle>
                </DialogHeader>

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
                    <Row label="默认运行模式" hint="新建运行时是否默认调用 LLM(实时)">
                        <Segment<boolean>
                            value={defaultReal}
                            onChange={setDefaultReal}
                            options={[
                                { value: true, label: '实时' },
                                { value: false, label: 'dummy' },
                            ]}
                        />
                    </Row>
                </div>

                <div className="mt-2 rounded-md bg-[var(--app-subtle-bg)] p-3 text-xs text-[var(--app-hint)]">
                    <div className="mb-1 font-medium text-[var(--app-fg)]">连接 / 关于</div>
                    <div>后端 API:Vite 代理 /api → 127.0.0.1:8099</div>
                    <div>模型:{config?.model ?? '(未知)'}{config?.base_url_set ? '(DeepSeek 兼容层)' : ''}</div>
                    <div>实时运行:{config ? (config.real_available ? '可用' : '不可用(缺 SDK 或密钥)') : '…'}</div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
