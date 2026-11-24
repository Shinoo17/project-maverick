import { Quaternion, Vector3 } from 'three';
import { DEFAULT_PSM_PROFILE, FLIGHT, PSM, SIM, DEG2RAD, type PsmProfile } from './config';
import type { ControlState } from '../control/ControlAxes';
import { airData, createAirData, liftAvail, liftCoef, liftFraction, sideCoef, type AirData } from './aero';
import type { FcsMode } from '../control/config';

/**
 * Arcade flight model, ported from example/flight-control (src/game/flight/FlightModel.ts).
 * Unchanged apart from its imports and `place` / `save` / `load`, which let this project's
 * runtime keep the model's memory on the AircraftState (see ./step.ts).
 *
 * Arcade flight model.
 *
 * Body frame (shared by every aircraft after normalisation):
 *   forward = +Z, up = +Y, right = -X  (left wing on +X)
 * World frame: +Y up, north = -Z, east = +X.
 *
 * The model keeps two directions apart on purpose:
 *   - the nose (orientation quaternion), driven by the player's body rates
 *   - the velocity vector, which lift swings toward the nose at a finite
 *     rate and gravity sags.
 * The gap between them is the angle of attack / sideslip that the HUD shows
 * as the Flight Path Marker separating from the boresight.
 *
 * Speed along the path has no target: W / S / afterburner add or remove
 * energy, gravity trades it against climb/dive, and load factor and airbrake
 * bleed it. With no thrust input the speed simply holds, so energy lost in a
 * turn stays lost until the player accelerates again.
 *
 * Lift follows `aero.ts`: unchanged from the pre-PSM model below |α| 25°,
 * collapsing past the peak and at low airspeed, so slow flight stalls and
 * the velocity can fall to zero and reverse. The α / β limit is not here:
 * it is a soft wall in the FCS (`Fcs.ts`).
 */

const FWD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(-1, 0, 0);
const WORLD_UP = new Vector3(0, 1, 0);

export interface FlightTelemetry {
  speed: number;
  altitude: number;
  /** 0..360, 0 = north. */
  headingDeg: number;
  /** Nose pitch above horizon, degrees. */
  pitchDeg: number;
  /** Bank, degrees, positive = right wing down. */
  rollDeg: number;
  /** Signed angle of attack, degrees, positive = nose above the flight path. */
  alphaDeg: number;
  /** Signed sideslip, degrees, positive = flight path right of the nose. */
  betaDeg: number;
  /** Total angle between nose and flight path, degrees. */
  sigmaDeg: number;
  /** Normal load factor shown on the HUD (Nz). */
  g: number;
  /** Vertical speed, m/s. */
  climbRate: number;
  stall: boolean;
}

/** FlightModel's step-to-step memory as plain data (see `save`). */
export interface ArcadeModelData {
  rates: [number, number, number];
  air: AirData;
  g: number;
  liftG: number;
  alphaRatePath: number;
  betaRatePath: number;
  stalled: boolean;
  fcsMode: FcsMode;
  agility: number;
  grip: number;
  spool: number;
  tvc: { pitch: number; yaw: number; roll: number };
  tvcScale: number;
  path: [number, number, number];
}

