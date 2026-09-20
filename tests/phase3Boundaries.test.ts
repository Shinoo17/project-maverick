import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { aircraft, getAircraft } from '../src/content/aircraft'
import { getFlightProfile } from '../src/game/flight/profile'
import { GameRuntime } from '../src/game/runtime/GameRuntime'

it('I16: input intent module has no capability/profile/state/engine imports', () => {
  const source = readFileSync(new URL('../src/game/flight/intent.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g)].map(match => match[1])
  expect(imports).toEqual(['../runtime/commands'])
})
it('no-TVC validation variant has independent aero data and reuses F-22 presentation in Playground only', () => {
  const normal = getAircraft('f22'), variant = getAircraft('f22-notvc')
  expect(aircraft.some(entry => entry.id === variant.id)).toBe(false)
  expect(variant.presentationId).toBe(normal.presentationId)
  expect(variant.modelFile).toBe(normal.modelFile)
  const profile = getFlightProfile(variant.id), base = getFlightProfile(normal.id)
  expect(profile.thrustVectoring).toBeNull()
  expect(profile.aero).toEqual(base.aero)
  expect(profile.aero).not.toBe(base.aero)
  expect(() => new GameRuntime({ mode: 'playground', aircraftIds: [variant.id] })).not.toThrow()
  expect(() => new GameRuntime({ mode: 'offline', aircraftIds: [variant.id] })).toThrow('Playground')
})
