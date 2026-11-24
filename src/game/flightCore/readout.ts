import { MathUtils } from 'three'
import type { AircraftState } from '../state/WorldState'
// Types only: flight/readout.ts imports the core registry, which imports this file.
import type { BurnerStatus, FlightPose, FlightReadout, FlightRegime } from '../flight/readout'
import { arcadeSpeed } from '../flight/speedLimits'
import { observeAir } from './aero'
import { coreProfileOf } from './profile'
import type { CoreFlightState } from './state'

const NOZZLE_DEG = 20

function burnerStatus(b: CoreFlightState['burner']): BurnerStatus {
  if (b.active) return 'engaged'
  if (b.locked) return 'depleted'
  if (b.reserve < 1 && b.rest > 1) return 'recharging'
  return 'ready'
}

/*
The rewrite core's FlightReadout. Step values come from what the last step stored (before the
first step: a state at rest on its pose); air values are observed at the pose with the same
observation the step ends on, so a stepped state's incidenceDeg equals its noseVelocityDeg.

Not yet the core's own (named, so no consumer changes when they are):
- psmAuthority is 0 and alphaLimitDeg the closed limit: PSM opens nothing until FR4.
- gAllowance is 1: the G limit never moves in FR1.
- nozzle is cosmetic, from the pitch and roll rates (no thrust vectoring physics until FR4).
- regime has no RECOVERING or DEPARTED yet.
*/
export function coreReadout(state: AircraftState, pose?: FlightPose): FlightReadout {
  const p = coreProfileOf(state.aircraftId), core = state.coreFlight
  const orientation = pose?.orientation ?? state.orientation, velocity = pose?.velocity ?? state.velocity
  const air = observeAir(orientation, velocity)
  const own = observeAir(state.orientation, state.velocity)
  const burner = core?.burner ?? { active: false, locked: false, reserve: 1, rest: 0 }
  const pitch = state.rates.pitch * 180 / Math.PI / p.maxRate.pitch, roll = state.rates.roll * 180 / Math.PI / p.maxRate.roll
  const nozzle = (value: number) => MathUtils.clamp(value, -NOZZLE_DEG, NOZZLE_DEG)
  const highAoa = MathUtils.smoothstep(air.incidenceDeg, p.aoaLimitDeg, p.alphaCritDeg) * air.confidence
  const postStall = MathUtils.smoothstep(own.incidenceDeg, p.alphaCritDeg, p.alphaCritDeg + 15) * own.confidence
  const separated = MathUtils.smoothstep(air.incidenceDeg, p.alphaCritDeg, p.alphaCritDeg + 15) * air.confidence
  const regime: FlightRegime = separated > 0.5 ? 'POST_STALL' : highAoa > 0.25 ? 'HIGH_AOA' : 'NORMAL'
  return {
    noseVelocityDeg: core?.noseVelocityDeg ?? own.incidenceDeg,
    g: core?.g ?? 1,
    pathRateDeg: core?.pathRateDeg ?? 0,
    power: core?.power ?? 0,
    burner: { active: burner.active, status: burnerStatus(burner), reserve: burner.reserve, seconds: burner.reserve * p.burnerSeconds },
    airbrake: core?.airbrake ?? 0,
    psmAuthority: core?.psmAuthority ?? 0,
    nozzle: p.tvc ? { left: nozzle(NOZZLE_DEG * (pitch - roll / 2)), right: nozzle(NOZZLE_DEG * (pitch + roll / 2)) } : null,
    postStall,
    gAllowance: 1,
    airspeed: air.airspeed, hudSpeed: arcadeSpeed(air.airspeed),
    alphaDeg: air.alphaDeg, betaDeg: air.betaDeg, incidenceDeg: air.incidenceDeg, angleConfidence: air.confidence,
    highAoa, regime,
    alphaLimitDeg: p.aoaLimitDeg,
    alphaBandDeg: { normal: p.aoaLimitDeg, critical: p.alphaCritDeg, max: 90 },
  }
}