export class FlightModel {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  /** World velocity, m/s. */
  readonly velocity = new Vector3(0, 0, FLIGHT.cruiseSpeed);
  /** Body rates in rad/s: x = pitch (nose up +), y = yaw (nose right +), z = roll (right +). */
  readonly rates = new Vector3();
  /** Air data at the end of the last step. */
  readonly air: AirData = createAirData();
  /**
   * Normal load factor for the HUD: 1 + gScale × manoeuvre acceleration
   * along body up / g. Reads 1 in level flight and matches the pre-PSM
   * pitch-rate G in a pull.
   */
  g = 1;
  /** Load factor from lift only (≥ 1), the one that bleeds speed. */
  liftG = 1;
  /** Rate (rad/s) the last step's forces moved α / β, body rotation excluded. The FCS limiter feeds forward on these. */
  alphaRatePath = 0;
  betaRatePath = 0;
  /** Stalled: |α| / |β| past the stall angle, or lift at the α limit cannot hold the flight path. */
  stalled = false;
  /** PSM character of the aircraft being flown. */
  profile: PsmProfile = DEFAULT_PSM_PROFILE;
  /** FCS mode and agility boost (0..1), set by the FCS each step. Outside NORMAL the PSM authority applies. */
  fcsMode: FcsMode = 'NORMAL';
  agility = 0;
  /**
   * 0..1: how much pitch control power there is to hold the commanded pitch
   * rate, 1 from `FLIGHT.minAuthority` up (all of NORMAL flight). Below it
   * the rate stops snapping to the command and the airframe's own moments
   * take over (tail-slide, idle with no TVC). Pitch only: yaw and roll keep
   * their response.
   */
  grip = 1;
  /** Engine spool 0..1 (0.6 = military power): drives TVC authority, post-stall thrust and the nozzle visuals. */
  spool = 0;
  /** Thrust-vectoring deflection the controls are using, deg (pitch nose-up +, yaw nose-right +, roll right +). */
  readonly tvc = { pitch: 0, yaw: 0, roll: 0 };
  /** Share of each axis's TVC rate left after the nozzle travel limit (cone or flap). */
  private tvcScale = 1;

  private readonly _path = new Vector3(0, 0, 1);

  // scratch
  private readonly _f = new Vector3();
  private readonly _u = new Vector3();
  private readonly _r = new Vector3();
  private readonly _v = new Vector3();
  private readonly _w = new Vector3();
  private readonly _p = new Vector3();
  private readonly _lb = new Vector3();
  private readonly _q = new Quaternion();

  reset(position: Vector3, headingDeg: number, speed = FLIGHT.cruiseSpeed): void {
    this.position.copy(position);
    // Model nose is +Z; heading 0 (north) is world -Z, so heading h is a yaw of 180° - h.
    this.quaternion.setFromAxisAngle(WORLD_UP, Math.PI - headingDeg * DEG2RAD);
    this._path.copy(FWD).applyQuaternion(this.quaternion);
    this.velocity.copy(this._path).multiplyScalar(speed);
    this.rates.set(0, 0, 0);
    Object.assign(this.air, createAirData());
    airData(this.velocity, this.quaternion, this.air);
    this.g = this.liftG = 1;
    this.alphaRatePath = this.betaRatePath = 0;
    this.stalled = false;
    this.fcsMode = 'NORMAL';
    this.agility = 0;
    this.spool = this.powerDemand(0, 0);
    this.tvc.pitch = this.tvc.yaw = this.tvc.roll = 0;
    this.tvcScale = 1;
  }

  /**
   * Puts the model on a pose this project's runtime made (its spawn, a reset): like `reset`,
   * but keeping the given attitude and velocity. Attitude is in this model's body frame.
   */
  place(position: Vector3, quaternion: Quaternion, velocity: Vector3): void {
    this.reset(position, 0, velocity.length());
    this.quaternion.copy(quaternion);
    this.velocity.copy(velocity);
    if (velocity.length() >= PSM.vEpsilon) this._path.copy(velocity).normalize();
    else this.forward(this._path);
    airData(this.velocity, this.quaternion, this.air);
  }

  /**
   * Everything a step reads back from the last one, as plain numbers (this project keeps it on
   * AircraftState.arcadeFlight, which snapshots clone). Position, velocity and attitude are the
   * AircraftState's own, and the profile comes from the aircraft id.
   */
  save(): ArcadeModelData {
    return {
      rates: this.rates.toArray(),
      air: { ...this.air },
      g: this.g, liftG: this.liftG,
      alphaRatePath: this.alphaRatePath, betaRatePath: this.betaRatePath,
      stalled: this.stalled, fcsMode: this.fcsMode, agility: this.agility, grip: this.grip, spool: this.spool,
      tvc: { ...this.tvc }, tvcScale: this.tvcScale, path: this._path.toArray(),
    };
  }

