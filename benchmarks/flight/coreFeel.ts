import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../../src/game/runtime/commands'
import { FLIGHT_STEP } from '../../src/game/runtime/clock'
import { readFlight } from '../../src/game/flight/readout'
import { arcadeSpeed, simulationSpeed } from '../../src/game/flight/speedLimits'
import { createCoreFlight, stepCoreFlight } from '../../src/game/flightCore/step'
import { GRAVITY, aeroScale, liftCoefficient } from '../../src/game/flightCore/aero'
import { coreProfileOf } from '../../src/game/flightCore/profile'
import type { AircraftState } from '../../src/game/state/WorldState'

/*
FR1 feel numbers for the rewrite core. Report only: nothing here is
a target. Simulated where the number is a response (rates, instantaneous turn, bleed), from the
profile's force balance where it is an equilibrium (sustained turn, top speed, 1 g stall).
Speeds in simulation m/s with HUD km/h (× 5.4) beside them.
*/
const DEG = Math.PI / 180

/** A fresh aircraft on the new core at `speed`, high up, banked `bankDeg`, flying along its nose. */
export function coreAircraft(aircraftId: string, speed: number, bankDeg = 0): AircraftState {
  const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraftId], flightCore: 'new' }).snapshot().aircraft[0]
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bankDeg * DEG)
  state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
  state.velocity = { x: speed, y: 0, z: 0 }
  state.position = { x: 0, y: 4000, z: 0 }
  state.coreFlight = createCoreFlight(aircraftId, speed)
  return state
}
function fly(state: AircraftState, seconds: number, command: Partial<PilotCommand>, each?: (s: AircraftState, t: number) => void) {
  const steps = Math.round(seconds / FLIGHT_STEP)
  for (let i = 0; i < steps; i++) { stepCoreFlight(state, { ...neutralCommand(i, state.id), ...command }, FLIGHT_STEP); each?.(state, (i + 1) * FLIGHT_STEP) }
}
const speedOf = (s: AircraftState) => Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)
const round = (value: number, digits = 1) => Number(value.toFixed(digits))

/** Full roll from wings level: peak rate, and the time to 90% of it. */
export function rollResponse(aircraftId: string, speed: number) {
  const state = coreAircraft(aircraftId, speed)
  let peak = 0, rise = NaN
  const rates: number[] = []
  fly(state, 1.5, { roll: 1 }, s => { rates.push(Math.abs(s.rates.roll) / DEG); peak = Math.max(peak, rates.at(-1)!) })
  rise = (rates.findIndex(rate => rate >= 0.9 * peak) + 1) * FLIGHT_STEP
  let stop = NaN
  fly(state, 1, {}, (s, t) => { if (Number.isNaN(stop) && Math.abs(s.rates.roll) / DEG < 0.05 * peak) stop = t })
  return { speed, hud: round(arcadeSpeed(speed), 0), peak: round(peak), rise: round(rise, 3), stop: round(stop, 3) }
}

/*
Full pull from a 90° bank, so gravity stays out of the pitch plane: the peak pitch rate, the
peak path turn rate (the instantaneous turn rate) in the first second, the G there, and what
limited the pitch rate at the end. Then the speed a 3 s pull costs.
*/
export function pullResponse(aircraftId: string, speed: number) {
  const state = coreAircraft(aircraftId, speed, 90)
  let pitch = 0, turn = 0, g = 0, at = speed, alpha = 0
  fly(state, 1, { pitch: 1 }, s => {
    const flight = readFlight(s)
    pitch = Math.max(pitch, s.rates.pitch / DEG)
    if (flight.pathRateDeg > turn) { turn = flight.pathRateDeg; g = flight.g; at = speedOf(s); alpha = flight.alphaDeg }
  })
  const limit = state.coreFlight!.diag.limit.pitch
  fly(state, 2, { pitch: 1 })
  return { speed, hud: round(arcadeSpeed(speed), 0), pitchRate: round(pitch), turnRate: round(turn), g: round(g, 2), alpha: round(alpha), at: round(at), limit, bleed3s: round(speed - speedOf(state)) }
}

/** Full rudder from straight flight: peak yaw rate, and the sideslip it settles on. */
export function yawResponse(aircraftId: string, speed: number) {
  const state = coreAircraft(aircraftId, speed)
  let peak = 0
  fly(state, 2, { yaw: 1 }, s => { peak = Math.max(peak, s.rates.yaw / DEG) })
  return { speed, hud: round(arcadeSpeed(speed), 0), peak: round(peak), beta: round(readFlight(state).betaDeg) }
}

/** Level sustained turn at `speed` with full dry (or burner) thrust: the load the thrust can pay
 * the drag for, inside the alpha and G limits, and the turn rate it gives. */
export function sustainedTurn(aircraftId: string, speed: number, burner: boolean) {
  const p = coreProfileOf(aircraftId), q = aeroScale(p) * speed * speed, thrust = burner ? p.thrustBurner : p.thrustDry
  const dragAt = (alphaDeg: number) => {
    const cl = Math.min(liftCoefficient(alphaDeg, p), p.gLimit * GRAVITY / q), s = Math.sin(alphaDeg * DEG)
    return { drag: q * (p.cd0 + p.inducedK * cl * cl + p.cdHigh * s * s), lift: q * cl }
  }
  let low = 0, high = p.aoaLimitDeg
  if (dragAt(0).drag > thrust) return { speed, hud: round(arcadeSpeed(speed), 0), g: NaN, turnRate: NaN }
  if (dragAt(high).drag <= thrust) low = high
  else for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (dragAt(mid).drag > thrust) high = mid; else low = mid }
  const n = dragAt(low).lift / GRAVITY
  return { speed, hud: round(arcadeSpeed(speed), 0), g: round(n, 2), turnRate: round(n > 1 ? Math.sqrt(n * n - 1) * GRAVITY / speed / DEG : 0) }
}

/** Level 1 g speeds: the slowest the alpha limit can hold, and dry/burner top speed. */
export function speedEnvelope(aircraftId: string) {
  const p = coreProfileOf(aircraftId), k = aeroScale(p)
  const stall = Math.sqrt(GRAVITY / (k * liftCoefficient(p.aoaLimitDeg, p)))
  const top = (thrust: number) => {
    let v = 100
    for (let i = 0; i < 100; i++) { const cl = GRAVITY / (k * v * v); v = Math.sqrt(thrust / (k * (p.cd0 + p.inducedK * cl * cl))) }
    return v
  }
  const row = (v: number) => ({ mps: round(v), hud: round(arcadeSpeed(v), 0) })
  return { stallAtAlphaLimit: row(stall), cornerDesign: row(simulationSpeed(p.cornerSpeedKph)), topDry: row(top(p.thrustDry)), topBurner: row(top(p.thrustBurner)) }
}

/** Corner speed: the speed of the highest instantaneous turn rate, on a 5 m/s grid. */
export function cornerSpeed(aircraftId: string) {
  let best = { speed: 0, turnRate: 0 }
  for (let speed = 50; speed <= 220; speed += 5) {
    const row = pullResponse(aircraftId, speed)
    if (row.turnRate > best.turnRate) best = { speed, turnRate: row.turnRate }
  }
  return { ...best, hud: round(arcadeSpeed(best.speed), 0) }
}
