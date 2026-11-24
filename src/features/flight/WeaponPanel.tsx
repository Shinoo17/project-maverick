/* THESIS: The helmet-mounted weapons column from example/hud-example.html (10 PARALLAX,
   17 PARALLAX COLUMN), floating at the bottom right beside the glass.
   OWN-WORLD: Off-white line art and numerals on a dark grid plane set back in depth. The HUD's
   phosphor green marks only the selected missile that has rounds left; amber a wait that will end
   (damage, the dispensers between bursts); red heat, critical damage and a refused press; grey
   what is spent. No glow, no fills.
   STORY: HP as slanted segments with its state in words, then one card per weapon slot
   (weaponSlots.ts): the gun, each missile station (1–4), the countermeasure dispensers. A cold
   gun card has no plate; once warm it shows a faint track and outline, filled left (0%) to right
   (100%) with heat in off-white, red and flashing past 80%, solid red while locked out (released
   past 80%: until 35%; overheated: until 0). The selected missile card steps toward the pilot and
   carries the launch key, grey once empty; with three or four missiles the others fold to one line
   (icon, name, count, select key). The countermeasure card closes the column: bursts left
   as pips, with its key; between bursts it fills amber like a hot gun, draining to the next burst,
   and its key reads WAIT.
   A refused press belongs to the card it was made on, whatever is selected after: a wait or no
   lock shakes that card with its word in amber; empty flashes its EMPTY red.
   MOTION: The column holds a fixed 3D tilt and sways a few degrees with roll rate and G, eased by
   CSS between 10 Hz telemetry updates; reduced motion keeps it still. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import type { WeaponKind } from '../../content/weapons'
import { AIRCRAFT_HP } from '../../game/combat/damage'
import type { FlightAction, InputPreset, KeyBindings } from '../../game/input/keyBindings'
import type { AircraftState } from '../../game/state/WorldState'
import { readFlight } from '../../game/flight/readout'
import { bindingNames } from '../settings/KeyPrompt'
import { weaponSlots, type MissileRow, type Refusal, type WeaponSlot } from './weaponSlots'
import './weaponPanel.css'

const HP_SEGMENTS = 20
// Matches the wpn-hit animation in weaponPanel.css.
const SHAKE_MS = 420
// How long a refused press holds its word (NO LOCK, WAIT); outlasts wpn-refuse (450 ms) in weaponPanel.css.
const REFUSE_MS = 600
// How long the barrels spin past the last telemetry update with new shots.
const FIRING_MS = 200
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))
// A counter as alternating a/b, so every change restarts its CSS animation.
const pulse = (count: number) => count % 2 ? 'a' : count ? 'b' : undefined

// Side-view line art, 92 × 26, nose to the right. Missiles are drawn by seeker kind, not by
// weapon id, so training rounds never borrow a real missile's outline.
const icons: Record<WeaponKind | 'countermeasure', string> = {
  gun: '<g class="wpn-body"><rect x="6" y="8" width="8" height="8"/><rect x="14" y="5" width="24" height="14" rx="2"/><circle cx="26" cy="12" r="3.5"/><path class="wpn-barrel" d="M38 9H86M38 12H86M38 15H86"/><rect x="56" y="7.5" width="3" height="9"/><rect x="80" y="7" width="3" height="10"/><path d="M18 19L12 25M24 19L18 25"/></g><path class="wpn-flash" d="M89 12L96 7M89 12L99 12M89 12L96 17M89 12L92 4M89 12L92 20"/>',
  ir: '<path d="M8 11H70Q84 11.4 90 13Q84 14.6 70 15H8Z"/><path d="M10 11L6 4H15L20 11M10 15L6 22H15L20 15"/><path d="M62 11L61 8H66L68 11M62 15L61 18H66L68 15"/>',
  radar: '<path d="M4 11H74Q85 11.4 90 13Q85 14.6 74 15H4Z"/><path d="M7 11L3 3H13L18 11M7 15L3 23H13L18 15"/><path d="M40 11L37 6H45L49 11M40 15L37 20H45L49 15"/><path d="M60 11V15M64 11V15"/>',
  // Countermeasures: a flare dropping on a smoke arc, and a chaff cloud of dashes.
  countermeasure: '<path d="M6 6Q26 6 34 18"/><circle cx="36" cy="20" r="2.6"/><path d="M36 13V15M41 15L39.6 16.4M43 20H41M31 15L32.4 16.4"/><path class="wpn-chaff" d="M56 9H60M66 7H70M76 10H80M60 15H64M71 14H75M82 16H86M57 21H61M67 20H71M77 22H81"/>',
}
const Icon = ({ kind }: { kind: WeaponKind | 'countermeasure' }) => <svg className="wpn-icon" viewBox="-2 0 104 26" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[kind] }} />
// The category line already carries the calibre: "M61A2 · 20 mm" → M61A2, "30 mm aircraft cannon" → aircraft cannon.
const gunName = (name: string) => name.split(' · ')[0].replace(/\s*\d+\s*(mm|มม\.)\s*/i, ' ').trim()
const category: Record<WeaponKind | 'countermeasure', string> = { gun: 'GUN', ir: 'IR · SRM', radar: 'RADAR · MRM', countermeasure: 'CM · BURST' }
const cardClass: Record<WeaponKind | 'countermeasure', string> = { gun: 'wpn-gun', ir: 'wpn-missile', radar: 'wpn-missile', countermeasure: 'wpn-cm' }
const refusalWord: Record<Refusal, string> = { empty: 'EMPTY', wait: 'WAIT', nolock: 'NO LOCK' }
const heatWord = { overheat: 'OVERHEAT · COOLING', cooling: 'COOLING', hot: 'HEAT HIGH', ready: 'HEAT' } as const
// Mouse buttons that also fire, in the mouse preset.
const mouseButton: Partial<Record<FlightAction, 'left' | 'right'>> = { fireGun: 'left', fireMissile: 'right' }

