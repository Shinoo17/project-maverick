import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { aimAssist, aimMagnetMaxRate, assistRange, cursorDraw, rangeShare, withAimAssist, type AimAssistLevel } from '../src/game/combat/aimAssist'
import { gunMountOf, solveGun } from '../src/game/combat/gunSolution'
import { parseMouseSettings } from '../src/game/input/mouseStick'
import { runFlightReplay } from '../src/game/playground/replay'
import type { TargetDroneMode } from '../src/game/playground/dronePath'

const mount = gunMountOf('f22')
const pair = () => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' }).snapshot().aircraft

describe('aim assist', () => {
  it('does nothing when off, with no target, or with the target out of the gun’s reach', () => {
    const [me, drone] = pair()
    expect(aimAssist('off', me, drone, mount, { pitch: 0, yaw: 0 }).active).toBe(false)
    expect(aimAssist('standard', me, undefined, mount, { pitch: 0, yaw: 0 }).active).toBe(false)
    // Past the rounds' 1,500 m.
    drone.position = { x: 2000, y: 400, z: 0 }
    expect(aimAssist('standard', me, drone, mount, { pitch: 0, yaw: 0 }).active).toBe(false)
  })
  it('pushes the nose toward the solution, up and right for a target above and right', () => {
    const [me, drone] = pair()
    drone.position = { x: 500, y: 410, z: 15 }
    const assist = aimAssist('standard', me, drone, mount, { pitch: 0, yaw: 0 })
    expect(assist).toMatchObject({ active: true })
    expect(assist.pitch).toBeGreaterThan(0)
    expect(assist.yaw).toBeGreaterThan(0)
  })
  it('reaches only inside its cone, further when strong', () => {
    const [me, drone] = pair()
    // About 10° right of the nose at 500 m.
    drone.position = { x: 492, y: 400, z: 88 }
    expect(aimAssist('standard', me, drone, mount, { pitch: 0, yaw: 0 }).active).toBe(false)
    expect(aimAssist('strong', me, drone, mount, { pitch: 0, yaw: 0 }).active).toBe(true)
  })
  it('gives way to a full stick and keeps every axis within ±1', () => {
    const [me, drone] = pair()
    drone.position = { x: 500, y: 430, z: 15 }
    expect(aimAssist('strong', me, drone, mount, { pitch: -1, yaw: 0 }).pitch).toBe(0)
    const command = withAimAssist({ ...neutralCommand(0, me.id), pitch: 0.9 }, aimAssist('strong', me, drone, mount, { pitch: 0.2, yaw: 0 }))
    expect(command.pitch).toBeLessThanOrEqual(1)
    expect(command.roll).toBe(0)
  })
  it('settings default to standard and read older saves', () => {
    expect(parseMouseSettings({}).aimAssist).toBe('standard')
    expect(parseMouseSettings({ aimAssist: 'strong' }).aimAssist).toBe('strong')
    expect(parseMouseSettings({ aimAssist: 'magnet' }).aimAssist).toBe('standard')
  })
})

/** A rough pilot: points the nose at the target itself (no lead, no drop), with a little wobble, and fires inside 800 m. */
function engage(level: AimAssistLevel, drone: TargetDroneMode, seconds = 22) {
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: drone })
  runtime.start()
  let hits = 0, kills = 0
  const pilot = (tick: number, id: string) => {
    const [me, target] = runtime.snapshot().aircraft
    const sight = { x: target.position.x - me.position.x, y: target.position.y - me.position.y, z: target.position.z - me.position.z }
    const range = Math.hypot(sight.x, sight.y, sight.z)
    const q = me.orientation
    const nose = { x: 1 - 2 * (q.y ** 2 + q.z ** 2), y: 2 * (q.x * q.y + q.w * q.z), z: 2 * (q.x * q.z - q.w * q.y) }
    const clamp = (value: number) => Math.max(-0.5, Math.min(0.5, value))
    const command = { ...neutralCommand(tick, id), speedAdjust: drone === 'still' ? 0 : 1, afterburner: drone !== 'still', gunHeld: range < 800,
      pitch: clamp(1.5 * (Math.asin(sight.y / range) - Math.asin(nose.y)) + 0.08 * Math.sin(tick / 23)),
      yaw: clamp(2 * (Math.atan2(sight.z, sight.x) - Math.atan2(nose.z, nose.x)) + 0.08 * Math.sin(tick / 31)) }
    return withAimAssist(command, aimAssist(level, me, target, mount, command))
  }
  for (let frame = 0; frame < 60 * seconds; frame++) {
    runtime.advance(1 / 60, pilot)
    hits += runtime.drainHits().filter(entry => entry.hit.kind === 'aircraft').length
    kills += runtime.drainEvents().filter(event => event.type === 'aircraft-destroyed').length
  }
  return { hits, kills, runtime }
}

