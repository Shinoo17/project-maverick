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
  settings: '#/settings',
  flight: '#/flight',
  /** Previous aircraft studio (stages, flight preview, weapons). Not linked from the menus. */
  studio: '#/studio',
} as const
export type RouteId = keyof typeof routes

/** Screens that share the menu 3D scene. */
export const menuRoutes = ['home', 'mode', 'hangar', 'armament', 'campaign', 'pve', 'settings'] as const
export type MenuRouteId = typeof menuRoutes[number]
export function isMenuRoute(route: RouteId): route is MenuRouteId {
  return (menuRoutes as readonly RouteId[]).includes(route)
}

/**
 * Where Esc and the top-left back link go. Home has no parent. Settings goes back to the
 * screen that opened it (see `openSettings`); 'home' is only its fallback after a reload.
 */
export const parentRoute: Record<MenuRouteId, MenuRouteId | null> = {
  home: null, mode: 'home', hangar: 'home', armament: 'hangar', campaign: 'mode', pve: 'mode', settings: 'home',
}

export function navigate(route: RouteId) { location.hash = routes[route] }

// The flight page returns the player to the screen that launched it.
let flightReturn: MenuRouteId = 'home'
export function launchFlight(from: MenuRouteId) { flightReturn = from; navigate('flight') }
export function flightReturnRoute(): MenuRouteId { return flightReturn }

// Settings opens from Home or the Hangar and returns there.
let settingsReturn: MenuRouteId = 'home'
export function openSettings(from: MenuRouteId) { settingsReturn = from; navigate('settings') }
export function settingsReturnRoute(): MenuRouteId { return settingsReturn }
/** Where Esc goes from a menu screen. */
export function backRoute(route: MenuRouteId): MenuRouteId | null {
  return route === 'settings' ? settingsReturn : parentRoute[route]
}

const byHash = new Map<string, RouteId>((Object.keys(routes) as RouteId[]).map((id) => [routes[id], id]))
function readRoute(): RouteId { return byHash.get(location.hash) ?? 'home' }
function subscribe(listener: () => void) {
  addEventListener('hashchange', listener)
  return () => removeEventListener('hashchange', listener)
}
export function useRoute(): RouteId { return useSyncExternalStore(subscribe, readRoute, () => 'home') }
