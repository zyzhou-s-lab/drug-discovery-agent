import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { I18nProvider } from '@/lib/i18n-context'
import { router } from './router'
import './index.css'

// The lifted components call useTranslation(), which throws outside an
// I18nProvider. We keep HAPI's real i18n (en/zh-CN locales) so the demo
// renders proper English. Routing (hapi parity) is provided by RouterProvider;
// see ./router. To drop i18n entirely, stub @/lib/use-translation.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <I18nProvider>
            <RouterProvider router={router} />
        </I18nProvider>
    </StrictMode>
)
