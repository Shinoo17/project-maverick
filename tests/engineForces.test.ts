import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { controlledPathStep, integrateTranslation } from '../src/game/flight/engineForces'

it('I19: engine path rate is bounded at zero/low speed, even with simultaneous reverse thrust', () => {
  const dt = 1 / 120, floor = 40, path = new Vector3(1, 0, 0)
  for (const speed of [0, 0.001, 1, 5, 40, 100]) for (const axial of [-1000, 0, 1000]) {
    const force = new Vector3(axial, 65, 20), result = controlledPathStep(path, force, speed, floor, dt)
    expect(result.direction.length()).toBeCloseTo(1, 14)
    expect(result.angle / dt).toBeLessThanOrEqual(Math.hypot(65, 20) / Math.max(speed, floor))
    expect(path.angleTo(result.direction)).toBeCloseTo(result.angle, 12)
    expect(result.maxRate).toBeCloseTo(Math.hypot(65, 20) / Math.max(speed, floor), 14)
  }
})
it('zero transverse thrust leaves direction exactly unchanged', () => {
  const path = new Vector3(1, 0, 0)
  expect(controlledPathStep(path, new Vector3(-50, 0, 0), 0, 40, 1 / 120).direction).toEqual(path)
})

it('I18/I19: combined engine + lateral force obeys work and heading bounds before gravity', () => {
  const dt = 1 / 120, gravity = 9.81, floor = 40
  for (const speed of [0, 0.001, 1, 5, 20, 100]) for (const y of [-1, -0.5, 0, 0.5, 1]) {
    const path = new Vector3(Math.sqrt(1 - y * y), y, 0), velocity = path.clone().multiplyScalar(speed)
    for (const drag of [0, 30, 10000]) {
      const out = integrateTranslation(velocity, path, new Vector3(0, 65, 0), new Vector3(0, 0, 70), drag, gravity, 1, floor, dt)
      const delta = out.velocity.lengthSq() / 2 + gravity * out.velocity.y * dt - speed * speed / 2
      expect(delta).toBeLessThanOrEqual(out.thrustWork - out.dragWork + 1e-9 * Math.max(1, speed * speed))
      expect(out.controlPathRate).toBeLessThanOrEqual(out.controlPathCap + 1e-12)
      expect(Number.isFinite(out.velocity.length())).toBe(true)
    }
  }
})

it('gravity and opposing axial engine thrust can cross zero; drag alone cannot reverse flow', () => {
  const dt = 1 / 120, path = new Vector3(0, -1, 0), velocity = path.clone().multiplyScalar(0.05)
  const opposite = integrateTranslation(velocity, path, new Vector3(0, 50, 0), new Vector3(), 0, 9.81, 1, 40, dt)
  expect(opposite.longitudinalZeroCrossing).toBe(true)
  expect(opposite.velocity.y).toBeGreaterThan(0)
  expect(opposite.controlPathRate).toBe(0) // No transverse rotation, signed axial velocity crosses zero.
  const braking = integrateTranslation(new Vector3(0.05, 0, 0), new Vector3(1, 0, 0), new Vector3(), new Vector3(), 50, 0, 0, 40, dt)
  expect(braking.velocity.x).toBe(0)
  expect(braking.longitudinalZeroCrossing).toBe(false)
  const falling = integrateTranslation(new Vector3(0, 0.01, 0), new Vector3(0, 1, 0), new Vector3(), new Vector3(), 0, 9.81, 1, 40, dt)
  expect(falling.velocity.y).toBeLessThan(0)
})
