import { describe, expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { createRwrFrame, emitterLabel, HOLD } from '../src/render/rwrFrame'

/** The F-22 at the origin flying +X and an Su-57 5 km ahead; `facing` says whether its nose (and radar) is on the F-22. */
function scene(facing: boolean) {
  const world = new GameRuntime({ mode: 'playground', aircraftIds: ['f22', 'su57'] }).snapshot()
  const [me, them] = world.aircraft
  me.position = { x: 0, y: me.position.y, z: 0 }
  them.position = { x: 5000, y: me.position.y, z: 0 }
  them.orientation = facing ? { x: 0, y: 1, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 }
  return { world, me }
}

describe('RWR display', () => {
  it('prints the type number for an aircraft', () => {
    expect(emitterLabel('Su-57')).toBe('57')
    expect(emitterLabel('F-22')).toBe('22')
  })

  it('chirps once for a new emitter, holds its symbol fading after it goes quiet, then drops it', () => {
    const frame = createRwrFrame()
    const painting = scene(true), quiet = scene(false)
    const first = frame.update(painting.world, painting.me, 1)
    expect(first).toMatchObject({ top: 'search', newEmitter: true, marks: [{ sourceId: 'aircraft-2', label: '57', level: 'search', strength: 1 }] })
    expect(frame.update(painting.world, painting.me, 1.1).newEmitter).toBe(false)
    // The radar looks away: the symbol stays, fading, and sounds nothing.
    const fading = frame.update(quiet.world, quiet.me, 1.1 + HOLD / 2)
    expect(fading.top).toBeNull()
    expect(fading.marks[0].strength).toBeCloseTo(0.5)
    expect(frame.update(quiet.world, quiet.me, 1.1 + HOLD + 0.01).marks).toEqual([])
    // Painted again later: a new chirp.
    expect(frame.update(painting.world, painting.me, 5).newEmitter).toBe(true)
  })

  it('starts afresh after a reset or a jump back in time, and shows nothing once the player is down', () => {
    const frame = createRwrFrame()
    const { world, me } = scene(true)
    frame.update(world, me, 10)
    expect(frame.update(world, me, 2).newEmitter).toBe(true)
    me.alive = false
    expect(frame.update(world, me, 3)).toEqual({ marks: [], top: null, newEmitter: false })
  })
})
