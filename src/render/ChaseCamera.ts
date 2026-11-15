import { Euler, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
import { readFlight, type FlightReadout } from '../game/flight/readout'
import type { CameraSettings } from '../game/camera/cameraSettings'
import { balancedTilt, bankAbout } from '../game/camera/cameraRoll'
import { driftWeight, pathOffsetDeg } from '../game/camera/chaseBlend'
import { Spring, omegaOfLag, springStep } from '../game/camera/spring'
import { visibility } from './targetVisibility'
import type { CameraTrace } from './cameraTrace'
import type { CameraRig } from './cameraRig'
/*
The rewrite's chase camera (FR2), for flightCore 'new'.

Each frame builds one target pose from the state, its readout and the chosen style — a look
direction, a roll about it, a boom (back, height, aim point) and a field of view — and follows
each value with its own critically damped spring (game/camera/spring.ts). There are no branches
per manoeuvre and no rate caps stacked on lags: one value, one spring, plus a hard ceiling on how
fast the look and the roll may turn.

The blend comes from the flight's real state (game/camera/chaseBlend.ts): the drift share reads
the sideslip and the alpha past the normal limit, so a hard turn inside the envelope stays a
plain chase and pressing Space moves nothing until the airframe does.

FR2 covers ordinary flight and drift. The PSM rows of §5 (Horizon locked follows the path,
Aircraft locked follows the nose with lag) are FR4.

  Horizon locked (Balanced, Dynamic): the horizon stays level. In a drift the look leaves the
  nose toward the path by `pathShare` of the separation, saturating smoothly at `clampDeg`
  (spec §9.3: 20–30°), so the side of the jet shows and the nose stays aimable.
  Aircraft locked: the camera rolls with the jet. In a drift it looks a little toward the path
  and lags more (spec §9.2: 0.12 s → 0.20 s), so the jet visibly swings against the view.

Lags are spec §9.2's "camera lag", read as a spring's ramp lag (ω = 2 / lag).
The camera only reads: it never writes the state, the readout or the aim it is given (spec §9.4).
*/
type Style = 'balanced' | 'dynamic' | 'aircraft'
/*
  aimAhead, aimLift  where the lens aims, ahead of the jet along the look and above it. 50 puts the
                     jet in the lower third; Dynamic aims far down the look, so the jet sits just
                     under the centre and rolls about it.
  height             how far the boom rises off the look line, toward the camera's up (Dynamic:
                     toward the jet's canopy, trailed by the orbit lag).
  lookLag            look lag in ordinary flight, and at full drift.
  rollLag            roll lag in ordinary flight, and at full drift; rollMaxRate its ceiling (rad/s).
  pathShare, clampDeg  the drift look (see above). Ordinary flight takes none of the path.
*/
interface ChaseStyle { aimAhead: number; aimLift: number; height: number; lookLag: [number, number]; rollLag: [number, number]; rollMaxRate: number; pathShare: number; clampDeg: number }
const STYLE: Record<Style, ChaseStyle> = {
  balanced: { aimAhead: 50, aimLift: 0.5, height: 6.5, lookLag: [0.12, 0.2], rollLag: [0.12, 0.12], rollMaxRate: Math.PI, pathShare: 0.45, clampDeg: 25 },
  dynamic: { aimAhead: 400, aimLift: 0, height: 5, lookLag: [0.12, 0.2], rollLag: [0.05, 0.05], rollMaxRate: Math.PI, pathShare: 0.45, clampDeg: 25 },
  aircraft: { aimAhead: 50, aimLift: 0.5, height: 6.5, lookLag: [0.12, 0.2], rollLag: [0.08, 0.17], rollMaxRate: 3 * Math.PI, pathShare: 0.2, clampDeg: 12 },
}
// The look never turns faster than this (rad/s), whatever its spring asks.
const LOOK_MAX_RATE = 4 * Math.PI / 3
/*
The level horizon vanishes where the look runs near vertical (its horizontal share below
cone.end): the roll then holds what it had and only eases back to level as the look leaves the
cone. Over the top of a loop level turns over by half a turn; the camera follows that at its
rollMaxRate, the same way every time.
*/
const UP = { cone: { start: 0.1, end: 0.35 } }
// The gap to level is followed continuously, so near inverted it does not swap sides frame to frame;
// past this it is re-read the short way, so the camera never rolls the long way round.
const GAP_UNWIND = 1.25 * Math.PI
// Dynamic's boom orbit trails the jet's roll on this spring (1/s), never by more than maxLag.
const ORBIT = { omega: 10, maxLag: MathUtils.degToRad(45) }
// Boom length: base, plus up to `speed` with airspeed (one unit per 70 m/s) and `drift` at full drift.
const BOOM = { back: 26, speed: 3, drift: 3, lag: 0.3, floor: 5 }
/*
Field of view. Settings › Camera › Field of view is three.js's vertical angle (base 56° ≈ 88°
horizontal at 16:9). Spec §9.2 gives horizontal figures, so the widening is added in horizontal
degrees at the frame's own aspect and capped at capH (spec §9.3: ~104°): drift +6 (88 → 94), the
burner +5 (spec +4–8), airspeed up to +4 by speedFull m/s. Reduced motion holds it at the base +5.
*/
const FOV = { speedH: 4, speedFull: 200, burnerH: 5, driftH: 6, capH: 104, reduced: 5, lag: 0.33 }
// Free look: see FlightCamera's FREE_LOOK. The same pivot, the same ease.
const FREE_LOOK = { rate: 10, rest: 1e-3 }
const DEG = Math.PI / 180

/** Horizontal FOV (degrees) of a vertical one at `aspect`, and back. */
export const horizontalFov = (vertical: number, aspect: number) => 2 * Math.atan(Math.tan(vertical * DEG / 2) * aspect) / DEG
export const verticalFov = (horizontal: number, aspect: number) => 2 * Math.atan(Math.tan(horizontal * DEG / 2) / aspect) / DEG

/** `held` taken across `forward`, so it follows the view's own turn; fallbacks cover a view along it. */
function carry(held: Vector3, forward: Vector3, bodyUp: Vector3, wing: Vector3) {
  const across = held.clone().addScaledVector(forward, -held.dot(forward))
  if (across.lengthSq() < 1e-6) across.copy(bodyUp).addScaledVector(forward, -bodyUp.dot(forward))
  if (across.lengthSq() < 1e-6) across.copy(wing).cross(forward)
  return across.normalize()
}
/** Signed angle from `from` to `to` about `axis` (both across the axis). */
function angleAbout(from: Vector3, to: Vector3, axis: Vector3) {
  const sine = new Vector3().crossVectors(from, to).dot(axis), cosine = from.dot(to)
  return Math.abs(sine) < 1e-8 && cosine < 0 ? Math.PI : Math.atan2(sine, cosine)
}
const wrapAngle = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))

