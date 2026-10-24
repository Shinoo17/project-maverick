import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { runFlightReplay } from '../src/game/playground/replay'
import { createGunState, stepGun } from '../src/game/combat/gun'
import { GRAVITY, spawnRound, stepRound, type CombatBody, type Projectile } from '../src/game/combat/projectiles'
import { boundingRadius, type SegmentHit } from '../src/game/combat/collision'
import { getWeapon, gunStation } from '../src/content/weapons'
import { getAircraft } from '../src/content/aircraft'
import { hitboxes } from '../src/content/hitboxes'
import type { Vec3 } from '../src/game/state/WorldState'
import { FlightInput } from '../src/game/input/FlightInput'
import { parseBindings } from '../src/game/input/keyBindings'

// The 900 m/s baseline; the module tests below are written around it.
const profile = getWeapon('su57-cannon').gun!
const level = { x: 0, y: 0, z: 0, w: 1 }
const body = (id: string, from: Vec3, to: Vec3 = from, velocity: Vec3 = { x: 0, y: 0, z: 0 }): CombatBody => {
  const shapes = hitboxes[getAircraft('su57').hitboxProfileId]
  return { id, shapes, radius: boundingRadius(shapes), from: { position: from, orientation: level, velocity }, to: { position: to, orientation: level, velocity } }
}
/** Flies one round to the end, with the targets moved by `move(tick)` each tick. */
function flyRound(round: Projectile, targets: (tick: number) => CombatBody[]) {
  for (let tick = 0; tick < 200; tick++) {
    const { hit, done } = stepRound(round, profile, 0, WORLD_STEP, targets(tick))
    if (done) return { hit, round, ticks: tick + 1 }
  }
  throw new Error('round never ended')
}
const shooterAt = (y: number, speed = 0) => body('shooter', { x: 0, y, z: 0 }, { x: 0, y, z: 0 }, { x: speed, y: 0, z: 0 })

describe('gun cadence and heat', () => {
  it('fires `rate` rounds a second, a tap fires one at once, and taps never beat the rate', () => {
    const held = createGunState('m61a2')
    let rounds = 0
    for (let tick = 0; tick < 60; tick++) rounds += stepGun(held, profile, true, WORLD_STEP).length
    expect(rounds).toBe(profile.rate)
    expect(stepGun(createGunState('m61a2'), profile, true, WORLD_STEP)[0]).toBe(0)
    const tapped = createGunState('m61a2')
    let tapRounds = 0
    for (let tick = 0; tick < 60; tick++) tapRounds += stepGun(tapped, profile, tick % 2 === 0, WORLD_STEP).length
    expect(tapRounds).toBeLessThanOrEqual(profile.rate)
  })
  it('overheats after `heatSeconds` of fire, then stays silent until it has cooled to 0', () => {
    const gun = createGunState('m61a2')
    let ticks = 0, rounds = 0
    while (!gun.overheated) { rounds += stepGun(gun, profile, true, WORLD_STEP).length; ticks++ }
    expect(ticks).toBe(Math.round(profile.heatSeconds / WORLD_STEP))
    expect(Math.abs(rounds - profile.rate * profile.heatSeconds)).toBeLessThanOrEqual(1)
    let silent = 0
    // Trigger still held: the gun cools anyway.
    while (stepGun(gun, profile, true, WORLD_STEP).length === 0) silent++
    const expected = Math.ceil((1 - profile.overheatResumeHeat) / profile.coolRate / WORLD_STEP)
    expect(Math.abs(silent - expected)).toBeLessThanOrEqual(1)
  })
  it('a release in the warning band locks the gun until it cools below 35%; below it the gun fires again at once', () => {
    const fireFor = (gun: ReturnType<typeof createGunState>, seconds: number) => { for (let t = 0; t < Math.round(seconds / WORLD_STEP); t++) stepGun(gun, profile, true, WORLD_STEP) }
    const cold = createGunState('m61a2')
    fireFor(cold, 0.5 * profile.heatSeconds)
    stepGun(cold, profile, false, WORLD_STEP)
    expect(cold.cooling).toBe(false)
    expect(stepGun(cold, profile, true, WORLD_STEP).length).toBeGreaterThan(0)
    const hot = createGunState('m61a2')
    fireFor(hot, 0.85 * profile.heatSeconds)
    stepGun(hot, profile, false, WORLD_STEP)
    expect(hot.cooling).toBe(true)
    let silent = 0
    while (stepGun(hot, profile, true, WORLD_STEP).length === 0) silent++
    expect(hot.cooling).toBe(false)
    const expected = (0.85 - profile.resumeHeat) / profile.coolRate / WORLD_STEP
    expect(Math.abs(silent - expected)).toBeLessThanOrEqual(2)
  })
})

