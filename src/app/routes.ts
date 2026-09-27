/*
Hash routes. Each screen has one address; the browser Back button works and a
reload stays on the same screen. `navigate` is the only way code changes screen.
*/
import { useSyncExternalStore } from 'react'

export const routes = {
  home: '#/',
  mode: '#/mode',
  hangar: '#/hangar',
  armament: '#/hangar/armament',
  campaign: '#/campaign',
  pve: '#/pve',
  flight: '#/flight',
  /** Previous aircraft studio (stages, flight preview, weapons). Not linked from the menus. */
  studio: '#/studio',
} as const
export type RouteId = keyof typeof routes

/** Screens that share the menu 3D scene. */
export const menuRoutes = ['home', 'mode', 'hangar', 'armament', 'campaign', 'pve'] as const
export type MenuRouteId = typeof menuRoutes[number]
export function isMenuRoute(route: RouteId): route is MenuRouteId {
  return (menuRoutes as readonly RouteId[]).includes(route)
}

/** Where Esc and the top-left back link go. Home has no parent. */
export const parentRoute: Record<MenuRouteId, MenuRouteId | null> = {
  home: null, mode: 'home', hangar: 'home', armament: 'hangar', campaign: 'mode', pve: 'mode',
}

export function navigate(route: RouteId) { location.hash = routes[route] }

// The flight page returns the player to the screen that launched it.
let flightReturn: MenuRouteId = 'home'
export function launchFlight(from: MenuRouteId) { flightReturn = from; navigate('flight') }
export function flightReturnRoute(): MenuRouteId { return flightReturn }

const byHash = new Map<string, RouteId>((Object.keys(routes) as RouteId[]).map((id) => [routes[id], id]))
function readRoute(): RouteId { return byHash.get(location.hash) ?? 'home' }
function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  return () => removeEventListener('hashchange', listener)
}
export function useRoute(): RouteId { return useSyncExternalStore(subscribe, readRoute, () => 'home') }
