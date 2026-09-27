/*
SELECT WEAPON row along the bottom of the Armament screen (mockup 2b):
an ALL card, then one card per weapon with the number carried.
Thumbnails are placeholders until weapon images exist.
*/
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import type { AircraftDefinition } from '../../content/schemas'
import { armamentRows, armamentSummary, type WeaponSelection } from './armament'

interface WeaponCardsProps {
  aircraft: AircraftDefinition
  selection: WeaponSelection
  onSelect: (selection: WeaponSelection) => void
}

export function WeaponCards({ aircraft, selection, onSelect }: WeaponCardsProps) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const rows = armamentRows(aircraft)
  const { guns, missiles } = armamentSummary(rows)

  return <section className="hangar-picker weapon-picker" aria-label={t('armamentSelectWeapon')}>
    <p className="hangar-picker-title">{t('armamentSelectWeapon')}</p>
    <div className="hangar-cards">
      <button type="button" className="hangar-card" aria-pressed={selection === 'all'} onClick={() => onSelect('all')}>
        <span className="hangar-card-thumb">{t('armamentAllKind')}</span>
        <span className="weapon-card-label"><strong>{t('armamentAll')}</strong><small>{guns + missiles}</small></span>
      </button>
      {rows.map(({ weapon, count }) => <button key={weapon.id} type="button" className="hangar-card" aria-pressed={selection === weapon.id}
        onClick={() => onSelect(weapon.id)} title={weapon.name[locale]}>
        <span className="hangar-card-thumb">{weapon.model ? t('armamentModel3d') : t('armamentNoModel')}</span>
        <span className="weapon-card-label"><strong>{weapon.name[locale]}</strong><small>×{count}</small></span>
      </button>)}
    </div>
  </section>
}
