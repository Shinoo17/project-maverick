import { Quaternion, Vector3 } from 'three';
import { DEG2RAD, FLIGHT, PSM, SIM } from './config';
import type { ControlState } from '../control/ControlAxes';
import type { FlightModel } from './FlightModel';

/** FCS mode, set by the player (docs/PSM_SPEC.md §4). Declared with the controls, which read it too. */
import type { FcsMode } from '../control/config';
export type { FcsMode };

/** The FCS's step-to-step memory as plain data (see `Fcs.save`). */
export interface ArcadeFcsData {
  mode: FcsMode;
  w: number;
  wHigh: number;
  wLowLatched: number;
  boost: number;
  recoveryDir: [number, number, number];
  capture: number;
  planeGamma: number;
  alignTimer: number;
  alignDir: [number, number, number];
  sinceRelease: number;
  releaseDir: [number, number, number];
  releaseSigma: number;
}

/**
 * Ported from example/flight-control (src/game/flight/Fcs.ts), unchanged apart from its imports
 * and `save` / `load` (see ./step.ts).
 *
 * Flight control system: shapes the stick the player (or the aim
 * controller) makes before the flight model flies it.
 *
 * NORMAL is the α / β limiter (§7, P6). It is a soft wall, not a clamp on
 * the flight path: the commanded body rate in the direction that grows |α|
 * is capped so that α itself may grow no faster than
 * `limiterGain × (αLimit − |α|)`. Near the limit the allowed rate goes to 0,
 * past it the wall pushes back. The cap feeds forward the rate at which lift
 * and gravity are moving α (`FlightModel.alphaRatePath`), so when the wing
 * stops carrying the aircraft and the path drops, the nose is pushed down
 * after it: an ordinary, recoverable stall. β works the same way with yaw.
 *
 * Holding the PSM key (§5) moves the wall out to a ceiling set by w(v)
 * (ARMED, then PSM once |α| is past the normal limit) and hands the flight
 * model its extra authority. Releasing it goes back to NORMAL directly when
 * the aircraft is inside the limits, otherwise through RECOVERY (§5.3): the
 * player's stick may no longer grow |α| / |β|, and an assist turns the nose
 * toward the flight path (or nose-low when too slow to fly it) at no more
 * than `recoveryRateDeg` × the authority there is.
 */
export class Fcs implements ControlState {
  pitch = 0;
  roll = 0;
  yaw = 0;
  thrust = 0;
  afterburner = 0;
  airbrake = 0;
  psm = false;

  mode: FcsMode = 'NORMAL';
  /** w(v) at the current speed and its high-speed side (1 at or below the peak). */
  w = 0;
  wHigh = 0;
  /** Low-speed side of w, latched as |α| passed the limit (§6). */
  wLowLatched = 0;
  /** Agility boost in use, 0..1. */
  boost = 0;
  /** Where RECOVERY is turning the nose (world, unit); valid while `mode` is RECOVERY. */
  readonly recoveryDir = new Vector3(0, 0, 1);

  private readonly _lim = new Vector3();
  private readonly _t = new Vector3();
  private readonly _n = new Vector3();
  private readonly _q = new Quaternion();
  private readonly _r = new Vector3();
  /** Path capture: side of the path (sign of α) the nose is being brought back from, 0 when off. */
  private capture = 0;
  /**
   * Climb angle (rad) of the flight path before the pull that led into PSM:
   * path capture brings the nose back to this plane, not to the path the
   * pull has bent upward. Tracked in NORMAL and in a quiet ARMED.
   */
  private planeGamma = 0;
  /** Thrust align (`PSM.recovery.alignDeg`): seconds left, and the nose direction it holds. */
  private alignTimer = 0;
  private readonly alignDir = new Vector3();
  /** Seconds since Space was let go into RECOVERY, and the nose direction then (for `alignBurnerGrace`). */
  private sinceRelease = Infinity;
  private readonly releaseDir = new Vector3();
  /** σ (deg) when Space was let go: the afterburner may come late, after RECOVERY has started to bring the nose down. */
  private releaseSigma = 0;

