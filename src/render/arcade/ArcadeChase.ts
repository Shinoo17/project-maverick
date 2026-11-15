import * as THREE from 'three';
import { CAMERA, CRUISE_SPEED, type FcsMode } from '../../game/control/config';

export type CameraMode = 'aircraft' | 'horizon' | 'aim';

/** Order the camera key cycles through. */
export const CAMERA_MODES: readonly CameraMode[] = ['aircraft', 'horizon', 'aim'];

export const CAMERA_MODE_LABEL: Record<CameraMode, string> = {
  aircraft: 'Aircraft lock',
  horizon: 'Horizon lock',
  aim: 'Aim lock',
};

/** How fast Aim lock settles onto a gun lock and back off it (1/s): most of the way in a second. At 8 the view snapped level. */
const GUN_LOCK_VIEW_RATE = 3;

export interface ChaseTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed: number;
  afterburner: number;
  airbrake: number;
  g: number;
  /** Mouse aim direction and flight path (world, unit); used by Aim Lock. */
  aim?: THREE.Vector3;
  pathDir?: THREE.Vector3;
  /** Where RECOVERY is turning the nose (world, unit); only while in RECOVERY. */
  recoveryDir?: THREE.Vector3;
  /** What the FCS is doing (`CAMERA.psmEntry`); none = NORMAL. */
  fcsMode?: FcsMode;
  /** Wreck view: pull far back and look down at the impact point. */
  crashed?: boolean;
  /**
   * This project's gun lock holds (game/combat/gunLock.ts; not in the example). Aim lock then looks
   * straight along the aim, which the lock keeps on the lead, with its horizon level: the target
   * holds still and upright on screen whatever the jet's roll.
   */
  gunLock?: boolean;
}

/**
 * The chase view without the shake: same place and projection, steady axes.
 * Whatever steers or aims by the view (mouse aim, virtual stick, weapons to
 * come) uses this one, so shake is only ever in the picture.
 */
export class SteadyCamera extends THREE.PerspectiveCamera {
  /** FOV from speed alone, without the acceleration kick (deg): see `MOUSE.fovSensitivity`. */
  speedFov = CAMERA.fovBase;
}

/**
 * Aircraft length (m) the chase offsets in `CAMERA` are for: the game scales
 * them by length / this (`ChaseCamera.sizeScale`), so in the camera's own
 * units every jet is this long.
 */
export const CHASE_JET_LENGTH = 19.5;

const BODY_FWD = new THREE.Vector3(0, 0, 1);
const BODY_UP = new THREE.Vector3(0, 1, 0);
const BODY_LEFT = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Camera looks down its -Z; the rig's forward is +Z, so turn the camera around. */
const ROLL = new THREE.Quaternion();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/**
 * Third-person chase camera.
 *
 * A "rig" orientation chases a target orientation with exponential lag:
 *   - Aircraft Lock: target = aircraft attitude (camera pitches, rolls, goes inverted)
 *   - Horizon Lock: target = aircraft heading/pitch on a level horizon, plus a
 *     little of the bank, so the horizon stays mostly level.
 *   - Aim Lock: like Horizon Lock, but looking along the mouse aim blended
 *     with the flight path, so the view leads into the turn and shows what
 *     the aircraft is about to fly into.
 * Past the normal α range (post-stall manoeuvres) every mode turns its look
 * direction from the nose toward the flight path (`CAMERA.psmBlendDeg`), so
 * a Cobra is seen as the jet standing up in front of a camera that keeps
 * flying along, not as the horizon swinging away. That path is the camera's
 * own (`CAMERA.psmPath`): it chases the real one, gently at low speed, eases
 * to the horizon in a tail-slide and leads toward the RECOVERY target.
 * While the FCS lets the jet leave the normal α range the view lets go of
 * the nose sooner, by where σ is heading, and takes it back later
 * (`CAMERA.psmEntry`), so it does not nod after a nose that snaps up and
 * back; and with the jet standing across the view the camera drops and
 * backs off to keep all of it in the picture (`CAMERA.psmFrame`). A nose
 * that has been right round and swings up to the path from below (the end
 * of a Kulbit) carries the jet down to the bottom of the picture, and the
 * camera catches up a little late (`CAMERA.psmDip`).
 * The camera sits behind and above the aircraft in rig space, looking along
 * the rig forward, which keeps the jet in the lower half of the screen with
 * its nose pointing at screen centre. Position lag is applied to the offset
 * only (not the absolute position) so it never falls behind at 400 m/s.
 *
 * Horizon and Aim Lock level the view with an up vector of the camera's own,
 * carried from update to update (`CAMERA.horizonUp`), so the view never rolls
 * just because it passed through the vertical: a loop is flown with no camera
 * roll at all, and the mouse, which steers in the camera's axes, keeps its
 * direction all the way round.
 *
 * Free look orbits the camera around the jet on top of any mode and eases
 * back once released. Over terrain the camera is kept clear of the ground
 * (`CAMERA.groundClearance`) by lifting it, never by turning it.
 *
 * Acceleration is shown by moving the camera, not turning it: it rides on a
 * spring (`CAMERA.accelSpring`), left behind as the jet speeds up and lifted
 * as it pulls g, and the FOV kicks with it (`CAMERA.fovKick`). Shake
 * (`CAMERA.shake`) does turn the view, by a fraction of a degree, but only
 * `camera`, the picture; `steady` is the same view without it, for the mouse.
 */
