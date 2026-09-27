/*
Left column of the Armament screen (mockup 2b): what the selected weapon is,
how to use it, a few facts, and its IN-GAME stats. Weapons are not tuned until
P5, so the stat bars say so instead of showing made-up numbers.
With ALL selected it shows a summary of the whole loadout instead.
*/
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import type { AircraftDefinition } from '../../content/schemas'
import { weaponKindCopy, weaponSize } from '../../content/weapons/details'
import type { Translation } from '../../locales/en'
import { FactRows, SectionHeading } from '../menu/parts'
import { armamentRows, armamentSummary, type ArmamentRow, type WeaponSelection } from './armament'

type StatKey = keyof Translation & `armament${string}`
const missileStats: StatKey[] = ['armamentRange', 'armamentLockTime', 'armamentSeeker', 'armamentDamage']
const gunStats: StatKey[] = ['armamentRange', 'armamentRate', 'armamentAmmo', 'armamentDamage']

export function WeaponDetail({ aircraft, selection }: { aircraft: AircraftDefinition; selection: WeaponSelection }) {
  const rows = armamentRows(aircraft)
  const row = rows.find(item => item.weapon.id === selection)
  return <section className="armament-detail" aria-live="polite">
    {row ? <SingleWeapon row={row} /> : <AllWeapons rows={rows} />}
  </section>
}

function SingleWeapon({ row }: { row: ArmamentRow }) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const { weapon, stations, count } = row
  const kind = weaponKindCopy[weapon.kind]
  const stationNames = stations.map(station => station.name[locale]).join(' · ')

  return <>
    <p className="armament-kind">{kind.long[locale]}</p>
    <h1 className="armament-name">{weapon.name[locale]}</h1>
    <p className="armament-sub">{stationNames} · ×{count}</p>
    {weapon.provisional && <p className="armament-provisional">{t('weaponProvisional')}</p>}
    <p className="armament-role">{kind.role[locale]}</p>
    <FactRows rows={[
      [t('armamentGuidance'), kind.guidance[locale]],
      [t('armamentSize'), weaponSize(weapon)],
      [t('armamentStation'), stationNames],
    ]} />

    <SectionHeading title={t('armamentInGame')} aside={t('armamentPending')} />
    <ul className="hangar-bars armament-bars">
      {(weapon.kind === 'gun' ? gunStats : missileStats).map(label => <li key={label}>
        <span>{t(label)}</span>
        <span className="hangar-bar-track armament-bar-pending" aria-hidden="true" />
        <span className="hangar-bar-value">—</span>
      </li>)}
    </ul>
  </>
}

function AllWeapons({ rows }: { rows: ArmamentRow[] }) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const summary = armamentSummary(rows)
  return <>
    <p className="armament-kind">{t('armamentAllKind')}</p>
    <h1 className="armament-name">{t('armamentAllTitle')}</h1>
    <p className="armament-sub">{t('armamentSummary', summary)}</p>
    <p className="armament-role">{t('armamentAllText')}</p>
    <FactRows rows={rows.map(({ weapon, count }) =>
      [weapon.name[locale], `${weaponKindCopy[weapon.kind].short[locale]} · ×${count}`])} />
  </>
}
