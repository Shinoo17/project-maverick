/*
Builds the game's sound files in public/assets/audio/ from the chosen sources in sound-source/select_sound/used/.
Needs ffmpeg on PATH. Run: node scripts/build-audio.mjs

Every trim, loop length and level was set by measurement and spectrogram, not by ear: change a
recipe below and run again.

- Loops are WAV, 16-bit: MP3's encoder delay and padding would leave a gap at the wrap. Each loop
  has an equal-power crossfade baked in: the `xfade` seconds after the loop's end are faded into
  its head, so the last sample runs straight on into the first.
- One-shots are MP3; a few silent milliseconds in front of a one-shot do no harm.
- Loops are levelled by RMS, one-shots by peak; `gainOf` gives a file the same gain as another so
  the gun's loop and tail stay matched.
- Writes public/assets/audio/manifest.json: source, trim, loop length, gain and licence of each file.
*/
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = join(root, 'sound-source/select_sound/used')
const output = join(root, 'public/assets/audio')
const PIXABAY = 'Pixabay Content License (pixabay.com/service/license-summary): free to use, no attribution required'
const SONNISS = 'Sonniss GDC 2026 Game Audio Bundle licence (sound-source/select_sound/License - GDC Game Audio.pdf): royalty-free, no attribution required'

/*
Recipes. Times in seconds of the source. `loop`: `start` + `length` is the loop, `xfade` more is read
past the end for the crossfade. One-shots: `start` + `length`, with `fadeIn` / `fadeOut`.
`rms` / `peak` are dBFS targets. `search: [from, to]` moves a loop's start to where its head best
matches the run past its end (spectral bands); `flatten` divides out slow level drift over that many seconds.
*/
const recipes = [
  // Engine: a steady jet bed throughout. Source peaks +2 dBFS, so it is levelled down.
  { out: 'engine/jet-loop.wav', src: 'pixabay/jet-loop.mp3', licence: PIXABAY, loop: true, start: 4, search: [1, 29.5], flatten: 2.5, length: 12, xfade: 0.5, channels: 2, rate: 24000, rms: -20 },
  // Afterburner: the file is dry for 7 s, then burner until about 33 s; its level wanders, so flattened.
  { out: 'engine/burner-loop.wav', src: 'pixabay/afterburner-sound.mp3', licence: PIXABAY, loop: true, start: 12, search: [8.5, 33], flatten: 2.5, length: 10, xfade: 0.6, channels: 2, rate: 24000, rms: -20 },
  // Airflow: steady buffeting throughout. Dry for speed, wet (more low end) for high-g and high-AoA buffet.
  { out: 'air/wind-loop.wav', src: 'pixabay/high-speed-wind-buffeting-dry.mp3', licence: PIXABAY, loop: true, start: 3, search: [1, 29.5], length: 12, xfade: 0.4, channels: 2, rate: 32000, rms: -20 },
  { out: 'air/buffet-loop.wav', src: 'pixabay/high-speed-wind-buffeting-wet.mp3', licence: PIXABAY, loop: true, start: 5, search: [1, 29.5], length: 10, xfade: 0.4, channels: 2, rate: 32000, rms: -20 },
  // Sonic boom: onset at 0.2 s, decays by 4 s.
  { out: 'air/sonic-boom.mp3', src: 'pixabay/cinematic-sonic-boom.mp3', licence: PIXABAY, start: 0.15, length: 4.1, fadeIn: 0.005, fadeOut: 0.8, channels: 2, rate: 44100, peak: -1 },
  // Gun: a rotary cannon at a measured 20 rounds/s (50 ms pulses). Sustain 0.6–2.6 s = 40 pulses, and
  // the crossfade is two pulses, so the beat stays even across the wrap. The spin-down from 2.6 s is the tail.
  { out: 'weapons/gun-loop.wav', src: 'pixabay/mini-gun.mp3', licence: PIXABAY, loop: true, start: 0.6, length: 2.0, xfade: 0.1, channels: 1, rate: 24000, rms: -16 },
  { out: 'weapons/gun-tail.mp3', src: 'pixabay/mini-gun.mp3', licence: PIXABAY, start: 2.6, length: 2.4, fadeIn: 0.004, fadeOut: 0.6, channels: 1, rate: 24000, gainOf: 'weapons/gun-loop.wav' },
  // Missile: the launch rush decays over 4.6 s; the other file's steady roar 0.8–2.4 s is the motor in flight.
  { out: 'weapons/missile-launch.mp3', src: 'pixabay/missile-launch.mp3', licence: PIXABAY, start: 0, length: 4.6, fadeIn: 0.004, fadeOut: 1.2, channels: 2, rate: 24000, peak: -1 },
  { out: 'weapons/missile-motor-loop.wav', src: 'pixabay/missile-firing-fl.mp3', licence: PIXABAY, loop: true, start: 0.8, search: [0.6, 3], flatten: 0.8, length: 1.6, xfade: 0.3, channels: 1, rate: 24000, rms: -16 },
  // RWR lock warning: beeps every 0.4286 s from 0.1025 s; seven of them (3.0 s), cut in the gap before
  // each beep, so the loop needs no crossfade.
  { out: 'warning/lock-warning-loop.wav', src: 'pixabay/missile-lock-detected-0s-3s-only.mp3', licence: PIXABAY, loop: true, start: 0.0925, length: 3.0, xfade: 0, channels: 1, rate: 24000, peak: -3 },
  // Fly-by: rises to its loudest near 4.5 s of the source, 2.5 s into this cut (flightSound.ts FLYBY_PEAK).
  { out: 'air/flyby.mp3', src: 'pixabay/jet-plane-flybyflac.mp3', licence: PIXABAY, start: 2, length: 10, fadeIn: 0.3, fadeOut: 3, channels: 1, rate: 24000, peak: -1 },
  // Explosions and hits (none in the Pixabay set).
  { out: 'impacts/explosion-small.mp3', src: 'sonniss/EXPLDsgn_Explosion Small Blast Enemy Death Crunchy Boom Cartoon Noisy Crash Impact Delay 03_ESM_AG.wav', licence: SONNISS, start: 0, length: 1.5, fadeIn: 0.002, fadeOut: 0.5, channels: 2, rate: 48000, peak: -1 },
  { out: 'impacts/explosion-large.mp3', src: 'sonniss/EffectiveTrailer_Booms_Vol2_075.wav', licence: SONNISS, start: 0.25, length: 6.5, fadeIn: 0.002, fadeOut: 2.5, channels: 2, rate: 48000, peak: -1, trimSilence: -45 },
  { out: 'impacts/hit-metal.mp3', src: 'sonniss/DSGNImpt_Metal Hit Thud Thump Low Ring Geofon 1_The Noisery_Moaning Metal.wav', licence: SONNISS, start: 0, length: 0.7, fadeIn: 0.002, fadeOut: 0.4, channels: 1, rate: 48000, peak: -1, trimSilence: -45 },
]