  /** Call once per fixed step, after the control mixer. */
  step(input: ControlState, fm: FlightModel): void {
    const L = PSM.fcs;
    const air = fm.air;
    const v = fm.speed;
    this.updateMode(input.psm, fm, input.afterburner > 0);

    this.w = wCurve(v);
    this.wHigh = v * 3.6 <= PSM.wPeakKmh ? 1 : this.w;
    const wLow = v * 3.6 >= PSM.wPeakKmh ? 1 : this.w;
    if (this.mode === 'NORMAL') this.boost = 0;
    else if (this.mode === 'ARMED') this.boost = Math.min(wLow, this.wHigh);
    else this.boost = Math.min(this.wLowLatched, this.wHigh);
    fm.setFcs(this.mode, this.boost);
    const quiet = this.mode === 'ARMED' && Math.abs(fm.rates.x) < L.capturePlaneRateDeg * DEG2RAD;
    if (this.capture === 0 && (this.mode === 'NORMAL' || quiet)) {
      this.planeGamma = Math.asin(clamp(fm.pathDir.y, -1, 1));
    }

    const lim = fm.rateLimits(this._lim);
    let aLim = L.alphaLimitDeg * DEG2RAD;
    let bLim = L.betaLimitDeg * DEG2RAD;
    if (this.mode === 'RECOVERY') {
      this.recover(input, fm, lim);
      this.roll = input.roll;
      this.thrust = input.thrust;
      this.afterburner = input.afterburner;
      this.airbrake = input.airbrake;
      this.psm = input.psm;
      return;
    }
    let walled = true;
    if (this.mode === 'ARMED' || this.mode === 'PSM') {
      // The ceiling opens with wHigh and is recomputed every step, so diving
      // past the top of the curve mid-manoeuvre brings the limiter back.
      aLim += this.wHigh * (Math.PI - aLim);
      bLim += this.wHigh * (Math.PI / 2 - bLim);
      walled = this.wHigh < 1;
    }
    // α grows with pitch rate; β grows with nose-left yaw.
    this.pitch = walled ? wall(input.pitch, lim.x, air.alpha, fm.alphaRatePath, aLim) : input.pitch;
    this.pitch = this.captureStick(this.pitch, lim.x, air.alpha, fm);
    this.yaw = walled ? -wall(-input.yaw, lim.y, air.beta, fm.betaRatePath, bLim) : input.yaw;
    this.roll = input.roll;
    this.thrust = input.thrust;
    this.afterburner = input.afterburner;
    this.airbrake = input.airbrake;
    this.psm = input.psm;
  }

  /**
   * Path capture: stick pushed back toward the flight path from past the α
   * limit (PSM) brings the nose back to the plane it flew before the pull
   * (`planeGamma`, along the path's current heading) and stops it there,
   * braking as it closes, instead of carrying it through. It holds while
   * the stick keeps pushing the same way and lets go once the stick is
   * centred. With the nose there the wing bends the path back down to it.
   * Too slow for that, the path falls away below the plane; the nose then
   * stops no further than α limit − the RECOVERY exit margin from the path
   * instead, so it never holds the wing past the limit.
   */
  private captureStick(stick: number, rateLimit: number, alpha: number, fm: FlightModel): number {
    const back = Math.abs(stick) > 0.05 && Math.sign(stick) === -Math.sign(alpha);
    if (this.mode === 'PSM' && back && this.capture === 0) this.capture = Math.sign(alpha);
    if (this.capture === 0) return stick;
    if (this.mode === 'RECOVERY' || this.mode === 'NORMAL' || Math.abs(stick) <= 0.05 || Math.sign(stick) === this.capture) {
      this.capture = 0;
      return stick;
    }
    // Angle left to the stop on the side the nose came from (negative once
    // past it): the plane, or the α bound when the path has fallen so far
    // below the plane that the bound is further. The bound moves with the
    // path, so its rate is fed forward.
    const s = this.capture;
    const toPlane = s * this.planeAlpha(fm, alpha);
    const toBound = s * alpha - (PSM.fcs.alphaLimitDeg - PSM.recovery.exitMarginDeg) * DEG2RAD;
    const a = Math.max(toPlane, toBound);
    // It may shrink at most at captureGain × a (pushing back once past the stop).
    const maxDrop = PSM.fcs.captureGain * a + (toBound > toPlane ? s * fm.alphaRatePath : 0);
    const rate = stick * rateLimit;
    if (-s * rate <= maxDrop || rateLimit < 1e-6) return stick;
    return clamp((-s * maxDrop) / rateLimit, -1, 1);
  }

