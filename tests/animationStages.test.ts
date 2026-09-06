import { describe, expect, it } from 'vitest'
import { AnimationClip, Group, NumberKeyframeTrack } from 'three'
import { AnimationStages, prepareAnimations } from '../src/render/aircraft/animationStages'

function fixture() {
  const root = new Group()
  const door = new Group(); door.name = 'door'; root.add(door)
  const gear = new Group(); gear.name = 'gear'; root.add(gear)
  const clips = [
    new AnimationClip('door', 1, [new NumberKeyframeTrack('door.position[x]', [0, 1], [0, 10]), new NumberKeyframeTrack('gear.position[x]', [0, 1], [0, 0])]),
    new AnimationClip('gear', 2, [new NumberKeyframeTrack('gear.position[x]', [0, 2], [0, 20]), new NumberKeyframeTrack('door.position[x]', [0, 2], [0, 0])]),
  ]
  const player = new AnimationStages(root, prepareAnimations(root, clips))
  return { player, door, gear }
}

describe('independent animation stages', () => {
  it('reaches full travel on simultaneous clips and holds their endpoints', () => {
    const { player, door, gear } = fixture()
    for (let frame = 0; frame < 120; frame++) player.update(1 / 60, { door: true, gear: true }, true, 1)
    expect(door.position.x).toBeCloseTo(10)
    expect(gear.position.x).toBeCloseTo(20)
    expect(player.update(1 / 60, { door: true, gear: true }, true, 1)).toBe(false)
  })
  it('pauses, reverses from an intermediate pose, restarts after an endpoint and resets', () => {
    const { player, door } = fixture()
    for (let frame = 0; frame < 30; frame++) player.update(1 / 60, { door: true }, true, 1)
    expect(door.position.x).toBeCloseTo(5)
    player.update(1 / 60, { door: true }, false, 1)
    expect(door.position.x).toBeCloseTo(5)
    for (let frame = 0; frame < 30; frame++) player.update(1 / 60, {}, true, 1)
    expect(door.position.x).toBeCloseTo(0)
    for (let frame = 0; frame < 60; frame++) player.update(1 / 60, { door: true }, true, 2)
    expect(door.position.x).toBeCloseTo(10)
    player.reset(); expect(door.position.x).toBe(0)
    player.dispose()
  })
})
