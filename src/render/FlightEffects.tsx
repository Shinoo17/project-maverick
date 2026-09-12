import { useEffect, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import type { FlightSession } from '../features/flight/session'
import { WORLD_STEP } from '../game/runtime/clock'
import { CondensationVolume } from './vapor/CondensationVolume'
import { flightVaporConditions } from './vapor/conditions'

export function FlightEffects({ session, aircraft }: { session: FlightSession; aircraft: RefObject<Group | null> }) {
  const gl = useThree(state => state.gl)
  const volume = useRef<CondensationVolume | null>(null)
  const reset = useRef(-1), tick = useRef(-1)
  useEffect(() => {
    const effect = new CondensationVolume(gl)
    volume.current = effect
    return () => { volume.current = null; effect.dispose() }
  }, [gl])
  // Runs after the simulation, pose interpolation and chase camera. Sharing the
  // displayed aircraft matrix prevents vapor from jittering at simulation ticks.
  useFrame(({ gl, scene, camera }, delta) => {
    const world = session.runtime?.snapshot(), state = world?.aircraft[0]
    if (!volume.current || !state || !aircraft.current) { gl.render(scene, camera); return }
    if (reset.current !== session.resetId) { volume.current.reset(); reset.current = session.resetId; tick.current = -1 }
    const now = world!.tick
    const dt = session.running ? Math.min(delta, .1) * session.timeScale : tick.current >= 0 ? Math.max(0, now - tick.current) * WORLD_STEP : 0
    tick.current = now
    volume.current.update(flightVaporConditions(state), dt, session.reducedMotion, state.aircraftId)
    aircraft.current.updateWorldMatrix(true, false)
    volume.current.render(gl, scene, camera, aircraft.current.matrixWorld)
  }, 1)
  return null
}