const db = gain => 20 * Math.log10(Math.max(gain, 1e-12))
const fromDb = dB => 10 ** (dB / 20)

/** Decodes `seconds` from `start` as interleaved float samples. */
function decode(file, start, seconds, channels, rate) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(start), '-t', String(seconds), '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

/** Seconds into `samples` where the level first rises above `threshold` dBFS. */
function onset(samples, channels, rate, threshold) {
  const limit = fromDb(threshold)
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > limit) return Math.floor(i / channels) / rate
  return 0
}

function writeWav(file, samples, channels, rate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([header, data]))
}

const stats = samples => {
  let sum = 0, peak = 0
  for (const value of samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)) }
  return { rms: Math.sqrt(sum / samples.length), peak }
}

/** RMS of one window, all channels. */
function windowRms(samples, channels, from, frames) {
  let sum = 0
  for (let i = from * channels; i < (from + frames) * channels; i++) sum += samples[i] ** 2
  return Math.sqrt(sum / (frames * channels))
}

/** In-place radix-2 FFT; `re.length` a power of two. */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = -2 * Math.PI / size
    for (let i = 0; i < n; i += size) for (let k = 0; k < size / 2; k++) {
      const c = Math.cos(step * k), s = Math.sin(step * k), a = i + k, b = a + size / 2
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
    }
  }
}

