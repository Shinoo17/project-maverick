import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { ArcadeCamera } from '../src/render/ArcadeCamera'
import { neutralCommand } from '../src/game/runtime/commands'
import { readFlight } from '../src/game/flight/readout'
import { FlightInput } from '../src/game/input/FlightInput'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import type { AircraftState } from '../src/game/state/WorldState'
import { gunLine, gunMountOf, solveGun } from '../src/game/combat/gunSolution'
import { createGunLock, gunLockTuning, stepGunLock, trackGoal, type GunLockState } from '../src/game/combat/gunLock'
import type { AimAssistLevel } from '../src/game/combat/aimAssist'

/*
Gun lock (src/game/combat/gunLock.ts): the cursor held on the target charges a ring, a full
ring locks the cursor onto the lead, dragging the cursor off it lets go.
*/
const mount = gunMountOf('f22')
const DT = 1 / 120

function scene(range = 600, crossing = 120) {
  const world = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'still', flightCore: 'arcade' }).snapshot()
  const shooter = world.aircraft[0]
  const target: AircraftState = { ...world.aircraft[1], position: { x: shooter.position.x + range, y: shooter.position.y + 20, z: 0 }, velocity: { x: 0, y: 0, z: crossing } }
  return { shooter, target }
}
const toward = (from: AircraftState, to: AircraftState) => new Vector3(to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z).normalize()
/** Where the nose must point for the rounds to meet the target (the lock's goal). */
function leadOf(shooter: AircraftState, target: AircraftState) {
  const solution = solveGun(shooter, mount, target)!
  return new Vector3(solution.aim.x, solution.aim.y, solution.aim.z).normalize().applyAxisAngle(new Vector3(0, 0, 1), -mount.elevationDeg * Math.PI / 180)
}
/** `drag`: degrees a second the hand turns the aim (about world up) before each frame. */
function run(lock: GunLockState, seconds: number, frame: { shooter: AircraftState; target: AircraftState | null; aim: Vector3; level?: AimAssistLevel; drag?: number }) {
  const steps = Math.round(seconds / DT), aims: Vector3[] = []
  for (let i = 0; i < steps; i++) {
    if (frame.drag) frame.aim.applyAxisAngle(new Vector3(0, 1, 0), frame.drag * DT * Math.PI / 180)
    stepGunLock(lock, { level: frame.level ?? 'standard', shooter: frame.shooter, target: frame.target, mount, aim: frame.aim, dt: DT })
    aims.push(frame.aim.clone())
  }
  return aims
}

