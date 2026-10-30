/*
The flight's recorded sounds (soundBank.ts), one set for every aircraft for now (user decision 2026-10-26).

- The player's jet is heard flat, not placed: the chase camera rides with it. The engine bed climbs in
  pitch and level with power; the afterburner loop fades in with the burner, with no light-up sound
  (user request 2026-10-26); wind grows with Mach, buffet with g and AoA; a sonic boom on passing
  Mach 1 (the HUD's Mach, as vapor uses).
- Every other aircraft is placed in 3D about the camera: its engine, with Doppler, and a fly-by timed so
  the recording's loudest moment lands on the closest pass.
- Guns: a loop while rounds leave (`gun.shots` climbing), the spin-down when they stop. A trigger held
  through a heat lockout fires nothing, so it is silent.
- Missiles: the launch rush when the motor lights (a bay missile lights after separating), then the
  motor placed on the missile until burnout. Someone else's missile passing the player close but outside
  its fuse: a rush timed so its loudest moment lands on the pass, panned to the side it passes.
- The player's flares, in one of two styles (FLARE_STYLE). Recorded (2026-10-30): the recorded burst
  whole when a run of flares starts, started again only if flares are still leaving once its pops are
  over; its six pops over 1.35 s do not line up with the dispenser's eight over 0.7 s. Pops (2026-10-28):
  a pop as flares leave, so a faster dispenser sounds faster with no change here, but never closer than
  the recording's pace (2026-10-30, one for every other flare at 0.1 s): one of six recorded pops at
  random, never the same twice running, a little off in pitch and level, panned to the side the flares
  leave; under them one burn, started again while flares keep coming and left to die out after the last. Before that a firework thunk per
  flare, and before that a synthesised blip.
- Explosions at missile bursts, placed, from three recordings near to far picked by distance; kills add
  the large boom. Gun hits on the player, and the player's own hits as a quiet knock.
- The RWR lock warning, looped while a radar holds us locked. The launch and missile warble stays
  synthesised (lockTone.ts).

Each sound plays into its volume channel (audioSettings.ts): engine, air, gun, missile (flares too), impacts or
warning. Silent while paused or hidden: the mixer suspends the context. Levels in MIX are provisional, set by
measurement, waiting on playtest by ear.
*/
import { Vector3, type Camera } from 'three'
import type { AircraftState, Vec3, WorldState } from '../../game/state/WorldState'
import type { GameEvent } from '../../game/runtime/events'
import type { ProjectileHit } from '../../game/combat/projectiles'
import type { ThreatLevel } from '../../game/combat/rwr'
import { motorBurning } from '../../game/combat/missiles'
import { getWeapon } from '../../content/weapons'
import { arcadeSpeed } from '../../game/flight/speedLimits'
import { machNumber } from '../vapor/atmosphere'
import type { AudioMixer } from './mixer'
import { loadSounds, sound, type SoundId } from './soundBank'

/** Linear gains on files levelled to about -20 dBFS RMS (loops) or -1 dBFS peak (one-shots).
 * The synthesised tones peak near 0.06, so the beds sit under them. Provisional. */
const MIX = {
  engine: 0.32, burner: 0.67, wind: 0.5, buffet: 0.45, boom: 0.25,
  gun: 0.5, launch: 0.22, motor: 0.9, otherEngine: 1.4, flyby: 0.75, missileMiss: 0.5, flare: 0.19,
  explosion: 0.7, hitTaken: 0.35, hitDealt: 0.12, lockWarning: 0.09,
} as const
const SPEED_OF_SOUND = 343
/** Seconds into air/flyby.mp3 where it is loudest (scripts/build-audio.mjs). */
export const FLYBY_PEAK = 2.5
const FLYBY = { range: 150, minClosing: 80, every: 6 } as const
/** Seconds without a new round before the gun counts as stopped: longer than one round apart at 25 rounds/s. */
const GUN_GAP = 0.1
/** Seconds between two hit knocks of one kind; more hits in between are one knock. */
const HIT_GAP = 0.06
/** Seconds into weapons/missile-miss.mp3 where it is loudest (scripts/build-audio.mjs). */
export const MISS_PEAK = 0.56
/** A missile passing the player: nearer than `range` m but `margin` m outside its fuse, closing faster
 * than `minClosing` m/s. Heard from `lead` s before the pass; one that turns in after all fades out on its
 * burst. The missile's own placed motor drops to `duck` of its level, the pass voice taking over. */
