/*
The recorded flight sounds, built from the chosen sources by scripts/build-audio.mjs (trims, loops and
levels in public/assets/audio/manifest.json). One set for every aircraft for now (user decision 2026-10-26).

Fetched and decoded once per page, on the first flying frame. An AudioBuffer belongs to no one context,
so a context made again (mixer.ts) reuses them. A sound not decoded yet is simply not played.
*/
const BASE = `${import.meta.env.BASE_URL}assets/audio/`
const FILES = {
  jet: 'engine/jet-loop.wav',
  burner: 'engine/burner-loop.wav',
  wind: 'air/wind-loop.wav',
  buffet: 'air/buffet-loop.wav',
  boom: 'air/sonic-boom.mp3',
  flyby: 'air/flyby.mp3',
  gun: 'weapons/gun-loop.wav',
  gunTail: 'weapons/gun-tail.mp3',
  launch: 'weapons/missile-launch.mp3',
  motor: 'weapons/missile-motor-loop.wav',
  missileMiss: 'weapons/missile-miss.mp3',
  flarePop1: 'weapons/flare-pop-1.mp3',
  flarePop2: 'weapons/flare-pop-2.mp3',
  flarePop3: 'weapons/flare-pop-3.mp3',
  flarePop4: 'weapons/flare-pop-4.mp3',
  flarePop5: 'weapons/flare-pop-5.mp3',
  flarePop6: 'weapons/flare-pop-6.mp3',
  flareBurn: 'weapons/flare-burn.mp3',
  flareBurst: 'weapons/flare-burst.mp3',
  lockWarning: 'warning/lock-warning-loop.wav',
  explosionNear: 'impacts/explosion-near.mp3',
  explosionMid: 'impacts/explosion-mid.mp3',
  explosionFar: 'impacts/explosion-far.mp3',
  explosionLarge: 'impacts/explosion-large.mp3',
  hit: 'impacts/hit-metal.mp3',
} as const
export type SoundId = keyof typeof FILES

const buffers = new Map<SoundId, AudioBuffer>()
const pending = new Set<SoundId>()

/** Starts loading every sound not loaded or loading. A failed one is tried again on a later call. */
export function loadSounds(context: BaseAudioContext) {
  for (const id of Object.keys(FILES) as SoundId[]) {
    if (buffers.has(id) || pending.has(id)) continue
    pending.add(id)
    fetch(BASE + FILES[id])
      .then(response => { if (!response.ok) throw new Error(`${FILES[id]}: ${response.status}`); return response.arrayBuffer() })
      .then(data => context.decodeAudioData(data))
      .then(buffer => { buffers.set(id, buffer) })
      .catch(() => {})
      .finally(() => pending.delete(id))
  }
}

export const sound = (id: SoundId) => buffers.get(id) ?? null
