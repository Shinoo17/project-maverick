import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { between, createGunnery } from '../src/render/gunneryFrame'
import type { GameEvent } from '../src/game/runtime/events'
import { distanceScale } from '../src/render/targetVisibility'

const world = () => new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' }).snapshot()
const shooterOf = (snapshot: ReturnType<typeof world>, targetId: string | null = 'drone-1') => {
  const me = snapshot.aircraft[0]
  return { id: me.id, targetId, position: me.position, orientation: me.orientation, velocity: me.velocity }
}

describe('HUD gun marks', () => {
  it('shows only the reticle with no target', () => {
    const marks = createGunnery('f22').update(null, world(), 1, shooterOf(world(), null), [])
    expect(marks.target).toBeNull()
    expect(marks.lead).toBeNull()
    expect(marks.reticle).not.toBeNull()
  })
  it('boxes the target with its HP, and gives no lead out of the gun’s reach', () => {
    const snapshot = world()
    snapshot.aircraft[1].hp = 40
    const far = createGunnery('f22').update(snapshot, snapshot, 1, shooterOf(snapshot), [])
    expect(far.target).toMatchObject({ hp: 0.4, label: 'DRONE · SU-57' })
    expect(far.target!.range).toBeCloseTo(Math.hypot(1300, 25), 0)
    expect(far.lead).toBeNull()
    expect(far.inRange).toBe(false)
    snapshot.aircraft[1].position = { x: 500, y: 401, z: 0 }
    const near = createGunnery('f22').update(snapshot, snapshot, 1, shooterOf(snapshot), [])
    expect(near.lead).not.toBeNull()
    expect(near.inRange).toBe(true)
    // The box frames the model as drawn: larger with distance.
    expect(far.target!.radius / near.target!.radius).toBeCloseTo(distanceScale(far.target!.range) / distanceScale(near.target!.range), 6)
    expect(far.target!.radius).toBeGreaterThan(near.target!.radius)
  })
  it('flashes and calls SPLASH only for the player’s own rounds', () => {
    const snapshot = world(), marks = createGunnery('f22')
    const theirs: GameEvent = { id: 'e1', tick: 3, type: 'damage-applied', targetId: 'drone-1', sourceId: 'aircraft-9', amount: 2 }
    expect(marks.update(snapshot, snapshot, 1, shooterOf(snapshot), [theirs]).hitTick).toBeNull()
    const mine: GameEvent[] = [{ id: 'e2', tick: 4, type: 'damage-applied', targetId: 'drone-1', sourceId: 'aircraft-1', amount: 2 },
      { id: 'e3', tick: 4, type: 'aircraft-destroyed', entityId: 'drone-1', sourceId: 'aircraft-1', cause: 'weapon' }]
    const after = marks.update(snapshot, snapshot, 1, shooterOf(snapshot), mine)
    expect(after.hitTick).toBe(4)
    expect(after.splash?.tick).toBe(4)
  })
  it('never draws a dead target, and snaps a respawned one into place', () => {
    const before = world(), now = structuredClone(before)
    now.aircraft[1].alive = false
    expect(between(before, now, entity => entity.id === 'drone-1', 0.5)).toBeNull()
    before.aircraft[1].alive = false
    now.aircraft[1].alive = true
    now.aircraft[1].position = { x: 5000, y: 400, z: 0 }
    expect(between(before, now, entity => entity.id === 'drone-1', 0.2)!.position.x).toBe(5000)
  })
})
