// Developer visual fixture: the real flight instruments over a synthetic flight,
// without WebGL, pointer lock or the pause dialog. Query: ?t=12 freezes the clock,
// ?lang=en, ?lesson=2, ?lab, ?warning, ?stall, ?recovering, ?psm, ?size=1280x672,
// ?gun (a target crossing 550 m ahead: box, HP, lead, reticle; ?gun=hit adds a hit each second,
// ?gun=assist shows the ASSIST label). Radar: ?radar (four contacts: a lock off screen right on its
// grace time, one painted ahead, one close behind seen by eye, one painted past the scope; ?radar=held keeps
// the lock inside the cone). Weapons column: ?aircraft=su57, ?heat=0.85 (?heat=cycle fires to overheat and cools), ?ovht, ?cooling, ?deny (a refused trigger press each second), ?hp=25, ?sel=1, ?firing.
import { createRef, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import i18n from '../../locales'
import { GameRuntime } from '../../game/runtime/GameRuntime'
import type { AircraftState } from '../../game/state/WorldState'
import { FlightInstruments, FlightSystemStatus, type HudDriver } from './FlightInstruments'
import { PlaygroundHud } from './PlaygroundHud'
import { WeaponPanel } from './WeaponPanel'
import { flightWarning } from './telemetry'
import { defaultBindings } from '../../game/input/keyBindings'
import { bindingNames } from '../settings/KeyPrompt'
import { angleOfAttack } from '../../game/flight/stall'
import { createGunnery } from '../../render/gunneryFrame'
import { radarFrame } from '../../render/radarFrame'
import { RadarScope, type RadarDriver } from './RadarScope'
import type { GameEvent } from '../../game/runtime/events'
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
const radar = params.get('radar')
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
}

function Preview() {
  const { t } = useTranslation()
  const [driver] = useState(() => createRef<HudDriver>())
  const [radarDriver] = useState(() => createRef<RadarDriver>())
  const [world] = useState(() => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: radar !== null ? [aircraftId, 'su57', 'su57', 'su57'] : [aircraftId], targetDrone: 'still' }).snapshot())
  const state = world.aircraft[0], target = world.aircraft[1]
  const [telemetry, setTelemetry] = useState<AircraftState>(() => structuredClone(state))
  useEffect(() => {
    const camera = new PerspectiveCamera(69, 1, 0.5, 14000), start = performance.now()
    let request = 0, published = 0
    // The target crosses 550 m out, a little right of the nose, turning at about 3 g, at 70% HP.
    const marks = createGunnery('f22')
    const previewGunnery = (seconds: number) => {
      const nose = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
      const right = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().copy(state.orientation))
      const at = new Vector3().copy(state.position).addScaledVector(nose, 550).addScaledVector(right, 40)
      target.position = { x: at.x, y: at.y, z: at.z }
      target.velocity = { x: -right.x * 150, y: -right.y * 150, z: -right.z * 150 }
      target.acceleration = { x: nose.x * 30, y: nose.y * 30, z: nose.z * 30 }
      target.hp = 70
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
      state.targeting = { targetId: locked.id, outside: radar === 'held' ? 0 : 1.2 + (seconds % 1.5) }
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
      const gunnery = scope?.gunnery ?? (params.has('gun') ? previewGunnery(seconds) : null)
      radarDriver.current?.(scope?.picture ?? null, seconds)
      driver.current?.({ camera, state, position: state.position, orientation: state.orientation, velocity: state.velocity, gunnery, radar: scope?.picture })
      if (now - published > 100) { published = now; setTelemetry(structuredClone(state)) }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [driver, radarDriver, state, world, target])
  const warning = params.has('warning') ? 'lowAltitude' : flightWarning(telemetry)
  return <div className="app-shell is-flight"><main className="flight-root hud-preview-sky" style={frame}><div className="flight-hud">
    <FlightInstruments driver={driver} />
    <RadarScope driver={radarDriver} />
    <div className="flight-identity"><strong>F-22</strong><span>{t('training')} / {t('flatRange')}</span></div>
    <div className="flight-actions"><span>{t('cameraRollHorizon')}</span><button>{t('pauseFlight')} · Esc</button></div>
    <FlightSystemStatus state={telemetry} />
    {!lab && <WeaponPanel aircraftId={aircraftId} state={telemetry} selected={Number(params.get('sel') ?? 0)} denied={params.has('deny') ? Math.floor(performance.now() / 1000) : 0} preset="mouse" bindings={defaultBindings} reducedMotion={false} />}
    <PlaygroundHud state={telemetry} lesson={lesson} cameraChanged={false} lab={lab} />
    <p className="flight-warning" role="status">{warning ? t(warning) : ''}</p>
    <p className="flight-controls">{t('controlsHint', bindingNames(defaultBindings))}</p>
  </div></main></div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
