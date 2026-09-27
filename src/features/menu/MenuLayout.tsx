/*
Frame for every menu screen. It keeps the 3D stage mounted while the route
changes, so moving between Home, Select Mode, Hangar, Campaign and PVE never
reloads the aircraft. The current screen is drawn as an overlay on top.

  MenuLayout
  ├─ MenuStage       shared 3D aircraft (hidden on Campaign and PVE)
  ├─ dim + vignette  keep floating text readable
  └─ <Screen>        HomeScreen, ModeSelectScreen, HangarScreen, …
*/
// Shared menu styles load first so each screen's own sheet can refine them.
import './menu.css'
import { useEffect, useState } from 'react'
import { navigate, parentRoute, type MenuRouteId } from '../../app/routes'
import { useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import type { MenuShot } from '../../render/menu/MenuScene'
import { CampaignScreen } from '../campaign/CampaignScreen'
import { HangarScreen } from '../hangar/HangarScreen'
import { HomeScreen } from '../home/HomeScreen'
import { ModeSelectScreen } from '../mode/ModeSelectScreen'
import { PveSetupScreen } from '../pve/PveSetupScreen'
import { useMenuHotkeys } from './hooks'
import { MenuStage } from './MenuStage'

/** Camera shot per screen. Campaign and PVE hide the scene, so they keep the Mode shot. */
const shotFor: Record<MenuRouteId, MenuShot> = { home: 'home', mode: 'mode', hangar: 'hangar', campaign: 'mode', pve: 'mode' }

export function MenuLayout({ route }: { route: MenuRouteId }) {
  const { aircraftId } = useSessionSettings()
  // The aircraft being browsed in the Hangar before SET ACTIVE. null = show the active one.
  const [previewId, setPreviewId] = useState<AircraftId | null>(null)
  const [resetViewId, setResetViewId] = useState(0)

  useEffect(() => { if (route !== 'hangar') setPreviewId(null) }, [route])
  useMenuHotkeys({ Escape: () => { const parent = parentRoute[route]; if (parent) navigate(parent) } })

  const shownId = route === 'hangar' && previewId ? previewId : aircraftId
  const sceneHidden = route === 'campaign' || route === 'pve'

  return <main className="menu" data-route={route}>
    <MenuStage aircraft={getAircraft(shownId)} shot={shotFor[route]} hidden={sceneHidden} resetViewId={resetViewId} />
    <div className="menu-dim" aria-hidden="true" />
    <div className="menu-vignette" aria-hidden="true" />

    {route === 'home' && <HomeScreen />}
    {route === 'mode' && <ModeSelectScreen />}
    {route === 'hangar' && <HangarScreen viewedId={shownId} onView={setPreviewId} onResetView={() => setResetViewId(value => value + 1)} />}
    {route === 'campaign' && <CampaignScreen />}
    {route === 'pve' && <PveSetupScreen />}
  </main>
}
