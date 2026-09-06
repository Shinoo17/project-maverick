import { lazy, Suspense, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { HangarPage } from '../features/hangar/HangarPage'

// Flight is loaded on entry; each route retains its own presentation scope.
const FlightPage = lazy(() => import('../features/flight/FlightPage').then(module => ({ default: module.FlightPage })))
export const routes = { home: '#/', flight: '#/flight' } as const
export type RouteId = keyof typeof routes

// The design owns a scope class so its sheet stays addressable from the shell.
export const routeClass: Record<RouteId, string> = { home: 'is-hangar', flight: 'is-flight' }
const pages: Record<RouteId, React.ComponentType> = { home: HangarPage, flight: FlightPage }
const byHash = new Map<string, RouteId>((Object.keys(routes) as RouteId[]).map((id) => [routes[id], id]))

function readRoute(): RouteId { return byHash.get(location.hash) ?? 'home' }
function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  return () => removeEventListener('hashchange', listener)
}
export function useRoute(): RouteId { return useSyncExternalStore(subscribe, readRoute, () => 'home') }
export function AppRoutes() { const Page = pages[useRoute()]; const { t } = useTranslation(); return <Suspense fallback={<p role="status">{t('flightLoading')}</p>}><Page /></Suspense> }