const FFT = 2048, BANDS = 12
/** Log band energies (dB) of mono frames every `hop` seconds: what the ear hears of a bed's colour and level. */
function bandFrames(samples, channels, rate, hop) {
  const mono = new Float32Array(samples.length / channels)
  for (let i = 0; i < mono.length; i++) { let sum = 0; for (let c = 0; c < channels; c++) sum += samples[i * channels + c]; mono[i] = sum / channels }
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round(60 * (Math.min(10000, rate / 2) / 60) ** (i / BANDS) * FFT / rate))
  const frames = [], stride = Math.round(hop * rate)
  for (let from = 0; from + FFT <= mono.length; from += stride) {
    const re = new Float64Array(FFT), im = new Float64Array(FFT)
    for (let i = 0; i < FFT; i++) re[i] = mono[from + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT))
    fft(re, im)
    frames.push(edges.slice(0, -1).map((edge, b) => {
      let sum = 0
      for (let k = edge; k < Math.max(edge + 1, edges[b + 1]); k++) sum += re[k] * re[k] + im[k] * im[k]
      return 10 * Math.log10(sum + 1e-12)
    }))
  }
  return frames
}

/** The loop start in [from, to] whose head sounds most like the run just past its end, which the crossfade lays over it. */
function bestLoopStart(file, recipe) {
  const { channels, rate, length } = recipe, [from, to] = recipe.search, hop = 0.05, span = Math.round(Math.max(recipe.xfade, 0.3) / hop) + 4
  const frames = bandFrames(decode(file, from, to - from, channels, rate), channels, rate, hop)
  const shift = Math.round(length / hop)
  let best = { start: from, score: Infinity }
  for (let i = 0; i + shift + span < frames.length; i++) {
    let score = 0
    for (let j = 0; j < span; j++) for (let b = 0; b < BANDS; b++) score += Math.abs(frames[i + j][b] - frames[i + shift + j][b])
    score /= span * BANDS
    if (score < best.score) best = { start: from + i * hop, score }
  }
  return best
}

/** Divides out the slow level drift (RMS over `seconds`), keeping the overall level. */
function flatten(samples, channels, rate, seconds) {
  const frames = samples.length / channels, half = Math.round(seconds * rate / 2)
  const power = new Float64Array(frames + 1)
  for (let i = 0; i < frames; i++) { let sum = 0; for (let c = 0; c < channels; c++) sum += samples[i * channels + c] ** 2; power[i + 1] = power[i] + sum / channels }
  const mean = Math.sqrt(power[frames] / frames)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - half), b = Math.min(frames, i + half), local = Math.sqrt((power[b] - power[a]) / (b - a))
    for (let c = 0; c < channels; c++) out[i * channels + c] = samples[i * channels + c] * mean / Math.max(local, 1e-6)
  }
  return out
}

