/*
The flight physics' tunable numbers, ported from example/flight-control (src/game/config.ts:
SIM, SPEED_PRESETS.arcade, FLIGHT, PSM, PSM_PROFILES). Values are unchanged; see the example's
docs/PSM_SPEC.md and docs/FLIGHT_SPEED_GUIDE.md for what each one does.

Units are the example's: metres, seconds, m/s. The readout shows km/h as m/s × 3.6, as the
example's HUD does. Radians unless a name says Deg.

Left out: the example's spawn point (the runtime spawns), the realistic speed preset, RENDER,
INPUT, MOUSE and CAMERA (the controls and camera live in src/game/control and src/render/arcade).
*/

const DEG = Math.PI / 180
export const DEG2RAD = DEG

export const SIM = {
  /** Fixed physics step. Rendering interpolates between steps. */
  fixedDt: 1 / 120,
  /** Upper bound on simulated time per rendered frame (tab-switch guard). */
  maxFrameDt: 0.1,
  gravity: 9.81,
};

/** Speed / energy model: the example's 'arcade' preset, its default. */
const SPEED = {
  /** Dry (military power) top speed, m/s. 470 ≈ 1690 km/h ≈ Mach 1.4. */
  milSpeed: 470,
  /** Afterburner top speed, m/s. 640 ≈ 2300 km/h ≈ Mach 1.9. */
  afterburnerSpeed: 640,
  /** Hard clamp (dives). */
  maxSpeed: 700,
  /** Acceleration from W at low speed (m/s²); tapers to 0 at `milSpeed`. */
  dryAccel: 14,
  /** Extra acceleration from afterburner (m/s²); tapers to 0 at `afterburnerSpeed`. */
  afterburnerAccel: 22,
  /**
   * Thrust taper shape: accel × (1 − (v / vmax)^n). High n keeps the
   * acceleration strong until close to top speed; 2 behaves like real drag.
   */
  thrustTaperExp: 8,
  /** Deceleration from S at `milSpeed` (m/s²); weaker when slower. */
  idleDecel: 14,
  /** Above `milSpeed` without AB, speed decays toward it at this rate (1/s × excess). */
  overspeedDrag: 0.06,
  /** Speed lost per second per g above 1 g (m/s per g per s). */
  turnBleed: 1.1,
  /** Pitch rate is limited so load factor stays under this (wider turns when fast). */
  gLimit: 9.5,
  /** Control authority starts dropping above this speed (q-limit). */
  qLimitSpeed: 450,
} as const

export const FLIGHT = {
  /** Spawn speed, and the reference speed for airbrake / FOV scaling. */
  cruiseSpeed: 230,
  /**
   * Speed is held, not targeted: with W / S released thrust balances drag at
   * whatever speed you have. W / S / Shift add or remove energy; climbs,
   * turns and the airbrake take it away and it does not come back by itself.
   */
  ...SPEED,
  /**
   * Arcade body rates would give absurd real g at high speed. Load factor is
   * computed as 1 + gScale * pitchRate * speed / g so a full pull at cruise
   * reads ~8 g, and both the HUD and the turn bleed use that number.
   */
  gScale: 0.26,
  /** Airbrake deceleration at full deployment, scaled by speed/cruise. */
  airbrakeDecel: 42,
  /**
   * Low end of the control-authority fade (see `fullAuthSpeed`). Speed itself
   * is not clamped: it can reach 0 and the velocity can reverse.
   */
  minSpeed: 55,

  /** Max body rates at full stick, deg/s. */
  maxRateDeg: { pitch: 62, roll: 210, yaw: 22 },
  /** How quickly the actual body rate reaches the commanded rate (1/s). */
  rateResponse: { pitch: 6.0, roll: 7.5, yaw: 4.0 },
  /**
   * Control effectiveness vs speed: full authority above `fullAuthSpeed`,
   * fading toward `minAuthority` at `minSpeed`.
   */
  fullAuthSpeed: 160,
  minAuthority: 0.35,
  /** Authority left at `maxSpeed` (q-limit starts at the preset's `qLimitSpeed`). */
  qLimitAuthority: 0.72,

  /**
   * How fast the velocity vector swings toward the nose (1/s). This is the
   * "lift": lower = more drift / slip, higher = on rails. Scaled by
   * effectiveness so slow flight mushes.
   */
  pathAlign: 5.5,
  /** Sideslip decays a bit faster than angle of attack. */
  slipAlign: 6.5,
  /**
   * Fraction of gravity that bends the flight path (the rest is assumed
   * trimmed out). Sets the hands-off sink rate and the level-flight gap
   * between boresight and FPM: ~0.5° at cruise, several degrees when slow.
   */
  gravitySag: 0.6,

  /**
   * Bank-to-turn: a banked aircraft drifts its heading toward the low wing at
   * `bankTurn * g * sin(bank) / speed` rad/s, like the horizontal lift
   * component would, so rolling alone already starts a gentle turn.
   */
  bankTurn: 1.0,

  spawn: {
    altitude: 450,
    /** Spawn point is south of the runway threshold, heading north. */
    position: { x: 0, z: 2600 },
    headingDeg: 0,
  },
};