export class ArcadeChase {
  /** The view that is drawn (and that the HUD projects through), shake included. */
  readonly camera: THREE.PerspectiveCamera;
  /** The same view without shake: what the mouse aim and the virtual stick use. */
  readonly steady: SteadyCamera;
  mode: CameraMode = 'aircraft';
  /** While true, `look()` deltas hold; when false the look offset eases back to 0. */
  freeLookActive = false;
  private readonly rig = new THREE.Quaternion();
  private readonly offset = new THREE.Vector3();
  private distance = CAMERA.distance;
  /** FOV from speed (deg) and the kick from acceleration on top of it. */
  private speedFov = CAMERA.fovBase;
  private fovKick = 0;
  private time = 0;
  /** Speed at the last update, to take its change from. */
  private lastSpeed = 0;
  /** Low-passed change of speed (m/s²) and load factor (game g). */
  private accel = 0;
  private gLoad = 1;
  /** `accel` as the camera shows it: slowing faded out past the normal α range. */
  private along = 0;
  /** Spring offsets in view axes (m, at size scale 1): `surge` back from the jet, `heave` up. */
  private readonly surge = { x: 0, v: 0, to: 0 };
  private readonly heave = { x: 0, v: 0, to: 0 };
  /** Shake in use: peak angle per axis (deg). */
  private shakeDeg = 0;
  private needsSnap = true;
  private lookYaw = 0;
  private lookPitch = 0;
  private readonly view = new THREE.Quaternion();
  private readonly _lq = new THREE.Quaternion();
  private readonly _q = new THREE.Quaternion();
  private readonly _v = new THREE.Vector3();
  private readonly _f = new THREE.Vector3();
  private readonly _u = new THREE.Vector3();
  private readonly _x = new THREE.Vector3();
  private readonly _m = new THREE.Matrix4();
  private readonly _a = new THREE.Vector3();
  private readonly _r = new THREE.Quaternion();
  private readonly _t = new THREE.Quaternion();
  private readonly _g = new THREE.Vector3();
  private readonly _h = new THREE.Vector3();
  /** The camera's flight path (world, unit), see `CAMERA.psmPath`. */
  private readonly path = new THREE.Vector3(0, 0, 1);
  /** 0..1, how far the camera path leads toward the RECOVERY target. */
  private lead = 0;
  /** 0..1, the σ blend in use: `psmBlend`, rate-limited at low speed. */
  private shown = 0;
  /** Gun lock eased in and out, 0..1 (`ChaseTarget.gunLock`). */
  private lockShare = 0;
  /** Speed (1/s) `shown` is changing at: it is eased, so the view is not jerked off the nose or back onto it. */
  private shownRate = 0;
  /** The blend `shown` was last heading for. */
  private shownTo = 0;
  /** σ (deg) at the last update, and its low-passed rate of change (deg/s). */
  private sigma = 0;
  private sigmaRate = 0;
  /** 0..1, how far σ may be read ahead by that rate: `engaged`, less at low speed. */
  private reach = 0;
  /** 0..1, how far the σ blend has gone over to its post-stall range (`CAMERA.psmEntry`). */
  private engaged = 0;
  /** Spring: the view turned back toward the nose (deg) as it snaps away, the bump of `CAMERA.psmEntry.bump`. */
  private readonly kick = { x: 0, v: 0, to: 0 };
  private readonly _n = new THREE.Vector3();
  private readonly _s = { x: 0, v: 0, to: 0 };
  /** 0..1 on a spring: how far the camera has moved to its post-stall place (`CAMERA.psmFrame`). */
  private readonly frame = { x: 0, v: 0, to: 0 };
  /** α (rad, signed: under 0 = nose below the flight path) at the last update, and its low-passed rate (deg/s). */
  private alpha = 0;
  private alphaRate = 0;
  /** 0..1, how far round the nose has been lately (`CAMERA.psmDip.deepDeg`). */
  private deep = 0;
  /** Spring: camera above its place (m), the jet that far down the picture (`CAMERA.psmDip`). */
  private readonly dip = { x: 0, v: 0, to: 0 };
  /**
   * Horizon / Aim lock: the camera's own up (world, unit, at right angles to
   * the look direction), before the bank tilt. See `CAMERA.horizonUp`.
   */
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** The level horizon that up is held to: +1 upright, -1 upside down (after going over the top). */
  private upSign = 1;
  /**
   * Upside down with the aircraft the same way up: the up rolls with the
   * aircraft, so rolling the jet upright brings the horizon back with it.
   */
  private glued = false;
  /** Angle (rad) from the up to the aircraft's up at the end of the last update; null when there was none. */
  private lastBank: number | null = null;
  /** The up was just taken from the rig (camera mode switched): upside down, roll upright without waiting. */
  private fromRig = false;
  /** Upside down and not with the aircraft: seconds the view has been calm, and seconds it has been rolling upright (-1 = not). */
  private calm = 0;
  private righting = -1;
  /** Way round the roll upright goes, once started. */
  private rightDir = 0;
  /** Bank tilt (rad) of the last update; null when there was none (snap, aircraft lock). */
  private tilt: number | null = null;
  /** Look direction of the last update, for the view's turn rate. */
  private readonly lastLook = new THREE.Vector3(0, 0, 1);
  private readonly _l = new THREE.Vector3();
  private readonly _c = new THREE.Vector3();

