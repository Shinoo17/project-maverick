/* THESIS: The helmet-mounted weapons column from example/hud-example.html (10 PARALLAX,
   17 PARALLAX COLUMN), floating at the bottom right beside the glass.
   OWN-WORLD: Off-white line art and numerals on a dark grid plane set back in depth. The HUD's
   phosphor green marks only the selected missile; red only heat and damage. No glow, no fills.
   STORY: HP as slanted segments with its state in words; a cold gun card has no plate; once warm it
   shows a faint track and outline, filled left (0%) to right (100%) with heat in off-white, red and
   flashing past 80%, solid red while locked out (released past 80%: until
   35%; overheated: until 0); the selected missile card
   steps toward the pilot and carries the launch key. The countermeasure card closes the column:
   bursts left as pips, with its key.
   MOTION: The column holds a fixed 3D tilt and sways a few degrees with roll rate and G, eased by
   CSS between 10 Hz telemetry updates; reduced motion keeps it still. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import { gunStation, missileStations, type WeaponKind, type WeaponStation } from '../../content/weapons'
import { AIRCRAFT_HP } from '../../game/combat/damage'
import type { InputPreset, KeyBindings } from '../../game/input/keyBindings'
import type { AircraftState } from '../../game/state/WorldState'
import { bindingNames } from '../settings/KeyPrompt'
import './weaponPanel.css'

// The warning band starts where a release locks the gun (GunProfile.lockHeat; 80% for every gun so far).
const HEAT_WARNING = 0.8
const HP_SEGMENTS = 20
// Matches the wpn-hit animation in weaponPanel.css.
const SHAKE_MS = 420
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))

// Side-view line art, 92 × 26, nose to the right. Missiles are drawn by seeker kind, not by
// weapon id, so training rounds never borrow a real missile's outline.
const icons: Record<WeaponKind, string> = {
  gun: '<g class="wpn-body"><rect x="6" y="8" width="8" height="8"/><rect x="14" y="5" width="24" height="14" rx="2"/><circle cx="26" cy="12" r="3.5"/><path class="wpn-barrel" d="M38 9H86M38 12H86M38 15H86"/><rect x="56" y="7.5" width="3" height="9"/><rect x="80" y="7" width="3" height="10"/><path d="M18 19L12 25M24 19L18 25"/></g><path class="wpn-flash" d="M89 12L96 7M89 12L99 12M89 12L96 17M89 12L92 4M89 12L92 20"/>',
  ir: '<path d="M8 11H70Q84 11.4 90 13Q84 14.6 70 15H8Z"/><path d="M10 11L6 4H15L20 11M10 15L6 22H15L20 15"/><path d="M62 11L61 8H66L68 11M62 15L61 18H66L68 15"/>',
  radar: '<path d="M4 11H74Q85 11.4 90 13Q85 14.6 74 15H4Z"/><path d="M7 11L3 3H13L18 11M7 15L3 23H13L18 15"/><path d="M40 11L37 6H45L49 11M40 15L37 20H45L49 15"/><path d="M60 11V15M64 11V15"/>',
}
// Countermeasures: a flare dropping on a smoke arc, and a chaff cloud of dashes.
const countermeasureIcon = '<path d="M6 6Q26 6 34 18"/><circle cx="36" cy="20" r="2.6"/><path d="M36 13V15M41 15L39.6 16.4M43 20H41M31 15L32.4 16.4"/><path class="wpn-chaff" d="M56 9H60M66 7H70M76 10H80M60 15H64M71 14H75M82 16H86M57 21H61M67 20H71M77 22H81"/>'
const Icon = ({ kind }: { kind: WeaponKind | 'countermeasure' }) => <svg className="wpn-icon" viewBox="-2 0 104 26" aria-hidden="true" dangerouslySetInnerHTML={{ __html: kind === 'countermeasure' ? countermeasureIcon : icons[kind] }} />
// The category line already carries the calibre: "M61A2 · 20 mm" → M61A2, "30 mm aircraft cannon" → aircraft cannon.
const gunName = (name: string) => name.split(' · ')[0].replace(/\s*\d+\s*(mm|มม\.)\s*/i, ' ').trim()
const category: Record<WeaponKind, string> = { gun: 'GUN', ir: 'IR · SRM', radar: 'RADAR · MRM' }

function Key({ mouse, name }: { mouse?: 'left' | 'right'; name: string }) {
  return <span className="wpn-key">{mouse && <><i className="wpn-mouse" data-button={mouse} />{mouse === 'left' ? 'LMB' : 'RMB'}<b>/</b></>}<kbd>{name}</kbd></span>
}

export function weaponRows(aircraftId: string, state: AircraftState | null) {
  const definition = getAircraft(aircraftId)
  const count = (station: WeaponStation) => state ? state.stores.filter(store => store.stationId === station.id).reduce((sum, store) => sum + store.count, 0) : station.capacity
  const { station, weapon } = gunStation(definition)
  return {
    gun: { station, weapon, count: count(station) },
    // In the seeker's selection order: short range first, so slot 0 is always the IR missile.
    missiles: missileStations(definition).map(row => ({ ...row, count: count(row.station) })),
    countermeasures: { capacity: definition.countermeasures.bursts, count: state?.countermeasures.bursts ?? definition.countermeasures.bursts },
  }
}

