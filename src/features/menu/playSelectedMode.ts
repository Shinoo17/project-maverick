/*
What PLAY on Home does with the saved mode choice.
Only free flight on the Flat Training Range can start today, so:
- Training and a playable PVE setup open the flight page.
- Anything that cannot start yet opens its setup screen, which says why.
*/
import { launchFlight, navigate } from '../../app/routes'
import { canPlayPve, findMap } from '../../content/maps'
import type { Settings } from '../../platform/storage'

export function canStartPve(settings: Settings): boolean {
  const map = findMap(settings.pveSetup.mapId)
  return map !== undefined && canPlayPve(map, settings.pveSetup.modeId)
}

export function playSelectedMode(settings: Settings) {
  switch (settings.selectedMode) {
    case 'training': return launchFlight('home')
    case 'campaign': return navigate('campaign')
    case 'pve': return canStartPve(settings) ? launchFlight('home') : navigate('pve')
  }
}