export class ChaseCamera implements CameraRig {
  baseFov = 56
  snapFov = false
  gunZoom = 0
  aim: Vector3 | null = null
  lookTurn = { yaw: 0, pitch: 0 }
  trace: CameraTrace | null = null
  readonly chase = new Quaternion()
  get lookingAway() { return this.orbit.yaw !== 0 || this.orbit.pitch !== 0 }
  private orbit = { yaw: 0, pitch: 0 }
  private initialized = false
  // The look and its angular velocity (world, rad/s).
  private look = new Vector3(1, 0, 0)
  private lookRate = new Vector3()
  // The camera's up (across the look), and its roll rate about the look (rad/s).
  private up = new Vector3(0, 1, 0)
  private rollRate = 0
  // Horizon locked: the roll from the camera's up to level, followed continuously (may pass ±π).
  private levelGap = 0
  private levelTracked = false
  // Dynamic's orbit: how far (rad) the boom trails the jet's roll, its rate, and last frame's body up.
  private orbitLag = 0
  private orbitRate = 0
  private lastBodyUp = new Vector3(0, 1, 0)
  // Dynamic's share of the boom side (eases on a style switch), and the roll from the camera's up to the orbit.
  private dynamic = new Spring(0)
  private orbitGap = 0
  private back = new Spring(BOOM.back)
  private height = new Spring(STYLE.balanced.height)
  private aimAhead = new Spring(STYLE.balanced.aimAhead)
  private aimLift = new Spring(STYLE.balanced.aimLift)
  private fov = new Spring(56)
  // Last frame's blend, for the trace and the overlay.
  private blend = { drift: 0, pathOffsetDeg: 0, levelShare: 1, rollTarget: 0 }
  reset() {
    this.initialized = false; this.orbit = { yaw: 0, pitch: 0 }; this.chase.identity()
    this.look.set(1, 0, 0); this.lookRate.set(0, 0, 0); this.up.set(0, 1, 0); this.rollRate = 0
    this.levelGap = 0; this.levelTracked = false; this.orbitLag = 0; this.orbitRate = 0; this.lastBodyUp.set(0, 1, 0); this.orbitGap = 0
    this.blend = { drift: 0, pathOffsetDeg: 0, levelShare: 1, rollTarget: 0 }
  }
  update(camera: PerspectiveCamera, state: AircraftState, view: CameraSettings, dt: number, reducedMotion = false) {
    const styleId: Style = view.roll === 'aircraft' ? 'aircraft' : view.horizonStyle === 'dynamic' ? 'dynamic' : 'balanced'
    const style = STYLE[styleId]
    const q = new Quaternion().copy(state.orientation), position = new Vector3().copy(state.position)
    const nose = new Vector3(1, 0, 0).applyQuaternion(q), bodyUp = new Vector3(0, 1, 0).applyQuaternion(q)
    const wing = new Vector3(0, 0, 1).applyQuaternion(q)
    const flight = readFlight(state)
    const snap = !this.initialized || reducedMotion
    const path = flight.airspeed > 1e-3 ? new Vector3().copy(state.velocity).normalize() : nose.clone()
    // Reduced motion keeps the plain chase: no drift look, no lag (every value snaps).
    const drift = reducedMotion ? 0 : driftWeight(flight)

    // --- Look ---------------------------------------------------------------------------------
    // The nose (or the mouse aim), turned toward the path by the drift look. The drift share is
    // zero from 170° of incidence, so the turn never needs the axis of a nose and path opposite.
    const base = this.aim ? this.aim.clone().normalize() : nose.clone()
    const offsetDeg = pathOffsetDeg(flight.incidenceDeg, style.pathShare * drift, style.clampDeg)
    const toPath = new Vector3().crossVectors(nose, path)
    const lookTarget = offsetDeg > 1e-6 && toPath.lengthSq() > 1e-12 ? base.applyAxisAngle(toPath.normalize(), offsetDeg * DEG) : base
    if (snap) { this.look.copy(lookTarget); this.lookRate.set(0, 0, 0) }
    else this.followLook(lookTarget, MathUtils.lerp(style.lookLag[0], style.lookLag[1], drift), dt)
    const forward = this.look.clone()

    // --- Roll ---------------------------------------------------------------------------------
    // The roll target is an angle about the look, from the camera's own up carried onto it.
    const carried = carry(this.up, forward, bodyUp, wing)
    const bodyAcross = bodyUp.clone().addScaledVector(forward, -bodyUp.dot(forward))
    if (bodyAcross.lengthSq() < 1e-8) bodyAcross.copy(carried)
    bodyAcross.normalize()
    let rollTarget = 0, levelShare = 1
    // Aircraft locked keeps no horizon history: a later switch to Horizon locked reads the gap
    // afresh, the short way, whatever the jet rolled meanwhile.
    if (styleId === 'aircraft') { rollTarget = angleAbout(carried, bodyAcross, forward); this.levelTracked = false; this.levelGap = 0 }
    else {
      levelShare = MathUtils.smoothstep(Math.hypot(forward.x, forward.z), UP.cone.start, UP.cone.end)
      const level = new Vector3(0, 1, 0).addScaledVector(forward, -forward.y)
      if (levelShare <= 1e-3 || level.lengthSq() < 1e-8) { this.levelTracked = false; this.levelGap = 0 }
      else {
        const raw = angleAbout(carried, level.normalize(), forward)
        this.levelGap = this.levelTracked ? this.levelGap + wrapAngle(raw - this.levelGap) : raw
        if (Math.abs(this.levelGap) > GAP_UNWIND) this.levelGap = raw
        this.levelTracked = true
        const tilt = styleId === 'balanced' ? balancedTilt(bankAbout(forward, bodyAcross)) : 0
        rollTarget = (this.levelGap + tilt) * levelShare
      }
    }
    let roll = rollTarget
    if (snap) this.rollRate = 0
    else {
      const next = springStep(-rollTarget, this.rollRate, omegaOfLag(MathUtils.lerp(style.rollLag[0], style.rollLag[1], drift)), dt)
      roll = rollTarget + next.offset; this.rollRate = next.rate
      const cap = style.rollMaxRate * dt
      if (Math.abs(roll) > cap) { roll = Math.sign(roll) * cap; this.rollRate = MathUtils.clamp(this.rollRate, -style.rollMaxRate, style.rollMaxRate) }
    }
    this.up.copy(carried).applyAxisAngle(forward, roll).normalize()
    if (this.levelTracked) this.levelGap -= roll
    this.updateOrbit(bodyAcross, forward, dt, snap)

    // --- Boom ---------------------------------------------------------------------------------
    const ease = (spring: Spring, target: number) => snap ? spring.snap(target) : spring.step(target, BOOM.lag, dt)
    const back = ease(this.back, BOOM.back + Math.min(BOOM.speed, flight.airspeed / 70) + BOOM.drift * drift)
    const height = ease(this.height, style.height), aimAhead = ease(this.aimAhead, style.aimAhead), aimLift = ease(this.aimLift, style.aimLift)
    // Dynamic swings the boom round to the canopy (the orbit); the others raise it toward the camera's
    // up. A style switch eases between them, the gap followed continuously so it cannot swap sides.
    const orbitUp = bodyAcross.clone().applyAxisAngle(forward, this.orbitLag)
    const dynamic = ease(this.dynamic, styleId === 'dynamic' ? 1 : 0)
    const toOrbit = angleAbout(this.up, orbitUp, forward)
    this.orbitGap = snap || dynamic <= 1e-3 || dynamic >= 1 - 1e-3 ? toOrbit : this.orbitGap + wrapAngle(toOrbit - this.orbitGap)
    const boomUp = this.up.clone().applyAxisAngle(forward, this.orbitGap * dynamic)
    const eye = position.clone().addScaledVector(forward, -back).addScaledVector(boomUp, height)
    eye.y = Math.max(BOOM.floor, eye.y)
    const aimPoint = position.clone().addScaledVector(forward, aimAhead).addScaledVector(this.up, aimLift)
    camera.position.copy(eye)
    camera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(eye, aimPoint, this.up))