  load(d: ArcadeModelData): void {
    this.rates.fromArray(d.rates);
    Object.assign(this.air, d.air);
    this.g = d.g; this.liftG = d.liftG;
    this.alphaRatePath = d.alphaRatePath; this.betaRatePath = d.betaRatePath;
    this.stalled = d.stalled; this.fcsMode = d.fcsMode; this.agility = d.agility; this.grip = d.grip; this.spool = d.spool;
    Object.assign(this.tvc, d.tvc); this.tvcScale = d.tvcScale; this._path.fromArray(d.path);
  }

  setProfile(profile: PsmProfile): void {
    this.profile = profile;
  }

  setFcs(mode: FcsMode, agility: number): void {
    this.fcsMode = mode;
    this.agility = agility;
  }

  /** Airspeed, m/s. */
  get speed(): number {
    return this.velocity.length();
  }

  /** Unit flight path direction; the last valid one while |v| < `PSM.vEpsilon`. */
  get pathDir(): Vector3 {
    const s = this.velocity.length();
    if (s >= PSM.vEpsilon) this._path.copy(this.velocity).divideScalar(s);
    return this._path;
  }

  forward(out = new Vector3()) {
    return out.copy(FWD).applyQuaternion(this.quaternion);
  }
  up(out = new Vector3()) {
    return out.copy(UP).applyQuaternion(this.quaternion);
  }
  right(out = new Vector3()) {
    return out.copy(RIGHT).applyQuaternion(this.quaternion);
  }

  /** Control authority 0..1 from airspeed (low-speed mush, high-speed q-limit). */
  effectiveness(speed = this.speed): number {
    const low = smoothstep(FLIGHT.minSpeed, FLIGHT.fullAuthSpeed, speed);
    let e = FLIGHT.minAuthority + (1 - FLIGHT.minAuthority) * low;
    if (speed > FLIGHT.qLimitSpeed) {
      const t = smoothstep(FLIGHT.qLimitSpeed, FLIGHT.maxSpeed, speed);
      e *= 1 + (FLIGHT.qLimitAuthority - 1) * t;
    }
    return e;
  }

  /**
   * Engine power 0..1 for visuals and the HUD (0.6 = military power): the
   * power needed to hold the current speed, plus the player's thrust
   * command, blended up to 1 by the afterburner.
   */
  enginePower(c: ControlState): number {
    return this.powerDemand(c.thrust, c.afterburner);
  }

  private powerDemand(thrust: number, afterburner: number): number {
    const hold = clamp((this.speed / FLIGHT.milSpeed) ** 2, 0.12, 1);
    const dry = clamp(hold + 0.7 * thrust, 0, 1);
    return dry * 0.6 + (1 - dry * 0.6) * afterburner;
  }

  /** Thrust / weight along the nose at the current spool (post-stall). */
  postStallTW(): number {
    const tw = this.profile.postStallTW;
    const mil = PSM.engine.milSpool;
    const s = this.spool;
    return s <= mil ? (tw.dry * s) / mil : tw.dry + ((tw.ab - tw.dry) * (s - mil)) / (1 - mil);
  }

  /**
   * Body rates (rad/s) that full stick commands right now, in the same
   * layout as `rates` (x = pitch, y = yaw, z = roll). Authority fades with
   * airspeed, and pitch is further capped by the G-limit at high speed.
   */
  rateLimits(out = new Vector3()): Vector3 {
    return this.authority(out, this.agility);
  }

