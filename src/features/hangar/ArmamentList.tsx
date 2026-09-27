/*
ARMAMENT column on the right of the Hangar and Armament screens (mockup 2).
One row per weapon: kind, name, stations and how many are carried.
On the Hangar a row opens Armament with that weapon; on Armament it switches
the inspected weapon and the current one is marked.
*/
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useSessionSettings } from '../../app/sessionStore'
import type { AircraftDefinition } from '../../content/schemas'
import { weaponKindCopy } from '../../content/weapons/details'
import { SectionHeading } from '../menu/parts'
import { armamentRows, armamentSummary, type WeaponSelection } from './armament'

interface ArmamentListProps {
  aircraft: AircraftDefinition
  onPick: (weaponId: string) => void
  /** Armament only: the weapon on screen. Leave out on the Hangar. */
  selection?: WeaponSelection
  /** Hangar only: the INSPECT ARMAMENT button. */
  onInspect?: () => void
}

export function ArmamentList({ aircraft, onPick, selection, onInspect }: ArmamentListProps) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const rows = armamentRows(aircraft)

  return <section className="armament-list" aria-label={t('armamentTitle')}>
    <SectionHeading title={t('armamentTitle')} aside={t('armamentSummary', armamentSummary(rows))} />
    <ul>
      {rows.map(({ weapon, stations, count }) => <li key={weapon.id}>
        <button type="button" className="armament-row" onClick={() => onPick(weapon.id)}
          aria-pressed={selection === undefined ? undefined : selection === weapon.id}>
          <span className="armament-row-kind">{weaponKindCopy[weapon.kind].short[locale]}</span>
          <span className="armament-row-name">
            <strong>{weapon.name[locale]}</strong>
            <small>{stations.map(station => station.name[locale]).join(' · ')}</small>
          </span>
          <span className="armament-row-count">{count}</span>
        </button>
      </li>)}
    </ul>
    <p className="hangar-note">{t('armamentFullNote')}</p>
    {onInspect && <button type="button" className="armament-inspect" onClick={onInspect}>
      <span>{t('armamentInspect')}</span><ChevronRight size={16} aria-hidden="true" />
    </button>}
  </section>
}