describe('gun lock', () => {
  it('charges over 1 s with the cursor on the target, then locks', () => {
    const { shooter, target } = scene(), lock = createGunLock(), aim = toward(shooter, target)
    run(lock, 0.5, { shooter, target, aim })
    expect(lock.progress).toBeCloseTo(0.5, 1)
    expect(lock.locked).toBe(false)
    run(lock, 0.55, { shooter, target, aim })
    expect(lock.locked).toBe(true)
  })

  it('charges faster on strong, and never on off', () => {
    const { shooter, target } = scene()
    const strong = createGunLock()
    run(strong, 0.75, { shooter, target, aim: toward(shooter, target), level: 'strong' })
    expect(strong.locked).toBe(true)
    const off = createGunLock()
    run(off, 3, { shooter, target, aim: toward(shooter, target), level: 'off' })
    expect(off.progress).toBe(0)
  })

  it('drains the ring slowly off the target instead of emptying it', () => {
    const { shooter, target } = scene(), lock = createGunLock()
    run(lock, 1, { shooter, target, aim: toward(shooter, target) })
    const charged = lock.progress
    const away = toward(shooter, target).applyAxisAngle(new Vector3(0, 1, 0), 10 * Math.PI / 180)
    run(lock, 0.2, { shooter, target, aim: away })
    expect(lock.progress).toBeGreaterThan(charged - 0.25)
    expect(lock.progress).toBeLessThan(charged)
  })

  it('locked, eases the cursor onto the lead from rest to rest and holds it there', () => {
    const { shooter, target } = scene(), lock = createGunLock(), aim = toward(shooter, target)
    const lead = leadOf(shooter, target), start = aim.angleTo(lead) * 180 / Math.PI
    while (!lock.locked) run(lock, DT, { shooter, target, aim })
    // The ring filling drew the cursor part of the way, gently: it is not on the lead yet.
    const gap = aim.angleTo(lead) * 180 / Math.PI
    expect(gap).toBeLessThan(start * 0.6)
    expect(gap).toBeGreaterThan(1)
    const aims = run(lock, 1, { shooter, target, aim })
    const speeds = aims.slice(1).map((a, i) => a.angleTo(aims[i]) * 180 / Math.PI / DT)
    // No jump: it starts from rest, and never moves faster than a smooth glide of that length.
    expect(speeds[0]).toBeLessThan(2)
    expect(Math.max(...speeds)).toBeLessThan(gap / gunLockTuning.settleSeconds[0] * 1.6)
    expect(aim.angleTo(lead) * 180 / Math.PI).toBeLessThan(0.05)
    expect(lock.locked).toBe(true)
  })

  it('springs back from a small nudge, lets go when the cursor is dragged off the lead', () => {
    const { shooter, target } = scene(), lock = createGunLock(), aim = toward(shooter, target)
    run(lock, 3, { shooter, target, aim })
    // A nudge: 1.5° in a tenth of a second, then hands off.
    run(lock, 0.1, { shooter, target, aim, drag: 15 })
    expect(lock.locked).toBe(true)
    run(lock, 1.5, { shooter, target, aim })
    expect(aim.angleTo(leadOf(shooter, target)) * 180 / Math.PI).toBeLessThan(0.05)
    // A slow drift never lets go; a plain drag does, within a third of a second, the cursor left where the hand put it.
    run(lock, 2, { shooter, target, aim, drag: 6 })
    expect(lock.locked).toBe(true)
    run(lock, 0.35, { shooter, target, aim, drag: 20 })
    expect(lock.locked).toBe(false)
    expect(aim.angleTo(leadOf(shooter, target)) * 180 / Math.PI).toBeGreaterThan(2.5)
    // The ring starts again from empty, after a wait: the cursor resting near the target does not lock straight back.
    run(lock, 0.5, { shooter, target, aim })
    expect(lock.progress).toBe(0)
  })

  it('locks a fast crossing target the hand keeps the cursor on, its lead far ahead of it', () => {
    // 230 m/s across at 400 m: the lead is about 12° ahead of the target, three times captureDeg.
    for (const level of ['standard', 'strong'] as const) {
      const { shooter, target } = scene(400, 230), lock = createGunLock(), aim = toward(shooter, target)
      expect(toward(shooter, target).angleTo(leadOf(shooter, target)) * 180 / Math.PI).toBeGreaterThan(2 * gunLockTuning.captureDeg)
      for (let i = 0; i < 2.5 / DT && !lock.locked; i++) {
        target.position = { ...target.position, z: target.position.z + 230 * DT }
        // The hand: keeps bringing the cursor back onto the target itself, a little behind it.
        const to = toward(shooter, target), gap = aim.angleTo(to)
        if (gap > 1e-9) aim.applyAxisAngle(new Vector3().crossVectors(aim, to).normalize(), gap * (1 - Math.exp(-8 * DT))).normalize()
        stepGunLock(lock, { level, shooter, target, mount, aim, dt: DT })
      }
      expect(lock.locked).toBe(true)
    }
  })

  it('does not charge out of gun reach, and lets go when the target dies or changes', () => {
    const far = scene(1500), none = createGunLock()
    run(none, 2, { shooter: far.shooter, target: far.target, aim: toward(far.shooter, far.target) })
    expect(none.progress).toBe(0)
    const { shooter, target } = scene(), lock = createGunLock(), aim = toward(shooter, target)
    run(lock, 1.6, { shooter, target, aim })
    run(lock, DT, { shooter, target: { ...target, id: 'other' }, aim })
    expect(lock.locked).toBe(false)
    run(lock, 1.6, { shooter, target, aim: toward(shooter, target) })
    run(lock, DT, { shooter, target: { ...target, alive: false }, aim })
    expect(lock.locked).toBe(false)
    expect(lock.targetId).toBeNull()
  })
})

