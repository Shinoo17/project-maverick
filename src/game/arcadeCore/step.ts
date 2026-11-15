import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { PilotCommand } from '../runtime/commands'
import { trainingMap } from '../../content/maps'
import type { PracticePreset } from '../playground/practice'
import type { ControlState } from '../control/ControlAxes'
import { INPUT } from '../control/config'
import { EXAMPLE_BODY, toExampleFrame } from './frame'
import { DEG2RAD, FLIGHT, GUN_TRACK, SIM, psmProfileOf } from './config'
import { Fcs, type ArcadeFcsData } from './Fcs'
import { FlightModel, type ArcadeModelData } from './FlightModel'

/*
The 'arcade' flight core: example/flight-control's flight physics (FlightModel + Fcs + aero,
ported unchanged in this folder) flying this project's AircraftState. Per command tick:

  command → afterburner / airbrake smoothing (the example's controls did it; the command only
            carries the switches) → Fcs.step (α/β limiter, PSM, recovery) → FlightModel.step

run in the example's own fixed step (SIM.fixedDt, 1/120 s): a WORLD_STEP of 1/60 s is two
sub-steps with the same command. The FCS's recovery timers count in SIM.fixedDt, so stepping
any coarser would run them slow.

State. The model's and the FCS's memory is plain data on AircraftState.arcadeFlight, so
snapshots clone it and replays rebuild it from the commands. One shared FlightModel and Fcs do
the arithmetic: each step loads that memory, steps, and saves it back. Position, velocity and
attitude are the AircraftState's own; the attitude is turned into the example's body frame
(forward +Z) and back with EXAMPLE_BODY.

Ground and the training boundary end the flight as in the other cores.

One addition of this project's: the gun lock's magnet. While the command carries gunTrack
(game/combat/gunLock.ts) each sub-step draws the nose, and the flight path with it, toward it
(config GUN_TRACK), no faster than the jet's own pitch rate there.
*/
export interface ArcadeFlightState {
  model: ArcadeModelData
  fcs: ArcadeFcsData
  /** Afterburner and airbrake, 0..1, smoothed as the example's FlightControls did. */
  afterburner: number
  airbrake: number
  /** Turn rate of the flight path over the last step (deg/s). */
  pathRateDeg: number
}

const fm = new FlightModel(), fcs = new Fcs()
const position = new Vector3(), velocity = new Vector3(), attitude = new Quaternion(), before = new Vector3()
const TO_PROJECT_BODY = EXAMPLE_BODY.clone().invert()
const controls: ControlState = { pitch: 0, roll: 0, yaw: 0, thrust: 0, afterburner: 0, airbrake: 0, psm: false }

function readPose(state: AircraftState) {
  position.set(state.position.x, state.position.y, state.position.z)
  velocity.set(state.velocity.x, state.velocity.y, state.velocity.z)
  toExampleFrame(state.orientation, attitude)
}

/** A fresh arcade state on the aircraft's current pose (spawn, respawn). */
export function createArcadeFlight(state: AircraftState): ArcadeFlightState {
  readPose(state)
  const model = new FlightModel(), control = new Fcs()
  model.setProfile(psmProfileOf(state.aircraftId))
  model.place(position, attitude, velocity)
  return { model: model.save(), fcs: control.save(), afterburner: 0, airbrake: 0, pathRateDeg: 0 }
}

/** Loads the shared model and FCS with an aircraft's state. Returns the model. */
function load(state: AircraftState, data: ArcadeFlightState) {
  readPose(state)
  fm.setProfile(psmProfileOf(state.aircraftId))
  fm.load(data.model); fcs.load(data.fcs)
  fm.position.copy(position); fm.quaternion.copy(attitude); fm.velocity.copy(velocity)
  return fm
}

const expApproach = (value: number, target: number, rate: number, dt: number) => {
  const next = value + (target - value) * (1 - Math.exp(-rate * dt))
  return Math.abs(next - target) < 1e-4 ? target : next
}