  /**
   * NORMAL: the pre-PSM rates. Otherwise (§7, P4) per axis the larger of
   * that and aerodynamic + TVC authority, plus the agility boost on pitch.
   * The aerodynamic part fades with |α| / |β| and is gone below
   * `aeroZeroSpeed`, where thrust vectoring (∝ engine thrust) is all that
   * is left; the NORMAL rates fade out there too.
   */
  private authority(out: Vector3, agility: number): Vector3 {
    const A = PSM.authority;
    const a = Math.abs(this.air.alpha) / DEG2RAD;
    const reverse = 1 - smoothstep(A.reverseFadeDeg[0], A.reverseFadeDeg[1], a);
    const eff = this.effectiveness();
    const max = FLIGHT.maxRateDeg;
    out.set(Math.min(max.pitch * DEG2RAD * eff, this.gLimitRate()), max.yaw * DEG2RAD * eff, max.roll * DEG2RAD * eff);
    // Tail first the surfaces stop working, the low-speed floor included,
    // so in a tail-slide the airframe (not the limiter) swings the nose.
    if (this.fcsMode === 'NORMAL') {
      this.grip = reverse;
      return out.multiplyScalar(reverse);
    }

    const P = this.profile;
    const v = this.speed;
    const b = Math.abs(this.air.beta) / DEG2RAD;
    const gate = smoothstep(A.aeroZeroSpeed, A.aeroFullSpeed, v);
    const aero = eff * gate * reverse * DEG2RAD;
    const side = 1 - A.betaFade * smoothstep(A.betaFadeDeg[0], A.betaFadeDeg[1], b);
    const pitchAero = aero * max.pitch * lerp(1, A.pitchHighAlpha, smoothstep(30, 90, a));
    const yawAero = aero * side * lerp(max.yaw, P.aeroHighAlphaDeg.yaw, smoothstep(A.yawFadeDeg[0], A.yawFadeDeg[1], a));
    const rollAero = aero * side * lerp(max.roll, P.aeroHighAlphaDeg.roll, smoothstep(A.rollFadeDeg[0], A.rollFadeDeg[1], a));
    // TVC moment scales with thrust: 1 at military power.
    const tvc = (this.postStallTW() / P.postStallTW.dry) * this.tvcScale * DEG2RAD;
    let pitch = pitchAero + P.tvcRateDeg.pitch * tvc;
    // Agility boost toward the profile's PSM pitch rate, from the control
    // surfaces where there is airspeed or from thrust vectoring. No G limit
    // here: the lift cap already keeps the load what NORMAL can pull.
    const source = Math.max(Math.min(1, tvc / DEG2RAD), aero / DEG2RAD);
    const boosted = Math.max(pitch, P.psmPitchRateDeg * DEG2RAD * source);
    pitch = lerp(pitch, boosted, agility);
    const yaw = yawAero + P.tvcRateDeg.yaw * tvc;
    const roll = rollAero + P.tvcRateDeg.roll * tvc;
    const pitchCtl = (pitchAero + P.tvcRateDeg.pitch * tvc) / (max.pitch * DEG2RAD);
    this.grip = Math.min(1, Math.max(eff * gate, pitchCtl) / FLIGHT.minAuthority);
    return out.set(
      Math.max(out.x * gate, pitch),
      Math.max(out.y * gate, yaw),
      Math.max(out.z * gate, roll),
    );
  }

  /** Most lift acceleration (m/s²) the wing makes: `liftTurnMargin` × a NORMAL full pull's path turn. */
  private maxLiftAccel(v: number, eff: number): number {
    return PSM.aero.liftTurnMargin * v * Math.min(FLIGHT.maxRateDeg.pitch * DEG2RAD * eff, this.gLimitRate(v));
  }

  /** Pitch rate (rad/s) at which load factor reaches `gLimit`. */
  gLimitRate(speed = this.speed): number {
    return ((FLIGHT.gLimit - 1) * SIM.gravity) / (FLIGHT.gScale * Math.max(speed, 1));
  }

