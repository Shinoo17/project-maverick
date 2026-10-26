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
  motor placed on the missile until burnout.
- The player's flares: a dull thunk per flare, left and right in turn as they leave, over one burning
  hiss (a firework bang and the launch rush's top end, 2026-10-27; it was a synthesised blip).
- Explosions at missile bursts and kills, placed; gun hits on the player, and the player's own hits as
  a quiet knock.
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
import { countermeasureRules } from '../../game/combat/countermeasures'
import { getWeapon } from '../../content/weapons'
import { arcadeSpeed } from '../../game/flight/speedLimits'
import { machNumber } from '../vapor/atmosphere'
import type { AudioMixer } from './mixer'
import { loadSounds, sound, type SoundId } from './soundBank'

/** Linear gains on files levelled to about -20 dBFS RMS (loops) or -1 dBFS peak (one-shots).
 * The synthesised tones peak near 0.06, so the beds sit under them. Provisional. */
const MIX = {
  engine: 0.32, burner: 0.42, wind: 0.5, buffet: 0.45, boom: 0.6,
  gun: 0.5, launch: 0.45, motor: 0.9, otherEngine: 1.4, flyby: 0.75, flare: 0.45, flareHiss: 0.1,
  explosionSmall: 0.9, explosionLarge: 1, explosionOwn: 0.7, hitTaken: 0.35, hitDealt: 0.12, lockWarning: 0.09,
} as const
const SPEED_OF_SOUND = 343
/** Seconds into air/flyby.mp3 where it is loudest (scripts/build-audio.mjs). */
export const FLYBY_PEAK = 2.5
const FLYBY = { range: 150, minClosing: 80, every: 6 } as const
/** Seconds without a new round before the gun counts as stopped: longer than one round apart at 25 rounds/s. */
const GUN_GAP = 0.1
/** Seconds between two hit knocks of one kind; more hits in between are one knock. */
const HIT_GAP = 0.06
/** Flare thunks: played a quarter slower (scripts/build-audio.mjs), with a little spread in pitch and
 * level so a burst does not sound like one sample repeated; panned to the side each flare leaves. */
const FLARE = { sounds: ['flare1', 'flare2', 'flare3', 'flare4'], rate: 0.75, spread: 0.05, quieter: 2.5, pan: 0.35 } as const

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
type Rocket = { out: Placed; motor: Loop | null; lit: boolean }

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

/** When (seconds from now) and how near (m) something at `offset` closing at `velocity` passes. */
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
  const forward = new Vector3(), up = new Vector3()

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

  /** The player's countermeasure burst: one thunk per flare, spread as the flares leave, over the hiss. */
  function dispense(ctx: AudioContext, to: AudioNode) {
    const { flares, duration } = countermeasureRules.burst, now = ctx.currentTime
    play(ctx, 'flareHiss', to, MIX.flareHiss)
    for (let index = 0; index < flares; index++) {
      const buffer = sound(FLARE.sounds[index % FLARE.sounds.length])
      if (!buffer) continue
      const source = ctx.createBufferSource(), gain = ctx.createGain(), side = ctx.createStereoPanner()
      source.buffer = buffer; source.playbackRate.value = FLARE.rate * (1 + (Math.random() * 2 - 1) * FLARE.spread)
      gain.gain.value = MIX.flare * 10 ** (-Math.random() * FLARE.quieter / 20)
      side.pan.value = index % 2 === 0 ? -FLARE.pan : FLARE.pan
      source.connect(gain).connect(side).connect(to)
      source.onended = () => { gain.disconnect(); side.disconnect() }
      source.start(now + index * duration / Math.max(1, flares - 1))
    }
  }

  /** A placed output: distance, direction, and the treble air takes off far away. */
  function placed(ctx: AudioContext, to: AudioNode, reference: number): Placed {
    const panner = ctx.createPanner(), air = ctx.createBiquadFilter()
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'
    panner.refDistance = reference; panner.rolloffFactor = 1; panner.maxDistance = 1e5
    air.type = 'lowpass'; air.frequency.value = 20000
    panner.connect(air).connect(to)
    return { panner, air }
  }

  function place(out: Placed, position: Vec3, listener: Vec3) {
    const { panner } = out
    if (panner.positionX) { panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z }
    else panner.setPosition(position.x, position.y, position.z)
    const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z)
    out.air.frequency.value = clamp(20000 * Math.exp(-distance / 1200), 900, 20000)
  }

  function release(out: Placed) { out.panner.disconnect(); out.air.disconnect() }

  /** A one-shot placed at a fixed point, its output freed when it ends. */
  function burst(ctx: AudioContext, to: AudioNode, id: SoundId, position: Vec3, listener: Vec3, level: number, reference = 150) {
    const out = placed(ctx, to, reference)
    place(out, position, listener)
    play(ctx, id, out.panner, level, 1, 0, () => release(out))
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
    }
    player = { jet: null, burner: null, wind: null, buffet: null }
    playerGun = { shots: -1, last: -Infinity, loop: null }
    crafts = new Map(); rockets = new Map(); lockLoop = null
    supersonic = null; lastTaken = -Infinity; lastDealt = -Infinity
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
      if (!rocket) { rocket = { out: placed(ctx, rocketry, 40), motor: null, lit: false }; rockets.set(missile.id, rocket) }
      place(rocket.out, missile.position, camera)
      const lit = motorBurning(missile, getWeapon(missile.weaponId).missile!), own = missile.ownerId === self.id
      if (lit && !rocket.lit) {
        rocket.lit = true
        if (own) play(ctx, 'launch', rocketry, MIX.launch)
        else play(ctx, 'launch', rocket.out.panner, MIX.launch * 2)
        rocket.motor = startLoop(ctx, 'motor', rocket.out.panner)
        // The player's own motor rises under the launch rush rather than over it.
        rocket.motor?.gain.gain.setTargetAtTime(MIX.motor, now, own ? 0.4 : 0.05)
      }
      if (!lit && rocket.motor) { stopLoop(ctx, rocket.motor, 0.2); rocket.motor = null }
      rocket.motor?.source.playbackRate.setTargetAtTime(dopplerRate(missile.position, missile.velocity, camera, frame.velocity), now, 0.05)
    }
    for (const [id, rocket] of rockets) if (!flying.has(id)) {
      stopLoop(ctx, rocket.motor, 0.06)
      const { out: gone } = rocket
      setTimeout(() => release(gone), 200)
      rockets.delete(id)
    }

    // Explosions, and the player's flares.
    for (const event of frame.events) {
      if (event.type === 'countermeasure-dispensed' && event.entityId === self.id) dispense(ctx, rocketry)
      if (event.type === 'missile-detonated' && event.cause !== 'dud') burst(ctx, impacts, 'explosionSmall', event.position, camera, MIX.explosionSmall)
      if (event.type === 'aircraft-destroyed' && event.cause !== 'boundary') {
        const lost = world?.aircraft.find(entity => entity.id === event.entityId)
        if (event.entityId === self.id) play(ctx, 'explosionLarge', impacts, MIX.explosionOwn)
        else if (lost) burst(ctx, impacts, 'explosionLarge', lost.position, camera, MIX.explosionLarge, 250)
      }
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