const MISS = { range: 150, margin: 3, minClosing: 100, lead: 2.5, pan: 0.6, duck: 0.15 } as const
/** The pass voice, drawn out longer than the real pass so it reads as far, near, then far again: a copy of
 * the motor whose gain climbs from `start` through `near` (`nearAt` s before the pass) to full, then falls
 * to `end` over `recede` s. A low-pass opens from `far` Hz to `open` Hz at the pass and closes to `gone` Hz;
 * the pitch drops from `high` to `low` across the pass. The recorded whoosh peaks on the pass. `level` scales it all. */
const PASS = { start: 0.04, near: 0.3, nearAt: 0.5, recede: 3, end: 0.015, far: 1000, mid: 3000, open: 14000, gone: 600, high: 1.12, low: 0.88, bed: 0.8, level: 0.8 } as const
/** Another's missile motor, kept easy on the ear rather than true to the missile: a gentler fall-off with
 * distance, `shift` of the true Doppler shift reached over `glide` s, and the position followed over `track` s. */
const ENEMY_MOTOR = { rolloff: 0.35, shift: 0.3, glide: 0.2, track: 0.08 } as const
/** How the player's flares sound: 'recorded' plays the recorded burst per run, 'pops' a pop per flare. */
const FLARE_STYLE: 'recorded' | 'pops' = 'pops'
/** Flare pops: pitch and level spread (share, dB) so a run never sounds like one sample repeated, the pan
 * to the side each flare leaves, and how long the burn plays before a newer flare starts it again (s).
 * Pops come no closer than `gap` s, near the recorded burst's 0.265 s: flares faster than that share a pop
 * (the dispenser's 0.1 s gets one for every other flare), panned to the mean side of the flares it stands for.
 * The recorded burst's pops are over `burstPops` s in (its last pop plus one gap, scripts/build-audio.mjs). */
const FLARE = { pops: ['flarePop1', 'flarePop2', 'flarePop3', 'flarePop4', 'flarePop5', 'flarePop6'], spread: 0.06, quieter: 2.5, pan: 0.35, gap: 0.16, burnEvery: 0.4, burstPops: 1.35 } as const
/** Missile bursts: the recording for each distance from the camera (m), near to far (scripts/build-audio.mjs).
 * Each already sounds its distance, so the level falls off gently with no treble taken off. Provisional. */
const EXPLOSION = { tiers: [{ id: 'explosionNear', within: 600 }, { id: 'explosionMid', within: 2000 }, { id: 'explosionFar', within: Infinity }], reference: 150, rolloff: 0.35 } as const

export interface SoundFrame {
  /** False while paused or hidden. */
  active: boolean
  world: WorldState | null
  player: AircraftState
  /** The player's drawn velocity, between ticks; the camera rides with it. */
  velocity: Vec3
  camera: Camera
  events: readonly GameEvent[]
  hits: readonly ProjectileHit[]
  /** The RWR's highest level shown (rwrFrame.ts). */
  warning: ThreatLevel | null
}

type Loop = { source: AudioBufferSourceNode; gain: GainNode }
type Placed = { panner: PannerNode; air: BiquadFilterNode }
type GunVoice = { shots: number; last: number; loop: Loop | null }
type Craft = { out: Placed; near: Placed; guns: Placed; engine: Loop | null; gun: GunVoice; flyby: number }
type Rocket = { out: Placed; motor: Loop | null; lit: boolean; passed: boolean; pass: { gain: GainNode; passAt: number } | null }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z

/** Playback rate a sound at `source` reaches `listener` with, both moving (m/s, simulation units). */
export function dopplerRate(source: Vec3, sourceVelocity: Vec3, listener: Vec3, listenerVelocity: Vec3) {
  const d = { x: listener.x - source.x, y: listener.y - source.y, z: listener.z - source.z }, length = Math.hypot(d.x, d.y, d.z)
  if (length < 1e-3) return 1
  const toListener = { x: d.x / length, y: d.y / length, z: d.z / length }
  const rate = (SPEED_OF_SOUND - dot(listenerVelocity, toListener)) / Math.max(SPEED_OF_SOUND * 0.2, SPEED_OF_SOUND - dot(sourceVelocity, toListener))
  return clamp(rate, 0.5, 2)
}