/** Refused presses on one slot: how many so far and why the last one was. */
export interface SlotRefusal { count: number; reason: Refusal }

function Key({ mouse, name }: { mouse?: 'left' | 'right'; name: string }) {
  return <span className="wpn-key">{mouse && <><i className="wpn-mouse" data-button={mouse} />{mouse === 'left' ? 'LMB' : 'RMB'}<b>/</b></>}<kbd>{name}</kbd></span>
}

/** A card's own refused presses as a/b for REFUSE_MS after each new one, then nothing. The count
 * the card mounts with is already spent, so a remounted card never replays an old refusal. */
function useRefusal(count: number) {
  const seen = useRef(count)
  const [shown, setShown] = useState<'a' | 'b' | undefined>(undefined)
  useEffect(() => {
    if (count === seen.current) return
    seen.current = count
    setShown(pulse(count))
    const timer = setTimeout(() => setShown(undefined), REFUSE_MS)
    return () => clearTimeout(timer)
  }, [count])
  return shown
}

/** True while `shots` keeps rising: the barrels spin. Telemetry lands every 100 ms, so the spin
 * holds FIRING_MS past the last rise before it stops. */
function useFiring(shots: number) {
  const last = useRef(shots), [firing, setFiring] = useState(false)
  useEffect(() => {
    const rose = shots > last.current
    last.current = shots
    if (!rose) return
    setFiring(true)
    const timer = setTimeout(() => setFiring(false), FIRING_MS)
    return () => clearTimeout(timer)
  }, [shots])
  return firing
}

