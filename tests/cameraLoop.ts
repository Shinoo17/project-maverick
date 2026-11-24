import { PerspectiveCamera, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { FlightInput } from '../src/game/input/FlightInput'
import { ArcadeCamera } from '../src/render/ArcadeCamera'
import { defaultCameraSettings } from '../src/game/camera/cameraSettings'
import { defaultMouseSettings } from '../src/game/control/mouseSettings'
import { CameraMotionMeter } from '../src/render/arcade/cameraMotion'
import type { CameraMode } from '../src/render/arcade/ArcadeChase'

/*
The chase camera flown in the loop it runs in: the real mouse aim, the real flight core and
ArcadeCamera, frame by frame as FlightScene does it (world aim). A hand script gives the mouse
travel of each frame in pixels. What is read is what the player sees: how the picture turns, and
where the reticle and the jet are on screen.
*/

const W = 1280, H = 720, DT = 1 / 60
export type Hand = (t: number) => [number, number]

export interface LoopResult {
  /** Peaks of the picture's turn (deg/s, deg/s²) and roll (deg/s). */
  lookRate: number; lookAccel: number; rollRate: number
  /** Root mean square of the look turn rate over the run (deg/s): how much the picture moves overall. */
  lookRms: number
  /** Seconds the picture kept turning faster than 3°/s after the hand stopped for good. */
  tail: number
  /** Times the picture's turn across reversed after the hand stopped: a sway. */
  reversals: number
  /** Fastest the reticle moved on screen while the hand was still (half-screens/s), and its furthest place from the centre. */
  reticleDrift: number; reticleMax: number
  /** Fastest the jet moved on screen (half-screens/s) and its furthest place across. */
  jetSpeed: number; jetMaxX: number
  /** Peak angle between the view and its target (deg). */
  lag: number
}

export function flyLoop(mode: CameraMode, hand: Hand, seconds: number, handEnd: number): LoopResult {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' })
  runtime.start()
  const input = new FlightInput({ ...defaultMouseSettings, aimMode: 'world' })
  input.setViewport(W, H)
  const rig = new ArcadeCamera(), camera = new PerspectiveCamera(56, W / H, 0.5, 14000), steady = new PerspectiveCamera()
  const settings = { ...defaultCameraSettings, mode }
  const meter = new CameraMotionMeter()
  const frame = (t: number, live: boolean) => {
    const [dx, dy] = live ? hand(t) : [0, 0]
    if (dx || dy) input.move(dx, dy)
    runtime.advance(DT, (tick, id) => { input.pose = runtime.snapshot().aircraft[0]; return input.command(tick, id, 'mouse') })
    const state = runtime.snapshot().aircraft[0]
    rig.aim = input.aim.synced && state.alive ? input.aim.direction : null
    rig.update(camera, state, settings, DT)
    camera.updateMatrixWorld()
    steady.position.copy(camera.position); steady.quaternion.copy(rig.chase)
    steady.fov = camera.fov; steady.aspect = camera.aspect; steady.updateProjectionMatrix(); steady.updateMatrixWorld()
    input.setView(steady)
    return { state, moved: dx !== 0 || dy !== 0 }
  }
  for (let i = 0; i < 120; i++) frame(0, false)
  meter.reset()
  const r: LoopResult = { lookRate: 0, lookAccel: 0, rollRate: 0, lookRms: 0, tail: 0, reversals: 0, reticleDrift: 0, reticleMax: 0, jetSpeed: 0, jetMaxX: 0, lag: 0 }
  let sum = 0, n = 0, lastReticle: Vector3 | null = null, lastJet: Vector3 | null = null, lastSide = 0
  const right = new Vector3(), lastLook = new Vector3()
  for (let t = 0; t < seconds; t += DT) {
    const { state, moved } = frame(t, true)
    const m = meter.sample(camera.quaternion, camera.fov, DT)
    sum += m.lookRateDeg ** 2; n++
    if (t > handEnd && m.lookRateDeg > 3) r.tail = t - handEnd
    // Turn across, signed: the look's change along the view's right.
    const look = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    const across = n > 1 ? look.clone().sub(lastLook).dot(right) / DT * 180 / Math.PI : 0
    lastLook.copy(look)
    if (t > handEnd && Math.abs(across) > 1) { const side = Math.sign(across); if (lastSide && side !== lastSide) r.reversals++; lastSide = side }
    if (rig.aim) {
      const p = camera.position.clone().addScaledVector(rig.aim as Vector3, 2000).project(camera)
      r.reticleMax = Math.max(r.reticleMax, Math.hypot(p.x, p.y))
      if (lastReticle && !moved) r.reticleDrift = Math.max(r.reticleDrift, Math.hypot(p.x - lastReticle.x, p.y - lastReticle.y) / DT)
      lastReticle = p
    }
    const j = new Vector3(state.position.x, state.position.y, state.position.z).project(camera)
    if (lastJet) r.jetSpeed = Math.max(r.jetSpeed, Math.hypot(j.x - lastJet.x, j.y - lastJet.y) / DT)
    lastJet = j
    r.jetMaxX = Math.max(r.jetMaxX, Math.abs(j.x))
    r.lag = Math.max(r.lag, rig.arcade.followState.lagDeg)
  }
  Object.assign(r, { lookRate: meter.peak.lookRateDeg, lookAccel: meter.peak.lookAccelDeg, rollRate: meter.peak.rollRateDeg, lookRms: Math.sqrt(sum / n) })
  return r
}

/** `px` pixels of travel spread evenly over t0..t1. */
const sweep = (t: number, t0: number, t1: number, px: number) => (t >= t0 && t < t1 ? px / Math.round((t1 - t0) / DT) : 0)

export const hands: Record<string, { hand: Hand; seconds: number; handEnd: number }> = {
  /** 35° right in 0.15 s, then hold. */
  flick: { hand: t => [sweep(t, 0.5, 0.65, 500), 0], seconds: 5, handEnd: 0.65 },
  /** Small corrections on a target: ±7° side to side at 0.5 Hz with a little up and down. */
  track: { hand: t => t < 6 ? [100 * Math.PI * Math.cos(Math.PI * t) * DT, 40 * 1.4 * Math.PI * Math.cos(1.4 * Math.PI * t) * DT] : [0, 0], seconds: 9, handEnd: 6 },
  /** 21° right, then 42° left: a reversal. */
  jink: { hand: t => [sweep(t, 0.5, 0.8, 300) + sweep(t, 1.6, 2.0, -600), 0], seconds: 6, handEnd: 2 },
  /** 28° up in 0.3 s. */
  pull: { hand: t => [0, sweep(t, 0.5, 0.8, -400)], seconds: 5, handEnd: 0.8 },
}
