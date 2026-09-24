import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { flightAttitude, burnerStatus, flightWarning } from '../src/features/flight/telemetry'
import { createGlassPainter, glassLayout, projectRung, projectVelocityMarker } from '../src/features/flight/hudPainter'
import { glassState } from '../src/features/flight/FlightInstruments'
import { arcadeSpeed } from '../src/game/flight/speed'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand } from '../src/game/runtime/commands'
import { observeAirflow } from '../src/game/flight/airflow'
import { getFlightProfile } from '../src/game/flight/profile'
import { separationTarget } from '../src/game/flight/stall'
import { stepFlight } from '../src/game/flight/stepFlight'
import { flightInstrumentation } from '../src/game/flight/instrumentation'
import { readIntent } from '../src/game/flight/intent'

const pose = (heading: number, pitch = 0, bank = 0) => new Quaternion()
  .setFromAxisAngle(new Vector3(0, 1, 0), -heading * Math.PI / 180)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pitch * Math.PI / 180))
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bank * Math.PI / 180))
const aircraft = () => new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]

describe('velocity marker projection', () => {
  const camera = new PerspectiveCamera(60, 16 / 9, .5, 14000)
  camera.lookAt(1, 0, 0); camera.updateMatrixWorld()
  const position = { x: 0, y: 0, z: 0 }
  it('projects forward flight at the sightline and hides speeds below 1 m/s', () => {
    const marker = projectVelocityMarker(camera, position, { x: 100, y: 0, z: 0 }, 1600, 900, 24)!
    expect(marker.onScreen).toBe(true)
    expect(marker.x).toBeCloseTo(800)
    expect(marker.y).toBeCloseTo(450)
    expect(projectVelocityMarker(camera, position, { x: .99, y: 0, z: 0 }, 1600, 900, 24)).toBeNull()
    expect(projectVelocityMarker(camera, position, { x: 0, y: 0, z: 0 }, 1600, 900, 24)).toBeNull()
    expect(projectVelocityMarker(camera, position, { x: 1, y: 0, z: 0 }, 1600, 900, 24)).not.toBeNull()
  })
  it('clamps side, aft and camera-plane directions to an inset edge with finite outward angles', () => {
    for (const x of [-100, 0, 1, 100]) for (const y of [-300, 0, 300]) for (const z of [-300, 0, 300]) {
      if (Math.hypot(x, y, z) < 1) continue
      const marker = projectVelocityMarker(camera, position, { x, y, z }, 1600, 900, 24)!
      expect(marker.x).toBeGreaterThanOrEqual(24)
      expect(marker.x).toBeLessThanOrEqual(1576)
      expect(marker.y).toBeGreaterThanOrEqual(24)
      expect(marker.y).toBeLessThanOrEqual(876)
      expect(Number.isFinite(marker.angle)).toBe(true)
      if (x <= 0) expect(marker.onScreen).toBe(false)
      if (!marker.onScreen) expect(Math.min(Math.abs(marker.x - 24), Math.abs(marker.x - 1576), Math.abs(marker.y - 24), Math.abs(marker.y - 876))).toBeLessThan(1e-9)
    }
    const aftUp = projectVelocityMarker(camera, position, { x: -100, y: 100, z: 0 }, 1600, 900, 24)!
    expect(aftUp.y).toBe(24)
    expect(aftUp.angle).toBeCloseTo(-Math.PI / 2)
  })
  it('uses world position and camera pose without mutating either vector or camera', () => {
    const moved = camera.clone()
    moved.position.set(900, 2000, -500); moved.updateMatrixWorld()
    const velocity = new Vector3(100, 0, 0), before = moved.matrixWorldInverse.clone()
    const point = projectVelocityMarker(moved, moved.position, velocity, 1600, 900, 24)!
    expect(point.x).toBeCloseTo(800)
    expect(point.y).toBeCloseTo(450)
    expect(velocity.toArray()).toEqual([100, 0, 0])
    expect(moved.matrixWorldInverse).toEqual(before)
  })
})

