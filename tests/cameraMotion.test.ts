import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { ArcadeChase, type CameraMode } from '../src/render/arcade/ArcadeChase'
import { CameraMotionMeter, type CameraMotionPeaks } from '../src/render/arcade/cameraMotion'

/*
Camera plan C0/C1: how hard the chase camera moves the picture in a few set manoeuvres, flown by
a scripted jet straight into ArcadeChase (no physics, so the numbers only move when the camera
does). The jet's frame is the example's: forward +Z, up +Y, left +X.

Run with CAMERA_MOTION_REPORT=1 to print the peaks of every mode and manoeuvre.
*/

const DT = 1 / 60
const DEG = Math.PI / 180
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)

interface Pose { heading: number; pitch: number; bank: number; aim?: Vector3; g?: number }
type Script = (t: number) => Pose

/** Jet attitude from heading (about world up, + = left), pitch (+ = nose up) and bank (+ = right wing down). */
function attitude(p: Pose) {
  return new Quaternion().setFromAxisAngle(Y, p.heading)
    .multiply(new Quaternion().setFromAxisAngle(X, -p.pitch))
    .multiply(new Quaternion().setFromAxisAngle(Z, p.bank))
}

const ease = (t: number, t0: number, t1: number) => { const x = Math.min(1, Math.max(0, (t - t0) / (t1 - t0))); return x * x * (3 - 2 * x) }

/** Level flight, then the mouse is flicked 35° right and the nose follows it over the next second. */
const flick: Script = t => {
  const aimHeading = t < 0.5 ? 0 : -35 * DEG
  const heading = -35 * DEG * ease(t, 0.55, 1.6)
  const bank = 50 * DEG * (ease(t, 0.5, 0.75) - ease(t, 1.3, 1.7))
  return { heading, pitch: 0, bank, aim: new Vector3(0, 0, 1).applyAxisAngle(Y, aimHeading), g: 1 + 2 * Math.sin(bank) }
}
/** A steady 70° bank turn at 25°/s, the aim held 12° into the turn. */
const turn: Script = t => {
  const heading = -25 * DEG * Math.max(0, t - 0.3)
  const bank = 70 * DEG * ease(t, 0, 0.3)
  return { heading, pitch: 0, bank, aim: new Vector3(0, 0, 1).applyAxisAngle(Y, heading - 12 * DEG * ease(t, 0, 0.3)), g: 1 / Math.cos(bank) }
}
/** A full aileron roll at 270°/s in level flight, the aim straight ahead. */
const roll: Script = t => ({ heading: 0, pitch: 0, bank: 2 * Math.PI * ease(t, 0.5, 1.83), aim: Z.clone() })
/** A 20° pull up and back down, the aim leading the nose by 6°. */
const pull: Script = t => {
  const pitch = 20 * DEG * (ease(t, 0.3, 1.1) - ease(t, 1.8, 2.6))
  return { heading: 0, pitch, bank: 0, aim: new Vector3(0, Math.sin(pitch + 6 * DEG * Math.sign(pitch)), Math.cos(pitch)).normalize(), g: 1 + 3 * Math.abs(Math.sin(pitch)) }
}

export const manoeuvres: Record<string, { script: Script; seconds: number }> = {
  flick: { script: flick, seconds: 3 },
  turn: { script: turn, seconds: 4 },
  roll: { script: roll, seconds: 2.5 },
  pull: { script: pull, seconds: 3 },
}

interface Measured extends CameraMotionPeaks {
  /** Jet's place on screen (NDC, -1..1) over the manoeuvre: extremes, and at the end. */
  jetMinX: number; jetMaxX: number; jetMinY: number; jetMaxY: number; jetEndX: number
  /** Furthest the reticle (the aim) got from the centre across / up and down (NDC), and the view's whole turn (deg). */
  reticleX: number; reticleY: number; turnedDeg: number
}