  /**
   * Like α, but to the capture plane: the path's heading climbing at
   * `planeGamma` (the nose's heading when the path is near vertical).
   * Positive with the nose above it.
   */
  private planeAlpha(fm: FlightModel, alpha: number): number {
    const d = fm.pathDir;
    let h = this._r.set(d.x, 0, d.z);
    if (h.lengthSq() < 0.01) h = fm.forward(this._r).setY(0);
    if (h.lengthSq() < 1e-8) return alpha;
    h.normalize().multiplyScalar(Math.cos(this.planeGamma)).setY(Math.sin(this.planeGamma));
    const b = h.applyQuaternion(this._q.copy(fm.quaternion).invert());
    return Math.atan2(-b.y, b.z);
  }

  /**
   * RECOVERY pitch / yaw: the player's stick minus any part that grows |α| or
   * |β| (past 180° in a Kulbit, pulling shrinks |α|, so it is allowed), plus
   * the assist toward the recovery target.
   */
  private recover(input: ControlState, fm: FlightModel, lim: Vector3): void {
    const air = fm.air;
    const pitch = Math.sign(input.pitch) === Math.sign(air.alpha) ? 0 : input.pitch;
    const yaw = Math.sign(-input.yaw) === Math.sign(air.beta) ? 0 : input.yaw;

    const target = this.recoveryTarget(fm);
    this.recoveryDir.copy(target);
    const b = target.applyQuaternion(this._q.copy(fm.quaternion).invert());
    // Pitch: angle to the target in the pitch plane, the long way round if
    // the nose is already turning fast enough to carry it there. Yaw: bring
    // the target into the pitch plane.
    const pitchErr = Math.atan2(b.y, b.z);
    const yawErr = Math.asin(clamp(-b.x, -1, 1));
    const resp = FLIGHT.rateResponse;
    const rate = fm.profile.recoveryRateDeg * DEG2RAD;
    const full = FLIGHT.maxRateDeg;
    // Aligning, the nose is stopped where it was let go, never carried round.
    const p = assist(pitchErr, fm.rates.x, lim.x, resp.pitch, rate * Math.min(1, lim.x / (full.pitch * DEG2RAD)), this.alignTimer <= 0);
    const y = assist(yawErr, fm.rates.y, lim.y, resp.yaw, rate * Math.min(1, lim.y / (full.yaw * DEG2RAD)), false);
    this.pitch = clamp(pitch + p, -1, 1);
    this.yaw = clamp(yaw + y, -1, 1);
  }

