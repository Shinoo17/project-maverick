import { useSyncExternalStore } from 'react'
import { HangarPage } from '../features/hangar/HangarPage'

// One surface today. The table stays because the scope class rides on it, and
// because flight and weapons attach here when they stop being panel shells.
export const routes = { home: '#/' } as const
export type RouteId = keyof typeof routes

// The design owns a scope class so its sheet stays addressable from the shell.
export const routeClass: Record<RouteId, string> = { home: 'is-hangar' }
const pages: Record<RouteId, () => React.JSX.Element> = { home: HangarPage }
const byHash = new Map<string, RouteId>((Object.keys(routes) as RouteId[]).map((id) => [routes[id], id]))

function readRoute(): RouteId { return byHash.get(location.hash) ?? 'home' }
function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  return () => removeEventListener('hashchange', listener)
}
export function useRoute(): RouteId { return useSyncExternalStore(subscribe, readRoute, () => 'home') }
export function AppRoutes() { const Page = pages[useRoute()]; return <Page /> }