/** The next flare pop: any of `count` but the one just played; `random` in [0, 1). */
export function nextPop(last: number, count: number, random: number) {
  if (last < 0 || count < 2) return Math.floor(random * count)
  return (last + 1 + Math.floor(random * (count - 1))) % count
}

/** The missile burst recording for a burst `distance` m from the camera. */
export function explosionSound(distance: number): SoundId {
  return EXPLOSION.tiers.find(tier => distance < tier.within)!.id
}

/** When (seconds from now) and how near (m) something at `offset` closing at `velocity` passes. */
/** The pass voice's gain `ahead` s before the pass (PASS): steady in dB from the lead to `nearAt`, then
 * steeper to full, so a pass first heard late starts where the swell would be by then. */
export function approachGain(ahead: number) {
  const tween = (from: number, to: number, share: number) => from * (to / from) ** clamp(share, 0, 1)
  if (ahead >= PASS.nearAt) return tween(PASS.start, PASS.near, (MISS.lead - ahead) / (MISS.lead - PASS.nearAt))
  return tween(PASS.near, 1, 1 - ahead / PASS.nearAt)
}

/** A playback rate moved only `share` of the way from 1 towards `rate`. */
export function softenRate(rate: number, share: number) {
  return 1 + (rate - 1) * share
}

export function closestApproach(offset: Vec3, velocity: Vec3) {
  const speed2 = dot(velocity, velocity)
  if (speed2 < 1) return { time: Infinity, distance: Math.hypot(offset.x, offset.y, offset.z) }
  const time = -dot(offset, velocity) / speed2
  return { time, distance: Math.hypot(offset.x + velocity.x * time, offset.y + velocity.y * time, offset.z + velocity.z * time) }
}

