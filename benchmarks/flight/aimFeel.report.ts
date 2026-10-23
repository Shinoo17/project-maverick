import { it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { FlightInput } from '../../src/game/input/FlightInput'
import { defaultMouseSettings } from '../../src/game/input/mouseStick'
import { cursorRay } from '../../src/game/input/mouseAim'
import { defaultReticle, gunMountOf } from '../../src/game/combat/gunSolution'
import { screenFrame } from '../../src/game/input/mouseStick'
import { bankAbout } from '../../src/game/camera/cameraRoll'
import { WORLD_STEP } from '../../src/game/runtime/clock'
import { FlightCamera } from '../../src/render/FlightCamera'
import type { CameraSettings } from '../../src/game/camera/cameraSettings'
import type { AircraftState } from '../../src/game/state/WorldState'

/* Screen-locked mouse aim feel (report only): how smooth the instructor's commands are, and how
   fast it brings the reticle onto a point the × is kept on. Flown the way FlightScene does. */
const W = 1600, H = 900
const deg = (r: number) => r * 180 / Math.PI

const reticlePixel = (camera: PerspectiveCamera, state: AircraftState) => {
  const p = new Vector3().copy(defaultReticle(state, gunMountOf('f22')) as Vector3).project(camera)
  return { x: p.x * W / 2, y: -p.y * H / 2 }
}

interface Tick { cmd: { pitch: number; roll: number; yaw: number }; rates: { pitch: number; roll: number; yaw: number }; bank: number; error: number; t: number }
function fly(seconds: number, preset: 'highG' | 'free', place: (camera: PerspectiveCamera, state: AircraftState, frame: number) => { x: number; y: number } | null, fps = 60) {
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
  runtime.reset(preset); runtime.start()
  const input = new FlightInput({ ...defaultMouseSettings, mode: 'cursor', aimAssist: 'off' }); input.setViewport(W, H); input.engage()
  const rig = new FlightCamera(), camera = new PerspectiveCamera(56, W / H, 0.5, 14000)
  const view: CameraSettings = { roll: 'horizon', horizonStyle: 'balanced' }
  const ticks: Tick[] = []
  let state = runtime.snapshot().aircraft[0]
  let error = 0
  for (let frame = 0; frame < fps * seconds; frame++) {
    rig.update(camera, state, view, 1 / fps); camera.updateMatrixWorld()
    const want = place(camera, state, frame)
    if (want) input.move(want.x - input.stick.px, want.y - input.stick.py)
    input.cursorRay = cursorRay(camera, input.stick.px, input.stick.py, W, H, state.position)
    const r = reticlePixel(camera, state)
    error = Math.hypot(r.x - input.stick.px, r.y - input.stick.py)
    runtime.advance(1 / fps, (tick, id) => {
      const live = runtime.snapshot().aircraft[0]
      input.pose = live
      input.cursorFrame = screenFrame(live, { roll: 'horizon', horizonStyle: 'dynamic' })
      const cmd = input.command(tick, id, 'mouse')
      const q = new Quaternion().copy(live.orientation), nose = new Vector3(1, 0, 0).applyQuaternion(q)
      ticks.push({ cmd: { pitch: cmd.pitch, roll: cmd.roll, yaw: cmd.yaw }, rates: { ...live.rates }, bank: deg(bankAbout(nose, new Vector3(0, 1, 0).applyQuaternion(q))), error, t: tick * WORLD_STEP })
      return cmd
    })
    state = runtime.snapshot().aircraft[0]
  }
  runtime.dispose()
  return ticks
}

/** Smoothness: mean |Δcommand| per tick, roll-rate sign reversals (> 3°/s each side), peak roll acceleration. */
function smoothness(ticks: Tick[]) {
  let dPitch = 0, dRoll = 0, dYaw = 0, reversals = 0, peakRollAccel = 0, sign = 0
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1], b = ticks[i]
    dPitch += Math.abs(b.cmd.pitch - a.cmd.pitch); dRoll += Math.abs(b.cmd.roll - a.cmd.roll); dYaw += Math.abs(b.cmd.yaw - a.cmd.yaw)
    peakRollAccel = Math.max(peakRollAccel, Math.abs(b.rates.roll - a.rates.roll) / WORLD_STEP)
    const s = b.rates.roll > 0.05 ? 1 : b.rates.roll < -0.05 ? -1 : 0
    if (s && sign && s !== sign) reversals++
    if (s) sign = s
  }
  const n = ticks.length - 1
  return { dPitch: dPitch / n * 100, dRoll: dRoll / n * 100, dYaw: dYaw / n * 100, rollReversals: reversals, peakRollAccelDeg: deg(peakRollAccel) }
}

