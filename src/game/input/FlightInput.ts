import { MathUtils, Vector3, type Camera } from 'three'
import { neutralCommand, type PilotCommand } from '../runtime/commands'
import { WORLD_STEP } from '../runtime/clock'
import type { AircraftState } from '../state/WorldState'
import type { CoreAssist, CoreProfile } from '../flightCore/profile'
import { CAMERA } from '../control/config'
import { FlightControls, type ControlKeys } from '../control/ControlAxes'
import { ControlMixer } from '../control/ControlMixer'
import { StateAircraft } from '../control/controlAircraft'
import { defaultMouseSettings, type MouseSettings } from '../control/mouseSettings'
import { actionForCode, defaultKeyboardSettings, missileSelectActions, type FlightAction, type KeyboardSettings } from './keyBindings'
export type { InputPreset } from './keyBindings'
import type { InputPreset } from './keyBindings'

const wrapPi = (angle: number) => angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI))

/*
The player's flight input, ported from example/flight-control (docs/MOUSE_CONTROL_SPEC.md there).

  keys    → FlightControls (progressive axes: a tap nudges, a hold ramps to full, a release
            decays; W/S a smoothed thrust command, released = hold speed)
  mouse   → MouseAim (a world aim direction, turned about the rendered view's axes)
  both    → ControlMixer: per axis, a key is 100 % manual and the aim controller takes the axis
            back after release; Space turns the mouse into a virtual stick (PSM)
          → PilotCommand

Mouse + Keyboard is the 'mouse' preset, Keyboard Only the 'keyboard' preset (the mixer is a
pass-through there). The aim controller reads the aircraft through controlAircraft.ts, which
divides by the flight core's own available rates, so it follows whatever physics the core has.

Determinism: the axes and the mixer step once per command tick, with dt = ticks × WORLD_STEP,
never per rendered frame, and the recorded command carries their output, so a replay or another
frame rate flies the same. Mouse motion turns the aim as it arrives, like the example.

What this project keeps around it: key bindings with hold/toggle, the weapon and target actions,
the left/right mouse buttons, free look (C) and look back (R), and the gun aim assist, which
draws the same aim direction (FlightScene, gunLock.ts).
*/
export class FlightInput {
  readonly held = new Set<string>()
  mouse: MouseSettings
  keyboard: KeyboardSettings
  /** Left mouse held while the pointer is locked to the flight surface. */
  mouseGun = false
  /** The new flight core's tuned profile (set by the flight scene from the Flight Lab), or null:
   * the aim controller then reads the aircraft's untuned core profile. */
  core: { profile: CoreProfile; assist: CoreAssist } | null = null
  /** The last command built, for the Flight Lab overlay. */
  lastCommand: PilotCommand | null = null
  /** The aircraft as of the last simulation tick. Set by the flight scene. */
  pose: AircraftState | null = null
  /** Set by the flight scene each frame: the camera is still turned off the chase shot (easing back after a release). */
  viewAway = false
  /** Set by the flight scene: the gun lock's magnet flies the nose (arcade core), so the aim
   * controller keeps off the stick and only held keys move it. No bank-to-turn rolls the jet. */
  gunTracking = false

  /** Keyboard axes and what the aircraft flies (example: FlightControls → ControlMixer). */
  readonly controls = new FlightControls()
  readonly mixer = new ControlMixer(this.controls)
  private readonly aircraft = new StateAircraft()
  // The rendered view without shake or free look, which the mouse aims through. Set by the scene.
  private view: Camera | null = null
  private stepTick = -1
  // Put the aim back on the nose at the next command: after a reset, a respawn or a resume.
  private resync = true
  // A next-target press waiting for the next command tick. One press is one action.
  private nextTarget = false
  // The missile slot picked since the last command (keys 1–4), or null.
  private select: number | null = null
  // A missile launch pressed since the last command (K, or the right mouse button).
  private launch = false
  // A countermeasure salvo pressed since the last command (F).
  private dispense = false
  private actionId = 1
  // Afterburner/airbrake/PSM switched on by a toggle-mode key press.
  private readonly latched = new Set<FlightAction>()
  // Free look: the view's turn off the chase shot from mouse motion while the key is held (radians).
  private look = { yaw: 0, pitch: 0 }
  // Degrees the hand has turned the aim since the gun lock last read it (takeHandMotion).
  private hand = 0
  private readonly before = new Vector3()

