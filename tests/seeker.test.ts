import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { stepTargeting } from '../src/game/combat/targeting'
import { lockPhase, seekerRules, selectedMissile, stepSeeker } from '../src/game/combat/seeker'
import { WORLD_STEP } from '../src/game/runtime/clock'
import { radarOf } from '../src/game/combat/radar'
import type { AircraftState } from '../src/game/state/WorldState'
import { FlightInput } from '../src/game/input/FlightInput'

/** The F-22 at the origin facing +X, an Su-57 and the still drone 1,300 m ahead. */
const world = () => new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'], targetDrone: 'still' }).snapshot()
const ticks = (seconds: number) => Math.round(seconds / WORLD_STEP)
function run(me: AircraftState, aircraft: AircraftState[], seconds: number, select: number | null = null) {
  for (let tick = 0; tick < ticks(seconds); tick++) {
    stepTargeting(me, aircraft, false, WORLD_STEP)
    stepSeeker(me, aircraft, tick === 0 ? select : null, WORLD_STEP)
  }
}

describe('missile seeker', () => {
  it('climbs through the phases to a lock over the missile\'s lock time', () => {
    const [me, other, drone] = world().aircraft
    other.alive = false
    const ir = selectedMissile('f22', 0)!
    expect(ir.weapon.kind).toBe('ir')
    run(me, [me, drone], ir.seeker.lockSeconds / 2)
    expect(me.targeting.seeker).toMatchObject({ targetId: 'drone-1', tracking: true, locked: false })
    expect(lockPhase(me.targeting.seeker.progress, false)).toBe('tracking')
    run(me, [me, drone], ir.seeker.lockSeconds * 0.3)
    expect(lockPhase(me.targeting.seeker.progress, me.targeting.seeker.locked)).toBe('acquiring')
    run(me, [me, drone], ir.seeker.lockSeconds * 0.2 + WORLD_STEP)
    expect(me.targeting.seeker).toMatchObject({ progress: 1, locked: true, lost: null })
  })
  it('loosens outside the seeker, reports LOCK LOST once, and clears it', () => {
    const [me, other, drone] = world().aircraft
    other.alive = false
    run(me, [me, drone], 2)
    expect(me.targeting.seeker.locked).toBe(true)
    // 35° off the nose: inside the radar cone (the radar lock holds) but outside the IR seeker's.
    drone.position = { x: 1300 * Math.cos(35 * Math.PI / 180), y: drone.position.y, z: 1300 * Math.sin(35 * Math.PI / 180) }
    run(me, [me, drone], 0.2)
    expect(me.targeting.targetId).toBe('drone-1')
    expect(me.targeting.seeker.locked).toBe(false)
    expect(me.targeting.seeker.lost).toBeGreaterThan(0)
    expect(me.targeting.seeker.progress).toBeLessThan(1)
    run(me, [me, drone], seekerRules.lostSeconds)
    expect(me.targeting.seeker.lost).toBeNull()
    expect(me.targeting.seeker.progress).toBe(0)
  })
  it('holds a lock a little past the cone edge, but never starts one there', () => {
    const [me, other, drone] = world().aircraft
    other.alive = false
    const cone = selectedMissile('f22', 0)!.seeker.coneDeg
    const at = (deg: number) => { drone.position = { x: 1300 * Math.cos(deg * Math.PI / 180), y: me.position.y, z: 1300 * Math.sin(deg * Math.PI / 180) } }
    at(cone + 1)
    run(me, [me, drone], 0.5)
    expect(me.targeting.seeker.progress).toBe(0)
    at(0)
    run(me, [me, drone], 2)
    at(cone + 1)
    run(me, [me, drone], 0.5)
    expect(me.targeting.seeker.locked).toBe(true)
  })
  it('starts over on another missile or another target, and reports nothing for a kill', () => {
    const [me, other, drone] = world().aircraft
    other.position = { x: 1200, y: me.position.y, z: 150 }
    run(me, [me, other, drone], 2)
    expect(me.targeting.seeker.locked).toBe(true)
    run(me, [me, other, drone], WORLD_STEP, 1)
    expect(me.targeting.seeker).toMatchObject({ slot: 1, locked: false, lost: null })
    expect(me.targeting.seeker.progress).toBeLessThan(0.05)
    expect(selectedMissile('f22', 1)!.weapon.kind).toBe('radar')
    run(me, [me, other, drone], 3)
    expect(me.targeting.seeker.locked).toBe(true)
    const locked = me.targeting.targetId
    stepTargeting(me, [me, other, drone], true, WORLD_STEP)
    stepSeeker(me, [me, other, drone], null, WORLD_STEP)
    expect(me.targeting.targetId).not.toBe(locked)
    expect(me.targeting.seeker).toMatchObject({ slot: 1, locked: false, lost: null })
    const target = [other, drone].find(entity => entity.id === me.targeting.targetId)!
    run(me, [me, other, drone], 3)
    target.alive = false
    run(me, [me, other, drone], WORLD_STEP)
    expect(me.targeting.seeker.lost).toBeNull()
  })
  it('has no minimum range: locks close in and holds the lock all the way in', () => {
    const [me, other, drone] = world().aircraft
    other.alive = false
    drone.position = { x: 150, y: me.position.y, z: 0 }
    run(me, [me, drone], 2)
    expect(me.targeting.seeker.locked).toBe(true)
    drone.position = { x: 20, y: me.position.y, z: 0 }
    run(me, [me, drone], 0.5)
    expect(me.targeting.seeker).toMatchObject({ locked: true, lost: null })
  })
  it('locks a radar missile through the aircraft\'s own radar cone', () => {
    expect(selectedMissile('f22', 1)!.seeker.coneDeg).toBe(radarOf('f22').coneDeg)
    expect(selectedMissile('su57', 1)!.seeker.coneDeg).toBe(radarOf('su57').coneDeg)
    const [me, other, drone] = world().aircraft
    other.alive = false
    // 50° off the nose: outside the IR seeker's 20°, inside the F-22 radar's 60°.
    drone.position = { x: 1300 * Math.cos(50 * Math.PI / 180), y: me.position.y, z: 1300 * Math.sin(50 * Math.PI / 180) }
    stepTargeting(me, [me, drone], true, WORLD_STEP)
    run(me, [me, drone], 3, 1)
    expect(me.targeting.seeker).toMatchObject({ slot: 1, locked: true })
    run(me, [me, drone], WORLD_STEP, 0)
    run(me, [me, drone], 2)
    expect(me.targeting.seeker).toMatchObject({ slot: 0, progress: 0, locked: false })
  })
  it('never locks with the selected station empty', () => {
    const [me, other, drone] = world().aircraft
    other.alive = false
    me.stores.forEach(store => { if (store.stationId === selectedMissile('f22', 0)!.station.id) store.count = 0 })
    run(me, [me, drone], 3)
    expect(me.targeting.seeker).toMatchObject({ progress: 0, locked: false, tracking: false })
  })
  it('picks the missile from the keys through the command, in the simulation', () => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' })
    runtime.start()
    const input = new FlightInput()
    input.press('Digit2')
    runtime.advance(WORLD_STEP, (tick, id) => ({ ...neutralCommand(tick, id), actions: input.command(tick, id, 'keyboard').actions }))
    expect(runtime.snapshot().aircraft[0].targeting.seeker.slot).toBe(1)
    runtime.advance(WORLD_STEP * 3, (tick, id) => neutralCommand(tick, id))
    expect(runtime.snapshot().aircraft[0].targeting.seeker.slot).toBe(1)
  })
})
