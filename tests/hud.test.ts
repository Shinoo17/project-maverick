import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { flightAttitude, burnerStatus, flightWarning } from '../src/features/flight/telemetry'
import { glassLayout, projectRung } from '../src/features/flight/hudPainter'
import { glassState } from '../src/features/flight/FlightInstruments'
import { arcadeSpeed } from '../src/game/flight/speed'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { stepFlight } from '../src/game/flight/stepFlight'

const pose = (heading: number, pitch = 0, bank = 0) => new Quaternion()
  .setFromAxisAngle(new Vector3(0, 1, 0), -heading * Math.PI / 180)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitch * Math.PI / 180))
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bank * Math.PI / 180))
const aircraft = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]

describe('stall advisories', () => {
  it('shows recovery advice, suppresses it during active PSM, and keeps terrain/boundary priority', () => {
    const state = aircraft()
    expect(flightWarning(null)).toBeNull()
    expect(flightWarning(state)).toBeNull()
    state.stall = { severity: 1, cause: 'aoa', aoaDeg: 40 }
    expect(flightWarning(state)).toBe('hudStall')
    state.stall.cause = 'none'
    expect(flightWarning(state)).toBe('hudStallRecovering')
    state.maneuver.phase = 'active'
    state.velocity.x = 40
    expect(flightWarning(state)).toBeNull()
    state.position.y = 50
    expect(flightWarning(state)).toBe('lowAltitude')
    state.position.x = 7000
    expect(flightWarning(state)).toBe('boundaryWarning')
    state.alive = false
    expect(flightWarning(state)).toBeNull()
  })
})

describe('HUD orientation', () => {
  it('reads nose heading through north wrap and every cardinal direction', () => {
    for (const heading of [0, 1, 90, 180, 270, 359]) {
      expect(flightAttitude(pose(heading)).heading).toBeCloseTo(heading)
    }
  })
  it('keeps pitch and signed bank correct in combined and inverted attitudes', () => {
    for (const heading of [0, 70, 260]) for (const pitch of [-60, 0, 50]) for (const bank of [-170, -40, 0, 30, 170]) {
      const value = flightAttitude(pose(heading, pitch, bank))
      expect(value.pitch).toBeCloseTo(pitch)
      expect(value.bank).toBeCloseTo(bank)
      expect(value.heading).toBeCloseTo(heading)
    }
  })
  it('marks undefined vertical heading/bank unavailable instead of showing a false direction', () => {
    for (const pitch of [-90, 90]) {
      const value = flightAttitude(pose(120, pitch, 30))
      expect(value.pitch).toBeCloseTo(pitch)
      expect(value.heading).toBeNull()
      expect(value.bank).toBeNull()
    }
  })
  it('matches the actual flight input axes and does not use the velocity heading', () => {
    const state = aircraft()
    for (let i = 0; i < 30; i++) stepFlight(state, { ...neutralCommand(i, state.id), pitch: 0.4, yaw: 0.3, roll: 0.2 }, 1 / 120)
    const before = structuredClone(state)
    const attitude = flightAttitude(state.orientation)
    expect(attitude.pitch).toBeGreaterThan(0)
    expect(attitude.bank).toBeGreaterThan(0)
    expect(attitude.heading).toBeGreaterThan(0)
    state.velocity = { x: -130, y: 0, z: 0 }
    expect(flightAttitude(state.orientation)).toEqual(attitude)
    expect(state.orientation).toEqual(before.orientation)
  })
})
describe('HUD afterburner states', () => {
  it('reflects active, depleted, recharging and simultaneous airbrake states from flight physics', () => {
    const state = aircraft()
    expect(burnerStatus(null)).toBe('hudWaiting')
    expect(burnerStatus(state)).toBe('hudBurnerReady')
    stepFlight(state, { ...neutralCommand(0, state.id), afterburner: true }, 1 / 120)
    expect(burnerStatus(state)).toBe('hudBurnerActive')
    stepFlight(state, { ...neutralCommand(1, state.id), airbrake: true, afterburner: true }, 1 / 120)
    expect(state.maneuver.burnerActive).toBe(true)
    expect(burnerStatus(state)).toBe('hudBurnerActive')
    state.maneuver.burnerActive = false
    state.maneuver.burnerLocked = true
    expect(burnerStatus(state)).toBe('hudBurnerLocked')
    state.maneuver.burnerLocked = false; state.maneuver.airbrake = 0; state.maneuver.burnerRest = 2
    expect(burnerStatus(state)).toBe('recharging')
  })
})