  /**
   * Terrain height under a world point, set by the game. With it the camera
   * stays `CAMERA.groundClearance` above the ground under itself.
   */
  ground: ((x: number, z: number) => number) | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovBase, aspect, CAMERA.near, CAMERA.far);
    this.steady = new SteadyCamera(CAMERA.fovBase, aspect, CAMERA.near, CAMERA.far);
  }

  /** Scale the chase distance to the aircraft (configured for ~19 m jets). */
  sizeScale = 1;

  snap() {
    this.needsSnap = true;
    this.lockShare = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  /** Next mode in `CAMERA_MODES`. */
  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  /**
   * Free look held from outside (FlightInput keeps the look angles): yaw > 0 turns the view
   * left, pitch > 0 tilts it down, as `look` builds them. Call with `active` false to let
   * the look ease home.
   */
  setLook(yaw: number, pitch: number, active: boolean) {
    this.freeLookActive = active;
    if (!active) return;
    this.lookYaw = wrapPi(yaw);
    this.lookPitch = pitch;
  }

  /** True while the view is turned off the chase shot, including while it eases back. */
  get lookingAway(): boolean {
    return this.lookYaw !== 0 || this.lookPitch !== 0;
  }

  /** Free look: orbit by a mouse delta in pixels. */
  look(dx: number, dy: number) {
    const k = THREE.MathUtils.degToRad(CAMERA.freeLookDegPerPx);
    const maxPitch = THREE.MathUtils.degToRad(CAMERA.freeLookMaxPitchDeg);
    // Rig +Y turns the view left, rig +X tilts it down: mouse right / up = look right / up.
    this.lookYaw = wrapPi(this.lookYaw - dx * k);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dy * k, -maxPitch, maxPitch);
  }

  update(t: ChaseTarget, dt: number) {
    this.time += dt;
    this.lockShare += ((t.gunLock ? 1 : 0) - this.lockShare) * (1 - Math.exp(-GUN_LOCK_VIEW_RATE * dt));
    this.trackPath(t, dt);
    this.feel(t, dt);
    let target: THREE.Quaternion;
    let rate: number;
    let limitTurn: boolean;
    switch (this.mode) {
      case 'aircraft':
        target = this.aircraftTarget(t);
        rate = CAMERA.lockFollowRate;
        limitTurn = false;
        break;
      case 'horizon':
        target = this.horizonTarget(t, dt);
        rate = CAMERA.horizonFollowRate;
        limitTurn = true;
        break;
      case 'aim':
        target = this.aimTarget(t, dt);
        rate = CAMERA.aimFollowRate;
        limitTurn = true;
        break;
      default: {
        const never: never = this.mode;
        throw new Error(`unknown camera mode ${never as string}`);
      }
    }
    // With the spring the distance answers to acceleration (`surge`), not to the keys.
    let wantDist = CAMERA.distance * this.sizeScale;
    if (!CAMERA.accelSpring.enabled) {
      wantDist += (CAMERA.afterburnerPullback * t.afterburner + CAMERA.airbrakePullback * t.airbrake) * this.sizeScale;
    }
    if (t.crashed) {
      target = this.crashTarget(t.quaternion);
      rate = 1.5;
      wantDist *= 4;
    }

    if (this.needsSnap) {
      this.rig.copy(target);
      this.distance = wantDist;
      this.offset.set(0, CAMERA.height * this.sizeScale, -wantDist).applyQuaternion(this.rig);
      this.needsSnap = false;
    } else {
      // Exponential follow, but never faster than maxTurnRate, so a fast
      // flick of the aim is a quick pan and not a cut.
      let k = 1 - Math.exp(-rate * dt);
      const angle = this.rig.angleTo(target);
      // Leading round to the RECOVERY target the camera path may turn faster than this cap: let the rig keep up.
      const cap = Math.max(CAMERA.maxTurnRateDeg, THREE.MathUtils.lerp(CAMERA.maxTurnRateDeg, CAMERA.psmPath.leadMaxRateDeg, this.lead));
      const maxStep = THREE.MathUtils.degToRad(cap) * dt;
      if (limitTurn && angle * k > maxStep) k = maxStep / angle;
      this.rig.slerp(target, k);
      this.distance += (wantDist - this.distance) * (1 - Math.exp(-(t.crashed ? 1.2 : CAMERA.distanceRate) * dt));
    }
    // Aircraft lock (and the wreck view) have no up of their own: keep it on
    // the rig, so switching to horizon / aim lock starts from what is shown.
    if (this.mode === 'aircraft' || t.crashed) this.adoptRigUp();

    // Free look orbits on top of the rig; released, it eases home.
    if (!this.freeLookActive || t.crashed) {
      const back = Math.exp(-CAMERA.freeLookReturnRate * dt);
      this.lookYaw = Math.abs(this.lookYaw) < 1e-4 ? 0 : this.lookYaw * back;
      this.lookPitch = Math.abs(this.lookPitch) < 1e-4 ? 0 : this.lookPitch * back;
    }
    const view = this.view.copy(this.rig);
    if (this.lookYaw !== 0 || this.lookPitch !== 0) {
      view.multiply(this._lq.setFromAxisAngle(BODY_UP, this.lookYaw));
      view.multiply(this._lq.setFromAxisAngle(BODY_LEFT, this.lookPitch));
    }

    // The spring offsets are along the view's own axes: the jet moves in the frame, the view does not turn.
    // Post-stall the camera backs off, at the height that puts the tail of a
    // jet standing at right angles to the view on `psmFrame.tail` of the way
    // down the picture, at the FOV its speed gives.
    const F = CAMERA.psmFrame;
    const w = this.frame.x;
    const stand =
      F.tail > 0
        ? F.tail * Math.tan(THREE.MathUtils.degToRad(this.speedFov) / 2) * (CAMERA.distance + F.back) - CHASE_JET_LENGTH / 2
        : CAMERA.height;
    const desired = this._v
      .set(
        0,
        (CAMERA.height + (stand - CAMERA.height) * w + this.heave.x + this.dip.x) * this.sizeScale,
        -this.distance - (this.surge.x + F.back * w) * this.sizeScale,
      )
      .applyQuaternion(view);
    this.offset.lerp(desired, 1 - Math.exp(-CAMERA.positionRate * dt));

    const cam = this.camera;
    const steady = this.steady;
    cam.position.copy(t.position).add(this.offset);
    cam.quaternion.copy(view).multiply(FLIP);
    steady.quaternion.copy(cam.quaternion);

    // Shake: a small turn of the picture alone, a function of time (so the
    // same at any frame rate). `steady` is left without it.
    if (this.shakeDeg > 1e-5) {
      const s = this.time;
      const a = THREE.MathUtils.degToRad(this.shakeDeg) / 2;
      cam.quaternion.multiply(
        this._lq
          .set(
            a * (0.6 * Math.sin(s * 47.1) + 0.4 * Math.sin(s * 71.3 + 1.3)),
            a * (0.6 * Math.sin(s * 53.7 + 2.1) + 0.4 * Math.sin(s * 83.9)),
            a * (0.6 * Math.sin(s * 39.3 + 0.7) + 0.4 * Math.sin(s * 61.1 + 4.2)) * CAMERA.shake.roll,
            1,
          )
          .normalize(),
      );
    }

    // Terrain: lift the camera off the ground under it. Only its height
    // changes, so the view axes (and the mouse aim that uses them) do not.
    if (this.ground) {
      const G = CAMERA.groundClearance;
      const h = cam.position.y - this.ground(cam.position.x, cam.position.z);
      if (h < G.soft) cam.position.y += softFloor(h, G.min, G.soft) - h;
    }
    steady.position.copy(cam.position);

    // Dynamic FOV: wider with speed, plus a kick while the speed is changing.
    const K = CAMERA.fovKick;
    const kf = 1 - Math.exp(-CAMERA.fovRate * dt);
    const wantSpeedFov = tableValue(CAMERA.fovSpeed, t.speed) + CAMERA.fovAfterburnerGain * t.afterburner;
    this.speedFov += (wantSpeedFov - this.speedFov) * kf;
    this.fovKick += (softLimit(K.gain * this.along, K.narrow, K.widen) - this.fovKick) * kf;
    const fov = this.speedFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    steady.fov = cam.fov;
    steady.speedFov = this.speedFov;
    steady.aspect = cam.aspect;
    steady.projectionMatrix.copy(cam.projectionMatrix);
    steady.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    steady.updateMatrixWorld();
  }

  /**
   * What the camera shows of the forces on the jet, each low-passed first
   * (they change per physics step, the camera runs per frame): the spring
   * offsets (`CAMERA.accelSpring`), the acceleration the FOV kick uses, and
   * the shake amplitude (`CAMERA.shake`). The two spring channels use
   * different quantities on purpose: the change of speed in m/s² along the
   * view, the HUD's load factor (game g) up it.
   */
  private feel(t: ChaseTarget, dt: number): void {
    const S = CAMERA.accelSpring;
    const K = CAMERA.shake;
    const sm = THREE.MathUtils.smoothstep;
    if (this.needsSnap) {
      this.accel = this.along = 0;
      this.gLoad = 1;
      this.surge.x = this.surge.v = this.surge.to = 0;
      this.heave.x = this.heave.v = this.heave.to = 0;
      this.frame.x = this.frame.v = this.frame.to = 0;
      this.dip.x = this.dip.v = this.dip.to = 0;
      this.alpha = this.alphaRate = this.deep = 0;
      this.shakeDeg = 0;
      this.fovKick = 0;
      this.lastSpeed = t.speed;
      return;
    }
    if (dt <= 0) return;
    const k = 1 - Math.exp(-S.accelRate * dt);
    const flying = !t.crashed;
    const raw = flying ? THREE.MathUtils.clamp((t.speed - this.lastSpeed) / dt, -S.accelMax, S.accelMax) : 0;
    this.lastSpeed = t.speed;
    this.accel += (raw - this.accel) * k;
    this.gLoad += ((flying ? t.g : 1) - this.gLoad) * k;
    // σ: nose off the flight path (deg). Past the normal α range the jet is
    // slowed by α drag, which is not shown as the camera closing in.
    // α: the same in the jet's pitch plane, signed (under 0 = nose below the path).
    let sigma = 0;
    let alpha = 0;
    if (t.pathDir) {
      const ahead = this._h.copy(BODY_FWD).applyQuaternion(t.quaternion).dot(t.pathDir);
      sigma = THREE.MathUtils.radToDeg(this._h.angleTo(t.pathDir));
      alpha = Math.atan2(-this._h.copy(BODY_UP).applyQuaternion(t.quaternion).dot(t.pathDir), ahead);
    }
    this.along = this.accel < 0 ? this.accel * (1 - sm(sigma, S.postStallDeg[0], S.postStallDeg[1])) : this.accel;

    // The end of a Kulbit: the nose has been right round and comes up to the
    // path from below. The framing lets go early and the camera is left
    // above its place for a moment (the jet swings down to the bottom of the
    // picture), coming back on a soft spring, later than the jet does.
    const D = CAMERA.psmDip;
    const rad = THREE.MathUtils.degToRad;
    const turning = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(wrapPi(alpha - this.alpha)) / dt, -D.maxRateDeg, D.maxRateDeg);
    this.alpha = alpha;
    this.alphaRate += (turning - this.alphaRate) * (1 - Math.exp(-D.rateSmoothing * dt));
    const round = sm(sigma, D.deepDeg[0], D.deepDeg[1]);
    // Kept until the nose is home on the path again: the whole way round counts, not how far it is now.
    if (round > this.deep) this.deep = round;
    else if (sigma < D.homeDeg) this.deep = approach(this.deep, 0, D.fadeRate * dt);
    // Coming up from below: α under 0 and rising, the jet flying fast enough for its path to mean something.
    const rising = sm(this.alphaRate, D.rateDeg[0], D.rateDeg[1]) * sm(t.speed, CAMERA.psmPath.trackSpeed[0], CAMERA.psmPath.trackSpeed[1]);
    const closing = D.enabled && flying && alpha < 0 ? this.deep * rising * sm(alpha, rad(D.alphaDeg[0]), rad(D.alphaDeg[1])) : 0;
    // Down the picture as fast as the jet swings, back up slower: that is the lag.
    const low = closing * D.height * sm(-alpha, 0, rad(D.easeDeg));
    const down = low > this.dip.x;
    dampedStep(this.dip, low, down ? D.omega : D.returnOmega, down ? D.damping : D.returnDamping, dt);
    settle(this.dip);

    // Post-stall the jet stands across the view, as far as the view has left
    // the nose for the path. σ is read ahead as for the blend (further: the
    // camera takes longer to get there than the view to turn), so it is on
    // its way before the tail swings down out of the picture.
    const F = CAMERA.psmFrame;
    const ahead = sigma + this.reach * F.leadTime * Math.max(0, this.sigmaRate);
    const across = Math.max(this.shown, this.reach) * sm(ahead, F.sigmaDeg[0], F.sigmaDeg[1]) * (1 - closing);
    // Out fast enough to keep the tail in the picture, back slowly: nothing is lost by a camera that takes its time coming home.
    const frame = F.enabled && flying ? across : 0;
    const out = frame > this.frame.x;
    dampedStep(this.frame, frame, out ? F.omega : F.returnOmega, out ? F.damping : F.returnDamping, dt);
    settle(this.frame);

    const on = S.enabled && flying;
    springStep(this.surge, on ? softLimit(S.surgeGain * this.along, S.surgeIn, S.surgeBack) : 0, S.omega, dt);
    // There the load is not the wing's any more: the place in the frame is the framing's, not the pull's.
    springStep(this.heave, on ? softLimit(S.heaveGain * (this.gLoad - 1), S.heaveDown, S.heaveUp) * (1 - this.frame.to) : 0, S.omega, dt);

    let shake = 0;
    if (flying && K.amount > 0) {
      const q = Math.min(1, t.speed / CRUISE_SPEED);
      shake =
        K.afterburner * t.afterburner +
        K.g * sm(this.gLoad, K.gRange[0], K.gRange[1]) +
        K.buffet * sm(sigma, K.buffetDeg[0], K.buffetDeg[1]) * q * q;
      if (this.ground) {
        const h = t.position.y - this.ground(t.position.x, t.position.z);
        shake += K.low * (1 - sm(h, K.lowAlt[0], K.lowAlt[1])) * q;
      }
      shake = softLimit(shake * K.amount, 0, K.maxDeg);
    }
    this.shakeDeg += (shake - this.shakeDeg) * (1 - Math.exp(-K.rate * dt));
  }

  /** Aircraft attitude, its nose turned toward the flight path at high σ. */
  private aircraftTarget(t: ChaseTarget): THREE.Quaternion {
    const f = this._f.copy(BODY_FWD).applyQuaternion(t.quaternion);
    const turn = this.towardPath(f, t, this.shown);
    this._t.copy(turn).multiply(t.quaternion);
    if (this.kick.x <= 0) return this._t;
    f.applyQuaternion(turn);
    return this._t.premultiply(this.towardNose(f, t));
  }

  /** Horizon-stabilised orientation: the aircraft's forward on a level basis. */
  private horizonTarget(t: ChaseTarget, dt: number): THREE.Quaternion {
    const f = this._f.copy(BODY_FWD).applyQuaternion(t.quaternion);
    f.applyQuaternion(this.towardPath(f, t, this.shown));
    if (this.kick.x > 0) f.applyQuaternion(this.towardNose(f, t));
    return this.levelBasis(t.quaternion, CAMERA.horizonBankFollowDeg, dt);
  }

  /**
   * Share of the way from the nose to the flight path the view turns, for the
   * nose `sigma` deg off it: 0 in normal flight. `engaged` (0..1) moves the
   * range from `psmBlendDeg` to the post-stall one and lets σ be read `lead`
   * s ahead (`CAMERA.psmEntry`); both 0 = `psmBlendDeg` on σ as it is.
   */
  private psmBlend(sigma: number, engaged: number, lead: number): number {
    const E = CAMERA.psmEntry;
    const [a, b] = CAMERA.psmBlendDeg;
    const lerp = THREE.MathUtils.lerp;
    const ahead = sigma + lead * Math.max(0, this.sigmaRate);
    return THREE.MathUtils.smoothstep(ahead, lerp(a, E.blendDeg[0], engaged), lerp(b, E.blendDeg[1], engaged)) * CAMERA.psmVelocityBlend;
  }

  /**
   * Rotation turning `dir` toward `to` (the camera path by default) by
   * `share` of the angle between them (identity at 0). Straight opposite
   * (tail first) turns about the aircraft's pitch axis.
   */
  private towardPath(dir: THREE.Vector3, t: ChaseTarget, share: number, to = this.path): THREE.Quaternion {
    if (share <= 0 || !t.pathDir) return this._r.identity();
    const axis = this._a.crossVectors(dir, to);
    if (axis.lengthSq() < 1e-10) axis.copy(BODY_LEFT).applyQuaternion(t.quaternion);
    axis.normalize();
    return this._r.setFromAxisAngle(axis, dir.angleTo(to) * share);
  }

  /** Rotation turning the view direction `dir` back toward the nose by the bump in progress (`kick`), never past it. */
  private towardNose(dir: THREE.Vector3, t: ChaseTarget): THREE.Quaternion {
    const nose = this._n.copy(BODY_FWD).applyQuaternion(t.quaternion);
    const off = dir.angleTo(nose);
    return this.towardPath(dir, t, off > 1e-6 ? Math.min(1, THREE.MathUtils.degToRad(this.kick.x) / off) : 0, nose);
  }

  /**
   * Move the camera path (`CAMERA.psmPath`) toward the flight path, or in
   * RECOVERY toward where the nose is being turned, then at low speed toward
   * the horizon. The horizon easing acts only as far as the view is turned
   * onto the camera path (the σ blend), so it never moves unseen.
   */
  private trackPath(t: ChaseTarget, dt: number): void {
    if (!t.pathDir) return;
    const P = CAMERA.psmPath;
    const path = this.path;
    const sm = THREE.MathUtils.smoothstep;
    const deg = THREE.MathUtils.degToRad;
    const E = CAMERA.psmEntry;
    const sigma = THREE.MathUtils.radToDeg(this._h.copy(BODY_FWD).applyQuaternion(t.quaternion).angleTo(t.pathDir));
    // Out of NORMAL the FCS lets the nose leave the flight path (ARMED), has
    // let it (PSM) or is bringing it back (RECOVERY).
    const free = E.enabled && t.fcsMode !== undefined && t.fcsMode !== 'NORMAL' && !t.crashed;
    if (this.needsSnap) {
      path.copy(t.pathDir);
      this.lead = 0;
      this.sigma = sigma;
      this.sigmaRate = 0;
      this.engaged = free ? 1 : 0;
      this.reach = 0;
      this.kick.x = this.kick.v = this.kick.to = 0;
      this.shown = this.shownTo = this.psmBlend(sigma, this.engaged, 0);
      this.shownRate = 0;
      return;
    }
    // A near-zero velocity swings σ round faster than the nose moves: the
    // view only turns with it as fast as `blendRate` allows down there, and
    // σ is not read ahead.
    const track = sm(t.speed, P.trackSpeed[0], P.trackSpeed[1]);
    if (dt > 0) {
      const raw = THREE.MathUtils.clamp((sigma - this.sigma) / dt, -E.maxRateDeg, E.maxRateDeg);
      this.sigmaRate += (raw - this.sigmaRate) * (1 - Math.exp(-E.rateSmoothing * dt));
      this.sigma = sigma;
    }
    this.engaged = approach(this.engaged, free ? 1 : 0, (free ? E.engageRate : E.disengageRate) * dt);
    this.reach = this.engaged * track;
    let blend = this.psmBlend(sigma, this.engaged, this.reach * E.leadTime);
    const rate = THREE.MathUtils.lerp(P.blendRate[0], P.blendRate[1], track);
    if (E.enabled) {
      // Back to the nose late: the view stays on the path until the nose is
      // nearly home on it (`releaseDeg`), so a nose that falls back through
      // the flight path is met there, not gone after and brought back.
      const lerp = THREE.MathUtils.lerp;
      const [a, b] = CAMERA.psmBlendDeg;
      const kept = sm(sigma, lerp(a, E.releaseDeg[0], this.engaged), lerp(b, E.releaseDeg[1], this.engaged)) * CAMERA.psmVelocityBlend;
      if (blend < this.shown) blend = Math.max(blend, Math.min(this.shown, kept));
      // Eased both ways (a spring, quicker off the nose than back to it): a
      // blend that starts moving at full rate jerks the view. `blendRate`
      // still bounds it at low speed.
      const last = this.shown;
      const s = this._s;
      s.x = last;
      s.v = this.shownRate;
      s.to = this.shownTo;
      springStep(s, blend, blend > last ? E.riseOmega : E.releaseOmega, dt);
      const step = THREE.MathUtils.clamp(s.x - last, -rate * dt, rate * dt);
      this.shown = THREE.MathUtils.clamp(last + step, 0, 1);
      this.shownRate = dt > 0 && step === s.x - last && this.shown === last + step ? s.v : dt > 0 ? (this.shown - last) / dt : 0;
      this.shownTo = blend;
      if (blend === 0 && this.shown < 1e-6 && Math.abs(this.shownRate) < 1e-6) this.shown = this.shownRate = 0;
    } else {
      this.shown = approach(this.shown, blend, rate * dt);
    }
    const shown = this.shown;
    // The bump: as the nose snaps away the view goes after it for a moment,
    // and is pressed back onto the path as the jet stands up.
    const B = E.bump;
    const ahead = sigma + this.reach * E.leadTime * Math.max(0, this.sigmaRate);
    const snapping = this.reach * sm(this.sigmaRate, B.rateDeg[0], B.rateDeg[1]) * sm(ahead, E.blendDeg[0], E.blendDeg[1]);
    dampedStep(this.kick, E.enabled ? B.deg * snapping * (1 - sm(sigma, B.fadeDeg[0], B.fadeDeg[1])) : 0, B.omega, B.damping, dt);
    settle(this.kick);
    const leading = t.recoveryDir !== undefined;
    this.lead = approach(this.lead, leading ? 1 : 0, (leading ? P.leadIn : P.leadOut) * dt);
    const goal = this._g.copy(t.recoveryDir ?? t.pathDir);
    const w = Math.max(track, this.lead);
    const ang = path.angleTo(goal);
    const back = THREE.MathUtils.lerp(1 - 0.8 * sm(ang, deg(90), deg(150)), 1, 0.75 * this.lead);
    const k = w * back;
    // Leading to the RECOVERY target (after a flip that is ~180° round) it may turn faster.
    const maxRate = THREE.MathUtils.lerp(P.maxRateDeg, P.leadMaxRateDeg, this.lead);
    this.turnPath(goal, Math.min(ang * (1 - Math.exp(-P.rate * k * dt)), deg(maxRate) * k * dt));

    const low = (1 - sm(t.speed, P.horizonSpeed[0], P.horizonSpeed[1])) * (1 - this.lead) * shown;
    if (low > 0) {
      // The path's heading, or the camera's when the path is vertical.
      const h = this._h.set(path.x, 0, path.z);
      if (h.lengthSq() < 1e-4) h.set(0, 0, 1).applyQuaternion(this.rig).setY(0);
      if (h.lengthSq() > 1e-8) {
        h.normalize();
        const a = path.angleTo(h);
        this.turnPath(h, Math.min(a * (1 - Math.exp(-P.horizonRate * low * dt)), deg(P.horizonMaxDeg) * low * dt));
      }
    }
  }

  /** Turn the camera path toward `to` by `step` rad (over the camera's left axis when opposite). */
  private turnPath(to: THREE.Vector3, step: number): void {
    if (step <= 1e-7) return;
    const axis = this._a.crossVectors(this.path, to);
    if (axis.lengthSq() < 1e-10) axis.copy(BODY_LEFT).applyQuaternion(this.rig);
    this.path.applyAxisAngle(axis.normalize(), step).normalize();
  }

  /**
   * Aim lock: look along the aim blended with the flight path (aim alone
   * would swing the view too far from where the jet actually goes), then
   * level it like horizon lock.
   */
  private aimTarget(t: ChaseTarget, dt: number): THREE.Quaternion {
    const q = t.quaternion;
    const f = this._f.copy(BODY_FWD).applyQuaternion(q);
    const share = this.shown;
    if (t.aim && t.pathDir) {
      // Slerp, not a vector sum: with aim and path far apart a sum shrinks and flips.
      f.copy(t.aim);
      // Gun lock: the view goes all the way to the aim (the lead).
      f.applyQuaternion(this.towardPath(f, t, (1 - this.aimWeight(t.aim, t.pathDir)) * (1 - this.lockShare), t.pathDir));
    }
    f.applyQuaternion(this.towardPath(f, t, share));
    if (this.kick.x > 0) f.applyQuaternion(this.towardNose(f, t));
    const B = CAMERA.aimBankTilt;
    const about = B.axis === 'aim' && t.aim ? this.tiltAxis(f, t.aim) : undefined;
    switch (B.mode) {
      case 'fixed':
        // Gun lock: none of the bank, so the jet rolling under the view does not tilt the target.
        return this.levelBasis(q, CAMERA.aimBankFollowDeg * (1 - this.lockShare), dt, false, about);
      case 'adaptive': {
        // More of the bank the harder the jet pulls (the load factor is 1 at a snap).
        const pull = THREE.MathUtils.smoothstep(this.gLoad, B.gRange[0], B.gRange[1]);
        return this.levelBasis(q, THREE.MathUtils.lerp(B.minDeg, B.maxDeg, pull) * (1 - this.lockShare), dt, true, about);
      }
      default: {
        const never: never = B.mode;
        throw new Error(`unknown CAMERA.aimBankTilt.mode ${never as string}`);
      }
    }
  }

  /**
   * Axis for the bank tilt that keeps the reticle still on screen
   * (`CAMERA.aimBankTilt.axis` 'aim'): the view direction `f` turned toward
   * the aim, all the way while the aim is within `axisMaxDeg` of it.
   */
  private tiltAxis(f: THREE.Vector3, aim: THREE.Vector3): THREE.Vector3 {
    const axis = this._g.copy(f).normalize();
    const turn = this._a.crossVectors(axis, aim);
    // Straight along the view, or straight behind it: nothing to turn toward.
    if (turn.lengthSq() < 1e-10) return axis;
    const max = THREE.MathUtils.degToRad(CAMERA.aimBankTilt.axisMaxDeg);
    return axis.applyAxisAngle(turn.normalize(), Math.min(axis.angleTo(aim), max));
  }

  /** Aim lock: share of the way from the flight path to the aim that the view looks (`CAMERA.aimWeightMode`). */
  private aimWeight(aim: THREE.Vector3, path: THREE.Vector3): number {
    switch (CAMERA.aimWeightMode) {
      case 'fixed':
        return CAMERA.aimLookWeight;
      case 'softZone': {
        const Z = CAMERA.aimSoftZone;
        // θ / R. The share is 1 − (1 − e^−x) / x: x / 2 near the centre, toward 1 far out.
        const x = aim.angleTo(path) / THREE.MathUtils.degToRad(Z.deg);
        return x > 1e-6 ? Math.min(1 + Math.expm1(-x) / x, Z.maxWeight) : 0;
      }
      default: {
        const never: never = CAMERA.aimWeightMode;
        throw new Error(`unknown CAMERA.aimWeightMode ${never as string}`);
      }
    }
  }

  /**
   * Orientation looking along `this._f`, levelled with the camera's own up
   * (`CAMERA.horizonUp`) plus a little of the aircraft bank (`q` supplies the
   * aircraft's up).
   *
   * World up cannot level a view that passes through the vertical: rebuilt
   * from it every update, the basis turns over by 180° as the look direction
   * crosses a pole. So the up is carried instead: each update it is moved the
   * least it must to stay at right angles to the new look direction, which
   * turns it over with the view in a loop and adds no roll of its own. Away
   * from the vertical it is then pulled onto the level horizon while it is
   * the upright one.
   *
   * After going over the top it is upside down, and so is the aircraft: from
   * there it rolls with the aircraft, one for one, until the jet has been
   * rolled back upright, which brings the horizon back with it. Upside down
   * without the aircraft (out of a Split-S the jet is already upright) there
   * is no roll to follow: it holds the upside-down horizon and, once the view
   * is calm, rolls upright by itself, gently.
   *
   * `eased` (`CAMERA.aimBankTilt`, adaptive): the bank tilt does not jump to
   * `bankFollowDeg` × sin(bank) but closes on it at a limited rate, since
   * there the gain itself moves with the load. `about` (world, unit): the
   * tilt rolls the view about this axis instead of its own.
   */
  private levelBasis(q: THREE.Quaternion, bankFollowDeg: number, dt: number, eased = false, about?: THREE.Vector3): THREE.Quaternion {
    const U = CAMERA.horizonUp;
    const f = this._f.normalize();
    const au = this._u.copy(BODY_UP).applyQuaternion(q);
    const up = this.up;
    // Level up for this look direction; its length is how far from vertical the view is.
    const level = this._l.copy(WORLD_UP).addScaledVector(f, -f.y);
    const flat = level.length();
    const hasLevel = flat > 1e-4;
    if (hasLevel) level.divideScalar(flat);

    if (this.needsSnap) {
      if (hasLevel) up.copy(level);
      else up.copy(au).addScaledVector(f, -au.dot(f)).normalize();
      this.upSign = 1;
      this.glued = false;
      this.fromRig = false;
      this.calm = 0;
      this.righting = -1;
      this.tilt = null;
      this.lastBank = null;
      this.lastLook.copy(f);
    } else {
      // Carry the up over to the new look direction.
      up.addScaledVector(f, -up.dot(f));
      if (up.lengthSq() < 1e-8) up.copy(au).addScaledVector(f, -au.dot(f));
      if (up.lengthSq() < 1e-8) up.copy(level);
      up.normalize();
    }
    const turnRate = dt > 0 ? f.angleTo(this.lastLook) / dt : 0;
    this.lastLook.copy(f);

    // No level horizon to hold near the vertical: there the up is only carried.
    const [b0, b1] = CAMERA.verticalBlend;
    const gate = hasLevel ? 1 - THREE.MathUtils.smoothstep(Math.abs(f.y), b0, b1) : 0;
    // The up's own roll in this update (rad), and whether the roll cap holds for it.
    let upStep = 0;
    let capped = true;
    if (hasLevel && dt > 0) {
      const deg = THREE.MathUtils.degToRad;
      const d = up.dot(level);
      // Angle from the up to the aircraft's up: how the jet is banked against the view.
      const bankNow = Math.atan2(this._c.crossVectors(up, au).dot(f), up.dot(au));
      if (this.fromRig) {
        // Camera mode switched while on its back: the player asked for a
        // level horizon, so roll to it now instead of staying with the jet.
        this.fromRig = false;
        if (d < -U.invertedCos) {
          this.upSign = -1;
          this.glued = false;
          this.startRighting(bankNow);
        }
      }
      if (this.righting < 0) {
        // Which way up it is: over on its back once clearly past edge-on
        // (leaving the vertical sideways stays upright), back once upright
        // again. Not judged at the vertical itself, where the level up swings
        // round with the least movement of the view.
        if (gate > 0 && this.upSign > 0 && d < -U.invertedCos) {
          this.upSign = -1;
          this.glued = Math.abs(bankNow) < Math.PI / 2;
        } else if (gate > 0 && this.upSign < 0 && d > Math.cos(deg(U.followUntilDeg))) {
          this.upSign = 1;
          this.glued = false;
        }
        if (this.upSign < 0) {
          // With the aircraft while it is the same way up as the view.
          const [same, other] = U.matchDeg;
          const b = Math.abs(bankNow);
          if (b < deg(same)) this.glued = true;
          else if (b > deg(other)) this.glued = false;
        }
        // Upside down by itself, clear of the vertical and the view at rest: roll upright.
        if (this.upSign < 0 && !this.glued && gate >= U.calmLevel && turnRate < deg(U.calmRateDeg)) this.calm += dt;
        else this.calm = 0;
        if (this.calm >= U.calmTime) this.startRighting(bankNow);
      } else if (gate <= 0 || turnRate > deg(U.abortRateDeg)) {
        // The view is being flown again: settle on whichever horizon is nearer.
        this.righting = -1;
        this.calm = 0;
        this.upSign = d > 0 ? 1 : -1;
      }

      let step: number;
      if (this.upSign < 0 && this.glued && this.righting < 0) {
        // Roll with the aircraft, one for one (the roll it made against the
        // up since the last update), and close what is left between them.
        const rolled = this.lastBank === null ? 0 : wrapPi(bankNow - this.lastBank);
        const rest = wrapPi(bankNow - rolled);
        const a = Math.abs(rest);
        const w = Math.min(U.levelRate * a, Math.sqrt(2 * deg(U.rollAccelDeg) * a), deg(U.maxRollRateDeg));
        step = rolled + Math.sign(rest) * Math.min(w * dt, a);
        capped = false;
      } else {
        const sign = this.righting >= 0 ? 1 : this.upSign;
        // Signed angle about the look direction from the up to the horizon it is held to.
        let e = Math.atan2(this._c.crossVectors(up, level).dot(f) * sign, d * sign);
        let rate = deg(U.maxRollRateDeg);
        if (this.righting >= 0) {
          // Keep to the way round it started (±180° are the same place).
          if (Math.abs(e) > Math.PI / 2 && Math.sign(e) !== this.rightDir) e += this.rightDir * 2 * Math.PI;
          this.righting += dt;
          rate *= THREE.MathUtils.smoothstep(this.righting, 0, U.easeTime);
        }
        // Proportional near the horizon, braking into it, never faster than the cap.
        const a = Math.abs(e);
        const w = Math.min(U.levelRate * a, Math.sqrt(2 * deg(U.rollAccelDeg) * a), rate) * gate;
        step = Math.sign(e) * Math.min(w * dt, a);
        // The cap is on the roll that is seen, bank tilt included: the tilt
        // moves by itself as the aircraft rolls, and by -cos(bank) × its gain
        // for each degree the up turns. The up only gets what is left of it.
        // (An eased tilt is held to the cap where it is applied, below.)
        if (this.tilt !== null && !eased) {
          const gain = deg(bankFollowDeg);
          const byAircraft = gain * Math.sin(bankNow) - this.tilt;
          const k = Math.max(0.5, 1 - gain * Math.cos(bankNow));
          const max = deg(U.maxRollRateDeg) * dt;
          if (step > 0) step = Math.min(step, Math.max(0, (max - byAircraft) / k));
          else step = Math.max(step, Math.min(0, (-max - byAircraft) / k));
        }
        if (this.righting >= 0 && a < 1e-3) {
          this.righting = -1;
          this.calm = 0;
          this.upSign = 1;
        }
      }
      up.applyAxisAngle(f, step);
      upStep = step;
    }

    // Body left (+X) = up × forward.
    const left = this._x.crossVectors(up, f);
    if (left.lengthSq() < 1e-6) return this._q.copy(q);
    left.normalize();
    this._m.makeBasis(left, this._v.crossVectors(f, left).normalize(), f);
    this._q.setFromRotationMatrix(this._m);
    // A little bank-follow keeps it lively without losing the horizon. Signed
    // bank about forward; sin() makes the tilt fade to zero at 180° so it is
    // continuous through inverted (a quaternion slerp would flip sides there).
    const bank = Math.atan2(this._c.crossVectors(up, au).dot(f), up.dot(au));
    let tilt = THREE.MathUtils.degToRad(bankFollowDeg) * Math.sin(bank);
    if (eased && this.tilt !== null) {
      // Toward where it should be, in proportion close by, never faster than
      // its own cap; and with the up's roll never more than the roll cap
      // (which does not hold while the up rolls with the jet).
      const B = CAMERA.aimBankTilt;
      const clamp = THREE.MathUtils.clamp;
      const max = THREE.MathUtils.degToRad(B.maxRateDeg) * dt;
      let d = clamp((tilt - this.tilt) * (1 - Math.exp(-B.followRate * dt)), -max, max);
      if (capped) {
        const all = THREE.MathUtils.degToRad(U.maxRollRateDeg) * dt;
        d = clamp(d, Math.min(0, -all - upStep), Math.max(0, all - upStep));
      }
      tilt = this.tilt + d;
    }
    this.tilt = tilt;
    this.lastBank = bank;
    if (about) return this._q.premultiply(ROLL.setFromAxisAngle(about, tilt));
    return this._q.multiply(ROLL.setFromAxisAngle(BODY_FWD, tilt));
  }

  /** Start rolling upright, the way the aircraft's own up lies (`bank`) so the roll passes through it. */
  private startRighting(bank: number): void {
    this.righting = 0;
    this.calm = 0;
    this.rightDir = Math.abs(Math.sin(bank)) > 0.02 ? Math.sign(bank) : 1;
  }

  /** Take the rig's up as the camera's own, and drop any roll upright in progress. */
  private adoptRigUp(): void {
    this.up.copy(BODY_UP).applyQuaternion(this.rig);
    this.upSign = 1;
    this.glued = false;
    this.fromRig = true;
    this.calm = 0;
    this.righting = -1;
    this.tilt = null;
    this.lastBank = null;
  }

  /** Heading kept, pitched 25° down so the camera rises and looks at the wreck. */
  private crashTarget(q: THREE.Quaternion): THREE.Quaternion {
    const f = this._f.copy(BODY_FWD).applyQuaternion(q);
    const yaw = Math.atan2(f.x, f.z);
    this._q.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(25), yaw, 0, 'YXZ'));
    return this._q;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

