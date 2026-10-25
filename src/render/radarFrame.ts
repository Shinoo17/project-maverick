/*
Builds the radar picture for one rendered frame: what the player's sensors show (radar.ts),
for the scope at the bottom left (radarPainter.ts) and the carets on the HUD heading tape.

Contacts are the simulation's (painted, locked or close), drawn between ticks like every other
aircraft so a contact never steps against the interpolated heading. Missiles in flight show too:
the player's own always, anyone else's only where the player's sensors see them (radar.ts
`seesPoint`); one chasing the player is a threat. Headings and bearings use
the HUD's convention: degrees of atan2(z, x), 0 along +X, 90 toward +Z.
*/
import { Quaternion, Vector3 } from 'three'
import { getAircraft } from '../content/aircraft'
import { radarContacts, radarOf, seesPoint } from '../game/combat/radar'
import { targetingRules } from '../game/combat/targeting'
import type { AircraftState, Quat, Vec3, WorldState } from '../game/state/WorldState'
import { between } from './gunneryFrame'

export interface RadarContactMark {
  id: string
  /** World position (interpolated) and its height above or below the player, in metres. */
  position: Vec3
  above: number
  /** Degrees, world heading convention; metres. */
  bearing: number
  range: number
  painted: boolean
  locked: boolean
  designation: string
}
export interface RadarMissileMark {
  id: number
  /** Fired by the player. */
  own: boolean
  /** Another's missile chasing the player. */
  threat: boolean
  /** World position (interpolated); degrees and metres from the player, as for contacts. */
  position: Vec3
  bearing: number
  range: number
  /** Degrees, world heading convention: where the missile is flying. */
  course: number
}
export interface RadarPicture {
  /** The player's heading (degrees) and position, interpolated. */
  heading: number
  position: Vec3
  coneDeg: number
  rangeM: number
  contacts: RadarContactMark[]
  missiles: RadarMissileMark[]
  /** The lock's grace timer: seconds spent outside the radar cone, out of `grace`. Null with no lock. */
  lock: { outside: number; grace: number } | null
}

const degrees = 180 / Math.PI
const nose = new Vector3(), turn = new Quaternion()
/** Compass heading of the nose, or of the flight path when the nose points straight up or down. */
export function headingOf(orientation: Quat, velocity: Vec3) {
  nose.set(1, 0, 0).applyQuaternion(turn.set(orientation.x, orientation.y, orientation.z, orientation.w))
  const [x, z] = Math.hypot(nose.x, nose.z) > 1e-3 ? [nose.x, nose.z] : [velocity.x, velocity.z]
  return Math.atan2(z, x) * degrees
}

/** The picture for `self` (the player as of the last tick) drawn at `pose` (interpolated); null once it is down. */
export function radarFrame(before: WorldState | null, now: WorldState | null, alpha: number, self: AircraftState, pose: { position: Vec3; orientation: Quat; velocity: Vec3 }): RadarPicture | null {
  if (!now || !self.alive) return null
  const spec = radarOf(self.aircraftId), p = pose.position
  const contacts = radarContacts(self, now.aircraft).map(contact => {
    const drawn = between(before, now, entity => entity.id === contact.entity.id, alpha)
    const position = drawn ? { x: drawn.position.x, y: drawn.position.y, z: drawn.position.z } : { ...contact.entity.position }
    const dx = position.x - p.x, dz = position.z - p.z
    return {
      id: contact.entity.id, position, above: position.y - p.y,
      bearing: Math.atan2(dz, dx) * degrees, range: Math.hypot(dx, position.y - p.y, dz),
      painted: contact.painted, locked: contact.locked, designation: getAircraft(contact.entity.aircraftId).designation.toUpperCase(),
    }
  })
  const missiles: RadarMissileMark[] = []
  for (const missile of now.missiles) {
    const own = missile.ownerId === self.id
    if (!own && !seesPoint(self, missile.position)) continue
    const last = before?.missiles.find(entry => entry.id === missile.id) ?? missile
    const at = (from: Vec3, to: Vec3) => ({ x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha, z: from.z + (to.z - from.z) * alpha })
    const position = at(last.position, missile.position), velocity = at(last.velocity, missile.velocity)
    const dx = position.x - p.x, dz = position.z - p.z
    missiles.push({ id: missile.id, own, threat: !own && missile.targetId === self.id, position,
      bearing: Math.atan2(dz, dx) * degrees, range: Math.hypot(dx, position.y - p.y, dz), course: Math.atan2(velocity.z, velocity.x) * degrees })
  }
  return {
    heading: headingOf(pose.orientation, pose.velocity), position: { ...p }, coneDeg: spec.coneDeg, rangeM: spec.rangeM, contacts, missiles,
    lock: self.targeting.targetId ? { outside: self.targeting.outside, grace: targetingRules.lockGraceSeconds } : null,
  }
}