    // --- Field of view ------------------------------------------------------------------------
    const aspect = camera.aspect > 0 ? camera.aspect : 16 / 9
    const baseH = horizontalFov(this.baseFov, aspect)
    const widen = FOV.speedH * Math.min(1, flight.airspeed / FOV.speedFull) + (flight.burner.active ? FOV.burnerH : 0) + FOV.driftH * drift
    const fov = reducedMotion ? this.baseFov + FOV.reduced
      : verticalFov(Math.min(baseH + widen, Math.max(baseH, FOV.capH)), aspect) * (1 - visibility.zoom * this.gunZoom)
    camera.fov = snap || this.snapFov ? this.fov.snap(fov) : this.fov.step(fov, FOV.lag, dt)
    camera.updateProjectionMatrix()

    this.initialized = true
    this.blend = { drift, pathOffsetDeg: offsetDeg, levelShare, rollTarget }
    this.chase.copy(camera.quaternion)
    this.turnLook(camera, position, dt, snap)
    camera.position.y = Math.max(BOOM.floor, camera.position.y)
    if (this.trace) this.recordTrace(this.trace, camera, styleId, flight, state, dt)
  }
  /*
  One frame of the look spring. The offset is the rotation vector from the target to the look;
  each of its components and of the angular velocity runs the closed-form spring, and the look is
  rebuilt from the target. The step is then held under LOOK_MAX_RATE. Exactly opposite target and
  look (only after a snap of the target itself) turn about the camera's up.
  */
  private followLook(target: Vector3, lag: number, dt: number) {
    const before = this.look.clone()
    const angle = target.angleTo(before)
    const axis = new Vector3().crossVectors(target, before)
    if (axis.lengthSq() < 1e-12) axis.copy(angle > 1 ? this.up.clone().addScaledVector(target, -this.up.dot(target)) : new Vector3())
    const offset = axis.lengthSq() > 1e-12 ? axis.normalize().multiplyScalar(angle) : new Vector3()
    const omega = omegaOfLag(lag)
    const next = new Vector3(), rate = this.lookRate
    for (const key of ['x', 'y', 'z'] as const) {
      const step = springStep(offset[key], rate[key], omega, dt)
      next[key] = step.offset; rate[key] = step.rate
    }
    const look = target.clone(), size = next.length()
    if (size > 1e-9) look.applyAxisAngle(next.divideScalar(size), size)
    look.normalize()
    const turned = before.angleTo(look), cap = LOOK_MAX_RATE * dt
    if (turned > cap) {
      const pivot = new Vector3().crossVectors(before, look)
      if (pivot.lengthSq() > 1e-12) look.copy(before).applyAxisAngle(pivot.normalize(), cap).normalize()
      const speed = rate.length()
      if (speed > LOOK_MAX_RATE) rate.multiplyScalar(LOOK_MAX_RATE / speed)
    }
    this.look.copy(look)
    // A spin about the look itself is the roll's business.
    rate.addScaledVector(look, -rate.dot(look))
  }
  /*
  Dynamic's orbit: the jet rolling by r since last frame moves the lag by −r (the boom stayed put);
  a critically damped spring then pulls it back to zero, capped at ORBIT.maxLag so the camera always
  sees the canopy, even through a 360° roll. Runs in every style so a mid-flight switch starts calm.
  */
  private updateOrbit(bodyAcross: Vector3, forward: Vector3, dt: number, snap: boolean) {
    const previous = this.lastBodyUp.clone().addScaledVector(forward, -this.lastBodyUp.dot(forward))
    this.lastBodyUp.copy(bodyAcross)
    if (snap || previous.lengthSq() < 1e-8) { this.orbitLag = 0; this.orbitRate = 0; return }
    const next = springStep(this.orbitLag - angleAbout(previous.normalize(), bodyAcross, forward), this.orbitRate, ORBIT.omega, dt)
    this.orbitLag = next.offset; this.orbitRate = next.rate
    if (Math.abs(this.orbitLag) > ORBIT.maxLag) { this.orbitLag = Math.sign(this.orbitLag) * ORBIT.maxLag; this.orbitRate = 0 }
  }
  /** Swing the finished chase shot about the jet by the eased look turn (free look, look back). */
  private turnLook(camera: PerspectiveCamera, pivot: Vector3, dt: number, snap: boolean) {
    const share = snap ? 1 : 1 - Math.exp(-FREE_LOOK.rate * dt)
    this.orbit.yaw = wrapAngle(this.orbit.yaw + wrapAngle(this.lookTurn.yaw - this.orbit.yaw) * share)
    this.orbit.pitch += (this.lookTurn.pitch - this.orbit.pitch) * share
    if (this.lookTurn.yaw === 0 && this.lookTurn.pitch === 0 && Math.abs(this.orbit.yaw) < FREE_LOOK.rest && Math.abs(this.orbit.pitch) < FREE_LOOK.rest) this.orbit = { yaw: 0, pitch: 0 }
    if (!this.lookingAway) return
    const turned = this.chase.clone().multiply(new Quaternion().setFromEuler(new Euler(this.orbit.pitch, this.orbit.yaw, 0, 'YXZ')))
    const swing = turned.clone().multiply(this.chase.clone().invert())
    camera.position.sub(pivot).applyQuaternion(swing).add(pivot)
    camera.quaternion.copy(turned)
  }
  private recordTrace(trace: CameraTrace, camera: PerspectiveCamera, style: Style, flight: FlightReadout, state: AircraftState, dt: number) {
    const v = (x: Vector3): [number, number, number] => [x.x, x.y, x.z]
    const s = STYLE[style], drift = this.blend.drift
    trace.record({ rig: 'chase', dt, style,
      position: v(camera.position), look: v(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)), up: v(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)), fov: camera.fov,
      chase: { look: v(this.look), up: v(this.up), boom: v(camera.position.clone().sub(state.position as Vector3)) },
      flight: { alphaDeg: flight.alphaDeg, betaDeg: flight.betaDeg, incidenceDeg: flight.incidenceDeg, confidence: flight.angleConfidence, airspeed: flight.airspeed, rates: { ...state.rates } },
      blend: { ...this.blend, levelGap: this.levelGap, rollRate: this.rollRate, lookRate: this.lookRate.length(),
        lookLag: MathUtils.lerp(s.lookLag[0], s.lookLag[1], drift), rollLag: MathUtils.lerp(s.rollLag[0], s.rollLag[1], drift),
        orbitLag: this.orbitLag, aimShare: this.aim ? 1 : 0, gunZoom: this.gunZoom, lookingAway: this.lookingAway } })
  }
}
