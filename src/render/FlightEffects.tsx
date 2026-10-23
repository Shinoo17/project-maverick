import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import type { FlightSession } from '../features/flight/session'
import type { AircraftId } from '../content/schemas'
import { WORLD_STEP } from '../game/runtime/clock'
import { CondensationVolume } from './vapor/CondensationVolume'
import { flightVaporConditions } from './vapor/conditions'
import { flightExhaustConditions, type ExhaustNozzles } from './exhaust/profile'
import { JetExhaust } from './exhaust/JetExhaust'
import { resolveExhaustStyle } from './exhaust/style'

export function FlightEffects({ session, aircraft, aircraftId, nozzles }: { session: FlightSession; aircraft: RefObject<Group | null>; aircraftId: AircraftId; nozzles?: ExhaustNozzles }) {
  const gl = useThree(state => state.gl)
  const volume = useRef<CondensationVolume | null>(null)
  const exhaust = useRef<JetExhaust | null>(null)
  const reset = useRef(-1), tick = useRef(-1)
  useEffect(() => {
    const effect = new CondensationVolume(gl)
    volume.current = effect
    return () => { volume.current = null; effect.dispose() }
  }, [gl])
  useEffect(() => {
    const flame = new JetExhaust(resolveExhaustStyle(aircraftId))
    exhaust.current = flame
    return () => { exhaust.current = null; flame.dispose() }
  }, [aircraftId])
  // Runs after the simulation, pose interpolation and chase camera. Sharing the
  // displayed aircraft matrix prevents vapor from jittering at simulation ticks.
  useFrame(({ gl, scene, camera }, delta) => {
    const world = session.runtime?.snapshot(), state = world?.aircraft[0]
    const flame = exhaust.current
    if (!volume.current || !flame || !state || !aircraft.current) { gl.render(scene, camera); return }
    if (flame.group.parent !== aircraft.current) aircraft.current.add(flame.group)
    if (reset.current !== session.resetId) { volume.current.reset(); flame.reset(); reset.current = session.resetId; tick.current = -1 }
    const now = world!.tick
    const dt = session.running ? Math.min(delta, .1) * session.timeScale : tick.current >= 0 ? Math.max(0, now - tick.current) * WORLD_STEP : 0
    tick.current = now
    const graphics = session.graphics
    volume.current.quality = { vapor: graphics.vapor, exhaust: graphics.exhaust }
    volume.current.setAntialias(gl, graphics.antialias)
    flame.setQuality(graphics.exhaust)
    volume.current.exhaustPlume = flame.activeStyle.volumePlume
    volume.current.exhaustCavity = flame.activeStyle.volumeCavity
    const conditions = { ...flightExhaustConditions(state), nozzles }
    volume.current.update(flightVaporConditions(state), dt, session.reducedMotion, state.aircraftId)
    volume.current.updateExhaust(conditions, dt, session.reducedMotion)
    aircraft.current.updateWorldMatrix(true, false)
    flame.update(conditions, dt, camera, aircraft.current.matrixWorld, session.reducedMotion)
    volume.current.render(gl, scene, camera, aircraft.current.matrixWorld, [flame])
  }, 1)
  return null
}
