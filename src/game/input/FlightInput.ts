import { neutralCommand } from '../runtime/commands'
import { WORLD_STEP } from '../runtime/clock'
import { LEVEL_FRAME, MOUSE_POSITIONAL, MOUSE_RELATIVE, MOUSE_STICK, clearStick, createMouseStick, defaultMouseSettings, engageStick, moveDiscStick, moveRelativeStick, moveStick, positionalRadius, readPositionalAxes, readStickAxes, springStick, stickGate, type MouseSettings, type ScreenFrame, type StickGate } from './mouseStick'
import { aimAtCursor, aimAtRay, createMouseAim, followTarget, instruct, stepAim, trackLead, turnAim, unsyncAim, type CursorRay } from './mouseAim'
import { gunMountOf, type GunMount } from '../combat/gunSolution'
import { cursorDraw } from '../combat/aimAssist'
import { capturePush, createPushCapture } from './pushCapture'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { actionForCode, defaultKeyboardSettings, type FlightAction, type KeyboardSettings } from './keyBindings'
export type { InputPreset } from './keyBindings'
import type { InputPreset } from './keyBindings'
// A held key is always full deflection and the shaped stick never is, so "strictly larger
// wins" gives the keyboard priority over the mouse without a special case for it.
const strongest = (digital: number, analog: number) => Math.abs(analog) > Math.abs(digital) ? analog : digital
/** How long the positional stick rests in its dead zone before a half turn kept from passing
 * the vertical is let go. */
