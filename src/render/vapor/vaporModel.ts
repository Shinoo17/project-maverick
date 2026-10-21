import { MathUtils } from 'three'
import type { AirSample } from './atmosphere'

/*
Simplified condensation model (docs/vapor-overhaul-plan.md §3). Each effect
estimates how far its local air cools (ΔT) and compares that with the dew-point
depression D. Pure functions, no three.js objects, so tests can drive them.

Starting constants, to tune against the reference images (plan phase 7).
*/

/** Per-aircraft values the model reads. Geometry lives in profile.ts. */
export interface VaporModelRig {
  /** kg/m². Heavier wing loading pulls harder suction for the same G. */
  wingLoading: number
  /** AoA where the leading-edge vortex starts to form, degrees. */
  alphaOnset: number
}

export interface VaporFlight {
  /** Simulation airspeed, m/s. Only gates near-zero flow. */
  speed: number
  /** Signed AoA, degrees. */
  aoa: number
  /** Load factor, G. */
  g: number
  mach: number
  /** ½ρV² from HUD speed and ISA density, Pa. */
  dynamicPressure: number
}

/** Target intensities 0–1 plus the two shape positions the shader reads. */
export interface VaporTargets {
  lex: number
  fog: number
  tip: number
  cone: number
  /** Where along the LEX vortex (0 apex, 1 trailing edge) it bursts; above 1 = no burst. */
  burst: number
  /** Vapor-cone aft edge, 0 forward (M 0.85) to 1 aft (M 1.05). */
  shock: number
}

export const WING_LOADING_REF = 350
/** K of cooling per G at the reference wing loading. Wing fog uses 1.5 (plan: 2.5) so a 1 G cruise stays clear. */
export const COOLING = { lex: 4, fog: 1.5, tip: 2 } as const
/** K above D over which condensation ramps from none to full. */
export const CONDENSE_BAND = 4
/** Local Mach gain over the canopy. The plan's 0.2 put a cone on every flight at cruise top speed (M 0.87). */
export const CONE_LOCAL_MACH = .12
/** Extra local Mach per G above 1: pulling speeds the flow over the wing. */
export const CONE_MACH_PER_G = .01

export const localMach = (mach: number, g: number) => mach + CONE_LOCAL_MACH + CONE_MACH_PER_G * Math.max(0, Math.abs(g) - 1)

/** The parts of an AirSample the model reads; VaporConditions carries them flat. */
export type AirState = Pick<AirSample, 'temperatureC' | 'depression' | 'water'>

export function condensation(cooling: number, air: AirState) {
  return MathUtils.smoothstep(cooling, air.depression, air.depression + CONDENSE_BAND) * air.water
}

/** ΔT of air expanding isentropically from free stream to the local Mach over the canopy. */
export function coneCooling(mach: number, temperatureC: number, g = 1) {
  const t = temperatureC + 273.15, local = localMach(mach, g)
  const total = t * (1 + .2 * mach * mach)
  return t - total / (1 + .2 * local * local)
}

/*
The vapor cone plays as a one-shot event, as action games do, not as a steady
collar or a repeating flash. Two things set it off:
- accelerating up through CONE_EVENT.mach (re-armed below rearmMach), and
- pulling past pullG while near the speed of sound (re-armed below rearmG):
  lift speeds the air over the wing, so it goes supersonic before the jet does.
Each shot rises in 0.08 s, holds briefly and is gone by `seconds`.
*/
export const CONE_EVENT = {
  mach: .93, rearmMach: .88,
  pullG: 4, rearmG: 2.5, pullBand: [.85, 1.05] as readonly [number, number],
  seconds: .9, cooldown: 1,
} as const

/** 0–1 brightness of one cone shot, `age` seconds after it fired. */
export function coneEnvelope(age: number) {
  if (!(age < CONE_EVENT.seconds)) return 0
  return MathUtils.smoothstep(age, 0, .08) * (1 - MathUtils.smoothstep(age, .25, CONE_EVENT.seconds))
}