/**
 * One step of a critically damped spring (`x`, speed `v`) toward `target`.
 * Exact for a target that holds still; one that moves is taken halfway
 * between the last (`to`) and this one, so a long frame neither leads nor
 * lags a short one.
 */
function springStep(s: { x: number; v: number; to: number }, target: number, omega: number, dt: number): void {
  const mid = (s.to + target) / 2;
  s.to = target;
  const d = s.x - mid;
  const c = (s.v + omega * d) * dt;
  const e = Math.exp(-omega * dt);
  s.x = mid + (d + c) * e;
  s.v = (s.v - omega * c) * e;
}

/**
 * `springStep` with damping `zeta` under 1: the spring runs past its target
 * and comes back (0.6: by a tenth of the way). Exact in the same way.
 */
function dampedStep(s: { x: number; v: number; to: number }, target: number, omega: number, zeta: number, dt: number): void {
  if (zeta >= 1) return springStep(s, target, omega, dt);
  const mid = (s.to + target) / 2;
  s.to = target;
  const d = s.x - mid;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const k = zeta * omega;
  const b = (s.v + k * d) / wd;
  const e = Math.exp(-k * dt);
  const c = Math.cos(wd * dt);
  const n = Math.sin(wd * dt);
  s.x = mid + e * (d * c + b * n);
  s.v = e * ((b * wd - k * d) * c - (d * wd + k * b) * n);
}

