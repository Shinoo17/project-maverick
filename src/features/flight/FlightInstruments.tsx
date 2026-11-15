/* THESIS: The reference implementation's fighter glass (example/F22), on the training range.
   OWN-WORLD: One phosphor green drawn onto a single canvas, with a translucent green bloom
   under every mark instead of fills or black outlines.
   STORY: Read attitude off the world-registered ladder, energy off the outboard tapes, incidence
   off the AoA bracket inboard of the speed tape, height and boundary off the status block
   beneath the sightline. The regime (HI AOA, POST STALL…) sets the α row's brightness.
   FIRST VIEWPORT: Heading tape high; ladder and nose pipper central;
   speed/A/B left, altitude/V/S right; GND, EDGE, pitch/bank and α/G below.
   MOTION: The glass is redrawn from the render loop's interpolated pose every frame. React
   renders only the canvas element and a visually hidden readout for screen readers. */
import { memo, useEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Quaternion, Vector3, type Camera } from 'three'
import type { AircraftState, Vec3 } from '../../game/state/WorldState'
import { readFlight } from '../../game/flight/readout'
import { trainingMap } from '../../content/maps'
import { machNumber } from '../../render/vapor/atmosphere'
import { burnerStatus, flightAttitude } from './telemetry'
import { createGlassPainter, type GlassState } from './hudPainter'
import type { GunneryMarks } from './gunnerySymbols'
import type { RadarPicture } from '../../render/radarFrame'
import type { LockMarks } from '../../render/lockFrame'

export interface HudFrame { camera: Camera; state: AircraftState; position: Vec3; orientation: AircraftState['orientation']; velocity: Vec3; gunnery?: GunneryMarks | null
  /** What the radar shows (radarFrame.ts); its contacts are marked on the heading tape. */
  radar?: RadarPicture | null
  /** Mouse aim's direction and the instructor's share (game/input/mouseAim.ts); null in the stick modes. */
  aim?: GlassState['aim']
  /** The missile lock (lockFrame.ts). */
  seeker?: LockMarks | null }
export type HudDriver = (frame: HudFrame) => void

// Past 2x the backing store is pixels nobody can see, repainted every frame.
const MAX_PIXEL_RATIO = 2
const zero = { x: 0, y: 0, z: 0 }
const standby: GlassState = {
  live: false, camera: null, position: zero, forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 0, z: 1 }, velocity: zero, speed: 0, mach: 0, altitude: 0, heading: null, pitch: 0, bank: null,
  verticalSpeed: 0, aoa: 0, gLoad: 1, power: 0, groundClearance: 0, edge: 0, burnerReserve: 0, burnerSeconds: 0, burnerState: 'ready', airbrake: false, highG: false, psm: false,
  regime: 'NORMAL', incidence: 0, alphaNormal: 20, alphaCritical: 30, alphaLimit: 20, alphaMax: 90, gunnery: null, seeker: null, aim: null, contacts: [],
}

const nose = new Vector3(), wing = new Vector3(), attitudeQuaternion = new Quaternion()
export function glassState({ camera, state, position, orientation, velocity, gunnery, aim, radar, seeker }: HudFrame): GlassState {
  // Step values from the state, the air at the drawn (interpolated) pose.
  const flight = readFlight(state, { orientation, velocity }), label = flight.regime
  const attitude = flightAttitude(orientation)
  nose.set(1, 0, 0).applyQuaternion(attitudeQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w))
  wing.set(0, 0, 1).applyQuaternion(attitudeQuaternion)
  const altitude = position.y
  // HUD km/h as the core reads it (the arcade core: true km/h, the others: arcade km/h).
  const speed = flight.hudSpeed
  return {
    live: true, camera, position, velocity, forward: nose, right: wing,
    speed, mach: machNumber(speed / 3.6, altitude),
    altitude, heading: attitude.heading, pitch: attitude.pitch, bank: attitude.bank,
    verticalSpeed: velocity.y, aoa: flight.noseVelocityDeg, gLoad: flight.g, power: flight.power,
    groundClearance: altitude,
    edge: Math.max(0, Math.min(trainingMap.radius - Math.hypot(position.x, position.z), trainingMap.radius - altitude)),
    burnerReserve: flight.burner.reserve, burnerSeconds: flight.burner.seconds, burnerState: flight.burner.status,
    airbrake: flight.airbrake > 0.1, highG: flight.gAllowance > 1.06, psm: label === 'HIGH_AOA' || label === 'POST_STALL' || label === 'RECOVERING',
    regime: label, incidence: flight.incidenceDeg * flight.angleConfidence, alphaNormal: flight.alphaBandDeg.normal, alphaCritical: flight.alphaBandDeg.critical,
    alphaLimit: flight.alphaLimitDeg, alphaMax: flight.alphaBandDeg.max, gunnery: gunnery ?? null, seeker: seeker ?? null, aim: aim ?? null,
    contacts: radar?.contacts.map(({ bearing, painted, locked }) => ({ bearing, painted, locked })) ?? [],
  }
}

