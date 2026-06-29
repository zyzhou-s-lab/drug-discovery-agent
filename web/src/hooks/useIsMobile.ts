import { useEffect, useState } from 'react'

// True when the viewport is below Tailwind's `lg` breakpoint (1024px) — phone/tablet. Kept in sync
// with the CSS so JS-driven layout (drawer / full-screen overlay) matches the `lg:` utility classes.
const QUERY = '(max-width: 1023px)'

export function useIsMobile(): boolean {
    const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false))
    useEffect(() => {
        const mq = window.matchMedia(QUERY)
        const onChange = () => setMobile(mq.matches)
        onChange()
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])
    return mobile
}
