import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { Sprite } from '../src/render/vfx/atlas'
import { createParticleLayer, particleAt, type ParticleSpec, type ParticleState } from '../src/render/vfx/particles'

const spec = (life: number, extra: Partial<ParticleSpec> = {}): ParticleSpec => ({
  sprite: Sprite.smoke, position: { x: 0, y: 100, z: 0 }, life, size: [1, 5], color: [new Color(1, 0, 0), new Color(0, 0, 1)], alpha: 1, ...extra,
})
const state = (): ParticleState => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, alpha: 0, r: 0, g: 0, b: 0 })

describe('combat effect particles', () => {
  it('keeps no more than its cap, replacing the oldest', () => {
    const layer = createParticleLayer({ capacity: 3, additive: false, order: 0 })
    for (let index = 0; index < 5; index++) layer.spawn(spec(10), index)
    expect(layer.count).toBe(3)
    layer.update(4)
    expect(layer.mesh.geometry.instanceCount).toBe(3)
    // The two oldest (born at 0 and 1) were replaced, leaving 2, 3 and 4; at 12.5 the one born at 2 has expired.
    layer.update(12.5)
    expect(layer.count).toBe(2)
  })
  it('expires by simulation time, and draws nothing before a delayed particle appears', () => {
    const layer = createParticleLayer({ capacity: 8, additive: true, order: 0 })
    layer.spawn(spec(1), 0)
    layer.spawn(spec(1, { delay: 0.5 }), 0)
    layer.update(0.25)
    expect(layer.mesh.geometry.instanceCount).toBe(1)
    layer.update(1.2)
    expect(layer.count).toBe(1)
    layer.update(1.6)
    expect(layer.count).toBe(0)
  })
  it('moves under drag and lift in closed form, and fades in then out', () => {
    const moving = spec(4, { velocity: { x: 10, y: 0, z: 0 }, drag: 1, lift: -9.81, fadeIn: 0.1 })
    const early = particleAt(moving, 0.2, state()), late = particleAt(moving, 3, state())
    // Drag: it never travels further than v / k.
    expect(late.x).toBeLessThan(10)
    expect(late.x).toBeGreaterThan(early.x)
    // Under drag the fall tends to a terminal speed of g / k.
    expect(late.vy).toBeLessThan(0)
    expect(late.vy).toBeGreaterThan(-9.81)
    expect(early.alpha).toBeCloseTo(0.5, 6)
    expect(particleAt(moving, 0.4, state()).alpha).toBeCloseTo(1, 6)
    expect(particleAt(moving, 4, state()).alpha).toBeCloseTo(0, 6)
    expect(late.size).toBeGreaterThan(early.size)
  })
})