export function stepArcadeFlight(state: AircraftState, command: PilotCommand, dt: number) {
  if (!state.alive || dt <= 0) return
  const data = state.arcadeFlight ??= createArcadeFlight(state)
  load(state, data)
  before.copy(fm.velocity)
  const steps = Math.max(1, Math.round(dt / SIM.fixedDt)), h = dt / steps
  for (let i = 0; i < steps; i++) {
    data.afterburner = expApproach(data.afterburner, command.afterburner ? 1 : 0, INPUT.afterburnerRate, h)
    data.airbrake = expApproach(data.airbrake, command.airbrake ? 1 : 0, INPUT.airbrakeRate, h)
    controls.pitch = command.pitch; controls.roll = command.roll; controls.yaw = command.yaw
    controls.thrust = command.speedAdjust; controls.afterburner = data.afterburner; controls.airbrake = data.airbrake
    controls.psm = command.psm
    fcs.step(controls, fm)
    fm.step(fcs, h)
    if (command.gunTrack) magnet(command.gunTrack, h)
    if (fm.position.y <= 3) break
  }

  state.position = { x: fm.position.x, y: fm.position.y, z: fm.position.z }
  state.velocity = { x: fm.velocity.x, y: fm.velocity.y, z: fm.velocity.z }
  const q = attitude.copy(fm.quaternion).multiply(TO_PROJECT_BODY).normalize()
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  // Same senses in both projects: x pitch, y yaw, z roll.
  state.rates = { pitch: fm.rates.x, yaw: fm.rates.y, roll: fm.rates.z }
  data.pathRateDeg = before.length() > 1 && fm.velocity.length() > 1 ? before.angleTo(fm.velocity) / dt / DEG2RAD : 0
  data.model = fm.save(); data.fcs = fcs.save()

  if (state.position.y <= 3) { state.position.y = 3; state.alive = false; state.stopReason = 'terrain' }
  if (Math.hypot(state.position.x, state.position.z) >= trainingMap.radius || state.position.y >= trainingMap.radius) {
    state.alive = false; state.stopReason = 'boundary'
  }
}

const goal = new Vector3(), nose = new Vector3(), axis = new Vector3(), pull = new Quaternion(), limits = new Vector3()
/** The gun lock's magnet (config GUN_TRACK): turns the nose, and the path with it, toward `track`. */
function magnet(track: { x: number; y: number; z: number }, h: number) {
  goal.set(track.x, track.y, track.z)
  if (goal.lengthSq() < 1e-12) return
  goal.normalize()
  fm.forward(nose)
  const angle = nose.angleTo(goal)
  if (angle < 1e-7) return
  axis.crossVectors(nose, goal)
  if (axis.lengthSq() < 1e-14) return
  axis.normalize()
  // No faster than the jet can turn itself: its pitch rate now (authority at this speed, the G limit).
  const most = Math.min(GUN_TRACK.maxRateDeg * DEG2RAD, fm.rateLimits(limits).x)
  const step = Math.min(angle * (1 - Math.exp(-GUN_TRACK.rate * h)), most * h)
  fm.quaternion.premultiply(pull.setFromAxisAngle(axis, step)).normalize()
  fm.velocity.applyAxisAngle(axis, step * GUN_TRACK.pathShare)
}

/** The arcade model's rate limits for the mouse aim controller (game/control/controlAircraft.ts). */
export function arcadeControlLimits(state: AircraftState, out: Vector3) {
  const data = state.arcadeFlight ?? createArcadeFlight(state)
  const model = load(state, data)
  model.rateLimits(out)
  return {
    authorityRate: FLIGHT.maxRateDeg.pitch * DEG2RAD * model.effectiveness(),
    gLimitRate: model.gLimitRate(),
  }
}

/** Speed the arcade core spawns at for a speed this project's world was set up for (its ~130 m/s cruise → the example's 230). The combat bot's. */
export const arcadeSpawnSpeed = (speed: number) => speed * FLIGHT.cruiseSpeed / trainingMap.spawnSpeed

/*
The practice spawns on the arcade core, in the example's speeds (m/s), each where its lesson
works there: free flight at the example's cruise; Cobra ready at 500 km/h, the top of the PSM
curve (PSM.wPeakKmh, w = 1; above 780 km/h Space opens nothing); hard turn at 900 km/h; low
energy just under the 60 m/s stall (PSM.recovery.stallSpeed).
*/
export const arcadeSpawnSpeeds: Record<PracticePreset, number> = { free: FLIGHT.cruiseSpeed, cobra: 500 / 3.6, highG: 250, recovery: 55 }