  constructor(mouse: MouseSettings = defaultMouseSettings, keyboard: KeyboardSettings = defaultKeyboardSettings) { this.mouse = { ...mouse }; this.keyboard = keyboard }

  /** The right mouse button under the mouse preset: one missile launch, like a press of the launch key. */
  pressLaunch() { this.launch = true }
  /** A key went down. Repeats keep a held key held but never flip a toggle again. */
  press(code: string, repeat = false) {
    this.held.add(code)
    const bound = repeat ? null : actionForCode(this.keyboard.bindings, code)
    if (bound?.action === 'nextTarget') this.nextTarget = true
    const slot = bound ? (missileSelectActions as readonly string[]).indexOf(bound.action) : -1
    if (slot >= 0) this.select = slot
    if (bound?.action === 'fireMissile') this.launch = true
    if (bound?.action === 'countermeasure') this.dispense = true
    if (bound && (bound.action === 'afterburner' || bound.action === 'airbrake' || bound.action === 'psm') && this.keyboard[bound.action] === 'toggle') {
      if (this.latched.has(bound.action)) this.latched.delete(bound.action)
      else this.latched.add(bound.action)
    }
  }
  /** True while any key bound to the action is held. */
  holds(action: FlightAction) { return this.keyboard.bindings[action].some(code => code !== null && this.held.has(code)) }
  private switched(action: 'afterburner' | 'airbrake' | 'psm') { return this.keyboard[action] === 'toggle' ? this.latched.has(action) : this.holds(action) }

  /** While the view is turned away the mouse moves the camera, not the aim, and the aim holds still,
   * so the jet keeps flying where it was going. */
  get lookingAway() { return this.viewAway || this.holds('freeLook') || this.holds('lookBack') }
  /** Where the camera looks off the chase shot: the free look while its key is held, plus a half turn for look back.
   * Yaw > 0 turns the view left, pitch > 0 up. */
  lookTarget() {
    if (!this.holds('freeLook')) this.look = { yaw: 0, pitch: 0 }
    return { yaw: wrapPi(this.look.yaw + (this.holds('lookBack') ? Math.PI : 0)), pitch: this.look.pitch }
  }

  /** The mouse aim as the HUD, the camera and the aim assist read it. `direction` is the mixer's own
   * vector: the aim assist turns it in place. */
  get aim() {
    const synced = !this.resync && !!this.pose?.alive
    return { direction: this.mixer.aim.dir, share: this.mixer.aimShare, synced }
  }
  /** The PSM virtual stick (screen −1..1 per axis, y up), while the mouse is flying it. */
  get virtualStick() { return this.mixer.stickMode && this.mixer.stick.active ? this.mixer.stick : null }
  /** The gun trigger, held on a key or the mouse. */
  get triggerHeld() { return this.holds('fireGun') || this.mouseGun }

  /** Put the aim back on the nose at the next command. */
  resyncAim() { this.resync = true }
  /** The surface has taken the pointer: the aim starts on the nose. */
  engage() { this.resync = true }
  clear() {
    this.mouseGun = false; this.nextTarget = false; this.select = null; this.launch = false; this.dispense = false
    this.held.clear(); this.latched.clear(); this.controls.reset(); this.stepTick = -1; this.resync = true
    this.pose = null; this.look = { yaw: 0, pitch: 0 }; this.viewAway = false; this.hand = 0; this.gunTracking = false
  }

  /** The rendered view the mouse aims through, without shake or free look (the chase shot). */
  setView(camera: Camera) { this.view = camera }
  /** The flight surface in pixels: half of it is full virtual stick travel on each axis. */
  setViewport(width: number, height: number) {
    if (!(width > 0 && height > 0)) return
    this.mixer.viewport.w = width; this.mixer.viewport.h = height
  }