describe('gun lock magnet (arcade core)', () => {
  const forward = (s: AircraftState) => new Vector3(1, 0, 0).applyQuaternion(new Quaternion(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w))
  const bankOf = (s: AircraftState) => {
    const q = new Quaternion(s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w)
    const right = new Vector3(0, 0, 1).applyQuaternion(q), up = new Vector3(0, 1, 0).applyQuaternion(q)
    return Math.atan2(-right.y, up.y) * 180 / Math.PI
  }

  it('draws the nose onto the goal in well under a second, without rolling the jet', () => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' })
    runtime.start()
    const goal = new Vector3(1, 0.15, 0.45).normalize()
    let bank = 0
    for (let i = 0; i < 45; i++) runtime.advance(1 / 60, (tick, id) => {
      const s = runtime.snapshot().aircraft[0]
      bank = Math.max(bank, Math.abs(bankOf(s)))
      return { ...neutralCommand(tick, id), gunTrack: { x: goal.x, y: goal.y, z: goal.z } }
    })
    const s = runtime.snapshot().aircraft[0]
    expect(forward(s).angleTo(goal) * 180 / Math.PI).toBeLessThan(2)
    // The path came round with the nose: no sideways slide left over.
    expect(readFlight(s).incidenceDeg).toBeLessThan(5)
    expect(bank).toBeLessThan(5)
  })

  it('holds the gun line on a target crossing from the side and shoots it down', () => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: 'bot', flightCore: 'arcade' })
    runtime.start()
    // The bot 400 m ahead, flying across the nose at 230 m/s.
    const world = (runtime as unknown as { world: { aircraft: AircraftState[] } }).world, me = world.aircraft[0], bot = world.aircraft[1]
    const across = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2)
    Object.assign(bot, { position: { x: me.position.x + 400, y: me.position.y, z: -150 }, velocity: { x: 0, y: 0, z: 230 }, orientation: { x: across.x, y: across.y, z: across.z, w: across.w }, arcadeFlight: undefined })
    const lock = createGunLock()
    lock.locked = true
    let worst = 0
    for (let i = 0; i < 150 && runtime.snapshot().aircraft[1].alive; i++) runtime.advance(1 / 60, (tick, id) => {
      const s = runtime.snapshot(), shooter = s.aircraft[0], target = s.aircraft[1]
      const command = neutralCommand(tick, id)
      if (!target.alive) return command
      command.gunTrack = trackGoal(lock, shooter, target, mount, 1 / 60) ?? undefined
      // Once the pull is in and the nose has come round, the gun line stays on the solution.
      if (i >= 50) {
        const line = gunLine(shooter.orientation, mount.elevationDeg), aim = solveGun(shooter, mount, target)!.aim
        worst = Math.max(worst, new Vector3(line.x, line.y, line.z).angleTo(new Vector3(aim.x, aim.y, aim.z)) * 180 / Math.PI)
        command.gunHeld = true
      }
      return command
    })
    expect(worst).toBeLessThan(0.4)
    expect(runtime.snapshot().aircraft[1].alive).toBe(false)
  })

  it('keeps the aim controller off the stick while tracking; held keys still fly', () => {
    const input = new FlightInput()
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' }).snapshot().aircraft[0]
    input.pose = state
    input.command(0, 'a', 'mouse')
    input.mixer.aim.dir.copy(new Vector3(0.5, 0, 0.86).normalize())
    input.gunTracking = true
    const tracked = input.command(1, 'a', 'mouse')
    expect([tracked.pitch, tracked.roll, tracked.yaw]).toEqual([0, 0, 0])
    input.press('ArrowUp')
    expect(input.command(2, 'a', 'mouse').pitch).toBeGreaterThan(0)
  })
})

describe('gun lock view (Aim lock)', () => {
  it('looks along the lead with a level horizon however the jet is banked', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' }).snapshot().aircraft[0]
    // Banked 70° right.
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -70 * Math.PI / 180)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 14000), rig = new ArcadeCamera()
    rig.aim = new Vector3(1, 0.05, 0.12).normalize()
    const view = { mode: 'aim', roll: 'horizon', horizonStyle: 'balanced' } as const
    const roll = () => {
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      return Math.asin(Math.abs(right.y)) * 180 / Math.PI
    }
    for (let i = 0; i < 120; i++) rig.update(camera, state, view, 1 / 60)
    const free = roll()
    rig.gunLock = true
    for (let i = 0; i < 120; i++) rig.update(camera, state, view, 1 / 60)
    expect(free).toBeGreaterThan(10)
    expect(roll()).toBeLessThan(1)
    expect(camera.getWorldDirection(new Vector3()).angleTo(rig.aim) * 180 / Math.PI).toBeLessThan(3)
  })
})
