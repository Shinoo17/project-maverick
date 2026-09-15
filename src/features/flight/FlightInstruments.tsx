/* THESIS: The reference implementation's fighter glass (example/F22), on the training range.
   OWN-WORLD: One phosphor green drawn onto a single canvas, with a translucent green bloom
   under every mark instead of fills or black outlines.
   STORY: Read attitude off the world-registered ladder, energy off the outboard tapes and the
   PSM band bracket, height and boundary off the status block beneath the sightline.
   FIRST VIEWPORT: Heading tape high; ladder and nose pipper central;
   speed/A/B left, altitude/V/S right; GND, EDGE, pitch/bank and α/G below.
   MOTION: The glass is redrawn from the render loop's interpolated pose every frame. React
   renders only the canvas element and a visually hidden readout for screen readers. */
import { memo, useEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Quaternion, Vector3, type Camera } from 'three'
import type { AircraftState, Vec3 } from '../../game/state/WorldState'
import { arcadeSpeed } from '../../game/flight/speed'
import { getFlightProfile } from '../../game/flight/profile'
import { aircraft } from '../../content/aircraft'
import { trainingMap } from '../../content/maps'
import { burnerStatus, flightAttitude } from './telemetry'
import { createGlassPainter, type BurnerState, type GlassState } from './hudPainter'

export interface HudFrame { camera: Camera; state: AircraftState; position: Vec3; orientation: AircraftState['orientation']; velocity: Vec3 }
export type HudDriver = (frame: HudFrame) => void

// Past 2x the backing store is pixels nobody can see, repainted every frame.
const MAX_PIXEL_RATIO = 2
const burnerStates: Record<string, BurnerState> = {
  hudBurnerActive: 'engaged', hudBurnerLocked: 'depleted', hudBurnerBlocked: 'inhibited', recharging: 'recharging', hudBurnerReady: 'ready', hudWaiting: 'ready',
}
const zero = { x: 0, y: 0, z: 0 }
const standby: GlassState = {
  live: false, camera: null, position: zero, forward: { x: 1, y: 0, z: 0 }, velocity: zero, speed: 0, altitude: 0, heading: null, pitch: 0, bank: null,
  verticalSpeed: 0, aoa: 0, gLoad: 1, power: 0, groundClearance: 0, edge: 0, burnerReserve: 0, burnerSeconds: 0, burnerState: 'ready', airbrake: false, highG: false, psm: false,
}

const nose = new Vector3(), attitudeQuaternion = new Quaternion()
export function glassState({ camera, state, position, orientation, velocity }: HudFrame): GlassState {
  const m = state.maneuver, maneuverProfile = getFlightProfile(state.aircraftId).maneuver
  const attitude = flightAttitude(orientation)
  nose.set(1, 0, 0).applyQuaternion(attitudeQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w))
  const altitude = position.y
  return {
    live: true, camera, position, velocity, forward: nose,
    speed: arcadeSpeed(Math.hypot(velocity.x, velocity.y, velocity.z)),
    altitude, heading: attitude.heading, pitch: attitude.pitch, bank: attitude.bank,
    verticalSpeed: velocity.y, aoa: m.alpha, gLoad: m.g, power: state.enginePower,
    groundClearance: altitude,
    edge: Math.max(0, Math.min(trainingMap.radius - Math.hypot(position.x, position.z), trainingMap.radius - altitude)),
    burnerReserve: m.burner, burnerSeconds: m.burner * maneuverProfile.burnerSeconds, burnerState: burnerStates[burnerStatus(state)] ?? 'ready',
    airbrake: m.airbrake > 0.1, highG: m.highG > 0.1, psm: m.phase === 'active' || m.phase === 'recovery',
  }
}

export const FlightInstruments = memo(function FlightInstruments({ driver, aircraftId = aircraft[0].id }: { driver: RefObject<HudDriver | null>; aircraftId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current, frame = element?.parentElement
    if (!element || !frame) return
    const maneuverProfile = getFlightProfile(aircraftId).maneuver
    const painter = createGlassPainter(element, { speedBand: maneuverProfile.psmEnabled ? { min: arcadeSpeed(maneuverProfile.entryMin), max: arcadeSpeed(maneuverProfile.entryMax) } : null })
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
  }, [driver, aircraftId])
  return <canvas ref={canvas} className="hud-glass" aria-hidden="true" />
})

// The glass is invisible to assistive technology; this carries the same readings in text.
export function FlightSystemStatus({ state }: { state: AircraftState | null }) {
  const { t } = useTranslation()
  const m = state?.maneuver
  const heading = state ? flightAttitude(state.orientation).heading : null
  const empty = '—'
  return <dl className="hud-a11y-readout" aria-label={t('hudFlightData')}>
    <div><dt>{t('hudSpeed')}</dt><dd>{state ? Math.round(arcadeSpeed(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z))) : empty} {t('arcadeUnit')}</dd></div>
    <div><dt>{t('altitude')}</dt><dd>{state ? Math.round(state.position.y) : empty} {t('metres')}</dd></div>
    <div><dt>{t('heading')}</dt><dd>{heading === null ? empty : `${Math.round(heading) % 360}°`}</dd></div>
    <div><dt>{t('burner')}</dt><dd>{t(burnerStatus(state))}</dd></div>
    <div><dt>{t('engineOutput')}</dt><dd>{state ? `${Math.round(state.enginePower * 100)}%` : empty}</dd></div>
    {(m?.airbrake ?? 0) > 0.1 && <div><dt>{t('airbrake')}</dt><dd>{t('hudOn')}</dd></div>}
  </dl>
}