/**
 * Post-stall manoeuvring and the physics it needs. See docs/PSM_SPEC.md.
 * Every number is a starting point for tuning.
 */
export const PSM = {
  /** Below this airspeed (m/s) the velocity has no usable direction: α, β and pathDir hold their last values. */
  vEpsilon: 0.5,
  /**
   * Above this speed (m/s) velocity integrates as speed along the path plus
   * a turn of the path, exactly like the pre-PSM model; below it as a plain
   * vector, so it can pass through zero and reverse.
   */
  vPolar: 5,

  /** Flight control system (FCS) limiter: a soft wall on α / β, not a clamp in the physics. */
  fcs: {
    /** Normal α limit (deg). */
    alphaLimitDeg: 22,
    /** Normal sideslip limit (deg). Full rudder in normal flight stays near 3–4°. */
    betaLimitDeg: 12,
    /** Allowed α (or β) growth rate per unit of margin to the limit (1/s). */
    limiterGain: 4,
    /** Path capture in PSM: allowed rate of return to the plane flown before the pull per unit of angle left (1/s). */
    captureGain: 3,
    /** That plane follows the flight path in NORMAL, and in ARMED while the pitch rate is under this (deg/s). */
    capturePlaneRateDeg: 5,
  },

  /**
   * How easy PSM is at each speed, w 0..1 (docs/PSM_SPEC.md §6), as
   * [km/h, w] points joined by smoothsteps. Above `wPeakKmh` it opens the α
   * ceiling (wHigh); below it, it only scales the agility boost (wLow).
   */
  wCurveKmh: [
    [250, 0],
    [300, 0.35],
    [400, 0.8],
    [450, 1],
    [550, 1],
    [600, 0.8],
    [700, 0.35],
    [780, 0],
  ] as [number, number][],
  wPeakKmh: 500,

  /** Hybrid recovery after Space is released (§5.3). */
  recovery: {
    /** 1 g stall speed at the α limit (m/s), ≈ 216 km/h; Space released slower than this goes to RECOVERY. */
    stallSpeed: 60,
    /** RECOVERY ends once |α| and |β| are this far (deg) inside their limits... */
    exitMarginDeg: 3,
    /** ...and the speed is above stallSpeed × this. */
    exitSpeedFactor: 1.05,
    /** Faster than this (m/s) and not sliding tail first, the nose is steered onto the flight path... */
    trackSpeed: 40,
    /** ...where tail first is σ over this range (deg): reverse flow after a Bell or a slow Kulbit, not the far side of a Cobra. */
    reversedDeg: [140, 160] as [number, number],
    /** ...slower, it is put this far (deg) below the horizon to dive for speed. */
    noseLowDeg: 40,
    /** Assist rate per rad of error near the target (1/s), before the stop-point braking curve. */
    gain: 3,
    /**
     * Thrust align ("fly where the nose points", as in example/ PSM Flight
     * Lab): Space released with the nose turned back past `alignDeg` of σ
     * while still faster than `trackSpeed` (a Cobra past 180°, not a Cobra
     * or a Bell) holds the nose where it was let go, without carrying the
     * rotation round, while thrust swings the velocity onto it. Ends once σ
     * is under `alignDoneDeg` (the velocity has come round to the nose side;
     * holding the nose longer at near zero speed only drops the jet), or
     * under `alignDoneBurnerDeg` on afterburner (which swings the velocity
     * onto the nose, `PSM.engine.abSwingRateDeg`, so the jet leaves where the
     * nose was let go), or after `alignTime` s, fading into the normal target
     * over the last `alignFade` s.
     */
    alignDeg: 135,
    /**
     * Thrust align on afterburner: Space let go with the nose past this σ
     * (deg), the afterburner lit with it or within `alignBurnerGrace` s
     * after, aligns as above at any speed, on the nose where Space was let
     * go: a Cobra standing at 90° let go on afterburner climbs away along
     * the nose instead of being pitched back down to the old flight path.
     * The aim rides on the nose through RECOVERY, so the mouse takes over
     * from there.
     */
    alignBurnerDeg: 60,
    alignBurnerGrace: 0.7,
    alignDoneDeg: 90,
    alignDoneBurnerDeg: 10,
    alignTime: 8,
    alignFade: 0.5,
    /** Seconds for the mouse to take the stick back after RECOVERY. */
    handbackTime: 0.4,
  },

  /** Engine spool and post-stall thrust (§7, P3). */
  engine: {
    /** Spool (0..1) at military power; ARMED / PSM / RECOVERY hold at least this unless S is held. */
    milSpool: 0.6,
    /** Thrust turns from the attached-flow speed model to T/W along the nose over this σ range (deg). */
    blendDeg: [28, 60] as [number, number],
    /**
     * Drag from flying sideways (m/s²) at σ 90° and cruise speed:
     * alphaDrag × sin²σ × (v / cruise)², faded in over `blendDeg` so the
     * attached-flow speed model is untouched.
     */
    alphaDrag: 126,
    /**
     * Past σ 90° the α drag no longer falls to 0 with sin²σ: it is at least a
     * ramp up to this share at 180° (tail first), so flying backwards is not
     * drag-free and thrust can reverse a turned-around jet. Below a Cobra's
     * σ the ramp is under sin²σ and changes nothing.
     */
    reverseDrag: 1,
    /**
     * Afterburner past the attached range (faded in with the post-stall blend
     * over `blendDeg`) swings the velocity onto the nose at up to this rate
     * (deg/s at full afterburner), losing `abSwingLoss` of the speed per 180°
     * turned: lighting the burner means "go where the nose points" (arcade),
     * not braking against the old motion to a stall first.
     */
    abSwingRateDeg: 180,
    abSwingLoss: 0.35,
  },

  /** Rate authority outside NORMAL (§7, P4). NORMAL keeps `FlightModel.rateLimits` as it was. */
  authority: {
    /** Aerodynamic authority is 0 at or below this speed (m/s) and back to the NORMAL value by `aeroFullSpeed`. */
    aeroZeroSpeed: 55,
    aeroFullSpeed: 75,
    /** Pitch authority left to the stabilators at |α| 90° (share), faded in from 30°. */
    pitchHighAlpha: 0.4,
    /** |α| range (deg) over which the rudders / ailerons fade to the profile's high-α rates. */
    yawFadeDeg: [20, 45] as [number, number],
    rollFadeDeg: [25, 60] as [number, number],
    /** Yaw / roll authority lost (share) as |β| goes over this range (deg). */
    betaFadeDeg: [30, 90] as [number, number],
    betaFade: 0.7,
    /** Reverse flow: aerodynamic authority fades to 0 over this |α| range (deg). */
    reverseFadeDeg: [120, 150] as [number, number],
    /**
     * Pitch response (1/s) a large pitch command gets at full agility boost,
     * instead of `FLIGHT.rateResponse.pitch`: the nose snaps up before the
     * wing can carry the flight path with it. Faded in over `snapRate`
     * (rad/s of rate error), so small corrections respond as in NORMAL.
     */
    pitchResponse: 24,
    snapRate: [0.05, 0.3] as [number, number],
  },

  /**
   * Weathercock stability: angular acceleration (rad/s² at cruise q) turning
   * the nose toward the velocity, × sin α / sin β, switched on over `onDeg`
   * of σ. The FCS holds against it with its base authority (no agility
   * boost), so at high q the nose falls by itself and at low q it holds.
   */
  stability: { pitch: 10, yaw: 6, onDeg: [28, 38] as [number, number] },
  /**
   * Tail-slide (§13, Kvochur's Bell): tail first and slow, the tail acts as
   * a lever and swings the nose toward the flow far harder than the
   * q-scaled weathercock (as in example/ PSM Flight Lab). Angular
   * acceleration (rad/s²) `pitch` × sin α × slide, slide = min(v /
   * `refSpeed`, `cap`) fading out over `fadeSpeed` (m/s), so it grows with
   * the backward speed and is gone before a Kulbit from 300 km/h slows to
   * its lowest (~50 m/s), so it does not slow the Kulbit. The FCS holds
   * against it with its base authority like the weathercock: Space at
   * military power stretches the slide, idle (S) lets it swing.
   * Nose straight into the flow it swings the way the pitch rate already
   * turns (beyond `rateDeadbandDeg` deg/s), otherwise toward the belly (the
   * classic Bell) with at least `bias` × slide.
   */
  tailSlide: {
    pitch: 8,
    refSpeed: 15,
    cap: 1.5,
    fadeSpeed: [30, 50] as [number, number],
    bias: 1.6,
    rateDeadbandDeg: 2,
    /**
     * Pitch rate damping (1/s) left with no pitch control power
     * (`FlightModel.grip` 0): the swing is a pendulum, not held by the rate command.
     */
    damping: 1.4,
  },

  /** Aerodynamic regime shown on the HUD, by |α| / |β| (deg). */
  regime: { highAlphaDeg: 22, highBetaDeg: 12, postStallAlphaDeg: 32, postStallBetaDeg: 30, reverseFlowDeg: 150 },

  aero: {
    /**
     * Speed (m/s) above which full lift is available; below it lift scales
     * with (v / vFull)². Sets the 1 g stall at the α limit to ~215 km/h.
     */
    vFull: 132,
    /**
     * Lift can turn the flight path at most this × the path turn rate of a
     * NORMAL full pull at the same speed (the pre-PSM pitch rate with its
     * G-limit). NORMAL never reaches it; a PSM pitch-up outruns it, which is
     * what lets the nose leave the flight path in a Cobra.
     */
    liftTurnMargin: 1.05,
    /** ...and fades to 0 over this |α| range (deg), from the NORMAL α limit + 2°: a Cobra keeps its flight path. */
    liftCapFadeDeg: [24, 34] as [number, number],
    /** Lift is sin α (the pre-PSM lift) up to here (deg)... */
    clLinearDeg: 25,
    /** ...peaks here at `clPeak`... */
    clPeakDeg: 32,
    clPeak: 0.55,
    /** ...and is gone at this angle (deg). */
    clZeroDeg: 90,
    /** Reverse flow (tail first) starts at this |α| (deg) with a small lift bump of `reverseCl`. */
    reverseFlowDeg: 150,
    reverseCl: 0.15,
    /** Side force is sin β up to `cyLinearDeg`, saturating at `cySat` from `cySatDeg`. */
    cyLinearDeg: 20,
    cySatDeg: 30,
    cySat: 0.42,
  },

  stall: {
    /** Stalled above these |α| / |β| (deg) whatever the speed. */
    alphaDeg: 32,
    betaDeg: 30,
    /** Stall clears once available lift exceeds required by this factor and |α| is 3° under `alphaDeg`. */
    exitMargin: 1.08,
  },
};

