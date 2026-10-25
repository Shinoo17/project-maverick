/*
The missile lock's tones (doc 07), synthesised with Web Audio: no sound files.

- While the seeker tracks, short beeps come faster and a little higher as the progress climbs.
  Acquiring raises the pitch again.
- On the lock: one rising two-note confirmation, then silence while it holds (user request
  25 Oct 2026: no steady lock tone).
- LOCK LOST: one low falling blip.
- A launch: a short rushing noise, the motor lighting under the jet.

Driven from the render loop with the frame's lock picture (lockFrame.ts). Silent while the flight
is paused, the jet is down or the page is hidden. The AudioContext is made on the first flying
frame, after the click that launched the flight, so the browser lets it play.
*/
import type { LockMarks } from './lockFrame'

/** Provisional values, waiting on playtest. */
const TONE = {
  gain: 0.05,
  /** Seconds between beeps at no progress and at the end of acquiring. */
  slow: 0.42, fast: 0.07,
  beepSeconds: 0.045,
  trackingHz: 880, acquiringHz: 1180,
  confirmHz: [1320, 1760] as const,
  lostHz: [620, 360] as const,
} as const

export function createLockTone() {
  let audio: AudioContext | null = null, out: GainNode | null = null
  let nextBeep = 0, wasLocked = false, wasLost = false

  function context() {
    if (!audio) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return null
      audio = new Context()
      out = audio.createGain(); out.gain.value = 1; out.connect(audio.destination)
    }
    if (audio.state === 'suspended') void audio.resume().catch(() => {})
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

  /** The player's own missile leaving: filtered noise swelling and dying away over about a second. */
  function launch() {
    const ctx = context()
    if (!ctx || !out) return
    const seconds = 1.1, now = ctx.currentTime
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate), data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'; filter.Q.value = 0.7
    filter.frequency.setValueAtTime(1800, now); filter.frequency.exponentialRampToValueAtTime(500, now + seconds)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(TONE.gain * 2.4, now + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
    source.connect(filter).connect(gain).connect(out)
    source.start(now); source.stop(now + seconds)
  }

  /** Stops every sound at once, scheduled beeps included. For pause, blur and a hidden page: the
   * render loop may not run another frame to do it. The next active `update` resumes. */
  function silence() {
    if (audio?.state === 'running') void audio.suspend().catch(() => {})
  }

  function dispose() {
    void audio?.close().catch(() => {})
    audio = null; out = null
  }
  return { update, launch, silence, dispose }
}
