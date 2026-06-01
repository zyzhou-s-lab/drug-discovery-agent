import { useCallback, useEffect, useState } from 'react'

/** Generic localStorage-backed setting (JSON-serialized). */
export function useLocalSetting<T>(key: string, initial: T): [T, (v: T) => void] {
    const [val, setVal] = useState<T>(() => {
        try {
            const s = localStorage.getItem(key)
            return s != null ? (JSON.parse(s) as T) : initial
        } catch {
            return initial
        }
    })
    const set = useCallback(
        (v: T) => {
            setVal(v)
            try {
                localStorage.setItem(key, JSON.stringify(v))
            } catch {
                /* ignore quota/private-mode */
            }
        },
        [key]
    )
    return [val, set]
}

export type Theme = 'light' | 'dark'

/** Theme preference, applied to <html data-theme>. */
export function useTheme(): [Theme, (t: Theme) => void] {
    const [theme, setTheme] = useLocalSetting<Theme>('dd-theme', 'light')
    useEffect(() => {
        document.documentElement.dataset.theme = theme
    }, [theme])
    return [theme, setTheme]
}

/** Default run mode (real vs free dummy) for the new-run form. */
export function useDefaultReal(): [boolean, (v: boolean) => void] {
    return useLocalSetting<boolean>('dd-default-real', true)
}