const dump = (ticks: Tick[]) => console.log(ticks.filter((_, i) => i % 3 === 0 && i < 240).map(t => [t.t, t.cmd.pitch, t.cmd.roll, t.cmd.yaw, deg(t.rates.pitch), deg(t.rates.roll), t.bank, t.error].map(v => v.toFixed(2).padStart(7)).join(' ')).join('\n'))

it('reports screen-locked mouse aim feel (report only)', () => {
  const rows: Record<string, unknown>[] = []
  // Held offsets from the reticle, in pixels (screen right, screen down).
  const offsets: [string, number, number][] = [['right 30', 30, 0], ['right 120', 120, 0], ['right 400', 400, 0], ['up 150', 0, -150], ['down 60', 0, 60], ['down 300', 0, 300], ['diag 250', 180, -180]]
  for (const [name, dx, dy] of offsets) {
    let start: { x: number; y: number } | null = null
    const ticks = fly(5, 'highG', (camera, state, frame) => {
      if (frame === 0) { const r = reticlePixel(camera, state); start = { x: r.x + dx, y: r.y + dy } }
      return frame === 0 ? start : null
    })
    if (process.env.AIM_TRACE === `hold ${name}`) dump(ticks)
    rows.push({ scenario: `hold ${name}`, ...smoothness(ticks.filter(t => t.t > 0.2)), bankAt3: ticks.find(t => t.t >= 3)!.bank })
  }
  // A world point at `off` degrees from the nose, toward screen angle `dir` (0 right, 90 up); the × kept on it.
  const points: [number, number, number][] = [[20, 0, 60], [45, 0, 60], [90, 0, 60], [45, 90, 60], [45, -90, 60], [15, -90, 60], [120, 30, 60], [60, -135, 60], [45, 0, 30], [45, 0, 144]]
  for (const [off, dir, fps] of points) {
    let goal: Vector3 | null = null
    const ticks = fly(6, 'highG', (camera, state) => {
      if (!goal) {
        const q = new Quaternion().copy(state.orientation)
        const nose = new Vector3(1, 0, 0).applyQuaternion(q), up = new Vector3(0, 1, 0).applyQuaternion(q), right = new Vector3(0, 0, 1).applyQuaternion(q)
        const axis = right.clone().multiplyScalar(-Math.sin(dir * Math.PI / 180)).add(up.clone().multiplyScalar(Math.cos(dir * Math.PI / 180))).normalize()
        goal = nose.applyAxisAngle(axis, -off * Math.PI / 180).multiplyScalar(3000).add(state.position as Vector3)
      }
      const p = goal.clone().project(camera)
      // Behind the camera: push the × to the edge toward it.
      if (p.z > 1) return { x: -Math.sign(p.x) * W / 2, y: Math.sign(p.y) * H / 2 }
      return { x: Math.max(-W / 2, Math.min(W / 2, p.x * W / 2)), y: Math.max(-H / 2, Math.min(H / 2, -p.y * H / 2)) }
    }, fps)
    const reached = ticks.find(t => t.t > 0.1 && t.error < 6)?.t ?? null
    const after = reached === null ? [] : ticks.filter(t => t.t >= reached + 0.1)
    if (process.env.AIM_TRACE === `point ${off}@${dir}`) dump(ticks)
    rows.push({ scenario: `point ${off}° @${dir}° ${fps}fps`, reached, overshoot: after.length ? Math.max(...after.map(t => t.error)) : null, final: ticks.at(-1)!.error, ...smoothness(ticks) })
  }
  console.table(rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? Number(v.toFixed(2)) : v]))))
}, 120000)