describe('HUD glass mapping', () => {
  it('carries arcade speed, flat-range clearance, boundary distance and burner/PSM state', () => {
    const state = aircraft()
    const camera = new PerspectiveCamera()
    const read = () => glassState({ camera, state, position: state.position, orientation: state.orientation, velocity: state.velocity })
    const glass = read()
    expect(glass.speed).toBeCloseTo(arcadeSpeed(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)))
    expect(glass.groundClearance).toBe(state.position.y)
    expect(glass.edge).toBeGreaterThan(0)
    expect(glass.burnerState).toBe('ready')
    expect(glass.forward.x).toBeCloseTo(new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation)).x)
    state.maneuver.burnerLocked = true
    expect(read().burnerState).toBe('depleted')
    state.maneuver.burnerLocked = false; state.maneuver.burnerActive = true
    expect(read().burnerState).toBe('engaged')
    state.maneuver.phase = 'active'
    expect(read().psm).toBe(true)
  })
})

describe('HUD glass layout', () => {
  it('keeps heading, ladder, tapes, status and advisory in order and on the glass', () => {
    for (const width of [400, 500, 760, 761, 1024, 1280, 1440, 1920, 2560]) for (const height of [602, 652, 672, 812, 1032]) {
      const l = glassLayout(width, height)
      const tape = l.half * l.tapeOffset
      expect(l.cy - l.rise).toBeGreaterThanOrEqual(100)
      expect(l.ladderTop).toBeGreaterThan(l.cy - l.rise)
      expect(l.ladderBottom).toBeLessThan(l.statusFirst)
      // Outboard value boxes (4 and 5 digits) stay inside the frame.
      expect(l.cx - tape - 10 - 66).toBeGreaterThanOrEqual(0)
      expect(l.cx + tape + 10 + 80).toBeLessThanOrEqual(width)
      if (!l.compact) {
        expect(l.cx - tape - 92).toBeGreaterThanOrEqual(8)
        expect(l.cx + tape + 92).toBeLessThanOrEqual(width - 8)
      }
      if (l.tight) expect(l.advisoryLeft).toBeGreaterThan(l.cx)
      else expect(l.advisoryTop).toBeGreaterThan(l.statusFirst + 20)
      expect(l.advisoryTop + 30).toBeLessThanOrEqual(height)
    }
  })
})

describe('world-registered pitch ladder', () => {
  const view = (lookX = 1) => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.5, 14000)
    camera.lookAt(lookX, 0, 0); camera.updateMatrixWorld()
    return camera
  }
  const origin = { x: 0, y: 0, z: 0 }, north = { x: 1, y: 0, z: 0 }
  it('puts the horizon on the level sightline with positive rungs above and negative below', () => {
    const camera = view()
    const horizon = projectRung(camera, origin, north, 0, 1600, 900)!
    expect(horizon.left.y).toBeCloseTo(450)
    expect(horizon.right.y).toBeCloseTo(450)
    expect(horizon.left.x).toBeLessThan(800)
    expect(horizon.right.x).toBeGreaterThan(800)
    expect(projectRung(camera, origin, north, 10, 1600, 900)!.left.y).toBeLessThan(450)
    expect(projectRung(camera, origin, north, -10, 1600, 900)!.left.y).toBeGreaterThan(450)
  })
  it('follows the ground track, not the nose pitch, and banks with a rolled camera', () => {
    const camera = view()
    const level = projectRung(camera, origin, north, 10, 1600, 900)!
    const noseUp = projectRung(camera, origin, { x: Math.cos(0.5), y: Math.sin(0.5), z: 0 }, 10, 1600, 900)!
    expect(noseUp.left.x).toBeCloseTo(level.left.x)
    expect(noseUp.left.y).toBeCloseTo(level.left.y)
    camera.rotateZ(Math.PI / 6); camera.updateMatrixWorld()
    const rolled = projectRung(camera, origin, north, 0, 1600, 900)!
    expect(Math.abs(rolled.left.y - rolled.right.y)).toBeGreaterThan(100)
  })
  it('hides rungs behind the camera and has no ground track when pointing straight up', () => {
    expect(projectRung(view(-1), origin, north, 0, 1600, 900)).toBeNull()
    expect(projectRung(view(), origin, { x: 0, y: 1, z: 0 }, 0, 1600, 900)).toBeNull()
  })
})