  /**
   * Where RECOVERY points the nose: along the flight path when there is
   * speed to fly it and the aircraft is not sliding tail first, otherwise
   * `noseLowDeg` under the horizon to dive for speed, blended so the target
   * never jumps. While thrust aligning it is the nose where Space was let
   * go instead, fading back to the above at the end.
   */
  private recoveryTarget(fm: FlightModel): Vector3 {
    const R = PSM.recovery;
    const f = fm.forward(this._n);
    // Horizontal heading of the nose; nose vertical: of the belly (or the
    // canopy, nose down), the way the nose falls when it pitches toward the horizon.
    let hx = f.x;
    let hz = f.z;
    if (hx * hx + hz * hz < 0.01) {
      const u = fm.up(this._t);
      const s = f.y > 0 ? -1 : 1;
      hx = s * u.x;
      hz = s * u.z;
    }
    const h = Math.hypot(hx, hz) || 1;
    const low = R.noseLowDeg * DEG2RAD;
    const t = this._t.set((hx / h) * Math.cos(low), -Math.sin(low), (hz / h) * Math.cos(low));
    const v = fm.speed;
    const track =
      smoothstep(R.trackSpeed - 8, R.trackSpeed + 8, v) *
      (1 - smoothstep(R.reversedDeg[0], R.reversedDeg[1], fm.air.sigma / DEG2RAD));
    if (track > 0) {
      t.multiplyScalar(1 - track).addScaledVector(fm.pathDir, track);
      if (t.lengthSq() < 1e-6) t.copy(fm.pathDir);
      t.normalize();
    }
    if (this.alignTimer > 0) turnToward(t, this.alignDir, Math.min(1, this.alignTimer / R.alignFade), this._n);
    return t;
  }

  private updateMode(held: boolean, fm: FlightModel, burner: boolean): void {
    const L = PSM.fcs;
    const R = PSM.recovery;
    const a = Math.abs(fm.air.alpha) / DEG2RAD;
    const b = Math.abs(fm.air.beta) / DEG2RAD;
    const v = fm.speed;
    const outside = a > L.alphaLimitDeg || b > L.betaLimitDeg;
    const prev = this.mode;
    let next: FcsMode;
    if (held) {
      // Pressing again during RECOVERY goes straight back to PSM.
      next = prev === 'RECOVERY' || outside ? 'PSM' : 'ARMED';
    } else if (prev === 'ARMED' || prev === 'PSM') {
      next = outside || v <= R.stallSpeed ? 'RECOVERY' : 'NORMAL';
    } else if (prev === 'RECOVERY') {
      const m = R.exitMarginDeg;
      const inside = a < L.alphaLimitDeg - m && b < L.betaLimitDeg - m;
      next = inside && v > R.exitSpeedFactor * R.stallSpeed ? 'NORMAL' : 'RECOVERY';
    } else next = 'NORMAL';
    // The low side of w is latched as the aircraft enters PSM, so the speed
    // bled in a Cobra does not take the boost away mid-manoeuvre.
    if (next === 'PSM' && prev !== 'PSM') this.wLowLatched = v * 3.6 >= PSM.wPeakKmh ? 1 : wCurve(v);
    // Thrust align: let go with the nose turned back, while still moving; or
    // on afterburner (lit with the release or just after it) with the nose
    // well off the path, as in a Cobra standing at 90°.
    const sigma = fm.air.sigma / DEG2RAD;
    const released = next === 'RECOVERY' && (prev === 'PSM' || prev === 'ARMED');
    if (released) {
      this.sinceRelease = 0;
      this.releaseSigma = sigma;
      fm.forward(this.releaseDir);
    } else if (next === 'RECOVERY') this.sinceRelease += SIM.fixedDt;
    else this.sinceRelease = Infinity;
    const burnerAlign = burner && this.alignTimer <= 0 && this.sinceRelease <= R.alignBurnerGrace && this.releaseSigma > R.alignBurnerDeg;
    if (released && sigma > R.alignDeg && v > R.trackSpeed) {
      this.alignTimer = R.alignTime;
      fm.forward(this.alignDir);
    } else if (next === 'RECOVERY' && burnerAlign) {
      this.alignTimer = R.alignTime;
      this.alignDir.copy(this.releaseDir);
    } else if (next !== 'RECOVERY' || sigma < (burner ? R.alignDoneBurnerDeg : R.alignDoneDeg)) this.alignTimer = 0;
    else this.alignTimer = Math.max(0, this.alignTimer - SIM.fixedDt);
    this.mode = next;
  }

