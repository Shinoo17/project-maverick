// Developer visual fixture: the real flight instruments over a synthetic flight,
// without WebGL, pointer lock or the pause dialog. Query: ?t=12 freezes the clock,
// ?lang=en, ?lesson=2, ?lab, ?warning, ?stall, ?recovering, ?size=1280x672.
import { createRef, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import i18n from '../../locales'
import { GameRuntime } from '../../game/runtime/GameRuntime'
import type { AircraftState } from '../../game/state/WorldState'
import { FlightInstruments, FlightSystemStatus, type HudDriver } from './FlightInstruments'
import { PlaygroundHud } from './PlaygroundHud'
import { flightWarning } from './telemetry'
import { angleOfAttack } from '../../game/flight/stall'
import '../../ui/styles.css'
import './flight.css'

const params = new URLSearchParams(location.search)
const frozen = params.has('t') ? Number(params.get('t')) : null
const lesson = Number(params.get('lesson') ?? 0), lab = params.has('lab')
if (params.get('lang')) void i18n.changeLanguage(params.get('lang')!)
const [frameWidth, frameHeight] = (params.get('size') ?? '').split('x').map(Number)
const frame = frameWidth && frameHeight ? { flex: 'none', width: frameWidth, height: frameHeight, minHeight: 0 } : undefined
const deg = Math.PI / 180, up = new Vector3(0, 1, 0)

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
  if (params.has('stall')) state.stall = { severity: 0.8, cause: 'aoa', aoaDeg: 42 }
  if (params.has('recovering')) state.stall = { severity: 0.4, cause: 'none', aoaDeg: 10 }
}

function Preview() {
  const { t } = useTranslation()
  const [driver] = useState(() => createRef<HudDriver>())
  const [state] = useState(() => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0])
  const [telemetry, setTelemetry] = useState<AircraftState>(() => structuredClone(state))
  useEffect(() => {
    const camera = new PerspectiveCamera(69, 1, 0.5, 14000), start = performance.now()
    let request = 0, published = 0
    const tick = (now: number) => {
      fly(state, frozen ?? (now - start) / 1000)
      // Horizon-locked chase camera behind the nose's ground track.
      const position = new Vector3().copy(state.position)
      const track = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation)).setY(0).normalize()
      camera.aspect = (frameWidth || innerWidth) / (frameHeight || innerHeight); camera.updateProjectionMatrix()
      camera.position.copy(position).addScaledVector(track, -70).addScaledVector(up, 14)
      camera.lookAt(new Vector3().copy(position).addScaledVector(track, 400)); camera.updateMatrixWorld()
      driver.current?.({ camera, state, position: state.position, orientation: state.orientation, velocity: state.velocity })
      if (now - published > 100) { published = now; setTelemetry(structuredClone(state)) }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [driver, state])
  const warning = params.has('warning') ? 'lowAltitude' : flightWarning(telemetry)
  return <div className="app-shell is-flight"><main className="flight-root hud-preview-sky" style={frame}><div className="flight-hud">
    <FlightInstruments driver={driver} />
    <div className="flight-identity"><strong>F-22</strong><span>{t('training')} / {t('flatRange')}</span></div>
    <div className="flight-actions"><span>{t('horizonCamera')}</span><button>{t('pauseFlight')} · Esc</button></div>
    <FlightSystemStatus state={telemetry} />
    <PlaygroundHud state={telemetry} lesson={lesson} cameraChanged={false} lab={lab} />
    <p className="flight-warning" role="status">{warning ? t(warning) : ''}</p>
    <p className="flight-controls">{t('controlsHint')}</p>
  </div></main></div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
