/*
Volume choices, as plain data (no Web Audio), so the save file and the Settings page can read them
without the mixer (user request 2026-10-26).

Each channel is a percent, 0–100 in steps of 5. The mixer (mixer.ts) gives each channel its own gain
under the master, so a channel's slider changes only its own sounds:
- engine: jet engines and afterburner, the player's and everyone else's
- air: wind, buffet, sonic boom and fly-bys
- gun, missile (launch rush, motor and the player's flares), impacts (explosions and hits)
- warning: the lock tones and the RWR (lockTone.ts and the lock warning loop)
- music and ui: no sounds yet; kept so the choice is ready when they arrive
*/
export const volumeChannels = ['master', 'engine', 'air', 'gun', 'missile', 'impacts', 'warning', 'music', 'ui'] as const
export type VolumeChannel = typeof volumeChannels[number]
export type AudioSettings = Record<VolumeChannel, number>

export const volumeRange = { min: 0, max: 100, step: 5 } as const
export const defaultAudioSettings: Readonly<AudioSettings> = {
  master: 80, engine: 100, air: 100, gun: 100, missile: 100, impacts: 100, warning: 100, music: 70, ui: 100,
}

export function parseAudioSettings(value: unknown): AudioSettings {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const read = (channel: VolumeChannel) => {
    const raw = data[channel]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return defaultAudioSettings[channel]
    return Math.min(volumeRange.max, Math.max(volumeRange.min, Math.round(raw / volumeRange.step) * volumeRange.step))
  }
  return Object.fromEntries(volumeChannels.map(channel => [channel, read(channel)])) as AudioSettings
}

/** A slider percent as a linear gain. Squared, so the slider's middle sounds about half as loud
 * (50% is -12 dB) rather than barely quieter. */
export const volumeGain = (percent: number) => (percent / 100) ** 2
