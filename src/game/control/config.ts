/**
 * Control and chase-camera tuning, ported from example/flight-control (src/game/config.ts:
 * INPUT, MOUSE and CAMERA, unchanged). The flight physics sections (FLIGHT, PSM) stay behind:
 * this project flies its own core, and the controls read its rates through controlAircraft.ts.
 *
 * Units: metres, seconds, radians (unless a name says `Deg`), m/s for speed.
 */

/**
 * What the example's FCS was doing. This project ports no FCS, so only two values occur:
 * 'PSM' while the PSM key is held, 'NORMAL' otherwise (see controlAircraft.ts).
 */
export type FcsMode = 'NORMAL' | 'ARMED' | 'PSM' | 'RECOVERY';

/** The example's cruise speed (m/s): the camera's reference for its low-speed fades. */
export const CRUISE_SPEED = 230;

const DEG = Math.PI / 180;

/** Progressive keyboard input: how fast an axis builds up and decays. */
export const INPUT = {
  /** Units/s an axis climbs toward ±1 while its key is held. */
  riseRate: 2.4,
  /** Extra climb rate gained per second of holding (the longer, the faster). */
  riseAccel: 3.0,
  /** Units/s an axis falls back to 0 once released. */
  fallRate: 3.2,
  /** Units/s when the player reverses direction (opposite key pressed). */
  reverseRate: 6.0,
  /**
   * Response curve exponent applied after smoothing. >1 gives fine control
   * near centre: a tap reaches ~0.2 raw → ~0.08 effective.
   */
  curve: { pitch: 1.6, roll: 1.4, yaw: 1.5 },
  /** With the PSM key held the pitch keys build up and fall back this many times faster: a sharp ↑ snaps the nose. */
  psmPitchKeyScale: 4,
  /** How fast the W / S thrust command builds up to ±1 (per second). */
  thrustRate: 4.0,
  /** How fast it eases back to 0 (= hold speed) on release (per second). */
  thrustReleaseRate: 6.0,
  /** Afterburner and airbrake ramp time constants (per second). */
  afterburnerRate: 3.5,
  airbrakeRate: 4.0,
};

/**
 * Mouse aim: the mouse steers a world-space aim direction and the aim
 * controller turns the nose toward it. See docs/MOUSE_CONTROL_SPEC.md.
 */
export const MOUSE = {
  /** Aim rotation per pixel of mouse travel (at `CAMERA.fovBase` where `fovSensitivity` scales it). */
  sensitivityDegPerPx: 0.07,
  /**
   * What the camera's changing FOV does to that rotation per pixel:
   *   angular — nothing: a hand movement turns the aim by the same angle at
   *             any speed (the reticle crosses a wide view in fewer pixels)
   *   screen  — × shown FOV / `fovBase`: the reticle moves the same pixels
   *             per pixel of mouse, so the angle grows with speed and swings
   *             with the FOV kick (how it was before the kick existed)
   *   baseFov — × the FOV from speed alone / `fovBase`: like `screen`, but
   *             steady through afterburner and airbrake kicks
   */
  fovSensitivity: 'angular' as 'angular' | 'screen' | 'baseFov',
  invertY: false,
  /** Per-event deltas larger than this (px) are dropped as pointer-lock glitches. */
  maxEventDelta: 400,
  /**
   * Aim range at start, switchable in game (G key / toolbar):
   *   limited — the aim may lead the nose by at most `coneDeg`
   *   free    — the aim goes anywhere, even behind the jet; the aircraft
   *             still only turns as fast as its rates and G-limit allow
   */
  aimLimit: 'limited' as 'limited' | 'free',
  /** Furthest the aim may lead the nose in limited mode (deg). */
  coneDeg: 65,
  /**
   * Virtual stick with the PSM key held: the cursor's place on the whole
   * screen is the stick (centre = 0, screen edge = full, per axis). Dead zone
   * at centre (share of full) and the response curve exponent after it.
   */
  psmStick: { deadzone: 0.05, curve: 1.5 },

  /**
   * Turn strategy blends on aim error: below `directDeg` the nose is moved
   * with pitch + yaw only (no roll), above `bankDeg` it is bank-and-yank.
   */
  directDeg: 6,
  bankDeg: 25,
  /**
   * Rate controller per axis: commanded rate = gain × error − damping × rate,
   * in rad/s per rad of error, then divided by the available rate to give stick.
   */
  gain: { pitch: 7.0, roll: 9.0, yaw: 5.0 },
  damping: { pitch: 0.9, roll: 0.9, yaw: 0.6 },
  /** Strongest push (negative stick) allowed while banking toward the aim. */
  bankPushLimit: 0.25,
  /** Share of yaw kept in bank-and-yank (the rest is left to the roll). */
  bankYawShare: 0.3,
  /**
   * When the aim sits almost straight below the lift vector, the roll keeps
   * its chosen direction until the roll error is this far (deg) past 180°.
   */
  rollHysteresisDeg: 25,

  /**
   * Auto-bank roll-out: once the aim is reached and the mouse has rested for
   * `idleTime`, the roll the controller itself added (bank-and-yank) is
   * unwound. Roll made with A / D resets that count, and a pure pitch loop
   * adds none, so knife-edge or inverted flight set by the player is kept.
   * Off: the jet stays at the bank it ended its last turn with (~110°).
   */
  rollOut: { enabled: true, idleTime: 0.35, gain: 3.0, maxRateDeg: 140 },

  /** Seconds for the aim controller to take an axis back after manual input ends. */
  handbackTime: 0.25,
  /** Aim keeps following the nose after pitch / yaw input until that body rate drops below this (deg/s). */
  syncRateDeg: 4,
  /** Aim error (deg) above which a saturated controller is reported to the HUD. */
  saturationErrorDeg: 8,
};

