/*
Frame for every menu screen. It keeps the 3D stage mounted while the route
changes, so moving between Home, Select Mode, Hangar, Campaign and PVE never
reloads the aircraft. The current screen is drawn as an overlay on top.

  MenuLayout
  ├─ MenuStage       shared 3D aircraft (hidden on Campaign and PVE),
  │                  or weapon models on Armament
  ├─ dim + vignette  keep floating text readable
  └─ <Screen>        HomeScreen, ModeSelectScreen, HangarScreen, …

Hangar and Armament share two pieces of state kept here: the aircraft being
browsed (before SET ACTIVE) and the weapon picked for inspection.
*/
// Shared menu styles load first so each screen's own sheet can refine them.
import './menu.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate, parentRoute, type MenuRouteId } from '../../app/routes'
import { useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import { availableWeapons, inspectedWeapons, weaponModelUrl, type WeaponModelStatus } from '../../content/weapons'
import { retryAircraftAsset } from '../../render/aircraft/assetLoader'
import type { MenuShot } from '../../render/menu/MenuScene'
import { CampaignScreen } from '../campaign/CampaignScreen'
import { validSelection, type WeaponSelection } from '../hangar/armament'
import { ArmamentScreen } from '../hangar/ArmamentScreen'
import { HangarScreen } from '../hangar/HangarScreen'
import { HomeScreen } from '../home/HomeScreen'
import { ModeSelectScreen } from '../mode/ModeSelectScreen'
import { PveSetupScreen } from '../pve/PveSetupScreen'
import { useMenuHotkeys } from './hooks'
import { MenuStage } from './MenuStage'

/** Camera shot per screen. Campaign and PVE hide the scene, so they keep the Mode shot. */
const shotFor: Record<MenuRouteId, MenuShot> = { home: 'home', mode: 'mode', hangar: 'hangar', armament: 'armament', campaign: 'mode', pve: 'mode' }

export function MenuLayout({ route }: { route: MenuRouteId }) {
  const { aircraftId } = useSessionSettings()
  // The aircraft being browsed in the Hangar before SET ACTIVE. null = show the active one.
  const [previewId, setPreviewId] = useState<AircraftId | null>(null)
  const [resetViewId, setResetViewId] = useState(0)
  // The weapon picked on Armament. Checked against the shown aircraft below.
  const [weaponPick, setWeaponPick] = useState<WeaponSelection | null>(null)
  const [weaponStatuses, setWeaponStatuses] = useState<Record<string, WeaponModelStatus>>({})
  const [weaponRetryId, setWeaponRetryId] = useState(0)

  const inHangar = route === 'hangar' || route === 'armament'
  useEffect(() => { if (!inHangar) setPreviewId(null) }, [inHangar])
  useMenuHotkeys({ Escape: () => { const parent = parentRoute[route]; if (parent) navigate(parent) } })

  const shown = getAircraft(inHangar && previewId ? previewId : aircraftId)
  const sceneHidden = route === 'campaign' || route === 'pve'
  const weaponSelection = validSelection(shown, weaponPick)
  const sceneWeapons = useMemo(() => route === 'armament' ? inspectedWeapons(shown, weaponSelection) : null, [route, shown, weaponSelection])

  const onWeaponStatus = useCallback((id: string, status: WeaponModelStatus) =>
    setWeaponStatuses(value => value[id] === status ? value : { ...value, [id]: status }), [])
  function retryWeapons() {
    const failed = availableWeapons(shown).filter(weapon => weapon.model && weaponStatuses[weapon.id] === 'missing')
    failed.forEach(weapon => retryAircraftAsset(weaponModelUrl(weapon)!))
    setWeaponStatuses(value => ({ ...value, ...Object.fromEntries(failed.map(weapon => [weapon.id, 'loading' as const])) }))
    setWeaponRetryId(value => value + 1)
  }
  function openArmament(selection: WeaponSelection) {
    setWeaponPick(selection)
    navigate('armament')
  }

  return <main className="menu" data-route={route}>
    <MenuStage aircraft={shown} shot={shotFor[route]} hidden={sceneHidden} resetViewId={resetViewId}
      weapons={sceneWeapons} weaponStatuses={weaponStatuses} onWeaponStatus={onWeaponStatus} weaponRetryId={weaponRetryId} />
    <div className="menu-dim" aria-hidden="true" />
    <div className="menu-vignette" aria-hidden="true" />

    {route === 'home' && <HomeScreen />}
    {route === 'mode' && <ModeSelectScreen />}
    {route === 'hangar' && <HangarScreen viewedId={shown.id} onView={setPreviewId} onResetView={() => setResetViewId(value => value + 1)}
      onInspect={openArmament} />}
    {route === 'armament' && <ArmamentScreen aircraft={shown} selection={weaponSelection} onSelect={setWeaponPick}
      statuses={weaponStatuses} onRetry={retryWeapons} onResetView={() => setResetViewId(value => value + 1)} />}
    {route === 'campaign' && <CampaignScreen />}
    {route === 'pve' && <PveSetupScreen />}
  </main>
}