describe('stall advisories', () => {
  it.each([0.6, 1])('keeps roll-only drift intentional across glass and telemetry (separation=%s)', separation => {
    const state = aircraft(), camera = new PerspectiveCamera()
    state.position = { x: 0, y: 3000, z: 0 }
    state.velocity = { x: 100, y: 0, z: 0 }
    state.orientation = pose(0, 45)
    state.stall.severity = separation
    const neutral = neutralCommand(0, state.id)
    state.intent = readIntent({ ...neutral, roll: 0.7 }, state.intent, 1 / 120, 0)
    const glass = () => glassState({ camera, state, position: state.position, orientation: state.orientation, velocity: state.velocity })
    expect(state.intent.demand).toBe(0)
    expect(state.intent.activity).toBe(1)
    expect(flightInstrumentation(state).label).toBe('POST_STALL')
    expect(glass().psm).toBe(true)
    expect(flightWarning(state)).toBeNull()

    // Actual release still restores the advisory even during permission's handoff decay.
    state.intent = readIntent(neutral, state.intent, 1 / 120, 0)
    expect(state.intent.continuation).toBeGreaterThan(0)
    const departed = separation > 0.8
    expect(flightInstrumentation(state).label).toBe(departed ? 'DEPARTED' : 'RECOVERING')
    expect(glass().psm).toBe(!departed)
    expect(flightWarning(state)).toBe(departed ? 'hudStall' : 'hudStallRecovering')
  })

  it('keeps a mild separation advisory with held activity above the low-energy threshold', () => {
    const state = aircraft()
    state.velocity = { x: 80, y: 0, z: 0 }
    state.intent.activity = 1
    state.stall.severity = 0.1
    expect(flightWarning(state)).toBeNull()
    for (const separation of [0.1001, 0.25, 0.5]) {
      state.stall.severity = separation
      expect(flightWarning(state)).toBe('hudStallRecovering')
    }
    state.stall.severity = 0.5001
    expect(flightWarning(state)).toBe('hudStall')
    state.intent.activity = 0
    expect(flightWarning(state)).toBe('hudStallRecovering')
    state.position.y = 50
    expect(flightWarning(state)).toBe('lowAltitude')
    state.position.x = 7000
    expect(flightWarning(state)).toBe('boundaryWarning')
  })

  it.each([0, 1])('keeps all three advisories reachable in settled low-speed flight (activity=%s)', activity => {
    const state = aircraft(), profile = getFlightProfile(state.aircraftId)
    state.intent.activity = activity
    for (const [speed, heldWarning] of [[62, 'hudStallRecovering'], [60, 'hudStall'], [59, 'hudLowEnergy']] as const) {
      state.velocity = { x: speed, y: 0, z: 0 }
      // Use the unmodified profile's equilibrium separation, not hand-picked
      // severity, to catch a warning hidden by the real low-speed stall band.
      state.stall.severity = separationTarget(observeAirflow(state, profile), profile.stall).target
      const expected = activity === 0 && heldWarning === 'hudStall' ? 'hudStallRecovering' : heldWarning
      expect(flightWarning(state)).toBe(expected)
    }
    state.orientation = pose(0, 40)
    state.stall.severity = 1
    expect(flightWarning(state)).toBe(activity === 0 ? 'hudStall' : null)
  })

  it('uses continuous flow labels, with terrain/boundary priority', () => {
    const state = aircraft()
    expect(flightWarning(null)).toBeNull()
    expect(flightWarning(state)).toBeNull()
    state.stall = { severity: 1, cause: 'aoa', aoaDeg: 40 }
    state.orientation = pose(0, 40)
    expect(flightWarning(state)).toBe('hudStall')
    state.orientation = pose(0, 0)
    expect(flightWarning(state)).toBe('hudStallRecovering')
    state.intent.activity = 1
    state.orientation = pose(0, 40)
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
    state.intent.activity = 1; state.orientation = pose(0, 45)
    expect(read().psm).toBe(true)
  })
})

describe('nose pipper painting', () => {
  it.each([[1600, 900], [760, 820]])('distinguishes actual nose, off-screen nose and FPM at %s × %s', (width, height) => {
    // Record the real painter, so projection tests alone cannot hide an ignored onScreen flag.
    const ctx = {
      arc: vi.fn(), rotate: vi.fn(), translate: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      beginPath() {}, clearRect() {}, clip() {}, closePath() {}, fill() {}, fillRect() {},
      fillText() {}, rect() {}, restore() {}, save() {}, setLineDash() {}, setTransform() {},
      stroke() {}, strokeText() {},
    }
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement
    const painter = createGlassPainter(canvas)
    painter.resize(width, height, 1)
    const state = aircraft(), camera = new PerspectiveCamera(60, width / height, 0.5, 14000)
    state.position = { x: 0, y: 0, z: 0 }
    camera.lookAt(1, 0, 0); camera.updateMatrixWorld()
    const glass = glassState({ camera, state, position: state.position, orientation: state.orientation, velocity: state.velocity })
    // Zero velocity hides FPM; isolate the pipper without changing the production painter.
    const draw = (forward: Vector3, velocity = new Vector3()) => {
      ctx.arc.mockClear(); ctx.rotate.mockClear(); ctx.translate.mockClear(); ctx.moveTo.mockClear()
      painter.draw({ ...glass, forward, velocity })
    }
    draw(new Vector3(1, 0, 0))
    expect(ctx.arc.mock.calls.filter(call => call[2] > 2)).toHaveLength(1)
    for (const forward of [new Vector3(0.1, 0, 1).normalize(), new Vector3(-1, 0, 0)]) {
      draw(forward)
      const point = projectVelocityMarker(camera, state.position, forward.clone().multiplyScalar(2), width, height, 24)!
      expect(point.onScreen).toBe(false)
      expect(ctx.arc.mock.calls.filter(call => call[2] > 2)).toHaveLength(0)
      expect(ctx.translate).toHaveBeenCalledWith(point.x, point.y)
      expect(ctx.rotate).toHaveBeenCalledWith(point.angle)
      expect(ctx.moveTo).toHaveBeenCalledWith(-17, -6)
    }
    draw(new Vector3(1, 0, 0), new Vector3(-100, 0, 0))
    expect(ctx.moveTo).toHaveBeenCalledWith(-10, -6)
    expect(ctx.moveTo).not.toHaveBeenCalledWith(-17, -6)
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
