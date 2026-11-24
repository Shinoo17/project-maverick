import { Quaternion, Vector3 } from 'three';
import { DEG2RAD, FLIGHT, PSM } from './config';

/**
 * Pure aerodynamic helpers (docs/PSM_SPEC.md §7, P2).
 *
 * Body frame as in FlightModel: forward = +Z, up = +Y, right = -X.
 *
 * Coefficients are expressed in the units of the arcade lift model rather
 * than real Cl: `liftCoef(α) = sin α` reproduces the pre-PSM path-alignment
 * lift exactly, so normal flight (|α| < 25°) is unchanged.
 */

/** Air data, in radians. */
export interface AirData {
  /** Pitch-plane angle of attack, (-π, π]. Positive = nose above the velocity. */
  alpha: number;
  /** Sideslip, [-π/2, π/2]. Positive = velocity to the right of the nose. */
  beta: number;
  /** Total angle between nose and velocity, [0, π]. */
  sigma: number;
  /** Dynamic pressure normalised to 1 at cruise speed. */
  qbar: number;
  /** Velocity points behind the wing (reverse flow). */
  tailFirst: boolean;
}

export function createAirData(): AirData {
  return { alpha: 0, beta: 0, sigma: 0, qbar: 1, tailFirst: false };
}

const _inv = new Quaternion();
const _vb = new Vector3();

/**
 * Air data from the world velocity and attitude, written into `out`.
 * Below `PSM.vEpsilon` the angles are undefined, so the previous α / β / σ
 * in `out` are kept and only `qbar` is updated.
 */
export function airData(velocity: Vector3, attitude: Quaternion, out: AirData): AirData {
  const speed = velocity.length();
  out.qbar = (speed / FLIGHT.cruiseSpeed) ** 2;
  if (speed < PSM.vEpsilon) return out;
  const vb = _vb.copy(velocity).applyQuaternion(_inv.copy(attitude).invert()).divideScalar(speed);
  const fwd = vb.z;
  const up = vb.y;
  const right = -vb.x;
  out.alpha = Math.atan2(-up, fwd);
  out.beta = Math.asin(clamp(right, -1, 1));
  out.sigma = Math.acos(clamp(fwd, -1, 1));
  out.tailFirst = fwd < 0;
  return out;
}

/**
 * Share of attached-flow lift left at this α, 0..1: 1 up to the lift peak,
 * falling to 0 at 90° and 0 in reverse flow. Gates trim lift and
 * bank-to-turn so a stalled aircraft gets the full weight of gravity.
 */
export function liftFraction(alpha: number): number {
  const a = PSM.aero;
  const x = Math.abs(alpha) / DEG2RAD;
  if (x <= a.clPeakDeg) return 1;
  return 1 - smoothstep(a.clPeakDeg, a.clZeroDeg, x);
}

/**
 * Lift coefficient vs signed α. sin α in the linear range (the pre-PSM
 * lift), a smooth peak at `clPeakDeg`, 0 at 90°, and a small value in
 * reverse flow (tail first, refined in Phase 3). Odd in α.
 */
export function liftCoef(alpha: number): number {
  const a = PSM.aero;
  const sgn = Math.sign(alpha);
  const x = Math.abs(alpha) / DEG2RAD;
  if (x <= a.clLinearDeg) return Math.sin(alpha);
  if (x <= a.clPeakDeg) {
    // Hermite from (linear end, sin, slope cos) to (peak, clPeak, slope 0).
    const x0 = a.clLinearDeg;
    const h = a.clPeakDeg - x0;
    const t = (x - x0) / h;
    const y0 = Math.sin(x0 * DEG2RAD);
    const m0 = Math.cos(x0 * DEG2RAD) * DEG2RAD * h;
    return sgn * hermite(y0, m0, a.clPeak, 0, t);
  }
  if (x < a.clZeroDeg) return sgn * a.clPeak * liftFraction(alpha);
  if (x < a.reverseFlowDeg) return 0;
  // Tail first: a weak bump that still pulls the velocity toward the body axis.
  const d = (180 - x) / (180 - a.reverseFlowDeg);
  return sgn * a.reverseCl * Math.sin(Math.PI * d);
}

/** Side-force coefficient vs sideslip: sin β, saturating near `cySatDeg`. Odd in β. */
export function sideCoef(beta: number): number {
  const a = PSM.aero;
  const sgn = Math.sign(beta);
  const x = Math.abs(beta) / DEG2RAD;
  if (x <= a.cyLinearDeg) return Math.sin(beta);
  if (x >= a.cySatDeg) return sgn * a.cySat;
  const x0 = a.cyLinearDeg;
  const h = a.cySatDeg - x0;
  const m0 = Math.cos(x0 * DEG2RAD) * DEG2RAD * h;
  return sgn * hermite(Math.sin(x0 * DEG2RAD), m0, a.cySat, 0, (x - x0) / h);
}

/** Aerodynamic regime (docs/PSM_SPEC.md §4), shown on the HUD next to the FCS mode. */
export type AeroRegime = 'attached' | 'high-alpha' | 'post-stall' | 'reverse-flow';

export function regime(air: AirData): AeroRegime {
  const R = PSM.regime;
  const a = Math.abs(air.alpha) / DEG2RAD;
  const b = Math.abs(air.beta) / DEG2RAD;
  if (a >= R.reverseFlowDeg) return 'reverse-flow';
  if (a > R.postStallAlphaDeg || b > R.postStallBetaDeg) return 'post-stall';
  if (a > R.highAlphaDeg || b > R.highBetaDeg) return 'high-alpha';
  return 'attached';
}

/** Lift the airspeed can support, 0..1: (v / vFull)², so low-speed flight stalls. */
export function liftAvail(speed: number): number {
  return Math.min(1, (speed / PSM.aero.vFull) ** 2);
}

function hermite(y0: number, m0: number, y1: number, m1: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
