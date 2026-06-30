// App routing (hapi parity): the index page (campaign list) and the campaign detail page are real
// routes, so selecting a run is a URL navigation — back/forward, refresh-persist and deep-links all
// work. Both routes render <App/>: the matched route is rendered into the root <Outlet/> at the same
// position, so App's component instance (and its state) is preserved across index↔detail navigation.
// `/c/$campaign` exposes the `campaign` param, which App reads via useParams({ strict: false }).
import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'

import { App } from './App'

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: App })
const campaignRoute = createRoute({ getParentRoute: () => rootRoute, path: '/c/$campaign', component: App })

const routeTree = rootRoute.addChildren([indexRoute, campaignRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
