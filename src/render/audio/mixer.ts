/*
One AudioContext for the flight: the synthesised lock and warning tones (lockTone.ts) and the recorded
sounds (flightSound.ts) share it, so one suspend stops them all.

- Made on the first call, which the render loop makes on the first flying frame, after the click that
  launched the flight, so the browser lets it play.
- Made again after a dispose: StrictMode runs effect cleanups once on mount, and a memoised mixer must
  survive that. Users compare `context()` with the one they built their nodes on and rebuild on a change.
- Every sound plays into one channel bus (audioSettings.ts), each under the master: `setVolumes` sets
  them from the saved Settings, at once and again whenever the context is made.
- `silence()` suspends the whole context, scheduled sounds included: pause, blur and a hidden page. The
  render loop may not run another frame to do it. The next `context()` resumes. With a delay it
  waits first: a shot-down jet's flight stops at once, and its explosion should still be heard out.
*/
import { defaultAudioSettings, volumeChannels, volumeGain, type AudioSettings, type VolumeChannel } from './audioSettings'

export type AudioMixer = ReturnType<typeof createAudioMixer>
type Channel = Exclude<VolumeChannel, 'master'>

export function createAudioMixer() {
  let audio: AudioContext | null = null
  let buses: Record<VolumeChannel, GainNode> | null = null
  let volumes: AudioSettings = { ...defaultAudioSettings }
  let pending: ReturnType<typeof setTimeout> | undefined

  function context() {
    clearTimeout(pending)
    if (!audio) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return null
      audio = new Context()
      const made = Object.fromEntries(volumeChannels.map(channel => [channel, audio!.createGain()])) as Record<VolumeChannel, GainNode>
      made.master.connect(audio.destination)
      for (const channel of volumeChannels) if (channel !== 'master') made[channel].connect(made.master)
      buses = made
      setVolumes(volumes)
    }
    if (audio.state === 'suspended') void audio.resume().catch(() => {})
    return audio
  }

  function setVolumes(settings: AudioSettings) {
    volumes = { ...settings }
    if (!audio || !buses) return
    // A short glide, so dragging a slider does not click.
    for (const channel of volumeChannels) buses[channel].gain.setTargetAtTime(volumeGain(volumes[channel]), audio.currentTime, 0.02)
  }

  function silence(afterSeconds = 0) {
    clearTimeout(pending)
    const suspend = () => { if (audio?.state === 'running') void audio.suspend().catch(() => {}) }
    if (afterSeconds > 0) pending = setTimeout(suspend, afterSeconds * 1000)
    else suspend()
  }

  function dispose() {
    clearTimeout(pending)
    void audio?.close().catch(() => {})
    audio = null; buses = null
  }

  return {
    context,
    /** A channel's input. Null until `context()` has made it. */
    bus: (channel: Channel) => buses?.[channel] ?? null,
    setVolumes, silence, dispose,
  }
}