export const CAMERA = {
  /** FOV (deg, vertical) at cruise speed; mouse sensitivity is given at this FOV. */
  fovBase: 62,
  /**
   * FOV by speed: [m/s, deg] points joined by straight lines, held past the
   * ends. Covers the speeds actually flown, so the view visibly opens up
   * between slow flight and a fast run.
   * (Before: `[[-5, 56], [700, 74]]`, 8° over 140–470 m/s.)
   */
  fovSpeed: [
    [120, 56],
    [230, 62],
    [470, 76],
  ] as [number, number][],
  /**
   * FOV kick from acceleration along the flight path: `gain` deg per m/s²,
   * easing into at most +`widen` / -`narrow` deg. It passes: gone once the
   * speed has settled. 0 gain = off.
   */
  fovKick: { gain: 0.14, widen: 6, narrow: 4 },
  /** FOV added while the afterburner key is held, whatever the speed does (was 6; the kick replaces it). */
  fovAfterburnerGain: 0,
  fovRate: 4,
  near: 0.5,
  far: 26000,
  /** Chase offset in aircraft lengths is not used: these are metres. */
  distance: 24.5,
  height: 5.9,
  /**
   * The camera rides on a spring behind the jet, so acceleration is seen as
   * the jet moving in the frame (and not turning: the view axes, which the
   * mouse steers in, stay as they are). Two channels, never mixed:
   *   - along the view, from the change of speed (m/s², `accelRate` 1/s
   *     low-pass): `surgeGain` m back per m/s², easing into at most
   *     `surgeBack` m back (speeding up) / `surgeIn` m closer (slowing).
   *     Past the normal α range (σ through `postStallDeg`) slowing is
   *     ignored: the α drag of a Cobra must not push the camera at the jet;
   *   - up the view, from the load factor on the HUD (game g, not m/s²):
   *     `heaveGain` m up per g over 1, easing into at most `heaveUp` m up
   *     (the jet sinks in the frame as it pulls) / `heaveDown` m down.
   *     Negative gain = the other way (the camera left behind, jet rising).
   * Both are critically damped at `omega` rad/s and scale with the aircraft
   * size. `enabled: false` = as before: distance from the keys below.
   */
  accelSpring: {
    enabled: true,
    accelRate: 10,
    /** Changes of speed beyond this (m/s²) are not flight: a respawn, a crash. */
    accelMax: 120,
    omega: 7,
    surgeGain: 0.14,
    surgeBack: 6,
    surgeIn: 3,
    postStallDeg: [15, 35] as [number, number],
    heaveGain: 0.25,
    heaveUp: 2.5,
    heaveDown: 1,
  },
  /** Only with `accelSpring.enabled` false: extra metres back at full afterburner. */
  afterburnerPullback: 5,
  /** Only with `accelSpring.enabled` false: extra distance with the airbrake out (negative pulls in). */
  airbrakePullback: -2.5,
  /** Rotation smoothing per second for each mode (higher = stiffer). */
  lockFollowRate: 13,
  horizonFollowRate: 9,
  /** Upper bound on camera rotation speed (deg/s) in horizon / aim lock: a flick of the aim is a quick pan, not a cut. */
  maxTurnRateDeg: 200,
  /**
   * Camera plan C1 (2026-11-17, owner: "too fast, hard to aim, dizzy"): the view turns on a
   * second-order spring, not the exponential follow above, so a pan starts and stops smoothly
   * instead of jumping to full speed (the old Aim lock flick: 200°/s reached in one frame,
   * ~12 000°/s²). Per mode:
   *   - `omega` (rad/s), `damping`: the spring toward the mode's target view;
   *   - `lagShare` 0..1: how much of the target's own turn rate the camera does NOT feed forward.
   *     In a steady turn the view trails the target by 2·damping·lagShare·rate / omega. With
   *     `boomRate` 0 that only delays the view; the jet keeps its place. 0 = no trailing;
   *   - `maxRateDeg` / `maxAccelDeg`: the turn of the look direction (deg/s, deg/s²);
   *   - `maxRollRateDeg` / `maxRollAccelDeg`: the same for the roll about the look direction,
   *     which makes people sick sooner than any pan;
   *   - `deadZone` (C2): while the look target is within this box round the centre of the
   *     picture (fractions of the half-screen, x across, y up and down) the view is not pulled
   *     at all and the target's turn is not fed forward: it coasts to a stop and holds still
   *     while the reticle and the jet move on screen. Past the box the spring pulls only by
   *     how far the target is beyond it (soft zone), so there is no step at the edge. A gun
   *     lock shrinks the box to nothing, so the view settles on the lead;
   *   - `leashDeg`: last resort, never further than this off the target (the screen boxes of
   *     `composer` are the real edge).
   * `composer` (C2): hard limits on screen, after the spring, in every mode. The reticle (the
   * mouse aim) is kept inside `reticleBox`, and then the jet inside `jetBox` (fractions of the
   * half-screen; the jet wins when both cannot fit). Only reaching an edge turns the view at the
   * subject's own speed; inside, the caps above hold. Past a box the view is pulled back on a
   * spring of its own (`edgeOmega` rad/s, at most `edgeMaxAccelDeg` deg/s² and, while it pulls,
   * up to `edgeMaxRateDeg` deg/s), so a subject that jumps out is brought back smoothly; past
   * `screenEdge` (fraction of the half-screen) it is turned back at once.
   * The RECOVERY lead (psmPath.leadMaxRateDeg) still lifts `maxRateDeg`. The wreck view keeps the
   * old exponential follow. `enabled: false` = the old follow in every mode.
   */
  motion: {
    enabled: true,
    /** Longest spring step (s): a long frame is cut into steps this long. */
    substep: 1 / 120,
    /**
     * 0 = the camera's place round the jet turns with its look, so the jet holds its place in the
     * picture. Above 0 the place follows the target on its own at this rate (1/s) and the gap to
     * the look slides the jet toward the side it turns to ("Lag" framing). Flown at 30 it made
     * the game worse (owner, 2026-11-17: dizzier than before): the jet, the thing the eye rests
     * on, darted across the screen at 1.4 half-screens/s on a flick, against 0.5 before the plan
     * and 0.16 at 0 (tests/cameraLoop.test.ts).
     */
    boomRate: 0,
    aircraft: { omega: 9, damping: 1, lagShare: 0.25, maxRateDeg: 220, maxAccelDeg: 1400, maxRollRateDeg: 320, maxRollAccelDeg: 2000, deadZone: { x: 0.03, y: 0.03 }, leashDeg: 40 },
    horizon: { omega: 5, damping: 1, lagShare: 0.55, maxRateDeg: 120, maxAccelDeg: 420, maxRollRateDeg: 45, maxRollAccelDeg: 180, deadZone: { x: 0.07, y: 0.06 }, leashDeg: 40 },
    aim: { omega: 4.5, damping: 1, lagShare: 0.55, maxRateDeg: 110, maxAccelDeg: 360, maxRollRateDeg: 40, maxRollAccelDeg: 160, deadZone: { x: 0.1, y: 0.08 }, leashDeg: 40 },
    composer: {
      enabled: true,
      edgeOmega: 9,
      edgeMaxAccelDeg: 900,
      edgeMaxRateDeg: 240,
      screenEdge: 0.92,
      /** Wide: at 0.6 a plain pull up already reached it and the edge spring kicked the view (437°/s² against 137). */
      reticleBox: { x: 0.8, up: 0.8, down: 0.8 },
      /** The jet rests about 0.41 below the centre: more room down than up. */
      jetBox: { x: 0.7, up: 0.3, down: 0.85 },
    },
  },
  /**
   * Horizon lock still banks with the aircraft for life: peak tilt (deg) at
   * 90° bank, easing back to level when inverted so a full roll never flips.
   */
  horizonBankFollowDeg: 14,
  /** |forward.y| range over which horizon / aim lock stop holding the level horizon (none is left near the vertical). */
  verticalBlend: [0.78, 0.97] as [number, number],
  /**
   * Horizon / aim lock level the view with an up vector of the camera's own,
   * carried from update to update, so passing through the vertical never
   * rolls the view (the mouse steers in the camera's axes, and a roll there
   * would turn "mouse up" round under the hand):
   *   - away from the vertical (`verticalBlend`) it is pulled onto the level
   *     horizon at `levelRate` (1/s), braking into it at `rollAccelDeg`
   *     (deg/s²), never faster than `maxRollRateDeg` (deg/s);
   *   - it counts as upside down once its cosine to the level up is under
   *     -`invertedCos` (after a half loop; leaving the vertical sideways,
   *     edge-on, stays upright), and as upright again within
   *     `followUntilDeg` of the level up;
   *   - upside down with the aircraft the same way up (within `matchDeg[0]`
   *     of the up, until past `matchDeg[1]`), it rolls with the aircraft one
   *     for one: rolling the jet upright brings the horizon back with it,
   *     and until then the view stays on its back with the jet;
   *   - upside down without the aircraft (after a Split-S), it holds the
   *     upside-down horizon and, once the view has turned slower than
   *     `calmRateDeg` (deg/s) for `calmTime` s while at least `calmLevel`
   *     (0..1) of the level horizon is held, rolls upright by itself, easing
   *     in over `easeTime` s; a view turning faster than `abortRateDeg` (a
   *     loop carried on), or gone vertical, stops that and it settles on the
   *     nearer horizon. Switching from aircraft lock on its back does the same
   *     without the wait.
   */
  horizonUp: {
    levelRate: 20,
    rollAccelDeg: 360,
    maxRollRateDeg: 90,
    invertedCos: 0.7,
    followUntilDeg: 45,
    matchDeg: [60, 120] as [number, number],
    calmRateDeg: 15,
    calmLevel: 0.5,
    calmTime: 0.5,
    easeTime: 0.5,
    abortRateDeg: 40,
  },
  /**
   * Height (m) the camera keeps above the terrain under it. From `soft` up
   * it is left alone; below that it is eased up, and never goes under `min`.
   */
  groundClearance: { min: 2.5, soft: 9 },
  /** Aim lock: rotation smoothing (1/s) — stiff, the view should track the mouse. */
  aimFollowRate: 16,
  /** Aim lock looks along aim × this + flight path × (1 − this). */
  aimLookWeight: 0.65,
  /**
   * How aim lock shares its look direction between the aim and the flight path:
   *   fixed    — `aimLookWeight` of the way to the aim, wherever the aim is:
   *              the hand turns the picture as much as the jet;
   *   softZone — the share grows with the angle θ between the two (`aimSoftZone`):
   *              a small move of the aim barely turns the view (the reticle
   *              moves on screen, the jet follows), a large one still shows
   *              where the jet is being sent.
   */
  aimWeightMode: 'softZone' as 'fixed' | 'softZone',
  /**
   * Soft zone: share = 1 − R(1 − e^(−θ/R)) / θ with R = `deg`, so the view
   * leaves the flight path by θ − R(1 − e^(−θ/R)): nothing at the centre,
   * nearly one for one far out. θ 10 / 20 / 40 / 65° → 0.18 / 0.32 / 0.51 /
   * 0.66 at `deg` 24 (keep it under half the vertical FOV: the reticle rests
   * at most `deg` off centre). The share never goes over `maxWeight`, which
   * only a free aim more than ~65° out reaches (1 = no such limit).
   */
  aimSoftZone: { deg: 24, maxWeight: 0.65 },
  /**
   * Past the normal α range (σ over `psmBlendDeg`, deg) every mode turns its
   * look direction from the nose toward the flight path by up to
   * `psmVelocityBlend`, so in a Cobra the camera keeps flying along with the
   * jet and shows it standing on its tail, instead of pitching up with it.
   */
  psmBlendDeg: [28, 60] as [number, number],
  psmVelocityBlend: 1,
  /**
   * The flight path that blend turns toward is the camera's own, chasing the
   * real one (as in example/ PSM Flight Lab):
   *   - `rate` (1/s), at most `maxRateDeg` (deg/s), both × a weight that
   *     fades to 0 below `trackSpeed` (m/s), where a near-zero velocity can
   *     flip at any moment; a path more than 90° behind is chased slower
   *     still, so it never swings the wrong way round;
   *   - below `horizonSpeed` (m/s) it eases toward the horizon at
   *     `horizonRate` (1/s, at most `horizonMaxDeg` deg/s), so a velocity
   *     reversal (tail-slide) is two gentle ~90° halves, not one 180° whip;
   *   - in RECOVERY it chases where the FCS is turning the nose instead (lead
   *     in / out at `leadIn` / `leadOut` per second), so after a slow Kulbit
   *     or tail-slide the view swings round to where the jet will fly next;
   *     while it leads it may turn at up to `leadMaxRateDeg` (deg/s, the
   *     rig's `maxTurnRateDeg` lifted to match), so after a 180° flip let go
   *     the camera is round behind the jet in ~0.85 s, not 1.2 s;
   *   - the σ blend itself changes at most `blendRate` (1/s, slow → at
   *     `trackSpeed`), since near zero speed σ swings with the velocity.
   * The low-speed rules act only as far as the blend has turned the view.
   */
  psmPath: {
    rate: 6,
    blendRate: [1.5, 30] as [number, number],
    maxRateDeg: 160,
    leadMaxRateDeg: 200,
    trackSpeed: [12, 60] as [number, number],
    horizonSpeed: [15, 55] as [number, number],
    horizonRate: 2,
    horizonMaxDeg: 50,
    leadIn: 3.5,
    leadOut: 1.2,
  },
  /**
   * Post-stall entry and exit (K5). The blend above waits for σ to pass
   * `psmBlendDeg`, so in a Cobra, where the nose goes up at ~150°/s, the view
   * went up after it by 25° and came back within half a second, and did the
   * same again as the nose came down. While the FCS is out of NORMAL (ARMED:
   * it will let the nose go; PSM: it has; RECOVERY: it is bringing it back):
   *   - the blend runs over `blendDeg` instead, and on σ read `leadTime` s
   *     ahead by its rate of rise (low-passed at `rateSmoothing` 1/s, at
   *     most `maxRateDeg` deg/s, faded out with `psmPath.trackSpeed`): the
   *     view lets go of the nose as it starts to snap away, not after;
   *   - the blend is eased, on a spring of `riseOmega` rad/s going off the
   *     nose and `releaseOmega` coming back to it (`psmPath.blendRate`
   *     alone lets it start at full rate, which jerks the view: 400–800
   *     deg/s² as a Cobra is pushed back down);
   *   - coming back, it also waits: the view stays on the path until σ is
   *     under `releaseDeg` (in any FCS mode but NORMAL), so a nose falling
   *     back through the flight path is met there, not gone after and
   *     brought back;
   *   - `bump`: so that the entry is not all smooth, the view does go up
   *     after the nose for a moment, `deg` at most, and is pressed back onto
   *     the path as the jet stands up, like a car over a bump: while σ rises
   *     through `rateDeg` (deg/s) and until it is through `fadeDeg`, on a
   *     spring of `omega` rad/s and `damping` (0.5: it swings back a
   *     little past the path, a jet with weight lifted and stood up). The
   *     same in every camera mode. `deg: 0` = none.
   * The change of range itself eases in at `engageRate` and out at
   * `disengageRate` (1/s). A steady σ under `blendDeg[0]` changes nothing,
   * whatever the FCS mode: holding the PSM key in ordinary flight is not seen.
   * `enabled: false` = as before: `psmBlendDeg` on σ as it is, in every mode.
   */
  psmEntry: {
    enabled: true,
    blendDeg: [14, 40] as [number, number],
    leadTime: 0.2,
    rateSmoothing: 30,
    maxRateDeg: 240,
    engageRate: 8,
    disengageRate: 2,
    riseOmega: 26,
    releaseOmega: 5,
    releaseDeg: [4, 18] as [number, number],
    bump: { deg: 12, rateDeg: [20, 80] as [number, number], fadeDeg: [30, 60] as [number, number], omega: 10, damping: 0.5 },
  },
  /**
   * Post-stall framing (K5): standing up, the jet is as tall in the picture
   * as it is long, and from the chase position its tail went off the bottom
   * of the screen. While the FCS is out of NORMAL (or as far as the view has
   * left the nose for the path, in any mode) and σ is through `sigmaDeg`,
   * the camera backs off by `back` (m) and takes the height that puts the
   * tail's tip `tail` of the way from the centre of the picture to its
   * bottom edge with the jet at right angles to the view (1 = on the edge;
   * with `back` 5 that is about the chase height, so the camera hardly
   * rises or falls; 0 = the chase height, whatever it frames). On the way
   * up through 30–80° the tail is a little past the edge.
   * σ is read `leadTime` s ahead as in `psmEntry`. The spring runs at
   * `omega` rad/s going out (it has to be there before the tail is gone)
   * and `returnOmega` coming home, slowly: a camera that snaps back to its
   * place is a jerk. `damping` / `returnDamping` under 1 let it run a
   * little past and settle, so the jet is set down with some weight
   * (1 = critically damped, no overshoot). It moves, it does not turn: the
   * view axes stay as they are. `enabled: false` = as before.
   */
  psmFrame: {
    enabled: true,
    sigmaDeg: [12, 30] as [number, number],
    leadTime: 0.5,
    tail: 1,
    back: 5,
    omega: 12,
    damping: 0.65,
    returnOmega: 4.5,
    returnDamping: 0.55,
  },
  /**
   * The end of a Kulbit: the nose has been right round and swings up to the
   * flight path from below. The jet is carried down to the bottom of the
   * picture as it comes through the bottom of the loop and springs back up
   * to its place, the camera catching up a little late:
   *   - it counts once the nose has been through `deepDeg` of σ (nothing
   *     before the first, all of it past the second; forgotten at
   *     `fadeRate` 1/s once σ is back under `homeDeg`), α (signed, under 0 =
   *     nose below the path) has come up through `alphaDeg`, and is rising
   *     through `rateDeg` (deg/s; low-passed at `rateSmoothing` 1/s, at
   *     most `maxRateDeg`). A Cobra pushed back down comes to the path from
   *     above and does not count;
   *   - then the post-stall framing (`psmFrame`) lets go, and the camera is
   *     sent `height` m above its place (the jet that far down the picture:
   *     at 6.3 m, on these slow springs, its middle gets 0.8 of the way from
   *     the centre to the bottom edge), easing back to 0 over the last
   *     `easeDeg` of α. The wide `alphaDeg` and `easeDeg` spread the dip over
   *     the last quarter of the loop (from ~270°) instead of its last 40°;
   *   - on a spring of `omega` rad/s and `damping` going down the picture,
   *     `returnOmega` and `returnDamping` coming back (1 = no bounce; 0.6
   *     runs a tenth past and back, 0.25 nearly half; less than that after a
   *     target that eases away: at 0.38 the jet springs ~0.055 of the
   *     half-screen above its place, slowly). The low `returnOmega`
   *     is the lag: the jet is level again before the camera is back in its
   *     place; the low `returnDamping` is the bounce.
   * It moves, it does not turn. `enabled: false` = none of it.
   */
  psmDip: {
    enabled: true,
    deepDeg: [70, 130] as [number, number],
    homeDeg: 8,
    fadeRate: 2,
    alphaDeg: [-125, -70] as [number, number],
    rateDeg: [8, 25] as [number, number],
    rateSmoothing: 12,
    maxRateDeg: 240,
    easeDeg: 45,
    height: 6.3,
    omega: 5.5,
    damping: 0.85,
    returnOmega: 4,
    returnDamping: 0.38,
  },
  /** Aim lock bank follow (deg at 90° bank), like `horizonBankFollowDeg`. */
  aimBankFollowDeg: 22,
  /**
   * How much of the bank aim lock shows:
   *   fixed    — `aimBankFollowDeg` at 90° of bank, whatever the load;
   *   adaptive — by the load factor on the HUD (game g, low-passed as for
   *              `accelSpring`): `minDeg` up to `gRange[0]`, `maxDeg` from
   *              `gRange[1]`, so a hard turn leans the horizon over and an
   *              aileron roll at 1 g hardly rocks it.
   * Adaptive, the tilt is also eased: it closes on where it should be at
   * `followRate` (1/s) and never turns faster than `maxRateDeg` (deg/s),
   * however fast the jet rolls or the load comes on.
   *
   * `axis` is what the tilt rolls the view about, in either mode:
   *   view — its own axis, the screen centre: a reticle away from the centre
   *          swings round it as the view rolls, with the mouse at rest;
   *   aim  — the aim (as far as `axisMaxDeg` from the view axis): the
   *          reticle stays where it is on screen and the picture rolls
   *          round it, so the view direction moves with the tilt instead.
   * Either way "mouse up" is the tilt off the level up.
   */
  aimBankTilt: {
    mode: 'fixed' as 'fixed' | 'adaptive',
    minDeg: 10,
    maxDeg: 35,
    gRange: [1.5, 6] as [number, number],
    followRate: 20,
    maxRateDeg: 60,
    axis: 'view' as 'view' | 'aim',
    axisMaxDeg: 25,
  },
  /** Free look: rotation per pixel (deg), pitch clamp (deg), return rate after release (1/s). */
  freeLookDegPerPx: 0.15,
  freeLookMaxPitchDeg: 75,
  freeLookReturnRate: 6,
  /** Position spring (1/s). The lag makes accelerations readable. */
  positionRate: 24,
  /** How fast the chase distance settles when it changes (1/s). */
  distanceRate: 5,
  /**
   * Shake: the view is turned by a fraction of a degree, never moved, and
   * only the picture: `ChaseCamera.steady` is the same view without it, and
   * that is what the mouse aim and the virtual stick use. Peak angle (deg,
   * in pitch and in yaw) of each source, added up and eased into at most
   * `maxDeg`:
   *   - `afterburner`: at full afterburner;
   *   - `g`: as the load factor goes through `gRange`;
   *   - `buffet`: as σ goes through `buffetDeg` toward the α limit and past
   *     it, × (speed / cruise)², at most 1;
   *   - `low`: as the jet's height above ground goes from `lowAlt[1]` down
   *     to `lowAlt[0]` m, × speed / cruise, at most 1.
   * `amount` scales the lot, `roll` is the share about the view axis, `rate`
   * (1/s) how fast it comes and goes.
   * Off (`amount: 0`) since the 2026-11-11 playtest: not liked. 1 = the
   * angles below.
   */
  shake: {
    amount: 0,
    maxDeg: 0.3,
    afterburner: 0.08,
    g: 0.16,
    gRange: [4.5, 9] as [number, number],
    buffet: 0.22,
    buffetDeg: [13, 22] as [number, number],
    low: 0.12,
    lowAlt: [15, 70] as [number, number],
    roll: 0.5,
    rate: 8,
  },
};

export const DEG2RAD = DEG;
