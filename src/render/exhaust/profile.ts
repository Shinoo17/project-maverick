import type { Vector3 } from 'three'
import { getAircraft } from '../../content/aircraft'
import { getFlightProfile } from '../../game/flight/profile'
import type { AircraftId } from '../../content/schemas'
import type { AircraftState } from '../../game/state/WorldState'
import { clamp } from '../../game/flight/speed'

// Metres in FlightWorld's centered, 18.9 m presentation frame (+X forward).
// Measured AFTER node removal, prepareAnimations(frame zero), and orientation.
// F-22's animation rest pose shifts the normalized vertical center by 0.583 m.
// Origins are
// the nozzle lips, not the aircraft bounds (the tail extends past the engines).
export const exhaustProfiles = {
  f22: { lipArm: .983, lipX: -7.3654, height: -1.0373, spacing: .6517, centerZ: -.00665, width: .445, radiusY: .205, inset: .82, round: 0, chamberRadius: .40, burnerViolet: .22, length: 5.8, turbulence: .15 },
  su57: { lipArm: 0, lipX: -8.22, height: -.6691, spacing: 1.3903, centerZ: 0, width: .50, radiusY: .50, inset: .92, round: 1, chamberRadius: 0, burnerViolet: 0, length: 6.6, turbulence: .26 },
} as const satisfies Record<AircraftId, object>

export function getExhaustProfile(aircraftId: string) { return exhaustProfiles[getAircraft(aircraftId).presentationId] }

export interface ExhaustNozzleFrame { origin: Vector3; axis: Vector3; up: Vector3; radius: number }
export interface ExhaustNozzles { left: ExhaustNozzleFrame; right: ExhaustNozzleFrame }

export interface ExhaustConditions { aircraftId: AircraftId; power: number; afterburner: boolean; vectorAngle: number; vectorAngles?: { left: number; right: number }; nozzles?: ExhaustNozzles }
export function flightExhaustConditions(state: AircraftState): ExhaustConditions {
  return { aircraftId: state.aircraftId, power: state.alive ? clamp(state.enginePower, 0, 1) : 0,
    afterburner: state.alive && state.maneuver.burnerActive, vectorAngle: 0,
    vectorAngles: getFlightProfile(state.aircraftId).thrustVectoring ? { left: state.thrustVectoring.left * Math.PI / 180, right: state.thrustVectoring.right * Math.PI / 180 } : undefined }
}

/** Presentation smoothing only; never writes back into the flight simulation. */
export class ExhaustResponse {
  power = 0
  burner = 0
  time = 0
  private initialized = false
  reset() { this.power = 0; this.burner = 0; this.time = 0; this.initialized = false }
  update(conditions: ExhaustConditions, dt: number, reducedMotion = false) {
    const step = Math.max(0, dt), power = clamp(conditions.power, 0, 1)
    const burner = conditions.afterburner && power > .01 ? 1 : 0
    const blend = (seconds: number) => this.initialized ? 1 - Math.exp(-step / seconds) : 1
    this.power += (power - this.power) * blend(.16)
    this.burner += (burner - this.burner) * blend(burner > this.burner ? .12 : .18)
    this.initialized = true
    if (!reducedMotion) this.time += step
  }
}