/** Fly a manoeuvre in a mode; peaks are read after a settled second of level flight. */
export function measure(mode: CameraMode, script: Script, seconds: number): Measured {
  const chase = new ArcadeChase(16 / 9)
  chase.mode = mode
  const meter = new CameraMotionMeter()
  const position = new Vector3(0, 1000, 0)
  const speed = 200
  const step = (pose: Pose) => {
    const q = attitude(pose)
    const fwd = Z.clone().applyQuaternion(q)
    position.addScaledVector(fwd, speed * DT)
    chase.update({ position, quaternion: q, speed, afterburner: 0, airbrake: 0, g: pose.g ?? 1, aim: pose.aim?.clone().normalize() ?? fwd, pathDir: fwd, fcsMode: 'NORMAL' }, DT)
    return chase.camera
  }
  for (let i = 0; i < 60; i++) step(script(0))
  meter.reset()
  const jet = { jetMinX: Infinity, jetMaxX: -Infinity, jetMinY: Infinity, jetMaxY: -Infinity, jetEndX: 0, reticleX: 0, reticleY: 0, turnedDeg: 0 }
  const start = chase.camera.quaternion.clone()
  for (let t = 0; t < seconds; t += DT) {
    const pose = script(t)
    const cam = step(pose)
    if (pose.aim) {
      const r = cam.position.clone().addScaledVector(pose.aim.clone().normalize(), 2000).project(cam)
      jet.reticleX = Math.max(jet.reticleX, Math.abs(r.x)); jet.reticleY = Math.max(jet.reticleY, Math.abs(r.y))
    }
    jet.turnedDeg = Math.max(jet.turnedDeg, cam.quaternion.angleTo(start) / DEG)
    meter.sample(cam.quaternion, cam.fov, DT)
    const ndc = position.clone().project(cam)
    jet.jetMinX = Math.min(jet.jetMinX, ndc.x); jet.jetMaxX = Math.max(jet.jetMaxX, ndc.x)
    jet.jetMinY = Math.min(jet.jetMinY, ndc.y); jet.jetMaxY = Math.max(jet.jetMaxY, ndc.y)
    jet.jetEndX = ndc.x
  }
  return { ...meter.peak, ...jet }
}

const modes: CameraMode[] = ['aircraft', 'horizon', 'aim']

describe('camera motion (plan C0)', () => {
  it('measures every mode through every manoeuvre', () => {
    const rows: string[] = []
    for (const mode of modes) for (const [name, m] of Object.entries(manoeuvres)) {
      const p = measure(mode, m.script, m.seconds)
      for (const v of [p.lookRateDeg, p.lookAccelDeg, p.rollRateDeg]) expect(Number.isFinite(v)).toBe(true)
      rows.push(`${mode.padEnd(8)} ${name.padEnd(6)} look ${p.lookRateDeg.toFixed(0).padStart(4)}°/s  accel ${p.lookAccelDeg.toFixed(0).padStart(5)}°/s²  roll ${p.rollRateDeg.toFixed(0).padStart(4)}°/s  fov ${p.fovMin.toFixed(1)}–${p.fovMax.toFixed(1)}  jet x ${p.jetMinX.toFixed(2)}..${p.jetMaxX.toFixed(2)} y ${p.jetMinY.toFixed(2)}..${p.jetMaxY.toFixed(2)}`)
    }
    if (process.env.CAMERA_MOTION_REPORT) console.log(rows.join('\n'))
  })
})

