import { Box3, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
import { observeAirflow } from '../game/flight/airflow'
import { getFlightProfile } from '../game/flight/profile'
import { balancedTilt, bankAbout, driftShare, psmShare } from '../game/camera/cameraRoll'
import type { CameraSettings } from '../game/camera/cameraSettings'
/*
The chase camera. Two shots, blended by incidence:

- Cruise: the pilot's chosen camera — Horizon locked (Balanced or Dynamic) or Aircraft locked.
  See `STYLE` below and `game/camera/cameraSettings.ts`.
- PSM: the Phase 7 shot. Values are owner decisions recorded in
  docs/psm-phase7-implementation.md and measured by benchmarks/flight/camera.report.ts (B21).
  It holds a level horizon and runs the view down the flight path.

Every cruise value is weighted by (1 − handover), so once the handover is complete the choice
has no effect at all: the PSM shot is the same whatever the pilot chose. Both weights come
from incidence alone, never from a manoeuvre phase — PSM is not a state.

One owner-approved exception: with Aircraft locked, a jet drift (nose leading the path
sideways, both near level; `driftShare`) does not hand over. The camera keeps following the
nose and the airframe's roll, only with extra lag (DRIFT_LAG) so the drift still reads.

`handover` follows the same incidence band as `decouple`, but where incidence is unreliable
(near-zero airspeed, e.g. the top of a tail slide) it holds its last value instead of falling
to zero. Decouple still eases the view back toward the nose there, as Phase 7 decided, and the
style stays out of it.

Decouple: how far the view leaves the nose, from incidence alone (confidence-gated near rest).
It attacks quickly so the markers stay framed through a fast pitch-up and eases back slowly.
The incidence band lives in `cameraRoll.ts` so the mouse stick reads the same handoff.
*/
const DECOUPLE = { attack: 7, release: 3 }
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
The level horizon (horizon lock, and the PSM shot) holds world up about the view at every AoA.
Where the view itself runs near vertical (horizontal share of the look below cone.end) the
world's up vanishes, so the camera keeps its own up carried along the view's turn and only
eases back to level as the view leaves the cone — never faster than horizonMaxRate, and more
slowly while the airframe rotates fast.
*/
const UP = { horizon: 5, rateSlowdown: 3, horizonMaxRate: Math.PI, cone: { start: 0.1, end: 0.35 } }
// The Phase 7 boom and aim: rates, and aim point at decouple 0 (attached) and 1 (decoupled).
const OFFSET = { attached: 10, decoupled: 5 }
const AIM = { ahead: 50, lift: 0.5, decoupledAhead: 38, decoupledLift: 4.5 }
const BOOM_HEIGHT = 6.5
const PSM_TURN_RATE = 8
/*
The cruise lag (offsetRate, turnRate) hands over to the PSM rates this many times faster than
the rest of the style, so it is fully gone by handover 0.2 (~15° incidence). A softer boom is what
makes cruise feel quick, but carried into a PSM entry it lets the nose leave the frame early.
Hard turns without the airbrake stay under 8° incidence, so they keep the full cruise lag.
*/
const ENTRY_SPEEDUP = 5
/*
The three cruise cameras. Ported in spirit from example/F22 (chase-camera/roll.js and
chaseCamera.js), at this project's own framing: the jet is 18.9 units long here, not 7.

  balanced    Horizon locked. The camera stays above and tilts a little in a roll.
  dynamic     Horizon locked, Battlefield-style. The horizon stays level, but the boom swings
              round the nose line to the canopy side, so you always see the top of the jet and
              the jet rolls around the centre of the screen (the lens aims far down the nose).
  aircraft    Aircraft locked. The camera rolls fully with the jet.

  offsetRate  how quickly the boom swings back behind the jet (1/s). Lower = more lag, so the
              jet visibly moves in the frame when it manoeuvres.
  turnRate    how quickly the lens turns onto its aim (1/s). Same idea, for the view angle.
  aimAhead    how far ahead of the jet the lens aims. 50 puts the jet in the lower third;
              Dynamic aims far down the nose line so the nose points at the screen centre.
  aimLift     how far above the nose line the aim point sits.
  height      how far the boom rises off the nose line. Dynamic sits lower: its lens aims down the
              nose line, so height alone sets how far below the centre the jet appears.
  upRate      how quickly the camera's roll follows its target (1/s), and upMaxRate its cap.
*/
type Cruise = 'balanced' | 'dynamic' | 'aircraft'
interface CruiseStyle { offsetRate: number; turnRate: number; aimAhead: number; aimLift: number; height: number; upRate: number; upMaxRate: number }
/*
Dynamic's up rate is stiff on purpose: the Phase 7 level horizon eases slowly and slows further
while the jet rotates, which let a rolling pull tip the horizon ~7°; at 30/s it stays within ~1°.
It still cannot turn over faster than UP.horizonMaxRate after a loop takes the view over the top,
where level itself flips.
*/
const STYLE: Record<Cruise, CruiseStyle> = {
  balanced: { offsetRate: 6, turnRate: 6.5, aimAhead: 50, aimLift: 0.5, height: 6.5, upRate: 8, upMaxRate: Math.PI },
  dynamic: { offsetRate: 5, turnRate: 6, aimAhead: 400, aimLift: 0, height: 5, upRate: 30, upMaxRate: Math.PI },
  aircraft: { offsetRate: 6, turnRate: 6.5, aimAhead: 50, aimLift: 0.5, height: 6.5, upRate: 14, upMaxRate: 3 * Math.PI },
}
/*
Dynamic's boom: it sits on a cylinder around the nose line, on the canopy side, and swings
round it after the jet rolls. The lag is a critically damped spring (no overshoot). At the
~4 rad/s roll rate the steady lag would be 2·rate/omega ≈ 48°; it is capped at maxLag, so the
top of the airframe is always what the camera sees, even through a 360° roll.
*/
const DYNAMIC = { omega: 10, maxLag: MathUtils.degToRad(45) }
/*
Aircraft locked through a jet drift: the camera keeps the cruise shot, with these slower rates
at full drift so the jet visibly swings against the view — the cue that the drift is on.
*/
const DRIFT_LAG = { offsetRate: 3, turnRate: 3.5, upRate: 6 }
// The drift lag reaches full this many times faster than the handover: by ~15° incidence, where a
// banked S-pull drift already sits. Hard turns without the airbrake stay under 8°, so never lag.
const DRIFT_LAG_SPEEDUP = 6
export type { CameraSettings }
/** Project actual world-space subject bounds, not a velocity-look heuristic. */
export function projectedAircraftBounds(camera: PerspectiveCamera, corners: Vector3[]) {
  camera.updateMatrixWorld()
  const points = corners.map(point => point.clone().project(camera))
  return { extent: Math.max(...points.flatMap(point => [Math.abs(point.x), Math.abs(point.y)])),
    depthValid: points.every(point => point.z > -1 && point.z < 1) }
}
/** `held` taken across the view, so it follows the view's own turn; fallbacks cover a view along it. */
function carry(held: Vector3, forward: Vector3, bodyUp: Vector3, wing: Vector3) {
  const across = held.clone().addScaledVector(forward, -held.dot(forward))
  if (across.lengthSq() < 1e-6) across.copy(bodyUp).addScaledVector(forward, -bodyUp.dot(forward))
  if (across.lengthSq() < 1e-6) across.copy(wing).cross(forward)
  return across.normalize()
}
/** `angle` wrapped into (−π, π]. */
function wrapAngle(angle: number) {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
}
/** One frame of roll toward `angle`: eased at `response` (1/s) and capped at `maxRate` (rad/s). */
function rollStep(angle: number, response: number, maxRate: number, dt: number, snap: boolean) {
  return snap ? angle : MathUtils.clamp(angle * (1 - Math.exp(-response * dt)), -maxRate * dt, maxRate * dt)
}
/** Signed angle from `from` to `to` about `axis` (both taken across the axis by the caller). */
function angleAbout(from: Vector3, to: Vector3, axis: Vector3) {
  const sine = new Vector3().crossVectors(from, to).dot(axis), cosine = from.dot(to)
  // Exactly opposite has no preferred side; turn the positive way.
  return Math.abs(sine) < 1e-8 && cosine < 0 ? Math.PI : Math.atan2(sine, cosine)
}
/** `from` turned toward `to` by `share` of the angle between them; `fallback` picks the axis when they are opposite. */
function turnToward(from: Vector3, to: Vector3, share: number, fallback: Vector3) {
  if (share <= 0) return from.clone()
  const axis = new Vector3().crossVectors(from, to)
  if (axis.lengthSq() < 1e-10) axis.copy(fallback).addScaledVector(from, -fallback.dot(from))
  if (axis.lengthSq() < 1e-10) return share >= 1 ? to.clone() : from.clone()
  return from.clone().applyAxisAngle(axis.normalize(), from.angleTo(to) * share).normalize()
}
export class FlightCamera {
  constructor(readonly diagnostic = false) {}
  /** Settings › Camera › Field of view. The dynamic widening adds to it; reduced motion holds it +5°. */
  baseFov = FOV.base
  /** Jump straight to the target FOV (set while paused, so a Settings change shows at once). */
  snapFov = false
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
  // The up the camera uses, and the two it is blended from (see the roll section of update).
  private up = new Vector3(0, 1, 0)
  private levelUp = new Vector3(0, 1, 0)
  private styleUp = new Vector3(0, 1, 0)
  // Roll from the style's up to the level up, followed continuously (may pass ±π).
  private gap = 0
  // Which side of the jet the boom rises toward. The camera's up, except in Dynamic cruise.
  private boomUp = new Vector3(0, 1, 0)
  private boomGap = 0
  // Smoothed jet drift share (Aircraft locked only).
  private drift = 0
  private lastDriftLag = 0
  /** Diagnostics: how much of the extra jet-drift lag was applied on the last frame (0..1). */
  get driftLag() { return this.lastDriftLag }
  private set driftLag(value: number) { this.lastDriftLag = value }
  private look = new Vector3(1, 0, 0)
  private initialized = false
  private decouple = 0
  private handover = 0
  private offset = new Vector3()
  // Dynamic style: how far (rad) the camera's roll trails the airframe's, its rate, and last frame's body up.
  private rollLag = 0
  private rollLagRate = 0
  private lastBodyUp = new Vector3(0, 1, 0)
  reset() {
    this.initialized = false; this.decouple = 0; this.handover = 0; this.up.set(0, 1, 0); this.levelUp.set(0, 1, 0); this.styleUp.set(0, 1, 0); this.gap = 0; this.boomUp.set(0, 1, 0); this.boomGap = 0; this.drift = 0; this.lastDriftLag = 0; this.look.set(1, 0, 0); this.offset.set(0, 0, 0)
    this.rollLag = 0; this.rollLagRate = 0; this.lastBodyUp.set(0, 1, 0)
  }
  update(camera: PerspectiveCamera, state: AircraftState, view: CameraSettings, dt: number, reducedMotion = false, diagnosticBounds?: Box3) {
    if (this.diagnostic && diagnosticBounds) { this.diagnosticView(camera, state, diagnosticBounds); return }
    const cruise: Cruise = view.roll === 'aircraft' ? 'aircraft' : view.horizonStyle === 'dynamic' ? 'dynamic' : 'balanced'
    const style = STYLE[cruise]
    const q = new Quaternion().copy(state.orientation), position = new Vector3().copy(state.position)
    const nose = new Vector3(1, 0, 0).applyQuaternion(q), bodyUp = new Vector3(0, 1, 0).applyQuaternion(q)
    const wing = new Vector3(0, 0, 1).applyQuaternion(q)
    const airflow = observeAirflow(state, getFlightProfile(state.aircraftId))
    // Presentation only: reveal real nose/path separation from airflow alone,
    // ignoring unreliable angles near rest. No maneuver phase exists.
    const decoupleTarget = psmShare(airflow.incidenceDeg, airflow.confidence)
    const decoupleRate = decoupleTarget > this.decouple ? DECOUPLE.attack : DECOUPLE.release
    this.decouple = reducedMotion ? 0 : this.decouple + (decoupleTarget - this.decouple) * (1 - Math.exp(-decoupleRate * dt))
    const handoverTarget = MathUtils.lerp(this.handover, psmShare(airflow.incidenceDeg, 1), airflow.confidence)
    const handoverRate = handoverTarget > this.handover ? DECOUPLE.attack : DECOUPLE.release
    this.handover = reducedMotion ? handoverTarget : this.handover + (handoverTarget - this.handover) * (1 - Math.exp(-handoverRate * dt))
    const snap = !this.initialized || reducedMotion
    const path = airflow.airspeed > 1e-6 ? new Vector3().copy(state.velocity).normalize() : nose.clone()
    // Jet drift, held like the handover where incidence is unreliable. Only Aircraft locked uses it:
    // there it takes its share out of both PSM weights and turns it into extra lag instead.
    const driftTarget = MathUtils.lerp(this.drift, driftShare(nose, path, airflow.incidenceDeg), airflow.confidence)
    const driftRate = driftTarget > this.drift ? DECOUPLE.attack : DECOUPLE.release
    this.drift = snap ? driftTarget : this.drift + (driftTarget - this.drift) * (1 - Math.exp(-driftRate * dt))
    const keep = cruise === 'aircraft' ? 1 - this.drift : 1
    const w = this.handover * keep, d = this.decouple * keep
    const lag = (1 - keep) * Math.min(1, this.handover * DRIFT_LAG_SPEEDUP)
    this.driftLag = lag

    // --- Look direction -------------------------------------------------------------------
    // PSM look: the path turned back toward the nose by a residual that vanishes at 180°.
    const theta = path.angleTo(nose)
    const residual = (1 - LOOK.pathShare) * theta * (1 - MathUtils.smoothstep(theta, MathUtils.degToRad(LOOK.residualFadeDeg), Math.PI))
    const towardNose = new Vector3().crossVectors(path, nose)
    // Only exactly opposite nose and path lack an axis; the airframe's pitch axis then picks the side.
    if (towardNose.lengthSq() < 1e-10) towardNose.copy(wing).addScaledVector(path, -wing.dot(path))
    const psmLook = towardNose.lengthSq() < 1e-10 ? path.clone() : path.clone().applyAxisAngle(towardNose.normalize(), residual)
    // Cruise looks down the nose. Blend along the nose–path arc; at full decouple this is exactly
    // the PSM look. (The example camera leans the cruise view onto the path; here that pushed the
    // nose out of frame during PSM entries, and cruise incidence is too small for it to show.)
    const lookTarget = turnToward(nose, psmLook, d, wing.clone().negate())
    if (snap) this.look.copy(lookTarget)
    else {
      const turn = this.look.angleTo(lookTarget), step = Math.min(turn, LOOK.maxRate * dt)
      const axis = new Vector3().crossVectors(this.look, lookTarget)
      if (axis.lengthSq() < 1e-10) axis.copy(wing).addScaledVector(this.look, -wing.dot(this.look))
      if (turn > 1e-9 && axis.lengthSq() > 1e-10) this.look.applyAxisAngle(axis.normalize(), step).normalize()
    }
    const forward = this.look.clone()

    // --- Camera roll (the up vector) --------------------------------------------------------
    // Two ups are carried every frame, then blended by `handover`:
    // - `levelUp`, the Phase 7 level horizon (the PSM shot, and the horizon lock), run whatever
    //   the style, so its history never depends on the pilot's choice;
    // - `styleUp`, the chosen cruise camera's own up.
    // At handover 1 the camera uses `levelUp` exactly, so every style gives the same PSM shot.
    const levelShare = MathUtils.smoothstep(Math.hypot(forward.x, forward.z), UP.cone.start, UP.cone.end)
    const level = new Vector3(0, 1, 0).addScaledVector(forward, -forward.y)
    const hasLevel = level.lengthSq() >= 1e-8
    if (hasLevel) level.normalize()
    const bodyRate = Math.hypot(state.rates.pitch, state.rates.yaw, state.rates.roll)
    const levelHeld = carry(this.levelUp, forward, bodyUp, wing)
    // Level: world up about the view, faded to "hold" inside the vertical cone where it vanishes.
    const toLevel = hasLevel ? angleAbout(levelHeld, level, forward) * levelShare : 0
    this.levelUp.copy(levelHeld).applyAxisAngle(forward, rollStep(toLevel, UP.horizon / (1 + bodyRate / UP.rateSlowdown), UP.horizonMaxRate, dt, snap))

    const styleHeld = carry(this.styleUp, forward, bodyUp, wing)
    // The airframe's up across the view. Degenerate only when the view runs along the airframe's up.
    const bodyAcross = bodyUp.clone().addScaledVector(forward, -bodyUp.dot(forward))
    if (bodyAcross.lengthSq() < 1e-8) bodyAcross.copy(styleHeld)
    bodyAcross.normalize()
    this.updateRollLag(bodyAcross, forward, dt, snap)
    const toStyle = this.styleRollAngle(cruise, styleHeld, bodyAcross, forward, hasLevel ? level : null, levelShare)
    const upRate = MathUtils.lerp(style.upRate, DRIFT_LAG.upRate, lag)
    this.styleUp.copy(styleHeld).applyAxisAngle(forward, rollStep(toStyle, upRate, style.upMaxRate, dt, snap))

    // Blend. The gap between the two ups is followed continuously rather than taken the short
    // way each frame: near inverted the short way flips from side to side, and a blend of it
    // would jump. At either end of the handover a whole turn is invisible, so it is unwound there.
    const gap = angleAbout(this.styleUp, this.levelUp, forward)
    const ends = snap || w <= 1e-3 || w >= 1 - 1e-3
    this.gap = ends ? gap : this.gap + wrapAngle(gap - this.gap)
    this.up.copy(this.styleUp).applyAxisAngle(forward, this.gap * w).normalize()

    // Boom side. Dynamic's orbit (the airframe's up, trailed by the roll lag) is blended onto
    // the camera's up by the same handover, followed the same continuous way.
    const previousBoom = carry(this.boomUp, forward, bodyUp, wing)
    if (cruise === 'dynamic') {
      const orbit = bodyAcross.clone().applyAxisAngle(forward, this.rollLag)
      const boomGap = angleAbout(orbit, this.up, forward)
      this.boomGap = ends ? boomGap : this.boomGap + wrapAngle(boomGap - this.boomGap)
      this.boomUp.copy(orbit).applyAxisAngle(forward, this.boomGap * w).normalize()
    } else { this.boomGap = 0; this.boomUp.copy(this.up) }
    // Cruise carries the boom round with its own roll, so the roll lag lives in one place (the
    // ups above) and the boom smoothing below only answers pitch and yaw. Without this a Dynamic
    // roll would trail twice and lose sight of the canopy. The PSM shot keeps its Phase 7 boom.
    if (!snap) this.offset.applyAxisAngle(forward, angleAbout(previousBoom, this.boomUp, forward) * (1 - w))

    // --- Boom and aim -----------------------------------------------------------------------
    // Chase offset sized so the whole airframe (normalised to 18.9 units long) stays in frame
    // even at rest, with speed only easing the camera back a few units.
    const speed = airflow.airspeed
    const back = 26 + Math.min(3, speed / 70) + d * 9
    const desiredOffset = forward.clone().multiplyScalar(-back).addScaledVector(this.boomUp, MathUtils.lerp(style.height, BOOM_HEIGHT, w) + d * 3.5)
    desiredOffset.y = Math.max(5, position.y + desiredOffset.y) - position.y
    const desiredPosition = position.clone().add(desiredOffset)
    // Aim ahead of the nose so the jet sits low in the frame, leaving the middle clear for what it
    // is flying at. While decoupled the aim rises with the camera, so the view does not tip toward
    // the path and push the nose out.
    // The style's aim hands over to the attached Phase 7 aim, which decouple then moves as before.
    const aimAhead = MathUtils.lerp(MathUtils.lerp(style.aimAhead, AIM.ahead, w), AIM.decoupledAhead, d)
    const aimLift = MathUtils.lerp(MathUtils.lerp(style.aimLift, AIM.lift, w), AIM.decoupledLift, d)
    const target = position.clone().addScaledVector(forward, aimAhead).addScaledVector(this.up, aimLift)
    const desiredQ = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(desiredPosition, target, this.up))
    // The offset is smoothed, not the world position: a world-space follow trails a moving
    // jet by speed/rate, which pushed the camera 30+ units back at cruise and hugged the tail at rest.
    // It trails further while decoupled, so the airframe visibly swings against the view.
    if (snap) { this.offset.copy(desiredOffset); camera.quaternion.copy(desiredQ); this.initialized = true }
    else {
      const entry = Math.min(1, w * ENTRY_SPEEDUP)
      const cruiseOffsetRate = MathUtils.lerp(style.offsetRate, DRIFT_LAG.offsetRate, lag), cruiseTurnRate = MathUtils.lerp(style.turnRate, DRIFT_LAG.turnRate, lag)
      const offsetRate = MathUtils.lerp(MathUtils.lerp(cruiseOffsetRate, OFFSET.attached, entry), OFFSET.decoupled, d)
      this.followOffset(desiredOffset, offsetRate, w, dt)
      camera.quaternion.slerp(desiredQ, 1 - Math.exp(-MathUtils.lerp(cruiseTurnRate, PSM_TURN_RATE, entry) * dt))
    }
    camera.position.copy(position).add(this.offset)
    const fov = reducedMotion ? this.baseFov + FOV.reduced - FOV.base : this.baseFov + Math.min(FOV.speed, speed / 50) + (state.maneuver.burnerActive ? FOV.burner : 0) + d * FOV.decouple
    camera.fov += (fov - camera.fov) * (reducedMotion || this.snapFov ? 1 : 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix()
    camera.position.y = Math.max(5, camera.position.y)
  }
  /*
  The roll angle, from the cruise up, that the chosen camera asks for.
  - Balanced: the level up tilted by `balancedTilt(bank)`; held inside the vertical cone.
  - Dynamic: the level up (its orbit is the boom's job, not the lens's); held inside the cone.
  - Aircraft locked: the airframe's up.
  */
  private styleRollAngle(cruise: Cruise, held: Vector3, bodyAcross: Vector3, forward: Vector3, level: Vector3 | null, levelShare: number) {
    if (cruise === 'aircraft') return angleAbout(held, bodyAcross, forward)
    if (!level || levelShare <= 0) return 0
    const tilt = cruise === 'balanced' ? balancedTilt(bankAbout(forward, bodyAcross)) : 0
    return angleAbout(held, level.clone().applyAxisAngle(forward, tilt), forward) * levelShare
  }
  /*
  Dynamic's roll lag. The airframe rolling by r since last frame moves the lag by −r (the
  camera stayed put); a critically damped spring then pulls the lag back to zero. Closed form,
  so a long frame cannot make it blow up. Runs in every style so a mid-flight switch starts calm.
  */
  private updateRollLag(bodyAcross: Vector3, forward: Vector3, dt: number, snap: boolean) {
    const previous = this.lastBodyUp.clone().addScaledVector(forward, -this.lastBodyUp.dot(forward))
    this.lastBodyUp.copy(bodyAcross)
    if (snap || previous.lengthSq() < 1e-8) { this.rollLag = 0; this.rollLagRate = 0; return }
    const rolled = angleAbout(previous.normalize(), bodyAcross, forward)
    const offset = this.rollLag - rolled
    const impulse = (this.rollLagRate + DYNAMIC.omega * offset) * dt
    const decay = Math.exp(-DYNAMIC.omega * dt)
    this.rollLag = (offset + impulse) * decay
    this.rollLagRate = (this.rollLagRate - DYNAMIC.omega * impulse) * decay
    if (Math.abs(this.rollLag) > DYNAMIC.maxLag) { this.rollLag = Math.sign(this.rollLag) * DYNAMIC.maxLag; this.rollLagRate = 0 }
  }
  /*
  Ease the boom toward its target. Cruise swings it on the sphere around the jet (an arc),
  so a fast roll carries the camera round the airframe instead of cutting a chord through it.
  The PSM shot keeps its Phase 7 straight-line ease, and `handover` blends the two results, so
  once the handover is complete the boom moves exactly as it did before the styles existed.
  */
  private followOffset(desired: Vector3, rate: number, handover: number, dt: number) {
    const share = 1 - Math.exp(-rate * dt)
    const chord = this.offset.clone().lerp(desired, share)
    const radius = this.offset.length(), targetRadius = desired.length()
    if (handover >= 1 || radius < 1e-6 || targetRadius < 1e-6) { this.offset.copy(chord); return }
    const direction = this.offset.clone().divideScalar(radius)
    const turn = new Quaternion().setFromUnitVectors(direction, desired.clone().divideScalar(targetRadius))
    const arc = direction.applyQuaternion(new Quaternion().slerp(turn, share)).multiplyScalar(MathUtils.lerp(radius, targetRadius, share))
    this.offset.copy(arc.lerp(chord, handover))
  }
}
