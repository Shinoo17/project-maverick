// Developer visual fixture: the real flight instruments over a synthetic flight,
// without WebGL, pointer lock or the pause dialog. Query: ?t=12 freezes the clock,
// ?lang=en, ?lesson=2, ?lab, ?warning, ?stall, ?recovering, ?psm, ?size=1280x672,
// ?gun (a target crossing 550 m ahead: box, HP, lead, reticle; ?gun=hit adds a hit each second,
// ?gun=assist shows the ASSIST label, ?gun=far puts it 1,300 m out, past the gun's reach: the dashed lead). Radar: ?radar (four contacts: a lock off screen right on its
// grace time, one painted ahead, one close behind seen by eye, one painted past the scope; our missile flying
// at the lock, the painted one's missile coming at us, and one behind out of sight; ?radar=held keeps
// the lock inside the cone). RWR: ?rwr (the radar fixtures turned on the player: the lock off the right locks
// it with a radar missile, the painted one's missile has gone active, the close one behind searches). Missile lock: ?lock (with the ?gun target; cycles search, tracking, acquiring, locked,
// lock lost), ?lock=0.45 holds that progress, ?lock=locked holds the lock. Weapons column: ?aircraft=su57, ?heat=0.85 (?heat=cycle fires to overheat and cools), ?ovht, ?cooling, ?hp=25, ?sel=1, ?firing,
// ?missiles=4 (1–4 missile slots, extra ones copied from the aircraft's), ?empty, ?wait (the dispensers' wait cycling),
// ?deny=empty|wait|nolock (a refused press each second on the gun, the selected missile and the dispensers;
// with ?flip the selection steps to the next missile 0.3 s after each refusal, which must stay on the card refused).
// The settings panel (top right, toggled with `) writes the same query and reloads; ?nopanel hides it for captures.
import { createRef, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import i18n from '../../locales'
import { GameRuntime } from '../../game/runtime/GameRuntime'
import type { AircraftState } from '../../game/state/WorldState'
import { FlightInstruments, FlightSystemStatus, type HudDriver } from './FlightInstruments'
import { PlaygroundHud, lessonLabels } from './PlaygroundHud'
import { WeaponPanel, type SlotRefusal } from './WeaponPanel'
import type { MissileRow, Refusal } from './weaponSlots'
import { flightWarning } from './telemetry'
import { defaultBindings } from '../../game/input/keyBindings'
import { bindingNames } from '../settings/KeyPrompt'
import { angleOfAttack } from '../../game/flight/stall'
import { createGunnery } from '../../render/gunneryFrame'
import { radarFrame } from '../../render/radarFrame'
import { RadarScope, type RadarDriver } from './RadarScope'
import { RwrScope, type RwrDriver } from './RwrScope'
import { createRwrFrame } from '../../render/rwrFrame'
import { gunStation, missileStations } from '../../content/weapons'
import { getAircraft, playgroundAircraft } from '../../content/aircraft'
import { createLockFrame } from '../../render/lockFrame'
import { createSeekerState, seekerRules } from '../../game/combat/seeker'
import type { GameEvent } from '../../game/runtime/events'
import { launchMissile } from '../../game/combat/missiles'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/600-italic.css'
import '@fontsource/barlow-condensed/700-italic.css'
import '@fontsource/ibm-plex-mono/500.css'
import '../../ui/styles.css'
import './flight.css'

const params = new URLSearchParams(location.search)
const frozen = params.has('t') ? Number(params.get('t')) : null
const lesson = Number(params.get('lesson') ?? 0), lab = params.has('lab')
if (params.get('lang')) void i18n.changeLanguage(params.get('lang')!)
const [frameWidth, frameHeight] = (params.get('size') ?? '').split('x').map(Number)
const frame = frameWidth && frameHeight ? { flex: 'none', width: frameWidth, height: frameHeight, minHeight: 0 } : undefined
const deg = Math.PI / 180, up = new Vector3(0, 1, 0)
const aircraftId = params.get('aircraft') ?? 'f22'
const rwr = params.has('rwr')
const radar = params.get('radar') ?? (rwr ? '' : null)
const lock = params.get('lock')
const ownMissiles = missileStations(getAircraft(aircraftId))
const previewMissiles: MissileRow[] = Array.from({ length: Number(params.get('missiles') ?? ownMissiles.length) }, (_, index) => {
  const row = ownMissiles[index % ownMissiles.length]
  return index < ownMissiles.length ? row : { station: { ...row.station, id: `${row.station.id}-${index}` }, weapon: row.weapon }
})
const ownGun = gunStation(getAircraft(aircraftId)).station.id
const deny = params.has('deny') ? (params.get('deny') || 'empty') as Refusal : null
/** The missile slot selected at `seconds` of page time: ?sel, or with ?flip the next one 0.3 s past each whole second. */
const previewSlot = (seconds: number) => params.has('flip') ? (Math.floor(seconds - 0.3) % previewMissiles.length + previewMissiles.length) % previewMissiles.length : Number(params.get('sel') ?? 0)
/** ?deny: each slot's refusals by page time. A refusal lands each whole second on the missile selected then, and on the gun and dispensers unless ?flip. */
function previewRefusals(seconds: number): Record<string, SlotRefusal> {
  if (!deny) return {}
  const beat = Math.floor(seconds), n = previewMissiles.length, out: Record<string, SlotRefusal> = {}
  previewMissiles.forEach((row, slot) => {
    // The last whole second on which this slot was selected.
    const last = beat - ((beat - 1 - slot) % n + n) % n
    if (params.has('flip')) out[row.station.id] = { count: last, reason: deny }
    else if (slot === previewSlot(seconds)) out[row.station.id] = { count: beat, reason: deny }
  })
  if (!params.has('flip')) Object.assign(out, { [ownGun]: { count: beat, reason: 'wait' }, countermeasures: { count: beat, reason: deny === 'empty' ? 'empty' : 'wait' } })
  return out
}
/** The ?lock cycle in seconds: search, the climb to the lock, the lock held, the lock lost and bleeding away. */
const LOCK_CYCLE = { search: 1, climb: 2.4, hold: 2, lost: 1.8 }
function previewSeeker(seconds: number) {
  const seeker = createSeekerState(previewSlot(performance.now() / 1000))
  seeker.targetId = 'drone-1'
  if (lock === 'locked') return Object.assign(seeker, { progress: 1, locked: true, tracking: true })
  if (lock && lock !== '' && Number.isFinite(Number(lock))) return Object.assign(seeker, { progress: Number(lock), tracking: true })
  const { search, climb, hold, lost } = LOCK_CYCLE
  const t = seconds % (search + climb + hold + lost)
  if (t < search) return seeker
  if (t < search + climb) return Object.assign(seeker, { progress: (t - search) / climb, tracking: true })
  if (t < search + climb + hold) return Object.assign(seeker, { progress: 1, locked: true, tracking: true })
  const since = t - search - climb - hold
  return Object.assign(seeker, { progress: Math.max(0, 1 - since / 1.2), lost: since < seekerRules.lostSeconds ? since : null })
}
/** Radar fixtures: degrees right of the nose's track, metres out, metres above. The first is locked. */
const radarContacts = [[radar === 'held' ? 40 : 75, 1500, 0], [-20, 3500, 600], [160, 1200, -300], [30, 7000, 0]] as const

function fly(state: AircraftState, t: number) {
  const heading = 40 + t * 12, pitch = 9 * Math.sin(t * 0.45), bank = 38 * Math.sin(t * 0.37), speed = 110 + 22 * Math.sin(t * 0.3)
  const q = new Quaternion().setFromAxisAngle(up, -heading * deg)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitch * deg))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bank * deg))
  // Velocity lags the nose by a few degrees, as it does in a real turn.
  const path = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromAxisAngle(up, -heading * deg)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (pitch - 4) * deg))).multiplyScalar(speed)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  state.velocity = { x: path.x, y: path.y, z: path.z }
  state.position = { x: 1800 * Math.cos(t * 0.05), y: 1100 + 180 * Math.sin(t * 0.25), z: 900 * Math.sin(t * 0.05) }
  state.enginePower = 0.72
  const m = state.maneuver
  m.burner = 0.55 + 0.45 * Math.sin(t * 0.2); m.burnerActive = Math.sin(t * 0.2) > 0.6
  m.g = 1 + Math.abs(bank) / 12; m.alpha = 4
  state.stall = { severity: 0, cause: 'none', aoaDeg: angleOfAttack(state) }
  // Explicit visual fixtures; the flight runtime remains the only physics owner.
  if (params.has('psm')) {
    state.thrustVectoring = { left: 12, right: 18, authority: 1 }
  }
  if (params.has('stall')) state.stall = { severity: 0.8, cause: 'aoa', aoaDeg: 42 }
  if (params.has('recovering')) state.stall = { severity: 0.4, cause: 'none', aoaDeg: 10 }
  state.rates = { pitch: 0.1, yaw: 0, roll: 0.9 * Math.cos(t * 0.37) }
  if (params.get('heat') === 'cycle') {
    // 2 s of fire to overheat, then the overheat lockout cooling to 0 at 0.5/s, like the M61 profile.
    const phase = t % 4
    state.gun.heat = phase < 2 ? phase / 2 : Math.max(0, 1 - (phase - 2) * 0.5)
    state.gun.overheated = phase >= 2 && state.gun.heat > 0
    state.gun.shots = phase < 2 ? Math.floor(t * 50) : state.gun.shots
  } else if (params.has('heat')) state.gun.heat = Number(params.get('heat'))
  if (params.has('ovht')) { state.gun.heat = 0.9; state.gun.overheated = true }
  if (params.has('cooling')) { state.gun.heat = 0.6; state.gun.cooling = true }
  if (params.has('firing')) state.gun.shots = Math.floor(t * 50)
  if (params.has('hp')) state.hp = Number(params.get('hp'))
  // Stores for the copied missile stations, and the selected slot.
  for (const row of previewMissiles) if (!state.stores.some(store => store.stationId === row.station.id)) state.stores.push({ stationId: row.station.id, weaponId: row.weapon.id, count: Math.max(1, row.station.capacity - 1) })
  state.targeting.seeker.slot = previewSlot(performance.now() / 1000)
  // Empty stores (the gun card shows heat, not rounds) and dispensers; the dispensers' wait between bursts, cycling every 2.2 s (preview tick 0).
  if (params.has('empty')) { state.stores = state.stores.map(store => ({ ...store, count: 0 })); state.countermeasures.bursts = 0 }
  if (params.has('wait')) state.countermeasures.readyTick = Math.round((1 - (t % 2.2) / 2.2) * 132)
}

