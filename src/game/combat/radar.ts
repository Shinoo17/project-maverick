/*
What an aircraft's sensors show it (doc 07, doc 12). One rule for every reader: target selection
and the lock (targeting.ts), the HUD heading tape and the radar scope all ask `radarContacts`,
so nothing on the map is out of reach of the lock and nothing lockable is missing from the map.

- Radar: inside the aircraft's radar cone (half-angle off the nose) and range. Each type has its
  own (`AircraftDefinition.radar`, gameplay tuning).
- Visual: any aircraft within `visualRange`, all round. A contact that has left the cone, and a
  lock that has dropped, still shows while it is that close.
- The locked target is always a contact while the lock holds, even outside the cone during its
  grace time (targeting.ts).
- Missiles (the scope only, `seesPoint`): its own always, as the fire control tracks them; any
  other aircraft's by the same radar and visual rules as an aircraft.

No line of sight yet: the flat range has nothing to hide behind. There are no teams either, so
every other live aircraft is a possible contact; friends are left out once teams exist (IFF).
*/
import { Quaternion, Vector3 } from 'three'
import { getAircraft } from '../../content/aircraft'
import type { RadarSpec } from '../../content/schemas'
import type { AircraftState, Vec3 } from '../state/WorldState'

/** Provisional values, waiting on playtest. */
export const radarRules = {
  /** Metres within which any aircraft is seen, all round, radar or not. */
  visualRange: 2000,
} as const

const nose = new Vector3(), toTarget = new Vector3(), turn = new Quaternion()
/** Angle off the nose in degrees and distance in metres, from `shooter` to `target`. */
export function bearing(shooter: AircraftState, target: AircraftState) {
  const { x, y, z, w } = shooter.orientation
  nose.set(1, 0, 0).applyQuaternion(turn.set(x, y, z, w))
  toTarget.set(target.position.x - shooter.position.x, target.position.y - shooter.position.y, target.position.z - shooter.position.z)
  const range = toTarget.length()
  const angle = range > 1e-6 ? nose.angleTo(toTarget) * 180 / Math.PI : 0
  return { angle, range }
}

export const radarOf = (aircraftId: string): RadarSpec => getAircraft(aircraftId).radar

export interface RadarContact {
  entity: AircraftState
  /** Degrees off the nose, and metres. */
  angle: number
  range: number
  /** Inside the radar cone and range (only these can be locked). */
  painted: boolean
  locked: boolean
}

/** Inside `spec`'s cone and range, from the angle off the nose and the range. */
export const insideRadar = (spec: RadarSpec, angle: number, range: number) => angle <= spec.coneDeg && range <= spec.rangeM

/** Every aircraft `self` can see now, nearest the nose first. `lockId` is its locked target. */
export function radarContacts(self: AircraftState, aircraft: readonly AircraftState[], lockId: string | null = self.targeting.targetId): RadarContact[] {
  const spec = radarOf(self.aircraftId)
  const contacts: RadarContact[] = []
  for (const entity of aircraft) {
    if (entity.id === self.id || !entity.alive) continue
    const { angle, range } = bearing(self, entity)
    const painted = insideRadar(spec, angle, range), locked = entity.id === lockId
    if (painted || locked || range <= radarRules.visualRange) contacts.push({ entity, angle, range, painted, locked })
  }
  return contacts.sort((a, b) => a.angle - b.angle || (a.entity.id < b.entity.id ? -1 : 1))
}

/** Whether `self` sees something at `position`: painted by its radar, or within visual range. */
export function seesPoint(self: AircraftState, position: Vec3) {
  const { x, y, z, w } = self.orientation
  nose.set(1, 0, 0).applyQuaternion(turn.set(x, y, z, w))
  toTarget.set(position.x - self.position.x, position.y - self.position.y, position.z - self.position.z)
  const range = toTarget.length(), angle = range > 1e-6 ? nose.angleTo(toTarget) * 180 / Math.PI : 0
  return insideRadar(radarOf(self.aircraftId), angle, range) || range <= radarRules.visualRange
}