  /** Mouse motion (pixels): free look while its key is held, else the aim (or the PSM virtual stick). */
  move(x: number, y: number) {
    if (this.holds('freeLook') || this.holds('lookBack')) {
      if (!this.holds('freeLook')) return
      const k = CAMERA.freeLookDegPerPx * Math.PI / 180, most = CAMERA.freeLookMaxPitchDeg * Math.PI / 180
      this.look.yaw = wrapPi(this.look.yaw - x * k)
      this.look.pitch = MathUtils.clamp(this.look.pitch - (this.mouse.invertPitch ? -y : y) * k, -most, most)
      return
    }
    if (this.viewAway || this.resync || !this.view || !this.pose?.alive) return
    const k = this.mouse.sensitivity
    this.before.copy(this.mixer.aim.dir)
    this.mixer.mouseMove(x * k, (this.mouse.invertPitch ? -y : y) * k, this.view)
    this.hand += this.before.angleTo(this.mixer.aim.dir) * 180 / Math.PI
  }

  /** Degrees the hand turned the aim since the last call (the gun lock's flick test). */
  takeHandMotion() { const hand = this.hand; this.hand = 0; return hand }

  command(tick: number, entityId: string, preset: InputPreset) {
    const c = neutralCommand(tick, entityId)
    const has = (action: FlightAction) => this.holds(action)
    const psm = this.switched('psm')
    if (tick !== this.stepTick) {
      // A tick that goes backwards is a runtime reset: start again from neutral.
      if (tick < this.stepTick) { this.controls.reset(); this.resync = true }
      const ticks = this.stepTick < 0 || tick < this.stepTick ? 1 : tick - this.stepTick
      this.stepTick = tick
      this.step(ticks * WORLD_STEP, preset, psm, has)
    }
    const stick = this.gunTracking && preset === 'mouse' ? this.controls : this.mixer
    c.pitch = stick.pitch; c.roll = stick.roll; c.yaw = stick.yaw
    c.speedAdjust = this.controls.thrust
    c.airbrake = this.switched('airbrake')
    c.afterburner = this.switched('afterburner')
    c.psm = psm
    c.gunHeld = has('fireGun') || (preset === 'mouse' && this.mouseGun)
    if (this.nextTarget) { this.nextTarget = false; c.actions.push({ id: this.actionId++, type: 'next-target' }) }
    if (this.select !== null) { c.actions.push({ id: this.actionId++, type: 'select-secondary', slot: this.select }); this.select = null }
    if (this.launch) { this.launch = false; c.actions.push({ id: this.actionId++, type: 'fire-missile' }) }
    if (this.dispense) { this.dispense = false; c.actions.push({ id: this.actionId++, type: 'countermeasure' }) }
    this.lastCommand = c
    return c
  }

  /*
  One command tick of the example's per-step input (Game.simulate: controls.update, then
  mixer.step). The FCS itself is part of the arcade flight core and steps after the command.
  */
  private step(dt: number, preset: InputPreset, psm: boolean, has: (action: FlightAction) => boolean) {
    const keys: ControlKeys = {
      pitchUp: has('pitchUp'), pitchDown: has('pitchDown'),
      rollLeft: has('rollLeft'), rollRight: has('rollRight'),
      yawLeft: has('yawLeft'), yawRight: has('yawRight'),
      throttleUp: has('speedUp'), throttleDown: has('speedDown'),
      airbrake: this.switched('airbrake'), afterburner: this.switched('afterburner'), psm,
    }
    this.controls.update(keys, dt)
    const mixer = this.mixer
    if (mixer.mode !== preset) { mixer.mode = preset; this.resync = true }
    mixer.aimLimit = this.mouse.aimLimit
    const pose = this.pose
    // A wreck has no nose to aim: the controls pass through until the respawn re-syncs the aim.
    if (!pose?.alive) { mixer.mode = 'keyboard'; mixer.step(this.aircraft, dt); mixer.mode = preset; this.resync = true; return }
    this.aircraft.read(pose, this.core?.profile)
    if (this.resync) { mixer.reset(this.aircraft); this.resync = false }
    // The arcade core runs the example's FCS: the mixer reads its mode and w as the example's did
    // (the last step's). The other cores have none, so the PSM key stands in, at full weight.
    const fcs = pose.arcadeFlight?.fcs
    mixer.step(this.aircraft, dt, fcs ? { mode: fcs.mode, wHigh: fcs.wHigh } : { mode: psm ? 'PSM' : 'NORMAL', wHigh: 1 })
  }
}
