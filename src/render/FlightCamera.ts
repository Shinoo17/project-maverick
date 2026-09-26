import { Box3, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
import { observeAirflow } from '../game/flight/airflow'
import { getFlightProfile } from '../game/flight/profile'
/*
Phase 7 presentation tuning, shared by every airframe. Values are owner decisions recorded in
docs/psm-phase7-implementation.md and measured by benchmarks/flight/camera.report.ts (B21).

Decouple: how far the view leaves the nose, from incidence alone (confidence-gated near rest).
It attacks quickly so the markers stay framed through a fast pitch-up and eases back slowly.
*/
const DECOUPLE = { startDeg: 8, fullDeg: 35, attack: 7, release: 3 }
/*
Decoupled, the view runs down the flight path, so a drift reads as the airframe swinging against
its own motion. It is pulled back toward the nose by (1 − pathShare) of the incidence, keeping
the nose near the frame; that residual fades out from residualFadeDeg to nothing at 180°, so in
reverse flow the view sits on the path whichever side of the tail the path passes, and no
rotation axis is needed there. (A plain nose/path lerp above one half passes through zero at
180°: the old 0.88 share flipped the view half a turn in one frame during a tail slide.) The
look direction itself turns no faster than maxRate.
*/
const LOOK = { pathShare: 0.8, residualFadeDeg: 90, maxRate: 4 * Math.PI / 3 }
const FOV = { base: 56, speed: 4, burner: 2, decouple: 10, reduced: 61 }
/*
Horizon mode holds world up about the view at every AoA. Where the view itself runs near
vertical (horizontal share of the look below cone.end) the world's up vanishes, so the camera
keeps its own up carried along the view's turn and only eases back to level as the view leaves
the cone — never faster than horizonMaxRate, and more slowly while the airframe rotates fast.
Aircraft mode rides the airframe's up tightly.
*/
const UP = { horizon: 5, aircraft: 14, rateSlowdown: 3, horizonMaxRate: Math.PI, aircraftMaxRate: 3 * Math.PI, cone: { start: 0.1, end: 0.35 } }
const OFFSET = { attached: 10, decoupled: 5 }
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
  private look = new Vector3(1, 0, 0)
  private initialized = false
  private decouple = 0
  private offset = new Vector3()
  reset() { this.initialized = false; this.decouple = 0; this.up.set(0, 1, 0); this.look.set(1, 0, 0); this.offset.set(0, 0, 0) }
  update(camera: PerspectiveCamera, state: AircraftState, mode: CameraRollMode, dt: number, reducedMotion = false, diagnosticBounds?: Box3) {
    if (this.diagnostic && diagnosticBounds) { this.diagnosticView(camera, state, diagnosticBounds); return }
    const q = new Quaternion().copy(state.orientation), position = new Vector3().copy(state.position)
    const nose = new Vector3(1, 0, 0).applyQuaternion(q), bodyUp = new Vector3(0, 1, 0).applyQuaternion(q)
    const wing = new Vector3(0, 0, 1).applyQuaternion(q)
    const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
    // Presentation only: reveal real nose/path separation from airflow alone,
    // ignoring unreliable angles near rest. No maneuver phase exists.
    const decoupleTarget = MathUtils.smoothstep(airflow.incidenceDeg, DECOUPLE.startDeg, DECOUPLE.fullDeg) * airflow.confidence
    const decoupleRate = decoupleTarget > this.decouple ? DECOUPLE.attack : DECOUPLE.release
    this.decouple = reducedMotion ? 0 : this.decouple + (decoupleTarget - this.decouple) * (1 - Math.exp(-decoupleRate * dt))
    // Target look: the path turned back toward the nose by a residual that vanishes at 180°.
    const path = airflow.airspeed > 1e-6 ? new Vector3().copy(state.velocity).normalize() : nose.clone()
    const theta = path.angleTo(nose)
    const residual = (1 - LOOK.pathShare) * theta * (1 - MathUtils.smoothstep(theta, MathUtils.degToRad(LOOK.residualFadeDeg), Math.PI))
    const towardNose = new Vector3().crossVectors(path, nose)
    // Only exactly opposite nose and path lack an axis; the airframe's pitch axis then picks the side.
    if (towardNose.lengthSq() < 1e-10) towardNose.copy(wing).addScaledVector(path, -wing.dot(path))
    const lookTarget = this.decouple <= 0 || towardNose.lengthSq() < 1e-10 ? nose.clone()
      : path.clone().applyAxisAngle(towardNose.normalize(), MathUtils.lerp(theta, residual, this.decouple))
    if (!this.initialized || reducedMotion) this.look.copy(lookTarget)
    else {
      const turn = this.look.angleTo(lookTarget), step = Math.min(turn, LOOK.maxRate * dt)
      const axis = new Vector3().crossVectors(this.look, lookTarget)
      if (axis.lengthSq() < 1e-10) axis.copy(wing).addScaledVector(this.look, -wing.dot(this.look))
      if (turn > 1e-9 && axis.lengthSq() > 1e-10) this.look.applyAxisAngle(axis.normalize(), step).normalize()
    }
    const forward = this.look.clone()
    // Transport the held up along the view's own turn first, so only the roll toward the target is smoothed.
    const transported = this.up.clone().addScaledVector(forward, -this.up.dot(forward))
    if (transported.lengthSq() < 1e-6) transported.copy(bodyUp).addScaledVector(forward, -bodyUp.dot(forward))
    if (transported.lengthSq() < 1e-6) transported.copy(wing).cross(forward)
    transported.normalize()
    // Target: the airframe's up (aircraft mode) or world up about the view, faded to "hold" inside the vertical cone.
    let desiredUp = mode === 'aircraft' ? bodyUp.clone().addScaledVector(forward, -bodyUp.dot(forward)) : new Vector3(0, 1, 0).addScaledVector(forward, -forward.y)
    const levelShare = mode === 'aircraft' ? 1 : MathUtils.smoothstep(Math.hypot(forward.x, forward.z), UP.cone.start, UP.cone.end)
    if (desiredUp.lengthSq() < 1e-8) desiredUp = transported.clone()
    else desiredUp.normalize()
    const sine = new Vector3().crossVectors(transported, desiredUp).dot(forward)
    const cosine = transported.dot(desiredUp)
    const angle = (Math.abs(sine) < 1e-8 && cosine < 0 ? Math.PI : Math.atan2(sine, cosine)) * levelShare
    const bodyRate = Math.hypot(state.rates.pitch, state.rates.yaw, state.rates.roll)
    const response = mode === 'aircraft' ? UP.aircraft : UP.horizon / (1 + bodyRate / UP.rateSlowdown)
    const maxStep = (mode === 'aircraft' ? UP.aircraftMaxRate : UP.horizonMaxRate) * dt
    const step = reducedMotion || !this.initialized ? angle : MathUtils.clamp(angle * (1 - Math.exp(-response * dt)), -maxStep, maxStep)
    this.up.copy(transported).applyAxisAngle(forward, step).normalize()
    // Chase offset sized so the whole airframe (normalised to 18.9 units long) stays in frame
    // even at rest, with speed only easing the camera back a few units.
    const speed = airflow.airspeed
    const back = 26 + Math.min(3, speed / 70) + this.decouple * 9
    const desiredOffset = forward.clone().multiplyScalar(-back).addScaledVector(this.up, 6.5 + this.decouple * 3.5)
    desiredOffset.y = Math.max(5, position.y + desiredOffset.y) - position.y
    const desiredPosition = position.clone().add(desiredOffset)
    // Aim far ahead of the nose so the view runs near level and the jet sits in the lower third,
    // leaving the middle of the frame clear for what it is flying at. While decoupled the aim
    // rises with the camera, so the view does not tip toward the path and push the nose out.
    const target = position.clone().addScaledVector(forward, 50 - this.decouple * 12).addScaledVector(this.up, 0.5 + this.decouple * 4)
    const desiredQ = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(desiredPosition, target, this.up))
    // The offset is smoothed, not the world position: a world-space follow trails a moving
    // jet by speed/rate, which pushed the camera 30+ units back at cruise and hugged the tail at rest.
    // It trails further while decoupled, so the airframe visibly swings against the view.
    if (!this.initialized || reducedMotion) { this.offset.copy(desiredOffset); camera.quaternion.copy(desiredQ); this.initialized = true }
    else {
      this.offset.lerp(desiredOffset, 1 - Math.exp(-MathUtils.lerp(OFFSET.attached, OFFSET.decoupled, this.decouple) * dt))
      camera.quaternion.slerp(desiredQ, 1 - Math.exp(-8 * dt))
    }
    camera.position.copy(position).add(this.offset)
    const fov = reducedMotion ? FOV.reduced : FOV.base + Math.min(FOV.speed, speed / 50) + (state.maneuver.burnerActive ? FOV.burner : 0) + this.decouple * FOV.decouple
    camera.fov += (fov - camera.fov) * (reducedMotion ? 1 : 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix()
    camera.position.y = Math.max(5, camera.position.y)
  }
}