  /** Everything the next step reads back, as plain numbers. The stick outputs are rebuilt every step. */
  save(): ArcadeFcsData {
    return {
      mode: this.mode, w: this.w, wHigh: this.wHigh, wLowLatched: this.wLowLatched, boost: this.boost,
      recoveryDir: this.recoveryDir.toArray(), capture: this.capture, planeGamma: this.planeGamma,
      alignTimer: this.alignTimer, alignDir: this.alignDir.toArray(),
      sinceRelease: this.sinceRelease, releaseDir: this.releaseDir.toArray(), releaseSigma: this.releaseSigma,
    };
  }

  load(d: ArcadeFcsData): void {
    this.mode = d.mode; this.w = d.w; this.wHigh = d.wHigh; this.wLowLatched = d.wLowLatched; this.boost = d.boost;
    this.recoveryDir.fromArray(d.recoveryDir); this.capture = d.capture; this.planeGamma = d.planeGamma;
    this.alignTimer = d.alignTimer; this.alignDir.fromArray(d.alignDir);
    this.sinceRelease = d.sinceRelease; this.releaseDir.fromArray(d.releaseDir); this.releaseSigma = d.releaseSigma;
  }

  reset(): void {
    this.pitch = this.roll = this.yaw = 0;
    this.thrust = this.afterburner = this.airbrake = 0;
    this.psm = false;
    this.mode = 'NORMAL';
    this.w = this.wHigh = this.wLowLatched = this.boost = 0;
    this.capture = 0;
    this.planeGamma = 0;
    this.alignTimer = 0;
    this.sinceRelease = Infinity;
  }
}

/**
 * Turn unit `dir` toward unit `to` by `share` of the angle between them
 * (over any perpendicular when they are opposite). `tmp` is scratch.
 */
function turnToward(dir: Vector3, to: Vector3, share: number, tmp: Vector3): void {
  const angle = dir.angleTo(to) * share;
  if (angle < 1e-9) return;
  const axis = tmp.crossVectors(dir, to);
  if (axis.lengthSq() < 1e-12) {
    axis.set(1, 0, 0).cross(dir);
    if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1).cross(dir);
  }
  dir.applyAxisAngle(axis.normalize(), angle).normalize();
}

/** w(v) from `PSM.wCurveKmh`, smoothstepped between points (speed in m/s). */
export function wCurve(speed: number): number {
  const pts = PSM.wCurveKmh;
  const kmh = speed * 3.6;
  if (kmh <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (kmh <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + (y1 - y0) * smoothstep(x0, x1, kmh);
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * Assist stick for one axis: a rate toward the error, braking along the
 * curve that stops the nose on target with `resp × limit` of authority, no
 * faster than `maxRate`. With `wrap`, the error is taken from the predicted
 * stop point (θ + q|q| / 2a, §5.3), so a fast rotation that would carry the
 * nose most of the way round carries on, and a slow one turns back.
 */
function assist(err: number, rate: number, limit: number, resp: number, maxRate: number, wrap: boolean): number {
  if (limit < 1e-6) return 0;
  const decel = resp * limit;
  let e = err;
  if (wrap) {
    const stop = (rate * Math.abs(rate)) / (2 * decel);
    e = stop + wrapPi(err - stop);
  }
  const want = Math.sign(e) * Math.min(maxRate, Math.sqrt(2 * decel * Math.abs(e)), PSM.recovery.gain * Math.abs(e));
  return clamp(want / limit, -1, 1);
}

/**
 * Stick after the soft wall. `stick × rateLimit` is a body rate that adds
 * one-for-one to the rate of `angle`; `pathRate` is how fast the angle is
 * moving without any body rotation.
 */
function wall(stick: number, rateLimit: number, angle: number, pathRate: number, limit: number): number {
  const s = Math.sign(angle);
  if (s === 0 || rateLimit < 1e-6) return stick;
  const maxRate = PSM.fcs.limiterGain * (limit - Math.abs(angle)) - s * pathRate;
  const rate = stick * rateLimit;
  if (s * rate <= maxRate) return stick;
  return clamp((s * maxRate) / rateLimit, -1, 1);
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