export const FlightInstruments = memo(function FlightInstruments({ driver }: { driver: RefObject<HudDriver | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current, frame = element?.parentElement
    if (!element || !frame) return
    const painter = createGlassPainter(element)
    let last: GlassState = standby
    // Sized from the HUD's own box, so a point projected through the flight camera lands on
    // the same pixel as the WebGL view; the ratio is re-read on zoom or display changes.
    const observer = new ResizeObserver(([entry]) => {
      const layout = painter.resize(entry.contentRect.width, entry.contentRect.height, Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO))
      // The advisory plate is HTML (it is announced) and hangs off the glass's own geometry.
      frame.style.setProperty('--hud-advisory-top', `${Math.round(layout.advisoryTop)}px`)
      frame.style.setProperty('--hud-advisory-left', `${Math.round(layout.advisoryLeft)}px`)
      frame.style.setProperty('--hud-advisory-shift', layout.advisoryCentred ? '-50%' : '0%')
      frame.style.setProperty('--hud-status-top', `${Math.round(layout.statusFirst)}px`)
      painter.draw(last)
    })
    observer.observe(frame)
    driver.current = hudFrame => { last = glassState(hudFrame); painter.draw(last) }
    return () => { observer.disconnect(); driver.current = null }
  }, [driver])
  return <canvas ref={canvas} className="hud-glass" aria-hidden="true" />
})

// The glass is invisible to assistive technology; this carries the same readings in text.
export function FlightSystemStatus({ state }: { state: AircraftState | null }) {
  const { t } = useTranslation()
  const flight = state ? readFlight(state) : null
  const heading = state ? flightAttitude(state.orientation).heading : null
  const empty = '—'
  return <dl className="hud-a11y-readout" aria-label={t('hudFlightData')}>
    <div><dt>{t('hudSpeed')}</dt><dd>{flight ? Math.round(flight.hudSpeed) : empty} {t('arcadeUnit')}</dd></div>
    <div><dt>{t('hudMach')}</dt><dd>{flight && state ? machNumber(flight.hudSpeed / 3.6, state.position.y).toFixed(2) : empty}</dd></div>
    <div><dt>{t('altitude')}</dt><dd>{state ? Math.round(state.position.y) : empty} {t('metres')}</dd></div>
    <div><dt>{t('heading')}</dt><dd>{heading === null ? empty : `${Math.round(heading) % 360}°`}</dd></div>
    <div><dt>{t('burner')}</dt><dd>{t(burnerStatus(state))}</dd></div>
    <div><dt>{t('engineOutput')}</dt><dd>{flight ? `${Math.round(flight.power * 100)}%` : empty}</dd></div>
    {state && <div><dt>{t('hudGunHeat')}</dt><dd>{state.gun.overheated ? t('hudGunOverheated') : state.gun.cooling ? t('hudGunCooling') : `${Math.round(state.gun.heat * 100)}%`}</dd></div>}
    {(flight?.airbrake ?? 0) > 0.1 && <div><dt>{t('airbrake')}</dt><dd>{t('hudOn')}</dd></div>}
  </dl>
}
