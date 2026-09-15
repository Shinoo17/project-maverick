import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
export type CameraRollMode = 'horizon' | 'aircraft'
export class FlightCamera {
  private up = new Vector3(0, 1, 0)
  private initialized = false
  private cinematic = 0
  private offset = new Vector3()
  reset() { this.initialized = false; this.cinematic = 0; this.up.set(0, 1, 0); this.offset.set(0, 0, 0) }
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
    // Chase offset sized so the whole airframe (normalised to 18.9 units long) stays in frame
    // even at rest, with speed only easing the camera back a few units.
    const speed = new Vector3().copy(state.velocity).length()
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