export function WeaponPanel({ aircraftId, state, selected, denied = 0, preset, bindings, reducedMotion }: {
  aircraftId: string; state: AircraftState | null; selected: number
  /** Counts trigger presses refused by a locked gun; each change shakes the gun card once. */
  denied?: number
  preset: InputPreset; bindings: KeyBindings; reducedMotion: boolean
}) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const keys = bindingNames(bindings), mouse = preset === 'mouse'
  const { gun, missiles, countermeasures } = weaponRows(aircraftId, state)

  // A drop in HP shakes the column; a rising shot count spins the barrels. Damage lands every
  // telemetry update under sustained fire, so a shake never restarts before the last one ends.
  const last = useRef({ hp: AIRCRAFT_HP, shots: 0, shook: 0 })
  const [hits, setHits] = useState(0), [firing, setFiring] = useState(false)
  useEffect(() => {
    if (!state) return
    const now = performance.now()
    if (state.hp < last.current.hp && now - last.current.shook > SHAKE_MS) { setHits(count => count + 1); last.current.shook = now }
    setFiring(state.gun.shots > last.current.shots)
    last.current = { ...last.current, hp: state.hp, shots: state.gun.shots }
  }, [state])

  const hp = state ? Math.max(0, Math.round(state.hp)) : AIRCRAFT_HP
  const health = hp < 30 ? 'critical' : hp < 60 ? 'damaged' : 'nominal'
  const lit = Math.ceil(hp / (AIRCRAFT_HP / HP_SEGMENTS))
  const heat = state?.gun.heat ?? 0, overheated = state?.gun.overheated ?? false, cooling = state?.gun.cooling ?? false
  const gunState = overheated ? 'overheat' : cooling ? 'cooling' : heat > HEAT_WARNING ? 'hot' : 'ready'
  const sway = reducedMotion ? 0 : clamp(-(state?.rates.roll ?? 0) * 1.4, 4)
  const sag = reducedMotion ? 0 : clamp(((state?.maneuver.g ?? 1) - 1) * 0.5, 3)
  const tilt = { '--wpn-sway': `${sway.toFixed(2)}deg`, '--wpn-sag': `${sag.toFixed(2)}deg`, '--wpn-drop': `${(sag * 2).toFixed(1)}px` } as CSSProperties

  return <section className="wpn" data-health={health} data-hit={hits % 2 ? 'a' : hits ? 'b' : undefined} aria-label={t('weaponPanel')}>
    <div className="wpn-stage" style={tilt}>
      <div className="wpn-back" aria-hidden="true" />

      <div className="wpn-hp">
        <span className="wpn-hp-label">HP</span>
        <span className="wpn-hp-bar" role="meter" aria-valuemin={0} aria-valuemax={AIRCRAFT_HP} aria-valuenow={hp} aria-label="HP">
          {Array.from({ length: HP_SEGMENTS }, (_, i) => <i key={i} data-on={i < lit || undefined} />)}
        </span>
        <strong className="wpn-hp-value">{hp}</strong>
        <span className="wpn-hp-state">{health.toUpperCase()}</span>
      </div>

      <div className="wpn-card wpn-gun" data-state={gunState} data-heat={heat > 0.005 || overheated || undefined} data-firing={firing || undefined} data-denied={denied % 2 ? 'a' : denied ? 'b' : undefined}>
        <span className="wpn-heat" aria-hidden="true"><i style={{ width: `${(heat * 100).toFixed(1)}%` }} /></span>
        <Icon kind="gun" />
        <span className="wpn-cat">{category.gun}{gun.weapon.calibreMm ? ` · ${gun.weapon.calibreMm} MM` : ''}</span>
        <span className="wpn-name">{gunName(gun.weapon.name[locale])}</span>
        <strong className="wpn-value">{Math.round(heat * 100)}<small>%</small></strong>
        <span className="wpn-row"><span className="wpn-foot">{gunState === 'overheat' ? 'OVERHEAT · COOLING' : gunState === 'cooling' ? 'COOLING' : gunState === 'hot' ? 'HEAT HIGH' : 'HEAT'}</span>
          <Key mouse={mouse ? 'left' : undefined} name={keys.fireGun} /></span>
      </div>

      {missiles.map((row, index) => {
        const active = index === selected, empty = row.count === 0
        return <div key={row.station.id} className="wpn-card wpn-missile" data-selected={active || undefined} data-empty={empty || undefined} aria-current={active || undefined}>
          <Icon kind={row.weapon.kind} />
          <span className="wpn-cat">{category[row.weapon.kind]}</span>
          <span className="wpn-name">{row.weapon.name[locale]}</span>
          <strong className="wpn-value">{String(row.count).padStart(2, '0')}</strong>
          <span className="wpn-row"><span className="wpn-pips" aria-hidden="true">{Array.from({ length: row.station.capacity }, (_, i) => <i key={i} data-on={i < row.count || undefined} />)}</span>
            {active
              ? <span className="wpn-launch"><Key mouse={mouse ? 'right' : undefined} name={keys.fireMissile} />{empty ? 'EMPTY' : 'LAUNCH'}</span>
              : <kbd>{keys[index ? 'selectMissile2' : 'selectMissile1']}</kbd>}</span>
        </div>
      })}

      <div className="wpn-card wpn-cm" data-empty={countermeasures.count === 0 || undefined}>
        <Icon kind="countermeasure" />
        <span className="wpn-cat">CM · BURST</span>
        <span className="wpn-name">FLARE + CHAFF</span>
        <strong className="wpn-value">{String(countermeasures.count).padStart(2, '0')}</strong>
        <span className="wpn-row"><span className="wpn-pips" aria-hidden="true">{Array.from({ length: countermeasures.capacity }, (_, i) => <i key={i} data-on={i < countermeasures.count || undefined} />)}</span>
          <span className="wpn-launch"><Key name={keys.countermeasure} />{countermeasures.count === 0 ? 'EMPTY' : 'DROP'}</span></span>
      </div>

    </div>
  </section>
}