describe('camera motion limits (plan C1)', () => {
  it('pans Horizon and Aim lock smoothly: no jump to full speed, gentle roll', () => {
    for (const mode of ['horizon', 'aim'] as const) for (const [name, m] of Object.entries(manoeuvres)) {
      const p = measure(mode, m.script, m.seconds)
      // Was 200°/s and ~12 000°/s² for an Aim lock flick. A flick past the reticle box adds the
      // box's own pull (C2, composer.edgeMaxAccelDeg), still nowhere near a jump.
      expect(p.lookRateDeg).toBeLessThanOrEqual(121)
      expect(p.lookAccelDeg).toBeLessThanOrEqual(name === 'flick' ? 1000 : 425)
      // Was 79–142°/s through an aileron roll.
      expect(p.rollRateDeg).toBeLessThanOrEqual(46)
    }
  })

  it('keeps the jet in the picture in every mode and manoeuvre', () => {
    for (const mode of modes) for (const m of Object.values(manoeuvres)) {
      const p = measure(mode, m.script, m.seconds)
      expect(Math.max(-p.jetMinX, p.jetMaxX)).toBeLessThan(0.6)
      expect(p.jetMinY).toBeGreaterThan(-0.9)
      expect(p.jetMaxY).toBeLessThan(0.5)
    }
  })

  it('holds the jet at the centre across through a steady turn (the Lag framing is off: boomRate 0)', () => {
    for (const mode of ['horizon', 'aim'] as const) expect(Math.abs(measure(mode, turn, 4).jetEndX)).toBeLessThan(0.04)
  })
})

describe('arcade camera trace (plan C0)', () => {
  it('records the picture motion each frame without changing the shot', async () => {
    const { PerspectiveCamera } = await import('three')
    const { ArcadeCamera } = await import('../src/render/ArcadeCamera')
    const { CameraTrace } = await import('../src/render/cameraTrace')
    const { GameRuntime } = await import('../src/game/runtime/GameRuntime')
    const { defaultCameraSettings } = await import('../src/game/camera/cameraSettings')
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' }).snapshot().aircraft[0]
    const fly = (trace: InstanceType<typeof CameraTrace> | null) => {
      const rig = new ArcadeCamera(), camera = new PerspectiveCamera(56, 16 / 9, 0.5, 14000)
      rig.trace = trace
      for (let i = 0; i < 30; i++) rig.update(camera, state, defaultCameraSettings, DT)
      return camera
    }
    const trace = new CameraTrace()
    const traced = fly(trace), plain = fly(null)
    expect(traced.quaternion.equals(plain.quaternion)).toBe(true)
    expect(trace.frames).toHaveLength(30)
    const last = trace.frames[29]
    expect(last.rig).toBe('arcade')
    if (last.rig === 'arcade') for (const v of Object.values(last.blend)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  })
})

describe('camera composer (plan C2)', () => {
  it('holds the view still while the target moves inside the dead zone', () => {
    // The nose eases 2° right and stays there: inside the box, nothing to turn for.
    const nudge: Script = t => { const heading = -2 * DEG * ease(t, 0.2, 0.6); return { heading, pitch: 0, bank: 0, aim: Z.clone().applyAxisAngle(Y, heading) } }
    for (const mode of ['horizon', 'aim'] as const) expect(measure(mode, nudge, 2).turnedDeg).toBeLessThan(0.5)
    // Aircraft lock keeps a small box: it is the mode that sits on the jet.
    expect(measure('aircraft', nudge, 2).turnedDeg).toBeGreaterThan(0.5)
  })

  it('still turns with a target that moves past the dead zone', () => {
    const swing: Script = t => { const heading = -20 * DEG * ease(t, 0.2, 1.2); return { heading, pitch: 0, bank: 0, aim: Z.clone().applyAxisAngle(Y, heading) } }
    for (const mode of modes) expect(measure(mode, swing, 3).turnedDeg).toBeGreaterThan(14)
  })

  it('keeps a reticle flicked far out near its box and always on screen', () => {
    // The aim is thrown 60° right at once and held; the jet flies on straight.
    const throw60: Script = t => ({ heading: 0, pitch: 0, bank: 0, aim: Z.clone().applyAxisAngle(Y, t < 0.3 ? 0 : -60 * DEG) })
    for (const mode of modes) {
      const p = measure(mode, throw60, 2)
      expect(p.reticleX).toBeLessThan(0.93)
      // The jet is kept too: it wins over the reticle.
      expect(Math.max(-p.jetMinX, p.jetMaxX)).toBeLessThan(0.75)
    }
  })
})