/** A spring as good as at rest on a target of 0 is put there, so nothing is left of it. */
function settle(s: { x: number; v: number; to: number }): void {
  if (s.to === 0 && Math.abs(s.x) < 1e-6 && Math.abs(s.v) < 1e-6) s.x = s.v = 0;
}

/** `x` eased into the range -`lo`..`hi`: itself near 0, never past either limit (a limit of 0 shuts that side). */
function softLimit(x: number, lo: number, hi: number): number {
  const limit = x < 0 ? lo : hi;
  return limit > 0 ? limit * Math.tanh(x / limit) : 0;
}

/** Value at `x` of a table of [x, value] points in rising x, joined by straight lines and held past its ends. */
function tableValue(points: readonly (readonly [number, number])[], x: number): number {
  let i = 1;
  while (i < points.length - 1 && x > points[i][0]) i++;
  const a = points[i - 1];
  const b = points[Math.min(i, points.length - 1)];
  if (b[0] <= a[0]) return a[1];
  return a[1] + (b[1] - a[1]) * THREE.MathUtils.clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
}

/**
 * Height above ground the camera is given for a height `h` it would have had:
 * `h` itself from `soft` up, then easing (same slope at `soft`) toward `min`,
 * which it never goes under however far below `h` is. No state, so it cannot
 * jump: it moves no faster than `h` does.
 */
function softFloor(h: number, min: number, soft: number): number {
  if (h >= soft) return h;
  const span = soft - min;
  return min + span * Math.exp((h - soft) / span);
}

function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