/** One slot's card. It keeps its own refusal and firing state, keyed by the slot. */
function WeaponCard({ slot, refusal, keys, mouse }: { slot: WeaponSlot; refusal?: SlotRefusal; keys: Record<FlightAction, string>; mouse: boolean }) {
  const { locale } = useSessionSettings()
  const refused = useRefusal(refusal?.count ?? 0), reason = refused ? refusal!.reason : undefined
  const firing = useFiring(slot.shots ?? 0)
  const empty = slot.count === 0, missile = slot.kind === 'ir' || slot.kind === 'radar'
  const fireKey = <Key mouse={mouse ? mouseButton[slot.fire] : undefined} name={keys[slot.fire]} />
  const pips = <span className="wpn-pips" aria-hidden="true">{Array.from({ length: slot.capacity }, (_, i) => <i key={i} data-on={i < slot.count || undefined} />)}</span>
  const word = reason ? refusalWord[reason] : empty ? 'EMPTY' : slot.kind === 'countermeasure' ? slot.fill > 0 ? 'WAIT' : 'DROP' : 'LAUNCH'

  return <div className={`wpn-card ${cardClass[slot.kind]}`} data-selected={missile && slot.selected || undefined} aria-current={missile && slot.selected || undefined}
    data-empty={slot.kind !== 'gun' && empty || undefined} data-denied={refused} data-refused={reason}
    data-state={slot.heat} data-heat={slot.kind === 'gun' && (slot.fill > 0.005 || slot.heat === 'overheat') || undefined} data-firing={firing || undefined}
    data-wait={slot.kind === 'countermeasure' && slot.fill > 0 || undefined}>
    {slot.kind === 'gun' && <span className="wpn-heat" aria-hidden="true"><i style={{ width: `${(slot.fill * 100).toFixed(1)}%` }} /></span>}
    {/* Mounted only while waiting, so a new burst's fill starts full instead of growing back. */}
    {slot.kind === 'countermeasure' && slot.fill > 0 && <span className="wpn-wait" aria-hidden="true"><i style={{ width: `${(slot.fill * 100).toFixed(1)}%` }} /></span>}
    <Icon kind={slot.kind} />
    <span className="wpn-cat">{category[slot.kind]}{slot.weapon?.calibreMm ? ` · ${slot.weapon.calibreMm} MM` : ''}</span>
    <span className="wpn-name">{!slot.weapon ? 'FLARE + CHAFF' : slot.kind === 'gun' ? gunName(slot.weapon.name[locale]) : slot.weapon.name[locale]}</span>
    {slot.kind === 'gun'
      ? <strong className="wpn-value">{Math.round(slot.fill * 100)}<small>%</small></strong>
      : <strong className="wpn-value">{String(slot.count).padStart(2, '0')}</strong>}
    <span className="wpn-row">
      {slot.kind === 'gun' ? <><span className="wpn-foot">{heatWord[slot.heat ?? 'ready']}</span>{fireKey}</>
        : slot.selected ? <>{pips}<span className="wpn-launch">{fireKey}{word}</span></>
        : <>{pips}{slot.select && <kbd>{keys[slot.select]}</kbd>}</>}
    </span>
  </div>
}

export function WeaponPanel({ aircraftId, state, tick, refusals = {}, missiles, preset, bindings, reducedMotion }: {
  aircraftId: string; state: AircraftState | null
  /** The world tick `state` was taken on; without it nothing reads as waiting. */
  tick?: number
  /** Refused presses by slot id (FlightPage); a change to one slot's entry plays on that card only. */
  refusals?: Readonly<Record<string, SlotRefusal>>
  /** Preview only: missile stations in place of the aircraft's own. */
  missiles?: readonly MissileRow[]
  preset: InputPreset; bindings: KeyBindings; reducedMotion: boolean
}) {
  const { t } = useTranslation()
  const keys = bindingNames(bindings), mouse = preset === 'mouse'
  const slots = weaponSlots(aircraftId, state, tick, missiles)

  // A drop in HP shakes the column. Damage lands every telemetry update under sustained fire, so
  // a shake never restarts before the last one ends.
  const last = useRef({ hp: AIRCRAFT_HP, shook: 0 })
  const [hits, setHits] = useState(0)
  useEffect(() => {
    if (!state) return
    const now = performance.now()
    if (state.hp < last.current.hp && now - last.current.shook > SHAKE_MS) { setHits(count => count + 1); last.current.shook = now }
    last.current.hp = state.hp
  }, [state])

  const hp = state ? Math.max(0, Math.round(state.hp)) : AIRCRAFT_HP
  const health = hp < 30 ? 'critical' : hp < 60 ? 'damaged' : 'nominal'
  const lit = Math.ceil(hp / (AIRCRAFT_HP / HP_SEGMENTS))
  const sway = reducedMotion ? 0 : clamp(-(state?.rates.roll ?? 0) * 1.4, 4)
  const sag = reducedMotion ? 0 : clamp(((state ? readFlight(state).g : 1) - 1) * 0.5, 3)
  const tilt = { '--wpn-sway': `${sway.toFixed(2)}deg`, '--wpn-sag': `${sag.toFixed(2)}deg`, '--wpn-drop': `${(sag * 2).toFixed(1)}px` } as CSSProperties

  // Three or four missiles fold the unselected ones to one line, so the column clears the HUD tapes.
  const crowded = slots.filter(slot => slot.fire === 'fireMissile').length > 2
  return <section className="wpn" data-health={health} data-hit={pulse(hits)} data-crowded={crowded || undefined} aria-label={t('weaponPanel')}>
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

      {slots.map(slot => <WeaponCard key={slot.id} slot={slot} refusal={refusals[slot.id]} keys={keys} mouse={mouse} />)}
    </div>
  </section>
}
