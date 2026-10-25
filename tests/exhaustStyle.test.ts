import { describe, expect, it } from 'vitest'
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { aircraft } from '../src/content/aircraft'
import { ExhaustResponse } from '../src/render/exhaust/profile'
import { JetExhaust } from '../src/render/exhaust/JetExhaust'
import { SIM_FX, resolveExhaustStyle, sanitizeExhaustStyle } from '../src/render/exhaust/style'

const conditions = { aircraftId: 'su57' as const, power: 1, afterburner: true, vectorAngle: 0 }

describe('exhaust style', () => {
  it('gives every aircraft the GAME / SIM FX profile by default', () => {
    expect(sanitizeExhaustStyle(SIM_FX)).toEqual(SIM_FX)
    // Only the Su-57 keeps the ray-marched cavity (its throat ring) and only the F-22 moves its
    // duct plane and flame start in to the throat; everything else is SIM_FX.
    for (const definition of aircraft) {
      const style = resolveExhaustStyle(definition.id)
      expect({ ...style, volumeCavity: SIM_FX.volumeCavity, flameStart: SIM_FX.flameStart, interior: { ...style.interior, inset: SIM_FX.interior.inset } }).toEqual(SIM_FX)
    }
    expect(resolveExhaustStyle('f22').interior.inset).toBe(2.15)
    expect(resolveExhaustStyle('f22').flameStart).toBe(2.15)
    expect(resolveExhaustStyle('su57').volumeCavity).toBe(1)
    expect(resolveExhaustStyle('f22').volumeCavity).toBe(0)
  })
  it('merges a partial override key by key and clamps bad values', () => {
    const style = resolveExhaustStyle('f22', { flameLength: 1.3, haze: { strength: -2 }, layers: { core: { colors: [[9, 0, 0], [1, 1, 1], [1, 1, 1], [1, 1, 1]], mids: [.9, .2] } } })
    expect(style.flameLength).toBe(1.3)
    expect(style.haze).toEqual({ enabled: true, strength: 0 })
    expect(style.layers.core.colors[0]).toEqual([8, 0, 0])
    expect(style.layers.core.mids).toEqual([.9, .9])
    expect(style.layers.core.r0).toBe(SIM_FX.layers.core.r0)
    expect(style.layers.cone).toEqual(SIM_FX.layers.cone)
    expect(SIM_FX.flameLength).toBe(1)
  })
})

describe('exhaust flow', () => {
  it('scrolls the same distance at any frame rate and freezes at pause and with reduced motion', () => {
    const [slow, fast] = [30, 120].map(fps => {
      const response = new ExhaustResponse(); response.update(conditions, 0)
      for (let i = 0; i < fps; i++) response.update(conditions, 1 / fps)
      return response.scroll
    })
    expect(slow).toBeCloseTo(fast, 10)
    expect(slow).toBeCloseTo((1.4 + 10.5) * 1.55, 10)
    const response = new ExhaustResponse(); response.update(conditions, .5)
    const scroll = response.scroll
    response.update(conditions, 0); response.update(conditions, .5, true)
    expect(response.scroll).toBe(scroll)
    response.reset(); expect(response.scroll).toBe(0)
  })
})

describe('JetExhaust', () => {
  const camera = new PerspectiveCamera(); camera.position.set(-40, 2, 0); camera.updateMatrixWorld()
  const identity = new Matrix4()
  it('follows each nozzle and hides with the engine off, a dead engine or Exhaust Off', () => {
    const exhaust = new JetExhaust(SIM_FX)
    exhaust.update(conditions, 1 / 60, camera, identity)
    expect(exhaust.group.visible).toBe(true)
    expect(exhaust.hazeActive).toBe(true)
    const anchor = exhaust.group.children[0], position = new Vector3().setFromMatrixPosition(anchor.matrix)
    const exit = new Vector3(0, 0, 1).transformDirection(anchor.matrix)
    expect(exit.x).toBeCloseTo(-1, 6)
    expect(position.z).toBeLessThan(0)
    const vectored = new JetExhaust(SIM_FX)
    vectored.update({ ...conditions, aircraftId: 'f22', vectorAngles: { left: .3, right: .3 } }, 1 / 60, camera, identity)
    expect(new Vector3(0, 0, 1).transformDirection(vectored.group.children[0].matrix).y).toBeCloseTo(Math.sin(.3), 6)
    exhaust.update({ ...conditions, power: 0, afterburner: false }, 5, camera, identity)
    expect(exhaust.group.visible).toBe(false)
    expect(exhaust.hazeActive).toBe(false)
    exhaust.update(conditions, 5, camera, identity)
    exhaust.setQuality('low')
    exhaust.update(conditions, 1 / 60, camera, identity)
    expect(exhaust.group.visible).toBe(true)
    expect(exhaust.hazeActive).toBe(false)
    exhaust.setQuality('off')
    exhaust.update(conditions, 1 / 60, camera, identity)
    expect(exhaust.group.visible).toBe(false)
    exhaust.dispose(); vectored.dispose()
  })
  it('turns the heat haze off with the style', () => {
    const exhaust = new JetExhaust({ ...SIM_FX, haze: { enabled: false, strength: 1 } })
    exhaust.update(conditions, 1 / 60, camera, identity)
    expect(exhaust.group.visible).toBe(true)
    expect(exhaust.hazeActive).toBe(false)
    exhaust.dispose()
  })
})
