import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { launchMissile } from '../src/game/combat/missiles'
import { radarFrame } from '../src/render/radarFrame'
import type { AircraftState, Vec3 } from '../src/game/state/WorldState'

let height = 0
/** The F-22 at the origin facing +X and an Su-57; `missiles` are [owner, target, position, velocity]. */
function picture(missiles: (world: AircraftState[]) => [AircraftState, AircraftState, Vec3, Vec3][]) {
  const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
  const [me] = world.aircraft
  height = me.position.y
  expect(Math.hypot(me.position.x, me.position.z)).toBeLessThan(1e-6)
  world.missiles = missiles(world.aircraft).map(([owner, target, position, velocity], index) => {
    const missile = launchMissile(index + 1, 0, owner, 'aim120', target, { stationId: 'test', mount: 'bay', point: [0, 0, 0] }, true)
    return { ...missile, position: { ...position }, velocity: { ...velocity } }
  })
  return radarFrame(world, world, 1, me, me)!
}
/** A point level with the F-22 (positions are read after `picture` has set `height`). */
const at = (x: number, z: number): Vec3 => ({ x, y: height, z })

describe('radar scope missiles', () => {
  it('always shows our own missiles, even behind us and far out', () => {
    const { missiles } = picture(([me, them]) => [[me, them, at(-6000, 0), { x: -700, y: 0, z: 0 }]])
    expect(missiles).toHaveLength(1)
    expect(missiles[0]).toMatchObject({ own: true, threat: false })
    expect(Math.abs(Math.abs(missiles[0].course) - 180)).toBeLessThan(1e-6)
  })
  it('shows another\'s missile only where our radar or eyes see it, and marks one chasing us', () => {
    const { missiles } = picture(([me, them]) => {
      them.position = at(5000, 0)
      return [
        [them, me, at(4000, 0), { x: -750, y: 0, z: 0 }], // ahead, painted: chasing us
        [them, them, at(-1500, 0), { x: 0, y: 0, z: 700 }], // behind but inside visual range
        [them, me, at(-3000, 0), { x: 750, y: 0, z: 0 }], // behind, past visual range: unseen
      ]
    })
    expect(missiles.map(missile => [missile.id, missile.own, missile.threat])).toEqual([[1, false, true], [2, false, false]])
    expect(missiles[0].range).toBeCloseTo(4000, -1)
  })
})
