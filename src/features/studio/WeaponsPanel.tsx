import { Layers, Rocket } from 'lucide-react'
import type { AircraftDefinition } from '../../content/schemas'
import { availableWeapons, fullArmament, weaponStations, type WeaponModelStatus } from '../../content/weapons'
import { useSessionSettings } from '../../app/sessionStore'
import { useTexts } from '../../locales'

export function WeaponsPanel({ aircraft, selected, onSelect, statuses }: {
  aircraft: AircraftDefinition; selected: string; onSelect: (id: string) => void; statuses: Record<string, WeaponModelStatus>
}) {
  const { locale } = useSessionSettings()
  const text = useTexts()
  const armament = fullArmament(aircraft)
  const stations = weaponStations[aircraft.weaponStationProfileId]
  const catalog = availableWeapons(aircraft)
  const kinds = { gun: text.weaponGun, ir: text.weaponIr, radar: text.weaponRadar }
  return <section id="hangar-panel-weapons" aria-labelledby="hangar-tab-weapons" className="hangar-section hangar-content" role="tabpanel">
    <h2 className="hangar-label"><Rocket size={14} />{aircraft.designation} · {text.weaponCatalog}<span className="hangar-count">{catalog.length}</span></h2>
    <div className="hangar-weapon-options" aria-label={text.weaponCatalog}>
      <button type="button" className={`hangar-weapon-option${selected === 'all' ? ' is-active' : ''}`} aria-pressed={selected === 'all'} onClick={() => onSelect('all')}>
        <Layers size={13} /><span><strong>{text.hangarAllWeapons}</strong><small>{text.hangarAllModels}</small></span><small>ALL</small>
      </button>
      {catalog.map(weapon => {
        const stores = armament.filter(store => store.weaponId === weapon.id)
        const count = stores.reduce((total, store) => total + store.count, 0)
        const status = weapon.model ? statuses[weapon.id] : 'missing'
        return <button type="button" key={weapon.id} className={`hangar-weapon-option${selected === weapon.id ? ' is-active' : ''}`} aria-pressed={selected === weapon.id} onClick={() => onSelect(weapon.id)}>
          <span className="hangar-weapon-quantity">{count}×</span>
          <span><strong>{weapon.name[locale]}</strong><small>{kinds[weapon.kind]}</small></span>
          <small>{status === 'missing' ? text.hangarNoModel : status === 'loading' ? text.loading : stores.length ? stations.find(station => station.id === stores[0].stationId)?.name[locale] : text.weaponNotEquipped}</small>
        </button>
      })}
    </div>
    <p className="hangar-content-note">{text.hangarWeaponHint}</p>
    <details className="weapon-reference"><summary>{text.weaponSource}</summary>
      <p className="hangar-content-note">{text.armamentCapacityNote}</p>
      {catalog.filter(weapon => weapon.source).map(weapon => <a key={weapon.id} href={weapon.source} target="_blank" rel="noreferrer">{weapon.name[locale]} ↗</a>)}
    </details>
  </section>
}
