import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { circleFrom, dronePaths, dronePose, racetrackFrom, type DronePath, type TargetDroneMode } from '../src/game/playground/dronePath'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { runFlightReplay } from '../src/game/playground/replay'
import { targetDrone } from '../src/game/playground/practice'

const vec = (p: { x: number; y: number; z: number }) => new Vector3(p.x, p.y, p.z)
const axes = (q: { x: number; y: number; z: number; w: number }) => {
  const turn = new Quaternion(q.x, q.y, q.z, q.w)
  return { nose: new Vector3(1, 0, 0).applyQuaternion(turn), up: new Vector3(0, 1, 0).applyQuaternion(turn) }
}
/** Samples one lap every tick. */
function lap(path: DronePath) {
  const seconds = (2 * path.leg + 2 * Math.PI * path.turnRadius) / path.speed
  return Array.from({ length: Math.ceil(seconds / WORLD_STEP) + 1 }, (_, tick) => dronePose(path, tick * WORLD_STEP))
}

describe('drone paths', () => {
  const start = { x: 1300, y: 425, z: 0 }
  it('fly a racetrack: straight to near the edge, turn toward the centre, and come home after one lap', () => {
    const path = racetrackFrom(start, { x: 1, y: 0, z: 0 }, 0)
    expect(path.leg).toBeCloseTo(dronePaths.turnBackRadius - start.x, 6)
    const poses = lap(path)
    for (let index = 1; index < poses.length; index++) {
      // No jumps: one tick never moves more than one tick of flight.
      expect(vec(poses[index].position).distanceTo(vec(poses[index - 1].position))).toBeLessThanOrEqual(path.speed * WORLD_STEP + 1e-6)
    }
    expect(poses.every(pose => pose.position.y === start.y && Math.hypot(pose.position.x, pose.position.z) <= dronePaths.turnBackRadius + 2 * path.turnRadius)).toBe(true)
    const home = dronePose(path, (2 * path.leg + 2 * Math.PI * path.turnRadius) / path.speed)
    expect(vec(home.position).distanceTo(vec(start))).toBeLessThan(1e-6)
  })
  it('turn toward the centre from either side', () => {
    // North of the centre heading east, the centre is to the right (+Z is right of +X).
    expect(racetrackFrom({ x: 0, y: 400, z: -2000 }, { x: 1, y: 0, z: 0 }, 0).side).toEqual({ x: -0, y: 0, z: 1 })
    expect(racetrackFrom({ x: 0, y: 400, z: 2000 }, { x: 1, y: 0, z: 0 }, 0).side).toEqual({ x: 0, y: 0, z: -1 })
  })
  it('circle the range centre at one radius, banked into the turn, nose along the velocity', () => {
    const path = circleFrom(start, 425, 0)
    for (const pose of lap(path)) {
      expect(Math.hypot(pose.position.x, pose.position.z)).toBeCloseTo(dronePaths.circleRadius, 6)
      const { nose, up } = axes(pose.orientation)
      expect(nose.angleTo(vec(pose.velocity))).toBeLessThan(1e-6)
      // Banked: the lift leans toward the centre by the coordinated-turn bank.
      const inward = new Vector3(-pose.position.x, 0, -pose.position.z).normalize()
      expect(up.dot(inward)).toBeCloseTo(Math.sin(Math.atan(path.speed ** 2 / (path.turnRadius * 9.81))), 6)
    }
  })
  it('fly wings level on the straight legs and roll smoothly into the turns', () => {
    const path = racetrackFrom(start, { x: 1, y: 0, z: 0 }, 0)
    expect(axes(dronePose(path, 1).orientation).up.y).toBeCloseTo(1, 9)
    const poses = lap(path)
    for (let index = 1; index < poses.length; index++) expect(axes(poses[index].orientation).up.angleTo(axes(poses[index - 1].orientation).up)).toBeLessThan(0.05)
  })
})

describe('moving drone in the runtime', () => {
  function fly(mode: TargetDroneMode, fps: number, seconds = 4) {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone: mode })
    runtime.start()
    for (let frame = 0; frame < fps * seconds; frame++) runtime.advance(1 / fps, (tick, id) => ({ ...neutralCommand(tick, id), gunHeld: tick % 90 < 30 }))
    return runtime
  }
  it.each(['racetrack', 'circle'] as const)('flies the %s path, the same at 30, 60 and 144 fps, and replays', mode => {
    const reference = fly(mode, 60)
    const world = reference.snapshot(), drone = world.aircraft[1]
    expect(drone.control).toBe('path')
    const expected = dronePose(drone.path!, world.tick * WORLD_STEP)
    expect(drone.position).toEqual(expected.position)
    expect(drone.velocity).toEqual(expected.velocity)
    for (const fps of [30, 144]) expect(fly(mode, fps).snapshot().aircraft).toEqual(world.aircraft)
    expect(runFlightReplay(reference.exportReplay()).aircraft).toEqual(world.aircraft)
  })
  it('starts the racetrack ahead of the spawn and the circle on the circle nearest it', () => {
    const racetrack = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'racetrack' }).snapshot().aircraft[1]
    expect(racetrack.position).toEqual({ x: targetDrone.ahead, y: 400 + targetDrone.above, z: 0 })
    const circle = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'circle' }).snapshot().aircraft[1]
    expect(circle.position).toEqual({ x: dronePaths.circleRadius, y: 400 + targetDrone.above, z: 0 })
  })
  it('keeps older sessions working: true is the still drone', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: true })
    expect(runtime.exportReplay().config.targetDrone).toBe('still')
    expect(runtime.snapshot().aircraft[1].control).toBe('hold')
  })
})