export class ConeTrigger {
  /** Seconds since the last shot fired. */
  age = Infinity
  private speedArmed = true
  private pullArmed = true

  reset() { this.age = Infinity; this.speedArmed = true; this.pullArmed = true }

  /** Advances by simulation time and returns the current shot's envelope. */
  update(mach: number, g: number, step: number) {
    this.age += step
    const load = Math.abs(g)
    if (mach < CONE_EVENT.rearmMach) this.speedArmed = true
    if (load < CONE_EVENT.rearmG) this.pullArmed = true
    let fire = false
    if (this.speedArmed && mach >= CONE_EVENT.mach) { this.speedArmed = false; fire = true }
    if (this.pullArmed && load >= CONE_EVENT.pullG && mach >= CONE_EVENT.pullBand[0] && mach <= CONE_EVENT.pullBand[1]) {
      this.pullArmed = false; fire = true
    }
    if (fire && this.age >= CONE_EVENT.cooldown) this.age = 0
    return coneEnvelope(this.age)
  }
}

export interface VaporCooling { lex: number; fog: number; tip: number; cone: number }

/** Fighter lift-curve slope, CL per degree (≈ 4.3 per radian). */
export const LIFT_SLOPE_PER_DEG = .075

/*
The arcade flight model turns the path without the AoA a real wing needs: a
full pull reaches 12 G at about 4°. The vortex reads the AoA that lift
implies instead, from q·CL = n·(W/S), or the measured AoA when that is larger
(post-stall, PSM). The measured AoA still steers the trails and the side.
*/
export function liftIncidence(flight: Pick<VaporFlight, 'g' | 'dynamicPressure'>, rig: VaporModelRig) {
  const cl = flight.g * rig.wingLoading * 9.81 / Math.max(500, flight.dynamicPressure)
  return MathUtils.clamp(cl / LIFT_SLOPE_PER_DEG, -40, 40)
}

export function vortexIncidence(flight: VaporFlight, rig: VaporModelRig) {
  const lift = liftIncidence(flight, rig)
  return Math.abs(lift) > Math.abs(flight.aoa) ? lift : flight.aoa
}

/** q·CL = n·(W/S): vortex and suction strength scale with G × wing loading. */
export function vaporCooling(flight: VaporFlight, rig: VaporModelRig, air: AirState): VaporCooling {
  const lift = Math.abs(flight.g) * rig.wingLoading / WING_LOADING_REF
  return {
    lex: COOLING.lex * lift * MathUtils.smoothstep(vortexIncidence(flight, rig), rig.alphaOnset, rig.alphaOnset + 12),
    fog: COOLING.fog * lift,
    tip: COOLING.tip * lift,
    cone: coneCooling(flight.mach, air.temperatureC, flight.g),
  }
}

export function vaporTargets(flight: VaporFlight, rig: VaporModelRig, air: AirState): VaporTargets {
  const cooling = vaporCooling(flight, rig, air)
  // Lift needs moving air; near rest the angles and G mean nothing.
  const flow = MathUtils.smoothstep(flight.speed, 20, 60)
  // Reversed flow (tail slide) sheds no attached vortex or suction.
  const attached = 1 - MathUtils.smoothstep(Math.abs(flight.aoa), 70, 115)
  const local = localMach(flight.mach, flight.g)
  // Needs supersonic flow over the canopy, gone once the shock leaves the airframe.
  const coneWindow = MathUtils.smoothstep(local, 1, 1.06) * (1 - MathUtils.smoothstep(flight.mach, 1.02, 1.08))
  return {
    lex: condensation(cooling.lex, air) * flow * attached,
    fog: condensation(cooling.fog, air) * flow * attached,
    tip: condensation(cooling.tip, air) * flow * attached,
    cone: condensation(cooling.cone, air) * coneWindow,
    burst: MathUtils.lerp(1.2, 0, MathUtils.smoothstep(vortexIncidence(flight, rig), 20, 40)),
    shock: MathUtils.smoothstep(flight.mach, .85, 1.05),
  }
}