  step(c: ControlState, dt: number): void {
    const vel = this.velocity;
    const f = this.forward(this._f);
    const u = this.up(this._u);
    const r = this.right(this._r);
    // Share of lift the wing still makes (α past the peak, low airspeed).
    const lift0 = liftFraction(this.air.alpha) * liftAvail(vel.length());

    this.updateSpool(c, dt);

    // --- angular rates: commanded rate approached with inertia -------------
    // G-limit: at high speed the same stick gives a lower pitch rate.
    const lim = this.rateLimits(this._v);
    const resp = FLIGHT.rateResponse;
    // Weathercock moment past `stability.onDeg` of σ (0 below), which the
    // FCS holds against with its base authority except in RECOVERY, where
    // it is left to help (§5.3).
    const S = PSM.stability;
    const T = PSM.tailSlide;
    const air0 = this.air;
    const on = smoothstep(S.onDeg[0], S.onDeg[1], air0.sigma / DEG2RAD) * air0.qbar;
    const v0 = vel.length();
    // Tail-slide lever: grows with the backward speed, gone by `fadeSpeed`.
    const slide = air0.tailFirst ? Math.min(v0 / T.refSpeed, T.cap) * (1 - smoothstep(T.fadeSpeed[0], T.fadeSpeed[1], v0)) : 0;
    let mPitch = 0;
    let mYaw = 0;
    let kPitch = 0;
    let kYaw = 0;
    let tgtPitch = c.pitch * lim.x;
    let tgtYaw = c.yaw * lim.y;
    const tgtRoll = c.roll * lim.z;
    if (on > 0 || slide > 0) {
      mPitch = -(S.pitch * on + T.pitch * slide) * Math.sin(air0.alpha);
      // Nose almost straight into the tail-first flow: either way is "toward"
      // the velocity, so keep turning the way the nose already is, or with no
      // rate to speak of fall toward the belly.
      if (Math.cos(air0.alpha) < -0.996) {
        const dead = T.rateDeadbandDeg * DEG2RAD;
        const dir = this.rates.x > dead ? 1 : -1;
        mPitch = dir * Math.max(Math.abs(mPitch), T.bias * slide);
      }
      mYaw = S.yaw * on * Math.sin(air0.beta);
      kPitch = Math.max(0, S.pitch * on * Math.cos(air0.alpha));
      kYaw = Math.max(0, S.yaw * on * Math.cos(air0.beta));
      if (this.fcsMode !== 'RECOVERY') {
        const base = this.fcsMode === 'NORMAL' ? lim : this.authority(this._lb, 0);
        tgtPitch = clamp(tgtPitch + clamp(-mPitch / resp.pitch, -base.x, base.x), -lim.x, lim.x);
        tgtYaw = clamp(tgtYaw + clamp(-mYaw / resp.yaw, -base.y, base.y), -lim.y, lim.y);
      }
    }
    this.updateTvc(tgtPitch, tgtYaw, tgtRoll, lim);
    // Semi-implicit in the moment: its growth over the step is taken from
    // the new rate, so a stiff (high-q) weathercock cannot overshoot.
    // A big pitch command snaps faster with the PSM agility boost.
    const A = PSM.authority;
    const snap = this.agility * smoothstep(A.snapRate[0], A.snapRate[1], Math.abs(tgtPitch - this.rates.x));
    // Without pitch control power (`grip`) only light airframe damping is left.
    const respPitch = lerp(T.damping, lerp(resp.pitch, A.pitchResponse, snap), this.grip);
    this.rates.x += (tgtPitch - this.rates.x) * (1 - Math.exp(-respPitch * dt));
    this.rates.z += (tgtRoll - this.rates.z) * (1 - Math.exp(-resp.roll * dt));
    this.rates.y += (tgtYaw - this.rates.y) * (1 - Math.exp(-resp.yaw * dt));
    if (on > 0 || slide > 0) {
      this.rates.x = (this.rates.x + mPitch * dt) / (1 + kPitch * dt * dt);
      this.rates.y = (this.rates.y + mYaw * dt) / (1 + kYaw * dt * dt);
    }

    // Body angular velocity in local axes: pitch about right, roll about
    // forward, yaw about up (nose right = negative about +Y).
    const w = this._w.set(-this.rates.x, -this.rates.y, this.rates.z);
    const angle = w.length() * dt;
    if (angle > 1e-9) {
      this._q.setFromAxisAngle(w.normalize(), angle);
      this.quaternion.multiply(this._q);
    }

    // Bank-to-turn: horizontal lift component swings heading toward the low
    // wing. Only as strong as the lift the wing still makes, so it fades out
    // in a stall and as speed goes to zero (the division is then gated too).
    const sinBank = -r.y; // right wing down => right.y < 0 => positive
    const horiz = Math.sqrt(Math.max(0, 1 - f.y * f.y));
    const turn = (FLIGHT.bankTurn * SIM.gravity * sinBank * horiz * lift0) / Math.max(vel.length(), 1);
    if (Math.abs(turn) > 1e-9) {
      this._q.setFromAxisAngle(WORLD_UP, -turn * dt);
      this.quaternion.premultiply(this._q);
      vel.applyQuaternion(this._q);
    }
    this.quaternion.normalize();

    // Refresh axes and air data after rotation.
    this.forward(f);
    this.up(u);
    this.right(r);
    const air = airData(vel, this.quaternion, this.air);
    const alpha0 = air.alpha;
    const beta0 = air.beta;

    // --- forces ---------------------------------------------------------------
    const v = vel.length();
    const d = this.pathDir;
    const eff = this.effectiveness(v);
    const avail = liftAvail(v);
    const liftFrac = liftFraction(alpha0) * avail;
    const kA = 1 - Math.exp(-FLIGHT.pathAlign * eff * dt);
    const kS = 1 - Math.exp(-FLIGHT.slipAlign * eff * dt);
    const g = SIM.gravity;
    const E = PSM.engine;
    // Post-stall share: thrust along the nose instead of the attached-flow speed model.
    const ps = smoothstep(E.blendDeg[0], E.blendDeg[1], air.sigma / DEG2RAD);

    // Velocity change across the path (m/s). Lift swings the path toward the
    // nose in the pitch plane, side force in the yaw plane (the pre-PSM
    // `pathAlign` / `slipAlign` model, with sin α and sin β generalised to
    // the lift / side-force curves). Gravity bends it down; trim lift
    // carries (1 - gravitySag) of the weight while the wing flies.
    const uPerp = this._p.copy(u).addScaledVector(d, -u.dot(d));
    const dvPerp = this._w.copy(uPerp).multiplyScalar(v * Math.cos(beta0) * liftCoef(alpha0) * kA * avail);
    // The wing turns the path no faster than a NORMAL full pull can at this
    // speed (fading out past the normal α range), so a nose pitched faster than that
    // (PSM) outruns its flight path; NORMAL itself never reaches the cap.
    const fade = 1 - smoothstep(PSM.aero.liftCapFadeDeg[0], PSM.aero.liftCapFadeDeg[1], Math.abs(alpha0) / DEG2RAD);
    const liftMax = this.maxLiftAccel(v, eff) * fade * dt;
    const lift = dvPerp.length();
    if (lift > liftMax) dvPerp.multiplyScalar(liftMax / lift);
    const rPerp = this._p.copy(r).addScaledVector(d, -r.dot(d));
    dvPerp.addScaledVector(rPerp, -v * sideCoef(beta0) * kS * avail);
    const yPerp = this._p.copy(WORLD_UP).addScaledVector(d, -d.y);
    dvPerp.addScaledVector(yPerp, (-g + (1 - FLIGHT.gravitySag) * g * liftFrac) * dt);

    // Along the path: no speed target, released keys hold whatever energy
    // the aircraft has. Drag-like terms only ever slow it toward zero.
    const n = FLIGHT.thrustTaperExp;
    let accel = -g * d.y;
    let push = 0;
    if (c.thrust > 0) push += c.thrust * FLIGHT.dryAccel * Math.max(0, 1 - (v / FLIGHT.milSpeed) ** n);
    push += c.afterburner * FLIGHT.afterburnerAccel * Math.max(0, 1 - (v / FLIGHT.afterburnerSpeed) ** n);
    accel += push * (1 - ps);
    let drag = 0;
    if (ps > 0) {
      const aDrag = ps * E.alphaDrag * this.profile.alphaDragFactor * alphaDragShape(air.sigma) * (v / FLIGHT.cruiseSpeed) ** 2;
      drag += aDrag;
      // Thrust along the nose. Across the path it only turns the velocity;
      // along it, with W and afterburner released it can at most cancel the
      // α drag (the post-stall "hold speed"), so PSM never adds energy.
      const t = ps * g * this.postStallTW();
      const fd = f.dot(d);
      let ta = t * fd;
      const free = Math.max(0, c.thrust, c.afterburner);
      if (ta > 0) ta = Math.min(ta, aDrag + free * ta);
      accel += ta;
      dvPerp.addScaledVector(this._p.copy(f).addScaledVector(d, -fd), t * dt);
    }
    if (c.thrust < 0) drag -= c.thrust * FLIGHT.idleDecel * (0.35 + 0.65 * Math.min(1, v / FLIGHT.milSpeed));
    if (v > FLIGHT.milSpeed) drag += FLIGHT.overspeedDrag * (v - FLIGHT.milSpeed) * (1 - c.afterburner);
    // Speed bleed from lift-G only: the pre-PSM pitch-rate G, scaled by the
    // lift the wing actually makes (no more than the lift cap lets it).
    this.liftG = 1 + (FLIGHT.gScale * Math.min(Math.abs(this.rates.x) * v * liftFrac, liftMax / dt)) / g;
    drag += FLIGHT.turnBleed * (this.liftG - 1);
    drag += FLIGHT.airbrakeDecel * c.airbrake * (v / FLIGHT.cruiseSpeed);
    const along = v + (accel - drag) * dt;

    // --- integrate velocity ----------------------------------------------------
    const prev = this._v.copy(vel);
    if (v > PSM.vPolar && along > PSM.vPolar) {
      // Speed along the path plus a turn of the path: the pre-PSM integration.
      vel.copy(d).multiplyScalar(v).add(dvPerp).normalize().multiplyScalar(Math.min(along, FLIGHT.maxSpeed));
    } else {
      // Slow: a plain vector sum, free to pass through zero and reverse (`d`
      // may be the last valid path here, but gravity still sums to the full
      // vector). Drag only shrinks the speed, never reverses it.
      vel.addScaledVector(d, accel * dt).add(dvPerp);
      const s = vel.length();
      if (s > 0) vel.multiplyScalar(Math.max(0, s - drag * dt) / s);
    }
    // Afterburner past the attached range: the player wants to go where the
    // nose points, so the velocity swings round onto it (arcade) instead of
    // being braked to a stop against the old motion first.
    if (c.afterburner > 0 && ps > 0) this.swingToNose(vel, f, r, E.abSwingRateDeg * DEG2RAD * c.afterburner * ps * dt);
    this.position.addScaledVector(vel, dt);

    // Manoeuvre acceleration along body up, scaled like the pre-PSM G.
    const aUp = prev.subVectors(vel, prev).dot(u) / dt;
    this.g = 1 + (FLIGHT.gScale * aUp) / g;

    airData(vel, this.quaternion, air);
    this.alphaRatePath = wrapPi(air.alpha - alpha0) / dt;
    this.betaRatePath = (air.beta - beta0) / dt;
    this.updateStall(vel.length(), eff, avail);
  }