describe('gun rounds', () => {
  it('leave the muzzle at muzzle speed plus the shooter velocity and drop under gravity', () => {
    const round = spawnRound(1, 0, shooterAt(500, 200), 0, [0, 0, 0], 'm61a2', { ...profile, spreadDeg: 0 }, 0, 0)
    expect(round.velocity.x).toBeCloseTo(200 + profile.muzzleSpeed)
    stepRound(round, profile, 0, WORLD_STEP, [])
    expect(round.velocity.y).toBeCloseTo(-GRAVITY * WORLD_STEP)
  })
  it('leave on the gun line, tilted nose-up by the station elevation; the M61 is faster', () => {
    const gun = gunStation(getAircraft('f22'))
    expect(gun.elevationDeg).toBeGreaterThan(0)
    expect(gun.profile.muzzleSpeed).toBe(1030)
    expect(gunStation(getAircraft('su57')).profile.muzzleSpeed).toBe(870)
    const round = spawnRound(1, 0, shooterAt(500), 0, [0, 0, 0], 'm61a2', { ...profile, spreadDeg: 0 }, 0, 0, gun.elevationDeg)
    expect(Math.atan2(round.velocity.y, round.velocity.x) * 180 / Math.PI).toBeCloseTo(gun.elevationDeg, 9)
  })
  it('stop at the 1,000 m cap, never beyond, and at the 1.2 s lifetime when slower', () => {
    const fast = flyRound(spawnRound(1, 0, shooterAt(2000, 250), 0, [0, 0, 0], 'm61a2', profile, 0, 0), () => [])
    expect(fast.hit).toBeNull()
    expect(fast.round.travelled).toBeCloseTo(1000, 6)
    const slow = flyRound(spawnRound(2, 0, shooterAt(2000, -400), 0, [0, 0, 0], 'm61a2', profile, 0, 0), () => [])
    expect(slow.round.age).toBeCloseTo(1.2, 9)
    expect(slow.round.travelled).toBeLessThan(1000)
  })
  it('end on the ground at y = 0', () => {
    const shooter = body('shooter', { x: 0, y: 50, z: 0 })
    shooter.from.orientation = shooter.to.orientation = { x: 0, y: 0, z: -Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) } // nose 45° down
    const { hit } = flyRound(spawnRound(1, 0, shooter, 0, [0, 0, 0], 'm61a2', profile, 0, 0), () => [])
    expect(hit).toMatchObject({ kind: 'ground' })
    expect((hit as SegmentHit).point.y).toBeCloseTo(0, 6)
  })
  it('hit a still target 600 m ahead although each step is longer than the target is thick', () => {
    const drop = GRAVITY * (600 / profile.muzzleSpeed) ** 2 / 2
    const { hit } = flyRound(spawnRound(1, 0, shooterAt(500), 0, [0, 0, 0], 'm61a2', profile, 0, 0), () => [body('drone', { x: 600, y: 500 - drop, z: 0 })])
    expect(hit).toMatchObject({ kind: 'aircraft', entityId: 'drone' })
  })
  it('hit a target crossing at 250 m/s only with lead', () => {
    // Round time to 500 m is 500 / muzzle speed; the target crosses z = 0 then when it starts that time × 250 m/s out.
    const crossing = (startZ: number) => (tick: number) => {
      const z0 = startZ + 250 * tick * WORLD_STEP, z1 = z0 + 250 * WORLD_STEP
      const drop = GRAVITY * (500 / profile.muzzleSpeed) ** 2 / 2
      return [body('drone', { x: 500, y: 500 - drop, z: z0 }, { x: 500, y: 500 - drop, z: z1 }, { x: 0, y: 0, z: 250 })]
    }
    const fire = () => spawnRound(1, 0, shooterAt(500), 0, [0, 0, 0], 'm61a2', { ...profile, spreadDeg: 0 }, 0, 0)
    expect(flyRound(fire(), crossing(-500 / profile.muzzleSpeed * 250)).hit).toMatchObject({ kind: 'aircraft', entityId: 'drone' })
    expect(flyRound(fire(), crossing(0)).hit).toBeNull()
  })
  it('ignore the shooter only while leaving the muzzle', () => {
    const muzzle = gunStation(getAircraft('f22')).muzzle
    const shooter = { ...body('shooter', { x: 0, y: 500, z: 0 }), shapes: hitboxes.f22, radius: boundingRadius(hitboxes.f22) }
    const round = spawnRound(1, 0, shooter, 0, muzzle, 'm61a2', profile, 0, 0)
    expect(stepRound(round, profile, 0, WORLD_STEP, [shooter]).hit).toBeNull()
    // An old round flying back through the shooter does hit it.
    const stray: Projectile = { ...round, age: 0.5, position: { x: 12, y: 499, z: 0 }, velocity: { x: -900, y: 0, z: 0 } }
    expect(stepRound(stray, profile, 0, WORLD_STEP, [shooter]).hit).toMatchObject({ kind: 'aircraft', entityId: 'shooter' })
  })
})

