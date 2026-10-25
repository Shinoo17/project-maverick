/*
The radar warning receiver and missile approach warning (doc 07): what an aircraft's own warning
gear tells it about the radars and missiles aimed at it. A pure reading of the world each tick,
like radar.ts: it changes nothing, so the HUD and the bots ask the same function and get the
same answer. User decisions 2026-10-25: it gives bearing and threat level only, never range, and
an IR seeker never sets it off (IR is passive); only MAWS sees an IR missile, close in.

Threats, lowest first (`threatRank`):
- search: another aircraft's radar paints us (inside its cone and range, radar.ts).
- lock: it has us as its radar target with a radar missile selected (seeker.ts slot). An IR
  missile selected leaves it at search: the seeker on that missile is passive.
- launch: a radar missile it fired at us is flying on its datalink. Shown on the launcher's
  bearing: the warning comes from the launcher's radar guiding it.
- missile: a missile itself, on its own bearing. A radar missile at us whose seeker is active
  (pitbull), seen by the RWR at any range; or any other aircraft's missile with its motor burning
  within `rwrRules.mawsRange`, closing, seen by MAWS (`maws`), IR or radar alike.
One entry per aircraft at its highest level, and one per missile. A radar missile on memory, or
coasting after burnout outside its own pitbull, is not seen at all.

Bearings are in the aircraft's own frame: degrees around its up axis, 0 on the nose, positive to
the right (body +Z), ±180 behind; elevation positive above its wings.
*/
import { Quaternion, Vector3 } from 'three'
import { getAircraft } from '../../content/aircraft'
import { getWeapon } from '../../content/weapons'
import type { AircraftState, Vec3 } from '../state/WorldState'
import { motorBurning, type Missile } from './missiles'
import { bearing, insideRadar, radarOf } from './radar'
import { selectedMissile } from './seeker'

/** Provisional values, waiting on playtest. */
export const rwrRules = {
  /** Metres within which MAWS sees a burning missile motor. */
  mawsRange: 3000,
} as const

export type ThreatLevel = 'search' | 'lock' | 'launch' | 'missile'
const ranks: Record<ThreatLevel, number> = { search: 0, lock: 1, launch: 2, missile: 3 }
export const threatRank = (level: ThreatLevel) => ranks[level]

export interface RwrThreat {
  /** The aircraft's id, or `missile-<id>`. */
  sourceId: string
  kind: 'aircraft' | 'missile'
  level: ThreatLevel
  /** Degrees in our own frame (see the header). No range, by design. */
  bearing: number
  elevation: number
  /** The aircraft's designation ('Su-57'), or the missile's weapon id. */
  label: string
  /** A missile seen only by MAWS: its motor, not a radar. */
  maws: boolean
}

const turn = new Quaternion(), line = new Vector3()
/** Bearing and elevation of `point` from `self`, in its own frame. */
function direction(self: AircraftState, point: Vec3) {
  const { x, y, z, w } = self.orientation
  line.set(point.x - self.position.x, point.y - self.position.y, point.z - self.position.z).applyQuaternion(turn.set(x, y, z, w).invert())
  return {
    bearing: Math.atan2(line.z, line.x) * 180 / Math.PI,
    elevation: Math.atan2(line.y, Math.hypot(line.x, line.z)) * 180 / Math.PI,
  }
}

/** What `self`'s warning gear shows now, highest threat first. */
export function rwrPicture(self: AircraftState, world: { aircraft: readonly AircraftState[]; missiles: readonly Missile[] }): RwrThreat[] {
  if (!self.alive) return []
  const threats: RwrThreat[] = []
  const levels = new Map<string, ThreatLevel>()
  const raise = (id: string, level: ThreatLevel) => { if (!levels.has(id) || threatRank(level) > threatRank(levels.get(id)!)) levels.set(id, level) }
  for (const other of world.aircraft) {
    if (other.id === self.id || !other.alive) continue
    const { angle, range } = bearing(other, self)
    if (!insideRadar(radarOf(other.aircraftId), angle, range)) continue
    raise(other.id, 'search')
    if (other.targeting.targetId === self.id && selectedMissile(other.aircraftId, other.targeting.seeker.slot)?.weapon.kind === 'radar') raise(other.id, 'lock')
  }
  for (const missile of world.missiles) {
    if (missile.ownerId === self.id) continue
    const weapon = getWeapon(missile.weaponId)
    const radar = weapon.kind === 'radar' && missile.targetId === self.id
    if (radar && missile.guidance === 'datalink') raise(missile.ownerId, 'launch')
    const pitbull = radar && missile.guidance === 'active'
    const toUs = new Vector3(self.position.x - missile.position.x, self.position.y - missile.position.y, self.position.z - missile.position.z)
    const closing = toUs.dot(new Vector3(missile.velocity.x - self.velocity.x, missile.velocity.y - self.velocity.y, missile.velocity.z - self.velocity.z)) > 0
    const maws = motorBurning(missile, weapon.missile!) && closing && toUs.length() <= rwrRules.mawsRange
    if (!pitbull && !maws) continue
    threats.push({ sourceId: `missile-${missile.id}`, kind: 'missile', level: 'missile', ...direction(self, missile.position), label: weapon.id, maws: !pitbull })
  }
  for (const [id, level] of levels) {
    const other = world.aircraft.find(entity => entity.id === id)
    if (!other?.alive) continue
    threats.push({ sourceId: id, kind: 'aircraft', level, ...direction(self, other.position), label: getAircraft(other.aircraftId).designation, maws: false })
  }
  return threats.sort((a, b) => threatRank(b.level) - threatRank(a.level) || (a.sourceId < b.sourceId ? -1 : 1))
}