/** A query value: null leaves the key out, '' writes it bare (?lab). */
type QueryValue = string | null
type Field = { key: string; label: string } & (
  | { kind: 'flag' }
  | { kind: 'choice'; options: readonly (readonly [QueryValue, string])[] }
  | { kind: 'number'; min?: number; max?: number; step?: number; placeholder: string })
const off = [null, 'ปิด'] as const
const settingGroups: readonly { title: string; fields: readonly Field[] }[] = [
  { title: 'ฉาก', fields: [
    { key: 'aircraft', label: 'เครื่องบิน', kind: 'choice', options: playgroundAircraft.map(entry => [entry.id === 'f22' ? null : entry.id, `${entry.designation} ${entry.name}`] as const) },
    { key: 'lang', label: 'ภาษา', kind: 'choice', options: [[null, 'ตามระบบ'], ['th', 'ไทย'], ['en', 'English']] },
    { key: 'size', label: 'ขนาดจอ', kind: 'choice', options: [[null, 'เต็มหน้าต่าง'], ['1280x672', '1280 × 672'], ['1366x768', '1366 × 768'], ['1920x1080', '1920 × 1080'], ['1024x640', '1024 × 640']] },
    { key: 't', label: 'หยุดเวลาที่ (วินาที)', kind: 'number', min: 0, step: 0.5, placeholder: 'เดินตามจริง' },
    { key: 'lesson', label: 'บทฝึก', kind: 'choice', options: [[null, 'ไม่มี'], ...lessonLabels.slice(1).map((_, index) => [String(index + 1), `บทที่ ${index + 1}`] as const)] },
    { key: 'lab', label: 'Lab (ข้อมูลดีบัก, ซ่อนแผงอาวุธ)', kind: 'flag' },
  ] },
  { title: 'สภาพการบิน', fields: [
    { key: 'warning', label: 'คำเตือนบินต่ำ', kind: 'flag' },
    { key: 'stall', label: 'Stall', kind: 'flag' },
    { key: 'recovering', label: 'กำลังฟื้นจาก stall', kind: 'flag' },
    { key: 'psm', label: 'PSM (thrust vectoring)', kind: 'flag' },
  ] },
  { title: 'ปืนและล็อกเป้า', fields: [
    { key: 'gun', label: 'เป้าปืน', kind: 'choice', options: [off, ['', '550 m'], ['hit', 'โดนทุกวินาที'], ['assist', 'ASSIST'], ['far', '1,300 m (เกินระยะ)']] },
    { key: 'lock', label: 'ล็อกมิสไซล์', kind: 'choice', options: [off, ['', 'วนทุกขั้น'], ['0.25', 'ค้าง 25%'], ['0.45', 'ค้าง 45%'], ['0.75', 'ค้าง 75%'], ['locked', 'ล็อกแล้ว']] },
    { key: 'still', label: 'Reduced motion (กรอบล็อก)', kind: 'flag' },
  ] },
  { title: 'เรดาร์', fields: [
    { key: 'radar', label: 'เรดาร์', kind: 'choice', options: [off, ['', 'ล็อกหลุดกรวย'], ['held', 'ล็อกในกรวย']] },
    { key: 'rwr', label: 'RWR (ถูกล็อก)', kind: 'flag' },
  ] },
  { title: 'แผงอาวุธ', fields: [
    { key: 'heat', label: 'ความร้อนปืน', kind: 'choice', options: [off, ['cycle', 'ยิงจน overheat แล้วเย็น'], ['0.3', '30%'], ['0.6', '60%'], ['0.85', '85%'], ['0.95', '95%']] },
    { key: 'ovht', label: 'Overheat', kind: 'flag' },
    { key: 'cooling', label: 'กำลังเย็น', kind: 'flag' },
    { key: 'firing', label: 'กำลังยิง', kind: 'flag' },
    { key: 'hp', label: 'HP', kind: 'number', min: 0, max: 100, step: 5, placeholder: '100' },
    { key: 'missiles', label: 'จำนวนช่องมิสไซล์', kind: 'choice', options: [[null, 'ตามเครื่องบิน'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
    { key: 'sel', label: 'ช่องที่เลือก', kind: 'choice', options: [[null, '1'], ['1', '2'], ['2', '3'], ['3', '4']] },
    { key: 'empty', label: 'หมด (มิสไซล์ + flare)', kind: 'flag' },
    { key: 'wait', label: 'Flare รอบรรจุ (วน)', kind: 'flag' },
    { key: 'deny', label: 'กดแล้วถูกปฏิเสธ', kind: 'choice', options: [off, ['empty', 'หมด'], ['wait', 'รอ'], ['nolock', 'NO LOCK']] },
    { key: 'flip', label: 'สลับช่องหลังถูกปฏิเสธ', kind: 'flag' },
  ] },
]
const panelKey = 'maverick.hudPreview.panel'
function readPanelOpen() { try { return localStorage.getItem(panelKey) !== 'closed' } catch { return true } }
function writePanelOpen(open: boolean) { try { localStorage.setItem(panelKey, open ? 'open' : 'closed') } catch { /* storage blocked */ } }
/** The query as typed by hand: bare keys for flags, in panel order. */
function queryString(values: URLSearchParams) {
  const parts = [...values].map(([key, value]) => value === '' ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  return parts.length ? `?${parts.join('&')}` : ''
}
/** Settings that rewrite the query and reload: every fixture reads it once at load. */
function SettingsPanel() {
  const [open, setOpen] = useState(readPanelOpen)
  const toggle = (next: boolean) => { setOpen(next); writePanelOpen(next) }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.code === 'Backquote' && !(event.target instanceof HTMLInputElement)) setOpen(now => { writePanelOpen(!now); return !now }) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  const apply = (key: string, value: QueryValue) => {
    if ((params.get(key) ?? null) === value) return
    const next = new URLSearchParams()
    // Panel order first, then any keys the panel does not know.
    for (const field of settingGroups.flatMap(group => group.fields)) {
      const current = field.key === key ? value : params.get(field.key)
      if (current !== null) next.set(field.key, current)
    }
    for (const [other, current] of params) if (!next.has(other) && other !== key) next.set(other, current)
    location.search = queryString(next)
  }
  if (!open) return <button className="hud-settings-toggle" onClick={() => toggle(true)} aria-expanded="false">ตั้งค่า preview · `</button>
  return <aside className="hud-settings" aria-label="ตั้งค่า HUD preview">
    <header><h2>HUD preview</h2><button onClick={() => toggle(false)} aria-expanded="true">ซ่อน · `</button></header>
    {settingGroups.map(group => <fieldset key={group.title}><legend>{group.title}</legend>
      {group.fields.map(field => {
        const id = `hud-setting-${field.key}`, current = params.get(field.key)
        if (field.kind === 'flag') return <label key={field.key} className="is-flag"><input id={id} type="checkbox" checked={current !== null} onChange={event => apply(field.key, event.target.checked ? '' : null)} />{field.label}</label>
        if (field.kind === 'choice') {
          const index = Math.max(0, field.options.findIndex(([value]) => value === current))
          return <label key={field.key} htmlFor={id}>{field.label}<select id={id} value={index} onChange={event => apply(field.key, field.options[Number(event.target.value)][0])}>
            {field.options.map(([, text], option) => <option key={option} value={option}>{text}</option>)}
          </select></label>
        }
        const commit = (text: string) => apply(field.key, text.trim() === '' ? null : text.trim())
        return <label key={field.key} htmlFor={id}>{field.label}<input id={id} type="number" min={field.min} max={field.max} step={field.step} placeholder={field.placeholder} defaultValue={current ?? ''}
          onBlur={event => commit(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commit(event.currentTarget.value) }} /></label>
      })}
    </fieldset>)}
    <footer><code>{queryString(params) || '(ค่าเริ่มต้น)'}</code><button onClick={() => { location.search = '' }} disabled={!params.size}>รีเซ็ตทั้งหมด</button></footer>
  </aside>
}

function Preview() {
  const { t } = useTranslation()
  const [driver] = useState(() => createRef<HudDriver>())
  const [radarDriver] = useState(() => createRef<RadarDriver>())
  const [rwrDriver] = useState(() => createRef<RwrDriver>())
  const [rwrFrame] = useState(createRwrFrame)
  const [world] = useState(() => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: radar !== null ? [aircraftId, 'su57', 'su57', 'su57'] : [aircraftId], targetDrone: 'still' }).snapshot())
  const state = world.aircraft[0], target = world.aircraft[1]
  const [telemetry, setTelemetry] = useState<AircraftState>(() => structuredClone(state))
  useEffect(() => {
    const camera = new PerspectiveCamera(69, 1, 0.5, 14000), start = performance.now()
    let request = 0, published = 0
    // The target crosses 550 m out (1,300 m with ?gun=far), a little right of the nose, turning at about 3 g, at 70% HP.
    const marks = createGunnery('f22')
    const lockFrame = createLockFrame()
    const previewGunnery = (seconds: number) => {
      const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
      const right = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().copy(state.orientation))
      const at = new Vector3().copy(state.position).addScaledVector(nose, params.get('gun') === 'far' ? 1300 : 550).addScaledVector(right, 40)
      target.position = { x: at.x, y: at.y, z: at.z }
      target.velocity = { x: -right.x * 150, y: -right.y * 150, z: -right.z * 150 }
      target.acceleration = { x: nose.x * 30, y: nose.y * 30, z: nose.z * 30 }
      target.hp = 70
      // The lock fixture turns the target, so the frame and outline can be seen following its attitude.
      if (lock !== null) {
        const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), right.clone().negate())
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.9 * Math.sin(seconds * 0.7)))
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.25 * Math.sin(seconds * 0.4)))
        target.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
      }
      world.tick = Math.round(seconds * 60)
      const events: GameEvent[] = params.get('gun') === 'hit' && world.tick % 60 === 0 ? [{ id: 'preview', tick: world.tick, type: 'damage-applied', targetId: 'drone-1', sourceId: state.id, amount: 2 }] : []
      return marks.update(world, world, 1, { id: state.id, targetId: 'drone-1', position: state.position, orientation: state.orientation, velocity: state.velocity }, events, params.get('gun') === 'assist')
    }
    const previewRadar = (seconds: number) => {
      const track = Math.atan2(new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation)).z, new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation)).x)
      radarContacts.forEach(([right, range, above], index) => {
        const entity = world.aircraft[index + 1], bearing = track + right * deg
        entity.position = { x: state.position.x + Math.cos(bearing) * range, y: state.position.y + above, z: state.position.z + Math.sin(bearing) * range }
        entity.velocity = { x: Math.cos(bearing + 1.2) * 150, y: 0, z: Math.sin(bearing + 1.2) * 150 }
        entity.alive = true
      })
      // The drone is not one of the fixtures.
      world.aircraft.slice(radarContacts.length + 1).forEach(entity => { entity.alive = false })
      const locked = world.aircraft[1]
      // Missiles: [from, toward, metres out from the player along the line from it, speed]. The
      // last flies behind the player, past visual range and outside the cone: not shown.
      world.missiles = ([[state, locked, 0.55, 700], [world.aircraft[2], state, 0.6, 750], [world.aircraft[3], state, 3.0, 750]] as const).map(([from, to, share, speed], index) => {
        const missile = launchMissile(index + 1, 0, from, from.id === state.id ? 'aim120' : 'training-radar', to, { stationId: 'preview', mount: 'bay', point: [0, 0, 0] }, true)
        const line = new Vector3(to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z)
        const at = new Vector3(from.position.x, from.position.y, from.position.z).addScaledVector(line, from.id === state.id ? share : 1 - share)
        if (index === 2) at.set(state.position.x, state.position.y, state.position.z).addScaledVector(line.normalize(), -share * 1000)
        missile.position = { x: at.x, y: at.y, z: at.z }
        line.setLength(speed); missile.velocity = { x: line.x, y: line.y, z: line.z }
        return missile
      })
      if (rwr) {
        // Every contact's nose on the player; the lock locks it with a radar missile; the painted one's missile is active.
        for (const entity of world.aircraft.slice(1, radarContacts.length + 1)) {
          const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(state.position.x - entity.position.x, state.position.y - entity.position.y, state.position.z - entity.position.z).normalize())
          entity.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
        }
        locked.targeting = { ...locked.targeting, targetId: state.id, seeker: { ...locked.targeting.seeker, slot: missileStations(getAircraft(locked.aircraftId)).findIndex(row => row.weapon.kind === 'radar') } }
        world.missiles[1] = { ...world.missiles[1], guidance: 'active' }
      }
      state.targeting = { ...state.targeting, targetId: locked.id, outside: radar === 'held' ? 0 : 1.2 + (seconds % 1.5) }
      world.tick = Math.round(seconds * 60)
      const gunnery = createGunnery(aircraftId).update(world, world, 1, { id: state.id, targetId: locked.id, lockOutside: state.targeting.outside, position: state.position, orientation: state.orientation, velocity: state.velocity }, [])
      return { gunnery, picture: radarFrame(world, world, 1, state, state) }
    }
    const tick = (now: number) => {
      fly(state, frozen ?? (now - start) / 1000)
      // Horizon-locked chase camera behind the nose's ground track.
      const position = new Vector3().copy(state.position)
      const track = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation)).setY(0).normalize()
      camera.aspect = (frameWidth || innerWidth) / (frameHeight || innerHeight); camera.updateProjectionMatrix()
      camera.position.copy(position).addScaledVector(track, -70).addScaledVector(up, 14)
      camera.lookAt(new Vector3().copy(position).addScaledVector(track, 400)); camera.updateMatrixWorld()
      const seconds = frozen ?? (now - start) / 1000
      const scope = radar !== null ? previewRadar(seconds) : null
      const gunnery = scope?.gunnery ?? (params.has('gun') || lock !== null ? previewGunnery(seconds) : null)
      if (lock !== null) { state.targeting = { ...state.targeting, targetId: 'drone-1', seeker: previewSeeker(seconds) } }
      const seeker = lock !== null ? lockFrame.update(world, world, 1, state, camera.position, params.has('still')) : null
      radarDriver.current?.(scope?.picture ?? null, seconds)
      rwrDriver.current?.(scope ? rwrFrame.update(world, state, seconds) : null, seconds)
      driver.current?.({ camera, state, position: state.position, orientation: state.orientation, velocity: state.velocity, gunnery, radar: scope?.picture, seeker })
      if (now - published > 100) { published = now; setTelemetry(structuredClone(state)) }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [driver, radarDriver, rwrDriver, rwrFrame, state, world, target])
  const warning = params.has('warning') ? 'lowAltitude' : flightWarning(telemetry)
  return <div className="app-shell is-flight"><main className="flight-root hud-preview-sky" style={frame}><div className="flight-hud">
    <FlightInstruments driver={driver} />
    <RadarScope driver={radarDriver} />
    <RwrScope driver={rwrDriver} />
    <div className="flight-identity"><strong>F-22</strong><span>{t('training')} / {t('flatRange')}</span></div>
    <div className="flight-actions"><span>{t('cameraRollHorizon')}</span><button>{t('pauseFlight')} · Esc</button></div>
    <FlightSystemStatus state={telemetry} />
    {!lab && <WeaponPanel aircraftId={aircraftId} state={telemetry} tick={params.has('wait') ? 0 : undefined} refusals={previewRefusals(performance.now() / 1000)} missiles={previewMissiles} preset="mouse" bindings={defaultBindings} reducedMotion={false} />}
    <PlaygroundHud state={telemetry} lesson={lesson} cameraChanged={false} lab={lab} />
    <p className="flight-warning" role="status">{warning ? t(warning) : ''}</p>
    <p className="flight-controls">{t('controlsHint', bindingNames(defaultBindings))}</p>
  </div></main>{!params.has('nopanel') && <SettingsPanel />}</div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
