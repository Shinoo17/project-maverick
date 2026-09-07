import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
export type CameraRollMode = 'horizon' | 'aircraft'
export class FlightCamera {
  private up = new Vector3(0, 1, 0)
  private initialized = false
  private cinematic = 0
  reset() { this.initialized = false; this.cinematic = 0; this.up.set(0, 1, 0) }
  update(camera: PerspectiveCamera, state: AircraftState, mode: CameraRollMode, dt: number, reducedMotion = false) {
    const q = new Quaternion().copy(state.orientation), position = new Vector3().copy(state.position)
    const forward = new Vector3(1, 0, 0).applyQuaternion(q)
    const maneuvering = state.maneuver.phase === 'active' || state.maneuver.phase === 'recovery'
    this.cinematic = reducedMotion ? 0 : this.cinematic + ((maneuvering ? 1 : 0) - this.cinematic) * (1 - Math.exp(-4 * dt))
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
    const desiredPosition = position.clone().addScaledVector(forward, -34 - this.cinematic * 22).addScaledVector(this.up, 9 + this.cinematic * 7)
    desiredPosition.y = Math.max(5, desiredPosition.y)
    const target = position.clone().addScaledVector(forward, 55 - this.cinematic * 45)
    const desiredQ = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(desiredPosition, target, this.up))
    if (!this.initialized || reducedMotion) { camera.position.copy(desiredPosition); camera.quaternion.copy(desiredQ); this.initialized = true }
    else { camera.position.lerp(desiredPosition, 1 - Math.exp(-10 * dt)); camera.quaternion.slerp(desiredQ, 1 - Math.exp(-8 * dt)) }
    const fov = reducedMotion ? 69 : 65 + Math.min(12, new Vector3().copy(state.velocity).length() / 22) + (state.maneuver.burnerActive ? 4 : 0)
    camera.fov += (fov - camera.fov) * (reducedMotion ? 1 : 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix()
    camera.position.y = Math.max(5, camera.position.y)
  }
}