  /**
   * Turn `vel` toward the nose `f` by up to `step` rad, shedding
   * `PSM.engine.abSwingLoss` of the speed per 180° turned. Nose and velocity
   * straight opposite turn about the pitch axis `r`.
   */
  private swingToNose(vel: Vector3, f: Vector3, r: Vector3, step: number): void {
    const v = vel.length();
    if (v < 1e-6) return;
    const angle = Math.min(step, vel.angleTo(f));
    if (angle < 1e-9) return;
    const axis = this._p.crossVectors(vel, f);
    if (axis.lengthSq() < 1e-12) axis.copy(r);
    vel.applyAxisAngle(axis.normalize(), angle).multiplyScalar(1 - (PSM.engine.abSwingLoss * angle) / Math.PI);
  }

  /**
   * Spool toward the power the controls ask for; outside NORMAL at least
   * military power (unless S is held) so thrust vectoring has thrust to work
   * with when the speed, and with it the demand, collapses.
   */
  private updateSpool(c: ControlState, dt: number): void {
    let target = this.powerDemand(c.thrust, c.afterburner);
    if (this.fcsMode !== 'NORMAL' && c.thrust >= 0) target = Math.max(target, PSM.engine.milSpool);
    const step = this.profile.spoolRate * dt;
    this.spool = clamp(target, this.spool - step, this.spool + step);
  }

