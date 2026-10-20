import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { gunStation } from '../src/content/weapons'
import { getAircraft } from '../src/content/aircraft'
import { hitboxes } from '../src/content/hitboxes'
import { boundingRadius } from '../src/game/combat/collision'
import { spawnRound, stepRound, type CombatBody } from '../src/game/combat/projectiles'
import { defaultReticle, DEFAULT_RANGE, gunLine, muzzlePoint, solveGun, type ShooterPose, type TargetMotion } from '../src/game/combat/gunSolution'
import { circleFrom, dronePose } from '../src/game/playground/dronePath'
import { WORLD_STEP } from '../src/game/runtime/clock'
import type { Vec3 } from '../src/game/state/WorldState'

const gun = gunStation(getAircraft('f22'))
const mount = { muzzle: gun.muzzle!, elevationDeg: gun.elevationDeg!, profile: gun.profile }
const still: Vec3 = { x: 0, y: 0, z: 0 }
const level = { x: 0, y: 0, z: 0, w: 1 }
const shapes = hitboxes[getAircraft('su57').hitboxProfileId], radius = boundingRadius(shapes)
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** The shooter turned so its gun line, tilt included, points along `aim`. */
function pointed(shooter: ShooterPose, aim: Vec3): ShooterPose {
  const e = mount.elevationDeg * Math.PI / 180
  const q = new Quaternion().setFromUnitVectors(new Vector3(Math.cos(e), Math.sin(e), 0), new Vector3(aim.x, aim.y, aim.z))
  return { ...shooter, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } }
}
/** Fires one round with no spread from `shooter` and flies it against a target that moves by `poseAt(seconds)`. */
function fire(shooter: ShooterPose, poseAt: (seconds: number) => { position: Vec3; orientation: CombatBody['from']['orientation']; velocity: Vec3 }) {
  const body = (seconds: number): CombatBody['from'] => poseAt(seconds)
  const shooterBody: CombatBody = { id: 'shooter', shapes: hitboxes.f22, radius: boundingRadius(hitboxes.f22), from: shooter, to: shooter }
  const round = spawnRound(1, 0, shooterBody, 0, mount.muzzle, 'm61a2', { ...mount.profile, spreadDeg: 0 }, 0, 0, mount.elevationDeg)
  for (let tick = 0; tick < 200; tick++) {
    const target: CombatBody = { id: 'target', shapes, radius, from: body(tick * WORLD_STEP), to: body((tick + 1) * WORLD_STEP) }
    const { hit, done } = stepRound(round, mount.profile, 0, WORLD_STEP, [target])
    if (done) return hit
  }
  return null
}
const spawn: ShooterPose = { position: { x: 0, y: 400, z: 0 }, orientation: level, velocity: { x: 130, y: 0, z: 0 } }

describe('gun solution', () => {
  it('puts the reticle on the lead point when the gun line points along the solution', () => {
    const target: TargetMotion = { position: { x: 600, y: 420, z: 80 }, velocity: { x: 0, y: 0, z: -150 }, acceleration: still }
    const solution = solveGun(spawn, mount, target)!
    // Turning the aircraft moves the muzzle (it sits off the centreline), so solve once more from the new pose.
    const once = solveGun(pointed(spawn, solution.aim), mount, target)!
    const aimed = solveGun(pointed(spawn, once.aim), mount, target)!
    expect(distance(aimed.reticle, aimed.lead)).toBeLessThan(0.01)
  })
  it.each([
    ['still drone', () => ({ position: { x: 600, y: 425, z: 0 }, orientation: level, velocity: still }), still],
    ['crossing at 150 m/s', (s: number) => ({ position: { x: 550, y: 430, z: 60 - 150 * s }, orientation: level, velocity: { x: 0, y: 0, z: -150 } }), still],
  ] as const)('hits the %s when aimed by the solution', (_, poseAt, acceleration) => {
    const now = poseAt(0)
    const solution = solveGun(spawn, mount, { position: now.position, velocity: now.velocity, acceleration })!
    expect(solution.reachable).toBe(true)
    expect(fire(pointed(spawn, solution.aim), poseAt)).toMatchObject({ kind: 'aircraft', entityId: 'target' })
  })
  it('hits the circling drone', () => {
    const path = circleFrom({ x: 3000, y: 0, z: 0 }, 425, 0)
    const poseAt = (s: number) => dronePose(path, 4 + s)
    const now = poseAt(0), before = poseAt(-WORLD_STEP)
    const shooter: ShooterPose = { position: { x: now.position.x - 450, y: 420, z: now.position.z + 300 }, orientation: level, velocity: { x: 130, y: 0, z: 0 } }
    const acceleration = { x: (now.velocity.x - before.velocity.x) / WORLD_STEP, y: 0, z: (now.velocity.z - before.velocity.z) / WORLD_STEP }
    const solution = solveGun(shooter, mount, { position: now.position, velocity: now.velocity, acceleration })!
    expect(fire(pointed(shooter, solution.aim), poseAt)).toMatchObject({ kind: 'aircraft' })
  })
  it('leads a hard-turning target around its turn, which a straight-line lead misses', () => {
    // About a 6 g level turn: 150 m/s on a 375 m radius.
    const path = { start: { x: 600, y: 425, z: 0 }, heading: { x: 0, y: 0, z: -1 }, side: { x: -1, y: 0, z: 0 }, leg: 0, turnRadius: 375, speed: 150, startTick: 0 }
    const poseAt = (s: number) => dronePose(path, 1 + s)
    const now = poseAt(0), before = poseAt(-WORLD_STEP)
    // A tail chase from 450 m: the turn pulls the target across the line of sight.
    const along = { x: now.velocity.x / 150, y: 0, z: now.velocity.z / 150 }
    const shooter: ShooterPose = { position: { x: now.position.x - along.x * 450, y: 420, z: now.position.z - along.z * 450 }, orientation: level, velocity: { x: along.x * 130, y: 0, z: along.z * 130 } }
    const acceleration = { x: (now.velocity.x - before.velocity.x) / WORLD_STEP, y: 0, z: (now.velocity.z - before.velocity.z) / WORLD_STEP }
    const turning = solveGun(shooter, mount, { position: now.position, velocity: now.velocity, acceleration })!
    expect(fire(pointed(shooter, turning.aim), poseAt)).toMatchObject({ kind: 'aircraft' })
    const straight = solveGun(shooter, mount, { position: now.position, velocity: now.velocity, acceleration: still })!
    expect(fire(pointed(shooter, straight.aim), poseAt)).toBeNull()
  })
  it('has no reachable solution past the distance cap, and the default reticle sits 500 m down the gun line', () => {
    const far = solveGun(spawn, mount, { position: { x: 1400, y: 400, z: 0 }, velocity: still, acceleration: still })!
    expect(far.reachable).toBe(false)
    const reticle = defaultReticle(spawn, mount)
    const line = gunLine(spawn.orientation, mount.elevationDeg), start = muzzlePoint(spawn, mount)
    const along = (reticle.x - start.x) * line.x + (reticle.y - start.y) * line.y + (reticle.z - start.z) * line.z
    expect(distance(reticle, start)).toBeCloseTo(DEFAULT_RANGE, -1)
    expect(along).toBeGreaterThan(450)
  })
})