describe('gun in the runtime', () => {
  const trigger = (from: number, to: number, pitch = 0) => (tick: number, entityId: string): PilotCommand =>
    ({ ...neutralCommand(tick, entityId), gunHeld: tick >= from && tick < to, pitch: tick >= from ? pitch : 0 })
  function fly(fps: number, seconds: number, script: (tick: number, id: string) => PilotCommand, targetDrone = false) {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], targetDrone })
    runtime.start()
    const hits = []
    for (let frame = 0; frame < Math.round(fps * seconds); frame++) { runtime.advance(1 / fps, script); hits.push(...runtime.drainHits()) }
    return { runtime, world: runtime.snapshot(), hits }
  }

  it('gives the same rounds at 30, 60 and 144 fps', () => {
    const reference = fly(60, 1, trigger(0, 60)).world
    expect(reference.aircraft[0].gun.shots).toBe(getWeapon('m61a2').gun!.rate)
    expect(new Set(reference.projectiles.map(round => round.id)).size).toBe(reference.projectiles.length)
    for (const fps of [30, 144]) {
      const world = fly(fps, 1, trigger(0, 60)).world
      expect(world.projectiles).toEqual(reference.projectiles)
      expect(world.aircraft[0].gun).toEqual(reference.aircraft[0].gun)
    }
  })
  it('does not change the shooter flight', () => {
    expect(fly(60, 3, trigger(0, 180)).world.aircraft[0].position).toEqual(fly(60, 3, trigger(999, 999)).world.aircraft[0].position)
  })
  it('hits the target drone with a slow pitch sweep, never the shooter, and a replay fires the same rounds', () => {
    // Close to about 650 m, sweep the nose up through the drone 25 m above, and let the rounds arrive.
    const { runtime, world, hits } = fly(60, 7, trigger(300, 390, 0.1), true)
    expect(hits.some(entry => entry.hit.kind === 'aircraft' && entry.hit.entityId === 'drone-1')).toBe(true)
    expect(hits.some(entry => entry.hit.kind === 'aircraft' && entry.hit.entityId === 'aircraft-1')).toBe(false)
    const replayed = runFlightReplay(runtime.exportReplay())
    expect(replayed.projectiles).toEqual(world.projectiles)
    expect(replayed.aircraft).toEqual(world.aircraft)
  })
  it('clears rounds and heat on reset', () => {
    const { runtime } = fly(60, 1, trigger(0, 60))
    runtime.reset()
    const world = runtime.snapshot()
    expect(world.projectiles).toEqual([])
    expect(world.aircraft[0].gun).toMatchObject({ heat: 0, shots: 0, cooldown: 0, overheated: false, cooling: false })
    expect(runtime.drainHits()).toEqual([])
  })
})

describe('gun trigger input', () => {
  it('fires on J in either preset and on left mouse only in the mouse preset; clearing drops both', () => {
    const input = new FlightInput()
    expect(input.command(0, 'aircraft-1', 'mouse').gunHeld).toBe(false)
    input.press('KeyJ')
    expect(input.command(1, 'aircraft-1', 'keyboard').gunHeld).toBe(true)
    input.held.delete('KeyJ')
    input.mouseGun = true
    expect(input.command(2, 'aircraft-1', 'mouse').gunHeld).toBe(true)
    expect(input.command(3, 'aircraft-1', 'keyboard').gunHeld).toBe(false)
    input.press('KeyJ'); input.clear()
    expect(input.command(4, 'aircraft-1', 'mouse').gunHeld).toBe(false)
  })
  it('never takes J from an older save that bound it elsewhere', () => {
    const bindings = parseBindings({ cameraCycle: ['KeyJ', null] })
    expect(bindings.cameraCycle[0]).toBe('KeyJ')
    expect(bindings.fireGun).toEqual([null, null])
    expect(parseBindings({}).fireGun).toEqual(['KeyJ', null])
  })
})