  /**
   * Nozzle deflection for the commanded rates: full rate = full travel on
   * each vectoring axis, then the travel limit of the nozzles (the Su-57
   * cone, as in su57-nozzle.js `setVectorWithRoll`; the F-22 flaps, as in
   * its rig). The share cut by that limit also cuts the TVC rate next step.
   */
  private updateTvc(pitch: number, yaw: number, roll: number, lim: Vector3): void {
    const T = this.profile.tvc;
    const p = T.pitch ? share(pitch, lim.x) * T.maxDeg : 0;
    const y = T.yaw ? share(yaw, lim.y) * T.maxDeg : 0;
    const r = T.roll ? share(roll, lim.z) * T.rollDeg : 0;
    const worst =
      T.coneDeg > 0
        ? Math.max(Math.hypot(p + r, y), Math.hypot(p - r, y)) / T.coneDeg
        : Math.max(Math.abs(p + r), Math.abs(p - r)) / T.maxDeg;
    this.tvcScale = worst > 1 ? 1 / worst : 1;
    this.tvc.pitch = p * this.tvcScale;
    this.tvc.yaw = y * this.tvcScale;
    this.tvc.roll = r * this.tvcScale;
  }

  /**
   * Stall from α / β past the stall angle, or from lift: even at the normal
   * α limit the wing cannot carry the part of the weight across the flight
   * path. The second catches both the slow 1 g stall and a pull too hard
   * for the airspeed. Hysteresis keeps the flag from chattering.
   */
  private updateStall(v: number, eff: number, avail: number): void {
    const S = PSM.stall;
    const a = Math.abs(this.air.alpha) / DEG2RAD;
    const b = Math.abs(this.air.beta) / DEG2RAD;
    // Gravity across the path, along the lift direction (body up projected off the path).
    const d = this.pathDir;
    const lift = this._p.copy(this.up(this._u)).addScaledVector(d, -this._u.dot(d));
    const len = lift.length();
    const across = len > 1e-6 ? lift.y / len : 0;
    let ratio = Infinity;
    if (across > 1e-3) {
      const aLim = PSM.fcs.alphaLimitDeg * DEG2RAD;
      const g = SIM.gravity;
      const dyn = Math.min(v * FLIGHT.pathAlign * eff * Math.cos(this.air.beta) * liftCoef(aLim) * avail, this.maxLiftAccel(v, eff));
      const trim = (1 - FLIGHT.gravitySag) * g * avail * across;
      ratio = (dyn + trim) / (g * across);
    }
    if (!this.stalled) this.stalled = ratio < 1 || a > S.alphaDeg || b > S.betaDeg;
    else this.stalled = !(ratio > S.exitMargin && a < S.alphaDeg - 3 && b < S.betaDeg - 3);
  }

