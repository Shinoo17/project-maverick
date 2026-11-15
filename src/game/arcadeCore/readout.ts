import { MathUtils, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
// Types only: flight/readout.ts imports the core registry, which imports this file.
import type { FlightPose, FlightReadout, FlightRegime } from '../flight/readout'
import { toExampleFrame } from './frame'
import { airData, createAirData, regime } from './aero'
import { DEG2RAD, PSM, psmProfileOf } from './config'

const velocity = new Vector3(), attitude = new Quaternion()

/*
The arcade core's FlightReadout (see ./step.ts). Step values come from what the last step
saved; air values are the example's air data at the pose.

- hudSpeed is km/h as the example's HUD shows it: m/s × 3.6.
- power is engine spool over military spool (1 at military power, above 1 with afterburner).
- The example's afterburner has no reserve, so the burner always reads full.
- psmAuthority is how far the FCS has opened the α ceiling: wHigh while ARMED or PSM.
- regime is the example's: attached, high alpha, post-stall or reverse flow, and RECOVERING
  while the FCS recovers.
*/
export function arcadeReadout(state: AircraftState, pose?: FlightPose): FlightReadout {
  const data = state.arcadeFlight, profile = psmProfileOf(state.aircraftId)
  const v = pose?.velocity ?? state.velocity
  velocity.set(v.x, v.y, v.z)
  toExampleFrame(pose?.orientation ?? state.orientation, attitude)
  // Below vEpsilon the example keeps the last angles; the saved ones stand in for them.
  const air = airData(velocity, attitude, data ? { ...data.model.air } : createAirData())
  const airspeed = velocity.length()
  const sigma = air.sigma / DEG2RAD, alpha = air.alpha / DEG2RAD
  const mode = data?.fcs.mode ?? 'NORMAL'
  const open = mode === 'ARMED' || mode === 'PSM' ? data?.fcs.wHigh ?? 0 : 0
  const limit = PSM.fcs.alphaLimitDeg
  const flow = regime(air)
  const flightRegime: FlightRegime = mode === 'RECOVERY' ? 'RECOVERING' : flow === 'attached' ? 'NORMAL' : flow === 'high-alpha' ? 'HIGH_AOA' : 'POST_STALL'
  const tvc = data?.model.tvc
  const active = (data?.afterburner ?? 0) > 0.5
  return {
    noseVelocityDeg: (data?.model.air.sigma ?? air.sigma) / DEG2RAD,
    g: data?.model.g ?? 1,
    pathRateDeg: data?.pathRateDeg ?? 0,
    power: (data?.model.spool ?? PSM.engine.milSpool) / PSM.engine.milSpool,
    burner: { active, status: active ? 'engaged' : 'ready', reserve: 1, seconds: Infinity },
    airbrake: data?.airbrake ?? 0,
    psmAuthority: open,
    // Positive is exhaust up, which is the example's nose-up pitch deflection; roll splits the pair.
    nozzle: profile.tvc.pitch ? { left: (tvc?.pitch ?? 0) - (tvc?.roll ?? 0), right: (tvc?.pitch ?? 0) + (tvc?.roll ?? 0) } : null,
    postStall: MathUtils.smoothstep(sigma, PSM.engine.blendDeg[0], PSM.engine.blendDeg[1]),
    gAllowance: 1,
    airspeed, hudSpeed: airspeed * 3.6,
    alphaDeg: alpha, betaDeg: air.beta / DEG2RAD, incidenceDeg: sigma,
    angleConfidence: MathUtils.smoothstep(airspeed, PSM.vEpsilon, 10),
    highAoa: MathUtils.smoothstep(sigma, PSM.regime.highAlphaDeg, PSM.regime.postStallAlphaDeg),
    regime: flightRegime,
    alphaLimitDeg: limit + open * (180 - limit),
    alphaBandDeg: { normal: limit, critical: PSM.stall.alphaDeg, max: 90 },
  }
}