export function createFlightSound(mixer: AudioMixer) {
  let built: AudioContext | null = null
  let player: { jet: Loop | null; burner: Loop | null; wind: Loop | null; buffet: Loop | null } = { jet: null, burner: null, wind: null, buffet: null }
  let playerGun: GunVoice = { shots: -1, last: -Infinity, loop: null }
  let crafts = new Map<string, Craft>(), rockets = new Map<number, Rocket>()
  let lockLoop: Loop | null = null
  let supersonic: boolean | null = null, lastTaken = -Infinity, lastDealt = -Infinity
  /** The newest of the player's flares heard (null: none seen yet, so those already out stay silent),
   * the pop played last and when, the sides of flares since that share the next pop, the burn under them,
   * and when the recorded burst last started. */
  let lastFlare: number | null = null, lastPop = -1, popAt = -Infinity, sharing: number[] = []
  let burn: { voice: Loop; started: number } | null = null, burstAt = -Infinity
  const forward = new Vector3(), up = new Vector3(), right = new Vector3()

  function startLoop(ctx: AudioContext, id: SoundId, to: AudioNode, offset?: number): Loop | null {
    const buffer = sound(id)
    if (!buffer) return null
    const source = ctx.createBufferSource(), gain = ctx.createGain()
    source.buffer = buffer; source.loop = true
    gain.gain.value = 0
    source.connect(gain).connect(to)
    // Loops of one sound start at different points, so two engines never beat in step.
    source.start(ctx.currentTime, offset ?? Math.random() * buffer.duration)
    return { source, gain }
  }

  function stopLoop(ctx: AudioContext, loop: Loop | null, seconds = 0.05) {
    if (!loop) return
    const now = ctx.currentTime
    loop.gain.gain.cancelScheduledValues(now)
    loop.gain.gain.setTargetAtTime(0, now, seconds / 4)
    loop.source.stop(now + seconds)
    loop.source.onended = () => loop.gain.disconnect()
  }

  /** One-shot; `after` is called when it ends, to free a placed output. */
  function play(ctx: AudioContext, id: SoundId, to: AudioNode, level: number, rate = 1, offset = 0, after?: () => void) {
    const buffer = sound(id)
    if (!buffer) { after?.(); return }
    const source = ctx.createBufferSource(), gain = ctx.createGain()
    source.buffer = buffer; source.playbackRate.value = rate
    gain.gain.value = level
    source.connect(gain).connect(to)
    source.onended = () => { gain.disconnect(); after?.() }
    source.start(ctx.currentTime, offset)
  }

  /** One of the player's flares leaving, `delay` s from now on `side` (-1 left, 1 right of the camera). */
  function flarePop(ctx: AudioContext, to: AudioNode, side: number, delay: number) {
    const at = ctx.currentTime + delay
    sharing.push(side)
    if (at - popAt < FLARE.gap) return
    const mean = sharing.reduce((sum, each) => sum + each, 0) / sharing.length
    popAt = at; sharing = []
    lastPop = nextPop(lastPop, FLARE.pops.length, Math.random())
    const buffer = sound(FLARE.pops[lastPop])
    if (buffer) {
      const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner()
      source.buffer = buffer; source.playbackRate.value = 1 + (Math.random() * 2 - 1) * FLARE.spread
      gain.gain.value = MIX.flare * 10 ** (-Math.random() * FLARE.quieter / 20)
      pan.pan.value = mean * FLARE.pan
      source.connect(gain).connect(pan).connect(to)
      source.onended = () => { gain.disconnect(); pan.disconnect() }
      source.start(at)
    }
    // The burn: once per run, started again only once it is past its swell, the old one faded out under it.
    if (burn && at - burn.started < FLARE.burnEvery) return
    const next = sound('flareBurn')
    if (!next) return
    const source = ctx.createBufferSource(), gain = ctx.createGain()
    source.buffer = next; gain.gain.value = MIX.flare
    source.connect(gain).connect(to)
    source.onended = () => gain.disconnect()
    source.start(at)
    if (burn) {
      const old = burn.voice
      old.gain.gain.setTargetAtTime(0, at, 0.04)
      old.source.stop(at + 0.2)
    }
    burn = { voice: { source, gain }, started: at }
  }

  /** A placed output: distance, direction, and the treble air takes off far away. */
  function placed(ctx: AudioContext, to: AudioNode, reference: number, rolloff = 1): Placed {
    const panner = ctx.createPanner(), air = ctx.createBiquadFilter()
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'
    panner.refDistance = reference; panner.rolloffFactor = rolloff; panner.maxDistance = 1e5
    air.type = 'lowpass'; air.frequency.value = 20000
    panner.connect(air).connect(to)
    return { panner, air }
  }

  /** `track` > 0 follows the position over that many seconds rather than jumping to it. */
  function place(out: Placed, position: Vec3, listener: Vec3, track = 0) {
    const { panner } = out
    if (panner.positionX && track > 0) {
      const now = panner.context.currentTime
      panner.positionX.setTargetAtTime(position.x, now, track); panner.positionY.setTargetAtTime(position.y, now, track); panner.positionZ.setTargetAtTime(position.z, now, track)
    } else if (panner.positionX) { panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z }
    else panner.setPosition(position.x, position.y, position.z)
    const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z)
    out.air.frequency.value = clamp(20000 * Math.exp(-distance / 1200), 900, 20000)
  }

  function release(out: Placed) { out.panner.disconnect(); out.air.disconnect() }

  /** A missile burst: the recording for its distance, falling off gently, with no air filter. */
  function detonation(ctx: AudioContext, to: AudioNode, position: Vec3, listener: Vec3) {
    const out = placed(ctx, to, EXPLOSION.reference, EXPLOSION.rolloff)
    place(out, position, listener)
    out.air.frequency.value = 20000
    const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z)
    play(ctx, explosionSound(distance), out.panner, MIX.explosion, 1, 0, () => release(out))
  }

  /** A missile passing the player `ahead` s from now, scripted rather than placed (PASS): the motor bed
   * (when its motor burns) and the recorded whoosh share one low-pass and a pan that swings to the side
   * of the camera it passes. Returns the gain that fades it all. */
  function passBy(ctx: AudioContext, to: AudioNode, side: number, distance: number, ahead: number, motor: boolean) {
    const now = ctx.currentTime, passAt = now + ahead, gone = passAt + PASS.recede, nearAt = passAt - PASS.nearAt
    const air = ctx.createBiquadFilter(), pan = ctx.createStereoPanner(), master = ctx.createGain()
    air.type = 'lowpass'
    air.connect(pan).connect(master).connect(to)
    // A frame can land late, so it always swells in, however short.
    master.gain.setValueAtTime(0, now); master.gain.linearRampToValueAtTime(PASS.level, now + Math.min(0.15, ahead))
    const lean = clamp(side, -1, 1)
    pan.pan.setValueAtTime(lean * 0.2, now); pan.pan.linearRampToValueAtTime(lean * MISS.pan, passAt); pan.pan.linearRampToValueAtTime(lean * 0.25, gone)
    air.frequency.setValueAtTime(ahead > PASS.nearAt ? PASS.far : PASS.mid, now)
    if (nearAt > now) air.frequency.exponentialRampToValueAtTime(PASS.mid, nearAt)
    air.frequency.exponentialRampToValueAtTime(PASS.open, passAt)
    air.frequency.exponentialRampToValueAtTime(PASS.mid, passAt + 1)
    air.frequency.exponentialRampToValueAtTime(PASS.gone, gone)

    const bed = motor ? sound('motor') : undefined
    if (bed) {
      const source = ctx.createBufferSource(), gain = ctx.createGain()
      source.buffer = bed; source.loop = true
      source.playbackRate.setValueAtTime(PASS.high, now); source.playbackRate.setTargetAtTime(PASS.low, passAt - 0.1, 0.15)
      const g = gain.gain, level = MIX.motor * PASS.bed
      g.setValueAtTime(level * approachGain(ahead), now)
      if (nearAt > now) g.exponentialRampToValueAtTime(level * PASS.near, nearAt)
      g.exponentialRampToValueAtTime(level, passAt)
      g.exponentialRampToValueAtTime(level * PASS.end, gone)
      g.linearRampToValueAtTime(0, gone + 0.1)
      source.connect(gain).connect(air)
      source.onended = () => gain.disconnect()
      source.start(now, Math.random() * bed.duration); source.stop(gone + 0.15)
    }
    const recorded = sound('missileMiss')
    if (recorded) {
      const source = ctx.createBufferSource(), gain = ctx.createGain()
      source.buffer = recorded
      gain.gain.value = MIX.missileMiss * (1 - 0.5 * distance / MISS.range)
      source.connect(gain).connect(air)
      source.onended = () => gain.disconnect()
      // Its loudest moment on the pass: started later when the lead allows, part way in when not.
      source.start(Math.max(now, passAt - MISS_PEAK), Math.max(0, MISS_PEAK - ahead))
    }
    setTimeout(() => { air.disconnect(); pan.disconnect(); master.disconnect() }, (Math.max(gone + 0.3, now + (recorded?.duration ?? 0)) - now) * 1000 + 100)
    return master
  }

  function stepGun(ctx: AudioContext, voice: GunVoice, shots: number, alive: boolean, to: AudioNode) {
    const now = ctx.currentTime
    if (voice.shots >= 0 && shots > voice.shots) voice.last = now
    voice.shots = shots
    const firing = alive && now - voice.last < GUN_GAP
    if (firing && !voice.loop) {
      voice.loop = startLoop(ctx, 'gun', to, 0)
      voice.loop?.gain.gain.setTargetAtTime(MIX.gun, now, 0.004)
    } else if (!firing && voice.loop) {
      stopLoop(ctx, voice.loop, 0.04); voice.loop = null
      play(ctx, 'gunTail', to, MIX.gun)
    }
  }

  /** Drops every node: on a reset, or when the context was made again (the old one took its nodes with it). */
  function clear(ctx: AudioContext | null) {
    if (ctx && ctx === built) {
      for (const loop of [player.jet, player.burner, player.wind, player.buffet, playerGun.loop, lockLoop]) stopLoop(ctx, loop)
      for (const craft of crafts.values()) { stopLoop(ctx, craft.engine); stopLoop(ctx, craft.gun.loop); release(craft.out); release(craft.near); release(craft.guns) }
      for (const rocket of rockets.values()) { stopLoop(ctx, rocket.motor); release(rocket.out) }
      if (burn) stopLoop(ctx, burn.voice)
    }
    player = { jet: null, burner: null, wind: null, buffet: null }
    playerGun = { shots: -1, last: -Infinity, loop: null }
    crafts = new Map(); rockets = new Map(); lockLoop = null
    supersonic = null; lastTaken = -Infinity; lastDealt = -Infinity
    lastFlare = null; lastPop = -1; popAt = -Infinity; sharing = []; burn = null; burstAt = -Infinity
  }

  /** One rendered frame. */
  function update(frame: SoundFrame) {
    if (!frame.active) return
    const ctx = mixer.context()
    const engine = mixer.bus('engine'), air = mixer.bus('air'), gun = mixer.bus('gun'), rocketry = mixer.bus('missile'), impacts = mixer.bus('impacts'), warning = mixer.bus('warning')
    if (!ctx || !engine || !air || !gun || !rocketry || !impacts || !warning) return
    if (ctx !== built) { clear(null); built = ctx; loadSounds(ctx) }
    const now = ctx.currentTime, self = frame.player, alive = self.alive, m = self.maneuver
    const camera = frame.camera.position

    // The listener is the camera, moving with the player.
    const listener = ctx.listener
    frame.camera.getWorldDirection(forward); up.set(0, 1, 0).applyQuaternion(frame.camera.quaternion)
    if (listener.positionX) {
      listener.positionX.value = camera.x; listener.positionY.value = camera.y; listener.positionZ.value = camera.z
      listener.forwardX.value = forward.x; listener.forwardY.value = forward.y; listener.forwardZ.value = forward.z
      listener.upX.value = up.x; listener.upY.value = up.y; listener.upZ.value = up.z
    } else { listener.setPosition(camera.x, camera.y, camera.z); listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z) }
    right.crossVectors(forward, up)

    // The player's jet.
    player.jet ??= startLoop(ctx, 'jet', engine)
    player.burner ??= startLoop(ctx, 'burner', engine)
    player.wind ??= startLoop(ctx, 'wind', air)
    player.buffet ??= startLoop(ctx, 'buffet', air)
    const power = clamp(self.enginePower, 0, 1), burner = alive && m.burnerActive
    const speed = Math.hypot(frame.velocity.x, frame.velocity.y, frame.velocity.z)
    const mach = machNumber(arcadeSpeed(speed) / 3.6, self.position.y)
    const flow = clamp((mach - 0.2) / 0.9, 0, 1)
    const buffet = alive ? Math.max(clamp((m.g - 4) / 5, 0, 1), clamp((m.alpha - 15) / 25, 0, 1)) * clamp(mach / 0.4, 0, 1) : 0
    if (player.jet) {
      player.jet.gain.gain.setTargetAtTime(alive ? MIX.engine * (0.55 + 0.45 * power) : 0, now, alive ? 0.12 : 0.4)
      player.jet.source.playbackRate.setTargetAtTime(0.85 + 0.3 * power + (burner ? 0.04 : 0), now, 0.25)
    }
    player.burner?.gain.gain.setTargetAtTime(burner ? MIX.burner : 0, now, burner ? 0.12 : 0.35)
    if (player.wind) {
      player.wind.gain.gain.setTargetAtTime(alive ? MIX.wind * flow : 0, now, 0.2)
      player.wind.source.playbackRate.setTargetAtTime(0.9 + 0.2 * flow, now, 0.3)
    }
    player.buffet?.gain.gain.setTargetAtTime(MIX.buffet * buffet, now, 0.15)
    // Once per pass through Mach 1, not again while hovering on it.
    if (supersonic === null) supersonic = mach >= 1
    else if (!supersonic && alive && mach >= 1) { supersonic = true; play(ctx, 'boom', air, MIX.boom) }
    else if (supersonic && mach < 0.97) supersonic = false
    stepGun(ctx, playerGun, self.gun.shots, alive, gun)

    // Every other aircraft.
    const world = frame.world
    const seen = new Set<string>()
    for (const craft of world?.aircraft ?? []) {
      if (craft.id === self.id || !craft.alive) continue
      seen.add(craft.id)
      let voice = crafts.get(craft.id)
      if (!voice) {
        voice = { out: placed(ctx, engine, 60), near: placed(ctx, air, FLYBY.range), guns: placed(ctx, gun, 60), engine: null, gun: { shots: -1, last: -Infinity, loop: null }, flyby: -Infinity }
        crafts.set(craft.id, voice)
      }
      place(voice.out, craft.position, camera); place(voice.near, craft.position, camera); place(voice.guns, craft.position, camera)
      voice.engine ??= startLoop(ctx, 'jet', voice.out.panner)
      const shift = dopplerRate(craft.position, craft.velocity, camera, frame.velocity)
      if (voice.engine) {
        voice.engine.gain.gain.setTargetAtTime(MIX.otherEngine * (0.6 + 0.4 * clamp(craft.enginePower, 0, 1)), now, 0.15)
        voice.engine.source.playbackRate.setTargetAtTime((0.85 + 0.3 * clamp(craft.enginePower, 0, 1)) * shift, now, 0.08)
      }
      stepGun(ctx, voice.gun, craft.gun.shots, true, voice.guns.panner)
      // The fly-by starts early by however far its loudest moment is into the recording.
      const offset = { x: craft.position.x - camera.x, y: craft.position.y - camera.y, z: craft.position.z - camera.z }
      const closing = { x: craft.velocity.x - frame.velocity.x, y: craft.velocity.y - frame.velocity.y, z: craft.velocity.z - frame.velocity.z }
      const pass = closestApproach(offset, closing)
      if (pass.time > 0 && pass.time <= FLYBY_PEAK && pass.distance < FLYBY.range && Math.hypot(closing.x, closing.y, closing.z) > FLYBY.minClosing && now - voice.flyby > FLYBY.every) {
        voice.flyby = now
        play(ctx, 'flyby', voice.near.panner, MIX.flyby * (1 - 0.5 * pass.distance / FLYBY.range), 1, FLYBY_PEAK - pass.time)
      }
    }
    for (const [id, voice] of crafts) if (!seen.has(id)) {
      stopLoop(ctx, voice.engine, 0.3); stopLoop(ctx, voice.gun.loop)
      // Freed after the engine's fade; a fly-by still playing is cut with it.
      const { out: far, near, guns } = voice
      setTimeout(() => { release(far); release(near); release(guns) }, 400)
      crafts.delete(id)
    }

    // Missiles.
    const flying = new Set<number>()
    for (const missile of world?.missiles ?? []) {
      flying.add(missile.id)
      let rocket = rockets.get(missile.id)
      const own = missile.ownerId === self.id, fresh = !rocket
      if (!rocket) { rocket = { out: placed(ctx, rocketry, 40, own ? 1 : ENEMY_MOTOR.rolloff), motor: null, lit: false, passed: false, pass: null }; rockets.set(missile.id, rocket) }
      place(rocket.out, missile.position, camera, own || fresh ? 0 : ENEMY_MOTOR.track)
      const profile = getWeapon(missile.weaponId).missile!
      const lit = motorBurning(missile, profile)
      if (lit && !rocket.lit) {
        rocket.lit = true
        if (own) play(ctx, 'launch', rocketry, MIX.launch)
        else play(ctx, 'launch', rocket.out.panner, MIX.launch * 2)
        rocket.motor = startLoop(ctx, 'motor', rocket.out.panner)
        // The player's own motor rises under the launch rush rather than over it.
        rocket.motor?.gain.gain.setTargetAtTime(MIX.motor, now, own ? 0.4 : 0.05)
      }
      if (!lit && rocket.motor) { stopLoop(ctx, rocket.motor, 0.2); rocket.motor = null }
      const rate = dopplerRate(missile.position, missile.velocity, camera, frame.velocity)
      rocket.motor?.source.playbackRate.setTargetAtTime(own ? rate : softenRate(rate, ENEMY_MOTOR.shift), now, own ? 0.05 : ENEMY_MOTOR.glide)
      if (!own && alive && !rocket.passed) {
        const offset = { x: missile.position.x - self.position.x, y: missile.position.y - self.position.y, z: missile.position.z - self.position.z }
        const closing = { x: missile.velocity.x - frame.velocity.x, y: missile.velocity.y - frame.velocity.y, z: missile.velocity.z - frame.velocity.z }
        const pass = closestApproach(offset, closing)
        if (pass.time > 0 && pass.time <= MISS.lead && pass.distance > profile.fuseM + MISS.margin && pass.distance < MISS.range && Math.hypot(closing.x, closing.y, closing.z) > MISS.minClosing) {
          rocket.passed = true
          const across = { x: offset.x + closing.x * pass.time, y: offset.y + closing.y * pass.time, z: offset.z + closing.z * pass.time }
          rocket.pass = { gain: passBy(ctx, rocketry, dot(across, right) / Math.max(pass.distance, 1), pass.distance, pass.time, !!rocket.motor), passAt: now + pass.time }
          rocket.motor?.gain.gain.setTargetAtTime(MIX.motor * MISS.duck, now, 0.15)
        }
      }
    }
    for (const [id, rocket] of rockets) if (!flying.has(id)) {
      stopLoop(ctx, rocket.motor, 0.06)
      // Gone before its pass: it turned in and burst, so the miss is faded under the burst.
      if (rocket.pass && now < rocket.pass.passAt) {
        const fade = rocket.pass.gain.gain
        if (fade.cancelAndHoldAtTime) fade.cancelAndHoldAtTime(now); else fade.cancelScheduledValues(now)
        fade.setTargetAtTime(0, now, 0.015)
      }
      const { out: gone } = rocket
      setTimeout(() => release(gone), 200)
      rockets.delete(id)
    }

    // The player's flares, each as it appears; ids only go up. Several new in one frame are spread a little.
    const released = (world?.decoys ?? []).filter(decoy => decoy.kind === 'flare' && decoy.ownerId === self.id && decoy.id > (lastFlare ?? -1)).sort((a, b) => a.id - b.id)
    if (released.length) {
      if (lastFlare !== null && FLARE_STYLE === 'recorded') {
        if (now - burstAt >= FLARE.burstPops) { burstAt = now; play(ctx, 'flareBurst', rocketry, MIX.flare) }
      } else if (lastFlare !== null) released.forEach((flare, index) => {
        const offset = { x: flare.position.x - camera.x, y: flare.position.y - camera.y, z: flare.position.z - camera.z }
        flarePop(ctx, rocketry, Math.sign(dot(offset, right)), index * 0.012)
      })
      lastFlare = released[released.length - 1].id
    } else lastFlare ??= -1

    // Explosions.
    for (const event of frame.events) {
      if (event.type === 'missile-detonated' && event.cause !== 'dud') detonation(ctx, impacts, event.position, camera)
      // Only the player's own loss has a sound of its own; another jet's is heard through the missile burst.
      if (event.type === 'aircraft-destroyed' && event.cause !== 'boundary' && event.entityId === self.id) play(ctx, 'explosionNear', impacts, MIX.explosion)
    }

    // Gun hits: rounds striking the player, and the player's rounds striking someone.
    let taken = false, dealt = false
    for (const { ownerId, hit } of frame.hits) {
      if (hit.kind !== 'aircraft') continue
      if (hit.entityId === self.id) taken = true
      else if (ownerId === self.id) dealt = true
    }
    if (taken && now - lastTaken > HIT_GAP) { lastTaken = now; play(ctx, 'hit', impacts, MIX.hitTaken, 0.85 + Math.random() * 0.3) }
    if (dealt && now - lastDealt > HIT_GAP) { lastDealt = now; play(ctx, 'hit', impacts, MIX.hitDealt, 1.1 + Math.random() * 0.3) }

    // The RWR lock warning.
    const locked = alive && frame.warning === 'lock'
    if (locked && !lockLoop) { lockLoop = startLoop(ctx, 'lockWarning', warning, 0); lockLoop?.gain.gain.setValueAtTime(MIX.lockWarning, now) }
    else if (!locked && lockLoop) { stopLoop(ctx, lockLoop, 0.03); lockLoop = null }
  }

  /** Stops every sound: a reset of the flight, or the scene going away. */
  function reset() { clear(built) }

  return { update, reset }
}