const temp = mkdtempSync(join(tmpdir(), 'maverick-audio-'))
const gains = new Map(), manifest = []
try {
  for (const recipe of recipes) {
    const { channels, rate } = recipe
    const file = join(sources, recipe.src)
    let start = recipe.start, match = ''
    if (recipe.trimSilence !== undefined) start += onset(decode(file, start, recipe.length, channels, rate), channels, rate, recipe.trimSilence)
    if (recipe.search) {
      const best = bestLoopStart(file, recipe)
      start = best.start; match = `start ${start.toFixed(2)} s (join ${best.score.toFixed(1)} dB)  `
    }
    const xfade = recipe.loop ? recipe.xfade : 0
    let read = decode(file, start, recipe.length + xfade, channels, rate)
    if (recipe.flatten) read = flatten(read, channels, rate, recipe.flatten)
    const fadeFrames = Math.round(xfade * rate)
    // A one-shot may run to the end of its source; a loop needs every frame it asks for.
    const frames = recipe.loop ? Math.round(recipe.length * rate) : Math.min(Math.round(recipe.length * rate), read.length / channels)
    if (read.length < (frames + fadeFrames) * channels) throw new Error(`${recipe.out}: source too short for the cut`)
    const samples = read.slice(0, frames * channels)
    if (recipe.loop) {
      // Equal-power crossfade: the run past the loop's end fades out over the head as the head fades in.
      for (let i = 0; i < fadeFrames; i++) {
        const t = (i + 0.5) / fadeFrames, head = Math.sin(t * Math.PI / 2), tail = Math.cos(t * Math.PI / 2)
        for (let c = 0; c < channels; c++) samples[i * channels + c] = read[i * channels + c] * head + read[(frames + i) * channels + c] * tail
      }
    } else {
      const fadeIn = Math.round((recipe.fadeIn ?? 0) * rate), fadeOut = Math.round((recipe.fadeOut ?? 0) * rate)
      for (let i = 0; i < frames; i++) {
        let g = 1
        if (i < fadeIn) g = i / fadeIn
        if (i >= frames - fadeOut) g = Math.min(g, ((frames - i) / fadeOut) ** 2)
        for (let c = 0; c < channels; c++) samples[i * channels + c] *= g
      }
    }
    const level = stats(samples)
    let gain = recipe.gainOf ? gains.get(recipe.gainOf) : recipe.rms !== undefined ? fromDb(recipe.rms) / level.rms : fromDb(recipe.peak) / level.peak
    // Never past -1 dBFS.
    gain = Math.min(gain, fromDb(-1) / level.peak)
    gains.set(recipe.out, gain)
    for (let i = 0; i < samples.length; i++) samples[i] *= gain
    const target = join(output, recipe.out)
    mkdirSync(dirname(target), { recursive: true })
    if (recipe.out.endsWith('.wav')) writeWav(target, samples, channels, rate)
    else {
      const wav = join(temp, 'cut.wav')
      writeWav(wav, samples, channels, rate)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', channels === 1 ? '96k' : '160k', target])
    }
    const after = stats(samples)
    let check = ''
    if (recipe.loop) {
      // A loop must decode to exactly its length, and its level must not jump at the wrap.
      const back = decode(target, 0, recipe.length + 1, channels, rate)
      if (back.length !== frames * channels) throw new Error(`${recipe.out}: decodes to ${back.length / channels} frames, expected ${frames}`)
      const w = Math.round(0.05 * rate), jump = db(windowRms(back, channels, 0, w)) - db(windowRms(back, channels, frames - w, w))
      // The step from the last sample to the first, against the largest step anywhere inside the loop.
      const step = Math.max(...Array.from({ length: channels }, (_, c) => Math.abs(back[c] - back[(frames - 1) * channels + c])))
      let inside = 0
      for (let i = channels; i < back.length; i++) inside = Math.max(inside, Math.abs(back[i] - back[i - channels]))
      check = `wrap: level ${jump >= 0 ? '+' : ''}${jump.toFixed(1)} dB, step ${step.toFixed(3)} (largest inside ${inside.toFixed(3)})`
    }
    console.log(`${recipe.out.padEnd(32)} ${(frames / rate).toFixed(2)} s  gain ${db(gain).toFixed(1)} dB  rms ${db(after.rms).toFixed(1)}  peak ${db(after.peak).toFixed(1)} dBFS  ${match}${check}`)
    manifest.push({ file: recipe.out, source: `sound-source/select_sound/used/${recipe.src}`, licence: recipe.licence, start: +start.toFixed(4), length: +(frames / rate).toFixed(4),
      ...(recipe.loop ? { loop: true, crossfade: xfade } : { fadeIn: recipe.fadeIn ?? 0, fadeOut: recipe.fadeOut ?? 0 }), channels, rate, gainDb: +db(gain).toFixed(2) })
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${manifest.length} files, manifest.json written`)