/** Per-aircraft PSM character (docs/PSM_SPEC.md §8). NORMAL flight ignores it. */
export interface PsmProfile {
  /**
   * Thrust-vectoring axes and travel (deg). `rollDeg` is the differential
   * deflection at full roll. `coneDeg` > 0 clamps the 3-D nozzles to a
   * circle like the visual rig; 0 = 2-D flaps, each limited to `maxDeg`.
   */
  tvc: { pitch: boolean; yaw: boolean; roll: boolean; maxDeg: number; rollDeg: number; coneDeg: number };
  /** Body rates (deg/s) full thrust vectoring adds at military power, per axis (0 without TVC on that axis). */
  tvcRateDeg: { pitch: number; yaw: number; roll: number };
  /** Pitch rate the agility boost reaches in PSM at w = 1 (deg/s). */
  psmPitchRateDeg: number;
  /** Rudder / aileron rates (deg/s) still available at high α. */
  aeroHighAlphaDeg: { yaw: number; roll: number };
  /** Multiplier on α drag. */
  alphaDragFactor: number;
  /** Thrust / weight along the nose in post-stall flight. */
  postStallTW: { dry: number; ab: number };
  /** Engine spool rate (1/s). */
  spoolRate: number;
  /** Recovery assist rate (deg/s). */
  recoveryRateDeg: number;
}

