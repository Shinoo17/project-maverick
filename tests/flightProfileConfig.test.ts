import { describe, expect, it } from 'vitest'
import { flightDefaults, maneuverDefaults, stallDefaults } from '../src/content/flight-profiles/defaults'
import { flightProfiles, getFlightProfile, validateFlightProfile } from '../src/game/flight/profile'
import { stepFlight } from '../src/game/flight/stepFlight'
import { stepManeuvers } from '../src/game/flight/maneuvers'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'

function createState() {
  return new GameRuntime({ mode: 'playground', aircraftIds: ['su57'] }).snapshot().aircraft[0]
}

describe('aircraft flight configuration', () => {
  it('validates every registered profile', () => {
    for (const profile of Object.values(flightProfiles)) {
      expect(() => validateFlightProfile(profile)).not.toThrow()
    }
  })

  it('keeps aircraft tuning independent from other aircraft and defaults', () => {
    const f22 = getFlightProfile('f22')
    const su57 = getFlightProfile('su57')
    const previousFlight = { ...f22.flight }
    const previousManeuver = { ...f22.maneuver }
    const previousStall = { ...f22.stall }
    const otherAircraft = structuredClone(su57)
    const defaults = structuredClone({ flightDefaults, maneuverDefaults, stallDefaults })
    try {
      f22.flight.acceleration = 10
      f22.flight.rateResponse = 2
      f22.maneuver.entryMin = 90
      f22.maneuver.activeGrip = 0.2
      f22.stall.stallSpeedKph = 200
      f22.stall.entrySeconds = 1
      expect(su57).toEqual(otherAircraft)
      expect({ flightDefaults, maneuverDefaults, stallDefaults }).toEqual(defaults)
    } finally {
      Object.assign(f22.flight, previousFlight)
      Object.assign(f22.maneuver, previousManeuver)
      Object.assign(f22.stall, previousStall)
    }
  })

  it('defaults to no PSM while retaining normal flight, high-G and afterburner', () => {
    const profile = getFlightProfile('su57')
    const previous = profile.maneuver
    profile.maneuver = { ...maneuverDefaults }
    try {
      expect(profile.maneuver.psmEnabled).toBe(false)
      const plain = createState()
      plain.velocity.x = 100
      const held = structuredClone(plain)
      for (let tick = 0; tick < 120; tick++) {
        const command = { ...neutralCommand(tick, plain.id), pitch: 0.3 }
        stepFlight(plain, command, 1 / 60)
        stepFlight(held, { ...command, psmArm: true }, 1 / 60)
        expect(held.maneuver.phase).toBe('normal')
        expect(held.maneuver.blocked).toBe('unsupported')
      }
      expect(held.position).toEqual(plain.position)
      expect(held.velocity).toEqual(plain.velocity)
      expect(held.orientation).toEqual(plain.orientation)

      const state = createState()
      stepFlight(state, {
        ...neutralCommand(0, state.id),
        psmArm: true,
        pitch: 0.5,
        highG: true,
        afterburner: true,
      }, 1 / 60)
      expect(state.maneuver.phase).toBe('normal')
      expect(state.maneuver.highG).toBeGreaterThan(0)
      expect(state.maneuver.burnerActive).toBe(true)
    } finally {
      profile.maneuver = previous
    }
  })

  it('supports a narrower PSM envelope and smaller maneuver budgets', () => {
    const profile = getFlightProfile('su57')
    const previous = profile.maneuver
    profile.maneuver = {
      ...maneuverDefaults,
      psmEnabled: true,
      entryMin: 95,
      entryMax: 105,
      minAltitude: 400,
      pitchRate: 1,
      yawRate: 0.8,
      activeSeconds: 0.5,
      cooldown: 8,
    }
    try {
      validateFlightProfile(profile)
      for (const [speed, altitude, blocked] of [
        [94, 400, 'speed'],
        [106, 400, 'speed'],
        [100, 399, 'altitude'],
        [95, 400, 'none'],
        [105, 400, 'none'],
      ] as const) {
        const state = createState()
        state.position.y = altitude
        const command = { ...neutralCommand(0, state.id), psmArm: true, pitch: 1 }
        stepManeuvers(state, command, 1 / 60, speed)
        expect(state.maneuver.blocked).toBe(blocked)
        expect(state.maneuver.phase).toBe(blocked === 'none' ? 'active' : 'normal')
      }

      const state = createState()
      const command = { ...neutralCommand(0, state.id), psmArm: true, pitch: 1, yaw: 1 }
      const assist = stepManeuvers(state, command, 1 / 60, 100)
      expect(assist.pitch).toBe(1)
      expect(assist.yaw).toBe(0.8)
      for (let tick = 0; tick < 30; tick++) stepManeuvers(state, command, 1 / 60, 100)
      expect(state.maneuver.phase).toBe('recovery')
      for (let tick = 0; tick < 20; tick++) stepManeuvers(state, command, 1 / 60, 100)
      expect(state.maneuver.phase).toBe('cooldown')
      expect(state.maneuver.cooldown).toBeGreaterThan(7.9)
    } finally {
      profile.maneuver = previous
    }
  })

  it('allows disabled PSM budgets but rejects an unusable enabled envelope', () => {
    const profile = structuredClone(getFlightProfile('su57'))
    Object.assign(profile.maneuver, {
      psmEnabled: false,
      entryMin: 0,
      entryMax: 0,
      activeSeconds: 0,
      maxRotation: 0,
    })
    expect(() => validateFlightProfile(profile)).not.toThrow()
    profile.maneuver.psmEnabled = true
    expect(() => validateFlightProfile(profile)).toThrow('maneuver.entryMin')

    profile.maneuver = { ...maneuverDefaults, psmEnabled: true, entryMin: 100, entryMax: 95 }
    expect(() => validateFlightProfile(profile, 'test-aircraft')).toThrow('test-aircraft.maneuver.entryMax')
  })

  it.each([
    ['pitchRate', 0],
    ['yawRate', 0],
    ['rollRate', 0],
    ['rateResponse', -1],
    ['turnRateReserve', 1.1],
  ] as const)('rejects unsafe flight tuning: %s = %s', (key, value) => {
    const profile = structuredClone(getFlightProfile('f22'))
    profile.flight[key] = value
    expect(() => validateFlightProfile(profile)).toThrow(`flight.${key}`)
  })
})