  telemetry(out: Partial<FlightTelemetry> = {}): FlightTelemetry {
    const f = this.forward(this._f);
    const r = this.right(this._r);
    const u = this.up(this._u);
    const t = out as FlightTelemetry;
    t.speed = this.speed;
    t.altitude = this.position.y;
    t.headingDeg = headingOf(f);
    t.pitchDeg = Math.asin(clamp(f.y, -1, 1)) / DEG2RAD;
    // Bank from the right vector's drop and whether the aircraft is inverted.
    t.rollDeg = Math.atan2(-r.y, u.y) / DEG2RAD;
    t.alphaDeg = this.air.alpha / DEG2RAD;
    t.betaDeg = this.air.beta / DEG2RAD;
    t.sigmaDeg = this.air.sigma / DEG2RAD;
    t.g = this.g;
    t.climbRate = this.velocity.y;
    t.stall = this.stalled;
    return t;
  }
}

/** Heading of a world direction: 0 = north (-Z), 90 = east (+X). */
export function headingOf(dir: Vector3): number {
  const h = Math.atan2(dir.x, -dir.z) / DEG2RAD;
  return (h + 360) % 360;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
/**
 * α drag vs σ: sin²σ, but past 90° never under a ramp to
 * `PSM.engine.reverseDrag` at 180° (tail first). Up to a Cobra's σ the ramp
 * is below sin²σ, so only flying backwards gains drag.
 */
function alphaDragShape(sigma: number): number {
  const s2 = Math.sin(sigma) ** 2;
  if (sigma <= Math.PI / 2) return s2;
  return Math.max(s2, (PSM.engine.reverseDrag * (sigma - Math.PI / 2)) / (Math.PI / 2));
}

/** Commanded rate as a share of full stick, -1..1. */
function share(rate: number, limit: number) {
  return limit > 1e-6 ? clamp(rate / limit, -1, 1) : 0;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
