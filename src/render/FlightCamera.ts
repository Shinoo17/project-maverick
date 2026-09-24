import { Box3, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
import { observeAirflow } from '../game/flight/airflow'
import { getFlightProfile } from '../game/flight/profile'
// Shared presentation band in degrees; per-aircraft camera tuning waits for Phase 7.
const DECOUPLING_START_DEG = 20
const DECOUPLING_FULL_DEG = 60
export type CameraRollMode = 'horizon' | 'aircraft'
/** Project actual world-space subject bounds, not a velocity-look heuristic. */
export function projectedAircraftBounds(camera: PerspectiveCamera, corners: Vector3[]) {
  camera.updateMatrixWorld()
  const points = corners.map(point => point.clone().project(camera))
  return { extent: Math.max(...points.flatMap(point => [Math.abs(point.x), Math.abs(point.y)])),
    depthValid: points.every(point => point.z > -1 && point.z < 1) }
}
export class FlightCamera {
  constructor(readonly diagnostic = false) {}
  private diagnosticView(camera: PerspectiveCamera, state: AircraftState, bounds: Box3) {
    const q = new Quaternion().copy(state.orientation), center = new Vector3().copy(state.position)
    const corners: Vector3[] = []
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      corners.push(new Vector3(x, y, z).applyQuaternion(q).add(center))
    }
    // Fixed world frame for diagnostic comparisons. No attitude/FOV chasing.
    const offset = new Vector3(-40, 14, 0)
    camera.fov = 61; camera.up.set(0, 1, 0); camera.updateProjectionMatrix()
    for (let pass = 0; pass < 5; pass++) {
      camera.position.copy(center).add(offset); camera.lookAt(center)
      const projected = projectedAircraftBounds(camera, corners)
      if (projected.depthValid && projected.extent <= 0.82) break
      offset.multiplyScalar(Math.max(1.1, projected.extent / 0.8))
    }
  }
  private up = new Vector3(0, 1, 0)
  private initialized = false
  private cinematic = 0
  private offset = new Vector3()
  reset() { this.initialized = false; this.cinematic = 0; this.up.set(0, 1, 0); this.offset.set(0, 0, 0) }
  update(camera: PerspectiveCamera, state: AircraftState, mode: CameraRollMode, dt: number, reducedMotion = false, diagnosticBounds?: Box3) {
    if (this.diagnostic && diagnosticBounds) { this.diagnosticView(camera, state, diagnosticBounds); return }
    const q = new Quaternion().copy(state.orientation), position = new Vector3().copy(state.position)
    const forward = new Vector3(1, 0, 0).applyQuaternion(q)
    const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
    // Presentation only: reveal real nose/path separation from airflow alone,
    // ignoring unreliable angles near rest. No maneuver phase exists.
    const cinematicTarget = MathUtils.smoothstep(airflow.incidenceDeg, DECOUPLING_START_DEG, DECOUPLING_FULL_DEG) * airflow.confidence
    this.cinematic = reducedMotion ? 0 : this.cinematic + (cinematicTarget - this.cinematic) * (1 - Math.exp(-4 * dt))
    const path = new Vector3().copy(state.velocity).normalize()
    forward.lerp(path, this.cinematic * 0.88).normalize()
    const bodyUp = new Vector3(0, 1, 0).applyQuaternion(q)
    const desiredUp = mode === 'aircraft' ? bodyUp : new Vector3(0, 1, 0)
    desiredUp.addScaledVector(forward, -desiredUp.dot(forward))
    // Transport through the vertical singularity, then rotate smoothly back to world-up.
    const transported = this.up.clone().addScaledVector(forward, -this.up.dot(forward))
    if (transported.lengthSq() < 1e-6) transported.copy(bodyUp)
    transported.normalize()
    if (desiredUp.lengthSq() < 0.04) desiredUp.copy(transported)
    else {
      desiredUp.normalize()

    }
    const sine = new Vector3().crossVectors(transported, desiredUp).dot(forward)
    const cosine = transported.dot(desiredUp)
    const angle = Math.abs(sine) < 1e-8 && cosine < 0 ? Math.PI : Math.atan2(sine, cosine)
    this.up.copy(transported).applyAxisAngle(forward, angle * (reducedMotion ? 1 : 1 - Math.exp(-3 * dt))).normalize()
    // Chase offset sized so the whole airframe (normalised to 18.9 units long) stays in frame
    // even at rest, with speed only easing the camera back a few units.
    const speed = airflow.airspeed
    const back = 26 + Math.min(3, speed / 70) + this.cinematic * 6
    const desiredOffset = forward.clone().multiplyScalar(-back).addScaledVector(this.up, 6.5 + this.cinematic * 3.5)
    desiredOffset.y = Math.max(5, position.y + desiredOffset.y) - position.y
    const desiredPosition = position.clone().add(desiredOffset)
    // Aim far ahead of the nose so the view runs near level and the jet sits in the lower third,
    // leaving the middle of the frame clear for what it is flying at.
    const target = position.clone().addScaledVector(forward, 50 - this.cinematic * 12).addScaledVector(this.up, 0.5)
    const desiredQ = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(desiredPosition, target, this.up))
    // The offset is smoothed, not the world position: a world-space follow trails a moving
    // jet by speed/rate, which pushed the camera 30+ units back at cruise and hugged the tail at rest.
    if (!this.initialized || reducedMotion) { this.offset.copy(desiredOffset); camera.quaternion.copy(desiredQ); this.initialized = true }
    else { this.offset.lerp(desiredOffset, 1 - Math.exp(-10 * dt)); camera.quaternion.slerp(desiredQ, 1 - Math.exp(-8 * dt)) }
    camera.position.copy(position).add(this.offset)
    const fov = reducedMotion ? 61 : 56 + Math.min(4, speed / 50) + (state.maneuver.burnerActive ? 2 : 0)
    camera.fov += (fov - camera.fov) * (reducedMotion ? 1 : 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix()
    camera.position.y = Math.max(5, camera.position.y)
  }
}
