import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '@/lib/i18n-context'
import { App } from './App'
import './index.css'

// The lifted components call useTranslation(), which throws outside an
// I18nProvider. We keep HAPI's real i18n (en/zh-CN locales) so the demo
// renders proper English. To drop i18n entirely, stub @/lib/use-translation
// to `() => ({ t: (k: string) => k, locale: 'en', setLocale() {} })`.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <I18nProvider>
            <App />
        </I18nProvider>
    </StrictMode>
)
