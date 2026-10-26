/*
The missile lock's tones (doc 07), synthesised with Web Audio: no sound files. They play on the
flight's shared context (audio/mixer.ts); the recorded sounds are audio/flightSound.ts.

- While the seeker tracks, short beeps come faster and a little higher as the progress climbs.
  Acquiring raises the pitch again.
- On the lock: one rising two-note confirmation, then silence while it holds (user request
  25 Oct 2026: no steady lock tone).
- LOCK LOST: one low falling blip.
- A refused press (gun locked, missile or dispensers not ready, no lock): one low dull knock;
  on an empty missile or empty dispensers, two short flat beeps instead.
- The warning gear (rwrFrame.ts): a short rising chirp for each new radar painting us, and a fast
  two-note warble while a missile is launched at us or closing. While one only locks us, the
  recorded lock warning plays instead (flightSound.ts; user's Pixabay set, 2026-10-26).

Driven from the render loop with the frame's lock picture (lockFrame.ts). Silent while the flight
is paused, the jet is down or the page is hidden.
*/
import type { LockMarks } from './lockFrame'
import type { RwrDisplay } from './rwrFrame'
import type { AudioMixer } from './audio/mixer'

/** Why a press was refused: `wait` until something changes (heat, cooldown, lock), or `empty` for good. */
export type RefusalTone = 'wait' | 'empty'

/** Provisional values, waiting on playtest. */
const TONE = {
  gain: 0.05,
  /** Seconds between beeps at no progress and at the end of acquiring. */
  slow: 0.42, fast: 0.07,
  beepSeconds: 0.045,
  trackingHz: 880, acquiringHz: 1180,
  confirmHz: [1320, 1760] as const,
  lostHz: [620, 360] as const,
  /** Warnings: the new-emitter chirp, the missile warble (two notes, seconds per note). */
  chirpHz: [520, 780] as const,
  warbleHz: [950, 1350] as const, warbleNote: 0.09,
  /** Refused presses: the knock (Hz falling to Hz) and the empty beeps (Hz, seconds apart). */
  knockHz: [190, 110] as const,
  emptyHz: 440, emptyEvery: 0.11,
} as const

export function createLockTone(mixer: AudioMixer) {
  let audio: AudioContext | null = null, out: GainNode | null = null
  let nextBeep = 0, wasLocked = false, wasLost = false
  let nextWarning = 0, warbleNote = 0, lastChirp = -Infinity

  function context() {
    audio = mixer.context(); out = mixer.bus('warning')
    return audio
  }

  function blip(at: number, hz: number, seconds: number, gain: number, toHz = hz, type: OscillatorType = 'triangle') {
    if (!audio || !out) return
    const osc = audio.createOscillator(), envelope = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(hz, at)
    if (toHz !== hz) osc.frequency.exponentialRampToValueAtTime(toHz, at + seconds)
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(gain, at + 0.006)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
    osc.connect(envelope).connect(out)
    osc.start(at); osc.stop(at + seconds + 0.02)
  }

  /** One rendered frame. `active` is false while paused, down or hidden: silent, and a lock held
   * through a pause is not confirmed again. */
  function update(marks: LockMarks | null, active: boolean) {
    if (!marks) { wasLocked = false; wasLost = false }
    if (!active || !marks) return
    const ctx = context()
    if (!ctx || !out) return
    const now = ctx.currentTime
    const locked = marks.phase === 'locked', lost = marks.lost !== null
    if (locked && !wasLocked) {
      blip(now, TONE.confirmHz[0], 0.07, TONE.gain * 1.2)
      blip(now + 0.08, TONE.confirmHz[1], 0.12, TONE.gain * 1.2)
    }
    if (lost && !wasLost) blip(now, TONE.lostHz[0], 0.22, TONE.gain, TONE.lostHz[1])
    wasLocked = locked; wasLost = lost
    // Beeps only while the seeker is actually on the target and climbing.
    if (locked || !marks.tracking || marks.targetId === null) { nextBeep = now; return }
    if (now >= nextBeep) {
      const acquiring = marks.phase === 'acquiring'
      blip(now, (acquiring ? TONE.acquiringHz : TONE.trackingHz) * (1 + 0.12 * marks.progress), TONE.beepSeconds, TONE.gain)
      nextBeep = now + TONE.slow + (TONE.fast - TONE.slow) * marks.progress
    }
  }

  /** One rendered frame of the warning gear. Silent while paused, down or hidden. */
  function warn(display: RwrDisplay, active: boolean) {
    if (!active) return
    const ctx = context()
    if (!ctx || !out) return
    const now = ctx.currentTime
    // At most one chirp in half a second, however many radars come up at once.
    if (display.newEmitter && now - lastChirp > 0.5) {
      lastChirp = now
      blip(now, TONE.chirpHz[0], 0.05, TONE.gain * 0.8, TONE.chirpHz[1], 'square')
    }
    const level = display.top
    if (level !== 'launch' && level !== 'missile') { nextWarning = now; return }
    if (now < nextWarning) return
    warbleNote = 1 - warbleNote
    blip(now, TONE.warbleHz[warbleNote], TONE.warbleNote, TONE.gain * 1.1, TONE.warbleHz[warbleNote], 'square')
    nextWarning = now + TONE.warbleNote
  }

  /** A press the aircraft refused (see RefusalTone). */
  function refuse(kind: RefusalTone) {
    const ctx = context()
    if (!ctx || !out) return
    const now = ctx.currentTime
    if (kind === 'wait') { blip(now, TONE.knockHz[0], 0.08, TONE.gain * 1.5, TONE.knockHz[1], 'square'); return }
    blip(now, TONE.emptyHz, 0.06, TONE.gain, TONE.emptyHz, 'square')
    blip(now + TONE.emptyEvery, TONE.emptyHz, 0.06, TONE.gain, TONE.emptyHz, 'square')
  }

  return { update, warn, refuse }
}
