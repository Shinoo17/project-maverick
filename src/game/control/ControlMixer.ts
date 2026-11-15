import { MathUtils, Vector3, type Camera } from 'three';
import { DEG2RAD, MOUSE, type FcsMode } from './config';
import { AimController } from './AimController';
import type { ControlAircraft } from './controlAircraft';
import type { ControlState, FlightControls } from './ControlAxes';
import { MouseAim, type AimView } from './MouseAim';

export type InputMode = 'mouse' | 'keyboard';
export type AimLimit = typeof MOUSE.aimLimit;

/**
 * The `ControlState` the aircraft actually flies: keyboard axes and the aim
 * controller arbitrated per axis.
 *
 *   - An axis with keyboard input (held, or still decaying) is 100 % manual.
 *   - Once it is released the aim controller takes it back over
 *     `MOUSE.handbackTime`, so nothing snaps.
 *   - Roll input keeps the aim where it is (a barrel roll ends on the same
 *     heading). Pitch / yaw input drags the aim along with the nose until that
 *     body rate has settled, so the nose never springs back afterwards.
 *   - Roll the controller adds on its own (bank-and-yank) is unwound once the
 *     mouse rests; roll from A / D or from a pure pitch loop is left alone
 *     (see `MOUSE.rollOut`).
 *   - PSM (docs/PSM_SPEC.md §9): with the PSM key held, moving the mouse
 *     turns it into a virtual stick: the cursor's place on the whole screen
 *     rectangle is the stick (centre = 0, edges = full), up / down a pitch
 *     and left / right a yaw rate command, like the keys. The cursor starts
 *     where the aim reticle was, so nothing jumps, and stays where it is put:
 *     flick up and back to centre is a Cobra that holds, hold it up and the
 *     nose keeps going round, pull it down to come back to the flight path.
 *     Until the mouse moves the aim controller keeps flying, in its direct
 *     regime (`psmWeight`, faded in with w so it does nothing where the key
 *     does nothing), so the PSM key alone changes nothing. In RECOVERY the
 *     aim follows the nose and the FCS flies; the mouse takes over again
 *     `RECOVERY_HANDBACK_TIME` after. Roll-out stops counting in PSM /
 *     RECOVERY and starts from zero back in NORMAL.
 *
 * In keyboard mode it is a pass-through of `FlightControls`.
 */
export class ControlMixer implements ControlState {
  readonly aim = new MouseAim();
  readonly autopilot = new AimController();
  mode: InputMode = 'mouse';
  /** `limited` keeps the aim within `MOUSE.coneDeg` of the nose; `free` lets it go anywhere. */
  aimLimit: AimLimit = MOUSE.aimLimit;
  /** 0..1, how far the aim controller is in its PSM direct regime. */
  psmWeight = 0;
  /** 0..1, share of the stick the aim controller has (0 in RECOVERY). */
  aimShare = 1;
  /**
   * PSM virtual stick: cursor position on the screen, -1..1 per axis from
   * centre to edge (x right = nose right, y up = nose up). `active` once the
   * mouse has moved it during this press of the PSM key.
   */
  readonly stick = { x: 0, y: 0, active: false };
  /** Viewport size (px): half of it is full stick travel on each axis. */
  readonly viewport = { w: 1280, h: 720 };
  /** The PSM key is held, so mouse movement drives `stick` instead of the aim. */
  stickMode = false;

  pitch = 0;
  roll = 0;
  yaw = 0;

  /** Manual share per axis, 1 = keyboard only. */
  private readonly manualShare = { pitch: 1, roll: 1, yaw: 1 };
  private pitchSync = false;
  private yawSync = false;
  /** `autoRoll`: body roll (rad) the controller has made since the last manual roll. */
  private readonly rollOut = { weight: 0, autoRoll: 0 };
  /** Roll-out was paused by PSM / RECOVERY; reset it on the way back to NORMAL. */
  private rollOutHeld = false;
  private readonly manual: FlightControls;
  private readonly _nose = new Vector3();
  private readonly _p = new Vector3();

  constructor(manual: FlightControls) {
    this.manual = manual;
  }

  get thrust() {
    return this.manual.thrust;
  }
  get afterburner() {
    return this.manual.afterburner;
  }
  get airbrake() {
    return this.manual.airbrake;
  }
  get psm() {
    return this.manual.psm;
  }

  /**
   * Mouse movement (px): the virtual stick while the PSM key is held, the aim
   * otherwise. `camera` is the view without shake (`ChaseCamera.steady`), so
   * shake never reaches the controls.
   */
  mouseMove(dx: number, dy: number, camera: AimView): void {
    if (!this.stickMode) {
      this.aim.rotate(dx, dy, camera);
      return;
    }
    const st = this.stick;
    if (!st.active) this.anchorStick(camera);
    st.x = MathUtils.clamp(st.x + dx / (this.viewport.w / 2), -1, 1);
    st.y = MathUtils.clamp(st.y + (MOUSE.invertY ? dy : -dy) / (this.viewport.h / 2), -1, 1);
    st.active = true;
  }

  /**
   * Start the virtual stick cursor where the aim reticle is on screen (centre
   * if the aim is behind the camera), so taking the stick does not jump.
   */
  anchorStick(camera: Camera): void {
    // Behind = not in front of the view axis (camera looks down its -Z).
    const behind = this._p.copy(this.aim.dir).transformDirection(camera.matrixWorldInverse).z >= 0;
    const p = this._p.copy(camera.position).add(this.aim.dir).project(camera);
    this.stick.x = behind ? 0 : MathUtils.clamp(p.x, -1, 1);
    this.stick.y = behind ? 0 : MathUtils.clamp(p.y, -1, 1);
  }

