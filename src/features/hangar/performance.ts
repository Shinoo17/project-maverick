/*
Hangar numbers are computed from the flight profile, never typed by hand.
Stat bars map each value onto 0–100 with one fixed range per stat, so every
aircraft is measured on the same scale. The values are game tuning, not
real-world specifications.
*/
import type { AircraftDefinition } from '../../content/schemas'
import { getFlightProfile } from '../../game/flight/profile'
import { tvcMomentCapacity } from '../../game/flight/thrustVectoring'
import type { Translation } from '../../locales/en'

type LabelKey = keyof Translation & (`stat${string}` | `detail${string}`)

export interface StatBar { label: LabelKey; value: number }
export interface DetailRow { label: LabelKey; value: string }

/** The value that maps to 0 and the value that maps to 100 for each stat. */
export const statRanges = {
  speed: { min: 900, max: 1600 },       // afterburner top speed, ARCADE km/h
  acceleration: { min: 15, max: 30 },   // m/s²
  agility: { min: 0.5, max: 1.2 },      // mean normal-flight rate, rad/s (see below)
  postStall: { min: 0, max: 12 },       // thrust-vectoring authority, rad/s²
} as const

/** Maps `value` onto 0–100 and clamps it. */
export function toPercent(value: number, range: { min: number; max: number }): number {
  const percent = (value - range.min) / (range.max - range.min) * 100
  return Math.round(Math.min(100, Math.max(0, percent)))
}

export function performanceBars(aircraft: AircraftDefinition): StatBar[] {
  const { flight, thrustVectoring } = getFlightProfile(aircraft.id)
  // Roll is naturally about twice as fast as pitch, so it counts half.
  const agility = (flight.pitchRate + flight.yawRate + flight.rollRate / 2) / 3
  const tvc = tvcMomentCapacity(thrustVectoring, flight.maxThrust).commanded.positive
  const postStall = tvc.pitch + tvc.yaw + tvc.roll
  return [
    { label: 'statSpeed', value: toPercent(flight.afterburnerTopSpeedKph, statRanges.speed) },
    { label: 'statAcceleration', value: toPercent(flight.acceleration, statRanges.acceleration) },
    { label: 'statAgility', value: toPercent(agility, statRanges.agility) },
    { label: 'statPostStall', value: toPercent(postStall, statRanges.postStall) },
  ]
}

const degreesPerSecond = (radians: number) => `${Math.round(radians * 180 / Math.PI)} °/s`
const kph = (value: number) => `${value.toLocaleString('en-US')} km/h`

export function performanceDetail(aircraft: AircraftDefinition): DetailRow[] {
  const { flight, stall, thrustVectoring: tvc } = getFlightProfile(aircraft.id)
  const vectoring = !tvc ? '—'
    : tvc.cantDeg === 0 ? `2D · ±${tvc.maxAngle}°`
    : `3D · ±${tvc.maxAngle}° · ${tvc.cantDeg}° cant`
  return [
    { label: 'detailTopSpeedMil', value: kph(flight.topSpeedKph) },
    { label: 'detailTopSpeedAb', value: kph(flight.afterburnerTopSpeedKph) },
    { label: 'detailAcceleration', value: `${flight.acceleration.toFixed(1)} m/s²` },
    { label: 'detailPitchRate', value: degreesPerSecond(flight.pitchRate) },
    { label: 'detailYawRate', value: degreesPerSecond(flight.yawRate) },
    { label: 'detailRollRate', value: degreesPerSecond(flight.rollRate) },
    { label: 'detailStallSpeed', value: kph(stall.stallSpeedKph) },
    { label: 'detailCriticalAoa', value: `${stall.criticalAoaDeg}°` },
    { label: 'detailThrustVector', value: vectoring },
  ]
}