/**
 * Gun lock magnet (this project's, not the example's; game/combat/gunLock.ts). While the
 * command carries `gunTrack`, each step turns the nose toward it by `rate` of the angle a second,
 * never faster than `maxRateDeg`, and the flight path with it by `pathShare` of that turn, so
 * the jet goes where the nose is drawn instead of sliding sideways or stalling. Arcade: the turn
 * costs no energy and pulls no G.
 */
export const GUN_TRACK = { rate: 8, maxRateDeg: 75, pathShare: 1 }

const F22: PsmProfile = {
  // 2-D nozzles: pitch plus differential (roll), no yaw. Rig: pitch ± roll × 0.4.
  tvc: { pitch: true, yaw: false, roll: true, maxDeg: 20, rollDeg: 8, coneDeg: 0 },
  tvcRateDeg: { pitch: 50, yaw: 0, roll: 50 },
  // Was 160: a Cobra stood up in 0.75 s (now 0.90 s), too fast to stop the nose where it was wanted.
  psmPitchRateDeg: 136,
  aeroHighAlphaDeg: { yaw: 15, roll: 40 },
  alphaDragFactor: 0.85,
  postStallTW: { dry: 0.85, ab: 1.15 },
  spoolRate: 1.6,
  recoveryRateDeg: 80,
}