  /**
   * Call once per fixed step, after the keyboard axes have been updated.
   * `fcs` is the FCS mode (and w on the high-speed side) from the last step.
   */
  step(fm: ControlAircraft, dt: number, fcs: { mode: FcsMode; wHigh: number } = NORMAL_FCS): void {
    const m = this.manual;
    const nose = fm.forward(this._nose);
    const recovering = fcs.mode === 'RECOVERY';
    const psmTarget = fcs.mode === 'ARMED' || fcs.mode === 'PSM' ? fcs.wHigh : 0;
    this.psmWeight = approach(this.psmWeight, psmTarget, dt / PSM_BLEND_TIME);
    this.aimShare = recovering ? 0 : approach(this.aimShare, 1, dt / RECOVERY_HANDBACK_TIME);
    this.stickMode = this.mode === 'mouse' && m.psm;
    if (!this.stickMode) this.resetStick();

    if (this.mode === 'keyboard') {
      this.aim.syncTo(nose);
      this.autopilot.reset();
      this.manualShare.pitch = this.manualShare.roll = this.manualShare.yaw = 1;
      this.pitch = m.pitch;
      this.roll = m.roll;
      this.yaw = m.yaw;
      return;
    }

    const settle = MOUSE.syncRateDeg * DEG2RAD;
    this.pitchSync = m.pitchAxis.active || (this.pitchSync && Math.abs(fm.rates.x) > settle);
    this.yawSync = m.yawAxis.active || (this.yawSync && Math.abs(fm.rates.y) > settle);
    this.aim.idle += dt;
    // RECOVERY and the virtual stick: the aim rides on the nose, so it does
    // not fight the FCS and is where the nose is when the mouse aims again.
    if (this.pitchSync || this.yawSync || recovering || this.stick.active) this.aim.syncTo(nose);
    if (this.aimLimit === 'limited') this.aim.clampToCone(nose);

    // Roll made by hand is the player's; only the controller's own roll is unwound.
    const ro = this.rollOut;
    const R = MOUSE.rollOut;
    if (fcs.mode === 'PSM' || recovering) {
      this.rollOutHeld = true;
      ro.weight = 0;
    } else {
      if (fcs.mode === 'NORMAL' && this.rollOutHeld) {
        this.rollOutHeld = false;
        ro.autoRoll = 0;
      }
      ro.autoRoll = m.rollAxis.active ? 0 : wrapPi(ro.autoRoll + fm.rates.z * dt);
      ro.weight =
        R.enabled && !m.rollAxis.active ? MathUtils.smoothstep(this.aim.idle, R.idleTime, R.idleTime + 0.3) : 0;
    }

    const ap = this.autopilot;
    ap.update(fm, this.aim.dir, ro, this.psmWeight);
    let apPitch = ap.pitch;
    let apRoll = ap.roll;
    let apYaw = ap.yaw;
    if (this.stick.active) {
      // Virtual stick: dead zone at centre, then a curve for fine control near it.
      apPitch = shapeStick(this.stick.y);
      apYaw = shapeStick(this.stick.x);
      apRoll = 0;
    }

    const fade = dt / MOUSE.handbackTime;
    const s = this.manualShare;
    s.pitch = m.pitchAxis.active ? 1 : Math.max(0, s.pitch - fade);
    s.roll = m.rollAxis.active ? 1 : Math.max(0, s.roll - fade);
    s.yaw = m.yawAxis.active ? 1 : Math.max(0, s.yaw - fade);
    const a = this.aimShare;
    this.pitch = s.pitch * m.pitch + (1 - s.pitch) * a * apPitch;
    this.roll = s.roll * m.roll + (1 - s.roll) * a * apRoll;
    this.yaw = s.yaw * m.yaw + (1 - s.yaw) * a * apYaw;
  }

  private resetStick(): void {
    this.stick.x = this.stick.y = 0;
    this.stick.active = false;
  }

  /** Aim on the nose, no pending hand-back. Call on spawn and on mode switches. */
  reset(fm: ControlAircraft): void {
    this.aim.syncTo(fm.forward(this._nose));
    this.autopilot.reset();
    this.manualShare.pitch = this.manualShare.roll = this.manualShare.yaw = this.mode === 'keyboard' ? 1 : 0;
    this.pitchSync = this.yawSync = false;
    this.rollOut.weight = 0;
    this.rollOut.autoRoll = 0;
    this.rollOutHeld = false;
    this.psmWeight = 0;
    this.aimShare = 1;
    this.stickMode = false;
    this.resetStick();
    this.pitch = this.roll = this.yaw = 0;
  }
}

const NORMAL_FCS = { mode: 'NORMAL' as FcsMode, wHigh: 0 };
/** Seconds for the aim controller to blend into / out of its PSM direct regime. */
const PSM_BLEND_TIME = 0.25;
/** The example's `PSM.recovery.handbackTime`: seconds for the mouse to take back over after RECOVERY. */
const RECOVERY_HANDBACK_TIME = 0.4;

/** One virtual stick axis (-1..1) through the dead zone and response curve. */
function shapeStick(v: number): number {
  const S = MOUSE.psmStick;
  const a = Math.abs(v);
  if (a <= S.deadzone) return 0;
  return Math.sign(v) * Math.pow(Math.min((a - S.deadzone) / (1 - S.deadzone), 1), S.curve);
}

function approach(v: number, target: number, step: number) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