const FLIP_RELEASE_SECONDS = 0.25
const wrapPi = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))
// F22's smoothAxis: a linear walk toward the target, at the release rate while it heads back
// toward neutral or across it and at the engage rate while it grows.
function slewToward(current: number, target: number, rate: { engage: number; release: number }, step: number) {
  const returning = target === 0 || Math.sign(target) !== Math.sign(current) || Math.abs(target) < Math.abs(current)
  const travel = (returning ? rate.release : rate.engage) * step
  return Math.abs(target - current) <= travel ? target : current + Math.sign(target - current) * travel
}
/** Seconds for Q/E pedal travel from centre to full deflection. */
export const PEDAL_RAMP_SECONDS = 0.2
export class FlightInput {
  readonly held = new Set<string>()
  /** Mouse mode, control frame and shaping settings (MR1). Input only: the command contract
   * and physics are unchanged, and a replay records the commands these produce. */
  mouse: MouseSettings
  private springTick = -1
  // Pixels of motion since the last command tick (relative mode).
  private since = { x: 0, y: 0 }
  /** Key bindings and hold/toggle choices. Input only, like `mouse`. */
  keyboard: KeyboardSettings
  /** Left mouse held while the pointer is locked to the flight surface. */
  mouseGun = false
  // A next-target press waiting for the next command tick. One press is one action, however
  // many ticks one frame runs, so it is taken by the first command and never repeated.
  private nextTarget = false
  private actionId = 1
  // Afterburner/airbrake switched on by a toggle-mode key press.
  private readonly latched = new Set<FlightAction>()
  constructor(mouse: MouseSettings = defaultMouseSettings, keyboard: KeyboardSettings = defaultKeyboardSettings) { this.mouse = { ...mouse }; this.keyboard = keyboard }
  // Flow observation refreshed on simulation ticks.
  highAoa = 0
  // Q/E pedal travel. It advances one step per command tick, never per rendered frame,
  // and the recorded command carries the ramped value, so replays match exactly.
  // Linear, so a released pedal reaches exact neutral and the controller's neutral branch engages.
  pedal = 0
  private pedalTick = -1
  // Positional stick mode's rate-limited axes (F22's DIRECT_RESPONSE), stepped per command tick.
  private slew = { pitch: 0, x: 0 }
  private slewTick = -1
  // Positional stick mode's screen turn, rate limited like F22's camera roll correction.
  private turn: number | null = null
  // Post-stall push capture, armed while a push that started in post-stall is held.
  private readonly capture = createPushCapture()
  // The last level-frame angle, the half turn added each time the nose passes the vertical,
  // and how long the stick has rested in its dead zone.
  private level: number | null = null
  private flip = 0
  private centred = 0
  /** A key went down. Repeats keep a held key held but never flip a toggle again. */
  press(code: string, repeat = false) {
    this.held.add(code)
    const bound = repeat ? null : actionForCode(this.keyboard.bindings, code)
    if (bound?.action === 'nextTarget') this.nextTarget = true
    if (bound && (bound.action === 'afterburner' || bound.action === 'airbrake') && this.keyboard[bound.action] === 'toggle') {
      if (this.latched.has(bound.action)) this.latched.delete(bound.action)
      else this.latched.add(bound.action)
    }
  }
  /** True while any key bound to the action is held. */
  holds(action: FlightAction) { return this.keyboard.bindings[action].some(code => code !== null && this.held.has(code)) }
  readonly stick = createMouseStick()
  /** Mouse aim (mouseAim.ts): the direction the instructor flies the nose to. */
  readonly aim = createMouseAim()
  /** The aircraft as of the last simulation tick, for the instructor. Set by the flight scene. */
  pose: AircraftState | null = null
  // The rendered view's right and up, which mouse motion turns the aim about.
  private view = { right: { x: 0, y: 0, z: 1 } as Vec3, up: { x: 0, y: 1, z: 0 } as Vec3 }
  setView(right: Vec3, up: Vec3) { this.view = { right: { ...right }, up: { ...up } } }
  /** Either mouse aim: world-locked ('aim') or screen-locked ('cursor'). */
  get aiming() { return this.mouse.mode === 'aim' || this.mouse.mode === 'cursor' }
  // Cursor mode: whether the × moved since the last command (a resting hand, not a held one).
  private cursorMoved = false
  /** Vertical field of view of the flight camera (Settings › Camera), for cursor mode's lens
   * before a frame has been rendered. */
  fov = 56
  /** Cursor mode: the ray through the × from the last rendered frame (set by the flight scene). */
  cursorRay: CursorRay | null = null
  /** The selected target as of the last simulation tick (set by the flight scene), so cursor
   * mode aims the reticle the HUD draws: at the target's range. */
  target: AircraftState | null = null
  // Cursor mode: pixels the hand moved the × since the last assist draw, and the lens the ×
  // was last read through.
  private handPixels = 0
  private lensFov = 0
  /** The gun trigger, held on a key or the mouse. */
  get triggerHeld() { return this.holds('fireGun') || this.mouseGun }
  private mount: { aircraftId: string; gun: GunMount } | null = null
  /** Put the aim back on the nose at the next command: after a reset, a respawn or a resume. */
  resyncAim() { unsyncAim(this.aim) }
  // The flight surface in pixels, and the gate that spans it.
  width = 640; height = 480
  gate: StickGate = stickGate(640, 480)
  // How far the airframe appears rotated inside the frame, and how much of that applies.
  screen: ScreenFrame = LEVEL_FRAME
  /** Cursor mode's frame: the true horizon under a horizon-locked camera (Balanced's small
   * cosmetic tilt left out, or a held turn would sink), the airframe under Aircraft locked. */
  cursorFrame: ScreenFrame = LEVEL_FRAME
  clear() { this.cursorMoved = false; this.handPixels = 0; this.lensFov = 0; this.target = null; this.mouseGun = false; this.nextTarget = false; this.highAoa = 0; this.pedal = 0; this.pedalTick = -1; this.slew = { pitch: 0, x: 0 }; this.slewTick = -1; this.turn = null; this.level = null; this.flip = 0; this.centred = 0; this.capture.armed = false; this.capture.hold = null; this.springTick = -1; this.since = { x: 0, y: 0 }; this.held.clear(); this.latched.clear(); clearStick(this.stick); unsyncAim(this.aim); this.pose = null; this.screen = LEVEL_FRAME; this.cursorFrame = LEVEL_FRAME; this.cursorRay = null }
  // The surface has taken the pointer: neutral and live from the first frame.
  engage() { engageStick(this.stick); unsyncAim(this.aim); this.slew = { pitch: 0, x: 0 }; this.slewTick = -1; this.turn = null; this.level = null; this.flip = 0; this.centred = 0; this.since = { x: 0, y: 0 }; this.handPixels = 0; this.lensFov = 0 }
  setViewport(width: number, height: number) {
    if (!(width > 0 && height > 0) || (width === this.width && height === this.height)) return
    this.width = width; this.height = height
    this.gate = stickGate(width, height)
    this.move(0, 0)
  }
  move(x: number, y: number) {
    const k = this.mouse.sensitivity
    // Mouse aim turns the aim, and drives the relative stick the instructor hands over to in post-stall.
    if (this.mouse.mode === 'aim' && this.stick.live && this.aim.synced) turnAim(this.aim, x * k, (this.mouse.invertPitch ? -y : y) * k, this.view.right, this.view.up)
    // Cursor mode: the × is a held position anywhere in the window, like the positional stick.
    // Invert pitch inverts the hand's motion; the × is then read where it is drawn.
    if (this.mouse.mode === 'cursor') {
      const { px, py } = this.stick
      moveStick(this.stick, x * k, (this.mouse.invertPitch ? -y : y) * k, this.gate)
      this.handPixels += Math.hypot(this.stick.px - px, this.stick.py - py)
      if (x || y) this.cursorMoved = true
    }
    else if (this.mouse.mode !== 'stick') {
      const { px, py } = this.stick
      moveRelativeStick(this.stick, x * k, y * k, this.gate)
      this.since.x += this.stick.px - px; this.since.y += this.stick.py - py
    }
    // Positional stick: raw motion; sensitivity sizes the disc instead (F22).
    else moveDiscStick(this.stick, x, y, this.stickRadius)
  }
  /** Positional stick mode's full-deflection disc, in pixels. */
  get stickRadius() { return positionalRadius(this.gate, this.mouse.sensitivity) }
  /*
  Cursor mode, once per rendered frame. The × is a direction through the lens, so when the
  field of view changes (speed, burner, the gun zoom) it is moved to keep its angle: a zoom
  while firing must not swing the aim off the target under it.
  */
  setLens(fovDeg: number) {
    if (this.mouse.mode !== 'cursor' || !(fovDeg > 0)) return
    const previous = this.lensFov
    this.lensFov = fovDeg
    if (!(previous > 0) || previous === fovDeg) return
    const scale = Math.tan(previous * Math.PI / 360) / Math.tan(fovDeg * Math.PI / 360)
    moveStick(this.stick, this.stick.px * (scale - 1), this.stick.py * (scale - 1), this.gate)
  }
  /*
  Cursor mode's aim assist, once per rendered frame like a hand: draws the × toward the lead
  marker at `lead` (pixels from the middle), `leadDeg` off it through the lens, or `targetDeg`
  off the target itself while firing, `range` metres from it (aimAssist.ts, `cursorDraw`). Not while the instructor is
  not flying (a key, post-stall, a recovery). Not a hand on the mouse, so it never counts
  against hands-off recovery. True while it acts.
  */
  drawCursor(lead: { x: number; y: number } | null, leadDeg: number, targetDeg: number, dt: number, range: number) {
    const hand = this.handPixels
    this.handPixels = 0
    if (this.mouse.mode !== 'cursor' || !lead || !this.stick.live || !this.aim.synced || this.aim.share <= 0 || this.aim.recovering) return false
    if ((['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight'] as const).some(action => this.holds(action))) return false
    const share = cursorDraw(this.mouse.aimAssist, leadDeg, targetDeg, dt, this.triggerHeld, hand, range)
    if (share <= 0) return false
    moveStick(this.stick, (lead.x - this.stick.px) * share, (lead.y - this.stick.py) * share, this.gate)
    return true
  }
  command(tick: number, entityId: string, preset: InputPreset) {
    const c = neutralCommand(tick, entityId)
    const has = (action: FlightAction) => this.holds(action)
    c.pitch = +has('pitchUp') - +has('pitchDown')
    c.roll = +has('rollRight') - +has('rollLeft')
    this.stepPedal(tick, +has('yawRight') - +has('yawLeft'))
    // Coordination is read off the keyboard roll before the mouse joins, so the keyboard
    // keeps the axes it was tuned on and a mouse roll adds no yaw of its own. A held pedal
    // key owns the axis (Q + E together is zero); a released pedal hands back to coordination.
    c.yaw = has('yawLeft') || has('yawRight') ? this.pedal : this.pedal + (1 - Math.abs(this.pedal)) * c.roll * 0.12
    if (preset === 'mouse' && this.aiming) this.flyAim(c, tick, has)
    else if (preset === 'mouse' && this.mouse.mode === 'stick') this.flyStick(c, tick)
    else if (preset === 'mouse') {
      this.stepSpring(tick)
      // The body frame reads the stick as drawn: mouse up is nose up at every bank.
      const body = this.mouse.frame === 'body'
      const axes = readStickAxes(this.stick, body ? LEVEL_FRAME : this.screen, body ? 0 : this.highAoa, MOUSE_RELATIVE)
      if (axes) {
        c.pitch = strongest(c.pitch, this.mouse.invertPitch ? -axes.pitch : axes.pitch)
        if (this.mouse.xAxis === 'yaw') c.yaw = strongest(c.yaw, axes.roll)
        else c.roll = strongest(c.roll, axes.roll)
      }
    }
    c.speedAdjust = +has('speedUp') - +has('speedDown')
    c.airbrake = this.keyboard.airbrake === 'toggle' ? this.latched.has('airbrake') : has('airbrake')
    c.afterburner = this.keyboard.afterburner === 'toggle' ? this.latched.has('afterburner') : has('afterburner')
    c.gunHeld = has('fireGun') || (preset === 'mouse' && this.mouseGun)
    // A push that brings a post-stall nose back stops on the horizon unless the throttle is on
    // (pushCapture.ts). Not under mouse aim, whose instructor has its own hands-off recovery.
    if (!(preset === 'mouse' && this.aiming)) c.pitch = capturePush(this.capture, this.pose, this.highAoa, c.pitch, c.speedAdjust > 0 || c.afterburner)
    if (this.nextTarget) { this.nextTarget = false; c.actions.push({ id: this.actionId++, type: 'next-target' }) }
    return c
  }
  /*
  Mouse aim. Any held pitch, roll or yaw key takes all three axes from the instructor and
  settles the aim onto the nose, so a released key leaves the jet where the key put it. Otherwise
  the instructor flies its share and the relative stick, read in the body frame, the rest: all
  of it in post-stall, until the hands have been off for a moment (stepAim).
  */
  private flyAim(c: ReturnType<typeof neutralCommand>, tick: number, has: (action: FlightAction) => boolean) {
    const cursor = this.mouse.mode === 'cursor'
    if (!cursor) this.stepSpring(tick)
    if (!this.stick.live) return
    // A wreck has no nose to aim; the respawned jet starts with the aim on its own.
    if (!this.pose?.alive) { unsyncAim(this.aim); return }
    const keyHeld = (['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight'] as const).some(has)
    // Post-stall's stick: the sprung one, or in cursor mode the held × as the positional stick.
    const stick = readStickAxes(this.stick, LEVEL_FRAME, 0, cursor ? MOUSE_STICK : MOUSE_RELATIVE) ?? { pitch: 0, roll: 0 }
    // The hand is on the mouse while the stick is out of the middle (or the × just moved).
    const handsOn = keyHeld || Math.hypot(stick.pitch, stick.roll) > 0.02 || (cursor && this.cursorMoved)
    this.cursorMoved = false
    // Cursor mode: the nose that puts the gun reticle under the ×, read afresh every tick (a
    // recovery flies its own). Through the rendered camera once there is one.
    if (cursor && this.aim.synced && !this.aim.recovering && !keyHeld) {
      const target = this.target?.alive ? this.target : null
      if (this.cursorRay) aimAtRay(this.aim, this.pose, this.cursorRay, this.gunOf(this.pose.aircraftId), target)
      else aimAtCursor(this.aim, this.pose, this.stick.px, this.stick.py, this.height, this.fov, this.cursorFrame.angle * this.cursorFrame.blend)
    }
    stepAim(this.aim, this.pose, tick, keyHeld, handsOn)
    // Cursor mode on a moving target: the lead's own turn is fed forward while the × is on it.
    if (cursor && !this.aim.recovering && !keyHeld) trackLead(this.aim, this.pose, this.target?.alive ? this.target : null, this.gunOf(this.pose.aircraftId), tick)
    else this.aim.tracking = 0
    // Close behind the locked target: the instructor turns with it.
    followTarget(this.aim, this.pose, !this.aim.recovering && !keyHeld && this.target?.alive ? this.target : null, this.gunOf(this.pose.aircraftId), tick)
    const share = this.aim.share, pilot = this.mouse.invertPitch && !cursor ? -stick.pitch : stick.pitch
    const flown = share > 0 ? instruct(this.aim, this.pose) : { pitch: 0, roll: 0, yaw: 0 }
    c.pitch = strongest(c.pitch, share * flown.pitch + (1 - share) * pilot)
    c.roll = strongest(c.roll, share * flown.roll + (1 - share) * stick.roll)
    c.yaw = strongest(c.yaw, share * flown.yaw)
  }
  /*
  Positional stick mode, as example/F22 flies it: the disc reading, turned into the airframe's
  frame, then rate limited toward the reading once per command tick. A held key still
  outranks it on its own axis.

  Always read as drawn on screen, whatever the Stick frame setting says: F22 has no body
  frame, and that turn is what makes a pointer held to the right a bank to the right rather
  than a roll that never stops. The bank settles where the airframe appears rotated by the
  pointer's angle. Under Aircraft locked nothing is rotated on screen, so a held side point
  keeps rolling there, as it does under F22's Roll On.

  The turn is F22's screen roll, rate limited at 200°/s like its camera's roll correction, and
  held where there is no level frame at all. Never faded out near the vertical: a faded turn
  cancels every pointer direction to nothing there, and the jet just falls.

  Through the vertical the level frame flips by half a turn although the airframe has not
  rolled. That flip is added back (`flip`), so a pull held through the vertical stays the same
  pull and the jet goes all the way round the loop rather than stopping on the vertical or
  rolling around it. The half turn is kept until the stick has rested in its dead zone for a
  moment (FLIP_RELEASE_SECONDS), not when the pointer merely swings across: a Cobra pulled past
  the vertical and then pushed back is the same half turn, and dropping it on the push would
  read the push as a pull, the opposite of the body-axis reading post-stall hands over to, and
  the two would cancel with the jet hanging nose high. While the stick rests in the dead zone it
  commands nothing, so the turn jumps straight to its goal there instead of walking.
  */
  private flyStick(c: ReturnType<typeof neutralCommand>, tick: number) {
    const yaw = this.mouse.xAxis === 'yaw'
    if (!this.stick.live) { this.slew = { pitch: 0, x: 0 }; this.slewTick = tick; this.turn = null; return }
    if (tick !== this.slewTick) {
      // A tick that goes backwards is a runtime reset: start again from neutral.
      if (tick < this.slewTick) { this.slew = { pitch: 0, x: 0 }; this.turn = null }
      const ticks = this.slewTick < 0 || tick < this.slewTick ? 1 : tick - this.slewTick
      this.slewTick = tick
      const step = ticks * WORLD_STEP, rates = MOUSE_POSITIONAL.slew
      const limit = MOUSE_POSITIONAL.turnRate * step, centred = Math.hypot(this.stick.x, this.stick.y) <= MOUSE_POSITIONAL.deadZone
      // The level frame is read only outside the cone round the vertical (blend 1): inside it
      // the bank swings with the smallest turn of the nose, and chasing it spins the jet round
      // the vertical. Coming out more than a quarter turn from where it went in is the nose
      // having passed the vertical, not a roll.
      if (this.screen.blend >= 1) {
        if (this.level !== null && Math.abs(wrapPi(this.screen.angle - this.level)) > Math.PI / 2) this.flip = wrapPi(this.flip + Math.PI)
        this.level = this.screen.angle
      }
      this.centred = centred ? this.centred + step : 0
      if (this.centred >= FLIP_RELEASE_SECONDS) this.flip = 0
      const goal = wrapPi((this.level ?? 0) + this.flip)
      this.turn = this.turn === null || centred ? goal : wrapPi(this.turn + Math.max(-limit, Math.min(limit, wrapPi(goal - this.turn))))
      const axes = readPositionalAxes(this.stick, { angle: this.turn, blend: 1 }, this.mouse.invertPitch, this.highAoa) ?? { pitch: 0, roll: 0 }
      this.slew.pitch = slewToward(this.slew.pitch, axes.pitch, rates.pitch, step)
      this.slew.x = slewToward(this.slew.x, axes.roll, yaw ? rates.yaw : rates.roll, step)
    }
    c.pitch = strongest(c.pitch, this.slew.pitch)
    if (yaw) c.yaw = strongest(c.yaw, this.slew.x)
    else c.roll = strongest(c.roll, this.slew.x)
  }
  private gunOf(aircraftId: string) {
    if (this.mount?.aircraftId !== aircraftId) this.mount = { aircraftId, gun: gunMountOf(aircraftId) }
    return this.mount.gun
  }
  // Like the pedal: once per command tick, however many frames or reads fall inside it.
  // The stick carried from the last tick springs for the ticks in between; motion since then
  // does not, so what the hand just did is read in full.
  private stepSpring(tick: number) {
    if (tick === this.springTick) return
    const ticks = this.springTick < 0 || tick < this.springTick ? 0 : tick - this.springTick
    this.springTick = tick
    springStick(this.stick, ticks, this.gate, this.since)
    this.since = { x: 0, y: 0 }
  }
  private stepPedal(tick: number, target: number) {
    if (tick === this.pedalTick) return
    // A tick that goes backwards is a runtime reset: start again from centre.
    if (tick < this.pedalTick) this.pedal = 0
    const ticks = this.pedalTick < 0 || tick < this.pedalTick ? 1 : tick - this.pedalTick
    this.pedalTick = tick
    const travel = ticks * WORLD_STEP / PEDAL_RAMP_SECONDS
    this.pedal = Math.abs(target - this.pedal) <= travel ? target : this.pedal + Math.sign(target - this.pedal) * travel
  }
}