const SU57: PsmProfile = {
  // 3-D nozzles in a ±18° cone, matching the visual rig (su57-nozzle.js).
  tvc: { pitch: true, yaw: true, roll: true, maxDeg: 18, rollDeg: 6, coneDeg: 18 },
  tvcRateDeg: { pitch: 45, yaw: 45, roll: 60 },
  // Was 140: 0.87 s to stand up, now 0.99 s. No lower: a half-second pull in a banked turn takes the nose
  // 48° off the path at 140, 29° at 126 and under 25° at 116, which is no drift any more (tests/psm.test.ts).
  psmPitchRateDeg: 126,
  aeroHighAlphaDeg: { yaw: 8, roll: 60 },
  alphaDragFactor: 1.0,
  postStallTW: { dry: 0.8, ab: 1.08 },
  spoolRate: 1.3,
  recoveryRateDeg: 70,
}

/** The no-TVC Raptor: the F-22 without its nozzles. */
const F22_NO_TVC: PsmProfile = {
  ...F22,
  tvc: { pitch: false, yaw: false, roll: false, maxDeg: 0, rollDeg: 0, coneDeg: 0 },
  tvcRateDeg: { pitch: 0, yaw: 0, roll: 0 },
}

/** PSM character by this project's aircraft id. */
export const PSM_PROFILES: Record<string, PsmProfile> = { f22: F22, su57: SU57, 'f22-notvc': F22_NO_TVC }
export const DEFAULT_PSM_PROFILE: PsmProfile = F22
export const psmProfileOf = (aircraftId: string) => PSM_PROFILES[aircraftId] ?? DEFAULT_PSM_PROFILE
