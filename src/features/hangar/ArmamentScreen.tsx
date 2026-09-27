/*
Armament (mockup 2b · Hangar armament), opened from a weapon row in the
Hangar, INSPECT ARMAMENT or W. The 3D stage swaps the aircraft for the chosen
weapon model; the right column keeps the Hangar's ARMAMENT list (the owner
chose this over the mockup's STATIONS map). Picking a weapon here only
inspects it: every aircraft always carries its full load.
Shortcuts: ← → weapon, R reset view, Esc back to the Hangar.
*/
import { useTranslation } from 'react-i18next'
import type { AircraftDefinition } from '../../content/schemas'
import { inspectedWeapons, type WeaponModelStatus } from '../../content/weapons'
import { useMenuHotkeys } from '../menu/hooks'
import { BackLink, HotkeyHints } from '../menu/parts'
import { stepSelection, type WeaponSelection } from './armament'
import { ArmamentList } from './ArmamentList'
import { WeaponCards } from './WeaponCards'
import { WeaponDetail } from './WeaponDetail'
import { WeaponModelNote } from './WeaponModelNote'
import './hangar.css'

interface ArmamentScreenProps {
  aircraft: AircraftDefinition
  selection: WeaponSelection
  onSelect: (selection: WeaponSelection) => void
  statuses: Record<string, WeaponModelStatus>
  onRetry: () => void
  onResetView: () => void
}

export function ArmamentScreen({ aircraft, selection, onSelect, statuses, onRetry, onResetView }: ArmamentScreenProps) {
  const { t } = useTranslation()

  useMenuHotkeys({
    ArrowLeft: () => onSelect(stepSelection(aircraft, selection, -1)),
    ArrowRight: () => onSelect(stepSelection(aircraft, selection, 1)),
    KeyR: onResetView,
  })

  return <div className="hangar armament menu-overlay">
    <header className="menu-topbar">
      <BackLink to="hangar" label={t('navHangar')} />
      <span className="menu-topbar-divider" aria-hidden="true" />
      <p className="menu-topbar-title">{t('armamentTitle')}</p>
      <p className="armament-aircraft">{aircraft.designation} {aircraft.name}</p>
      <HotkeyHints hints={[['← →', t('armamentHintWeapon')], ['R', t('resetView')], ['ESC', t('hintBack')]]} />
    </header>

    <WeaponModelNote weapons={inspectedWeapons(aircraft, selection)} statuses={statuses} onRetry={onRetry} />
    <WeaponDetail aircraft={aircraft} selection={selection} />
    <ArmamentList aircraft={aircraft} selection={selection} onPick={onSelect} />
    <WeaponCards aircraft={aircraft} selection={selection} onSelect={onSelect} />
    <p className="hangar-orbit-hint armament-orbit-hint">{t('cameraHint')}</p>
  </div>
}
