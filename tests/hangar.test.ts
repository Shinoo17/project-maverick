import { describe, expect, it } from 'vitest'
import { getAircraft } from '../src/content/aircraft'
import { inspectedWeapons, weaponModelUrl } from '../src/content/weapons'
import { flightAxes } from '../src/features/hangar/useHangarFlight'

describe('hangar weapon inspection', () => {
  it('All includes the gun and every compatible weapon', () => {
    const all = inspectedWeapons(getAircraft('f22'), 'all')
    expect(all.map(weapon => weapon.id)).toEqual(['m61a2', 'aim9', 'aim120'])
    expect(all.filter(weapon => weaponModelUrl(weapon)).map(weapon => weapon.id)).toEqual(['aim9', 'aim120'])
  })
  it('a single selection never retains other weapons or substitutes an aircraft model', () => {
    for (const id of ['m61a2', 'aim9', 'aim120']) expect(inspectedWeapons(getAircraft('f22'), id).map(weapon => weapon.id)).toEqual([id])
    expect(weaponModelUrl(inspectedWeapons(getAircraft('f22'), 'm61a2')[0])).toBeUndefined()
    expect(inspectedWeapons(getAircraft('su57'), 'aim9')).toEqual([])
    expect(inspectedWeapons(getAircraft('su57'), 'all').every(weapon => !weaponModelUrl(weapon))).toBe(true)
  })
})
describe('hangar held flight input', () => {
  it('combines axes and cancels opposite directions without releasing afterburner', () => {
    expect(flightAxes(['pitchUp', 'rollLeft', 'yawRight', 'burner'])).toEqual({ pitch: 1, roll: -1, yaw: 1, afterburner: true })
    expect(flightAxes(['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'burner'])).toEqual({ pitch: 0, roll: 0, yaw: 0, afterburner: true })
  })
  it('releases every axis and afterburner when input is cleared', () => {
    expect(flightAxes([])).toEqual({ pitch: 0, roll: 0, yaw: 0, afterburner: false })
  })
})