describe('aim assist in flight', () => {
  it('turns a rough pilot’s pass on the still drone from a few hits into dozens', () => {
    const off = engage('off', 'still').hits, standard = engage('standard', 'still').hits
    expect(standard).toBeGreaterThanOrEqual(30)
    expect(standard).toBeGreaterThan(off * 5)
  })
  it('lets a rough pilot shoot down the racetrack drone, and a replay repeats the assisted flight', () => {
    expect(engage('off', 'racetrack').kills).toBe(0)
    const { kills, runtime } = engage('standard', 'racetrack')
    expect(kills).toBe(1)
    expect(runFlightReplay(runtime.exportReplay()).aircraft[1].hp).toBe(runtime.snapshot().aircraft[1].hp)
  })
  it('acts in full out to 800 m and fades to nothing at 1,000 m; the close fade under mouse aim is off ([0, 1])', () => {
    expect(assistRange).toEqual({ near: [0, 1], far: [800, 1000] })
    const ranges = [0, 0.5, 50, 100, 200, 500, 800, 900, 1000, 1200]
    expect(ranges.map(range => rangeShare(range))).toEqual([0, 0.5, 1, 1, 1, 1, 1, 0.5, 0, 0])
    expect(ranges.map(range => rangeShare(range, false))).toEqual([1, 1, 1, 1, 1, 1, 1, 0.5, 0, 0])
    expect(cursorDraw('standard', 2, 2, 1 / 60, false, 0, 50)).toBeCloseTo(cursorDraw('standard', 2, 2, 1 / 60, false, 0, 500), 9)
    const [me, drone] = pair()
    // Straight ahead and a little high: inside the cone at every range here, and in the rounds' reach.
    const pitchAt = (x: number) => { drone.position = { x, y: 400 + x * 0.03, z: 0 }; return aimAssist('strong', me, drone, mount, { pitch: 0, yaw: 0 }) }
    expect(pitchAt(700).pitch).toBeGreaterThan(0)
    expect(pitchAt(900).pitch).toBeGreaterThan(0)
    expect(pitchAt(900).pitch).toBeLessThan(pitchAt(700).pitch)
    // The stick assist never rolls the jet, so it keeps working up close.
    expect(pitchAt(80).pitch).toBeGreaterThan(0)
    drone.position = { x: 1100, y: 433, z: 0 }
    expect(solveGun(me, mount, drone)?.reachable).toBe(true)
    expect(aimAssist('strong', me, drone, mount, { pitch: 0, yaw: 0 }).active).toBe(false)
    expect(cursorDraw('standard', 2, 2, 1 / 60, false, 0, 900)).toBeCloseTo(cursorDraw('standard', 2, 2, 1 / 60, false, 0, 500) / 2, 9)
    expect(cursorDraw('standard', 2, 2, 1 / 60, true, 0, 1000)).toBe(0)
  })
  it('never turns the aim or moves the × faster than its top rate, twice that while firing', () => {
    expect(aimMagnetMaxRate).toEqual({ standard: 30, strong: 45 })
    // Idle 3° off the lead the draw (12°/s) is under the 30°/s cap; firing 6° off, 65°/s is held to 60°/s.
    expect(cursorDraw('standard', 3, 3, 1 / 60, false, 0, 500)).toBeCloseTo(1 - Math.exp(-4 / 60), 9)
    expect(cursorDraw('standard', 6, 6, 1 / 60, true, 0, 500) * 6).toBeCloseTo(60 / 60, 9)
  })
  it('never acts on a solution the rounds cannot reach', () => {
    const [me, drone] = pair()
    drone.position = { x: 2000, y: 400, z: 0 }
    expect(solveGun(me, mount, drone)?.reachable).toBe(false)
    expect(aimAssist('strong', me, drone, mount, { pitch: 0, yaw: 0 }).active).toBe(false)
  })
})
