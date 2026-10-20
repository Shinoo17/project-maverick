/*
Builds the HUD's gun marks for one rendered frame (gunnerySymbols.ts draws them).

The player's selected target comes from the simulation (targeting.ts). Its pose is drawn
between ticks like every other aircraft, with the same rule as the drone model: once it is
not alive it is not drawn, and a respawn snaps into place instead of sweeping across the
frame. The gun solution is solved from the same interpolated poses the camera sees.

Hit flashes and SPLASH come from the simulation's events, only for rounds the player fired,
and are timed in ticks so pause freezes them.
*/
import { Quaternion, Vector3 } from 'three'
import { getAircraft } from '../content/aircraft'
import { hitboxes } from '../content/hitboxes'
import { boundingRadius } from '../game/combat/collision'
import { AIRCRAFT_HP } from '../game/combat/damage'
import { defaultReticle, EFFECTIVE_RANGE, gunMountOf, solveGun, type ShooterPose } from '../game/combat/gunSolution'
import type { GameEvent } from '../game/runtime/events'
import type { AircraftState, WorldState } from '../game/state/WorldState'
import type { GunneryMarks } from '../features/flight/gunnerySymbols'

/** An aircraft between the last two ticks; null when it is not alive now. */
export function between(before: WorldState | null, now: WorldState | null, pick: (entity: AircraftState) => boolean, alpha: number) {
  const current = now?.aircraft.find(pick)
  if (!current?.alive) return null
  const last = before?.aircraft.find(pick)
  const from = last?.alive && last.id === current.id ? last : current
  const point = (p: AircraftState['position']) => new Vector3(p.x, p.y, p.z)
  return {
    entity: current,
    position: point(from.position).lerp(point(current.position), alpha),
    orientation: new Quaternion(from.orientation.x, from.orientation.y, from.orientation.z, from.orientation.w)
      .slerp(new Quaternion(current.orientation.x, current.orientation.y, current.orientation.z, current.orientation.w), alpha),
    velocity: point(from.velocity).lerp(point(current.velocity), alpha),
  }
}

const radii = new Map<string, number>()
function radiusOf(entity: AircraftState) {
  const id = getAircraft(entity.aircraftId).hitboxProfileId
  if (!radii.has(id)) radii.set(id, boundingRadius(hitboxes[id]))
  return radii.get(id)!
}

export function createGunnery(aircraftId: string) {
  const mount = gunMountOf(aircraftId)
  let hitTick: number | null = null
  let splash: GunneryMarks['splash'] = null

  function reset() { hitTick = null; splash = null }

  /** `events` are the ones drained this frame; `alpha` is how far the frame is past the last tick. */
  function update(before: WorldState | null, now: WorldState | null, alpha: number, shooter: ShooterPose & { id: string; targetId: string | null }, events: readonly GameEvent[], assist = false): GunneryMarks {
    for (const event of events) {
      if (event.type === 'damage-applied' && event.sourceId === shooter.id) hitTick = event.tick
      if (event.type === 'aircraft-destroyed' && event.sourceId === shooter.id) {
        const wreck = now?.aircraft.find(entity => entity.id === event.entityId)
        if (wreck) splash = { tick: event.tick, position: { ...wreck.position } }
      }
    }
    const clock = (now?.tick ?? 0) - 1 + alpha
    const target = shooter.targetId ? between(before, now, entity => entity.id === shooter.targetId, alpha) : null
    const base = { now: clock, hitTick, splash, assist }
    if (!target) return { ...base, reticle: defaultReticle(shooter, mount), target: null, lead: null, inRange: false, onSolution: false }
    const solution = solveGun(shooter, mount, { position: target.position, velocity: target.velocity, acceleration: target.entity.acceleration })
    const p = shooter.position, v = shooter.velocity
    const toTarget = target.position.clone().sub(new Vector3(p.x, p.y, p.z))
    const range = toTarget.length()
    const closure = range > 1e-6 ? -toTarget.dot(target.velocity.clone().sub(new Vector3(v.x, v.y, v.z))) / range : 0
    const radius = radiusOf(target.entity)
    const reachable = !!solution?.reachable
    const miss = solution ? new Vector3(solution.reticle.x - solution.lead.x, solution.reticle.y - solution.lead.y, solution.reticle.z - solution.lead.z).length() : Infinity
    return {
      ...base,
      // Out of reach, the reticle at the target's range would mark a point no round arrives at.
      reticle: reachable ? solution!.reticle : defaultReticle(shooter, mount),
      target: { position: target.position, radius, range, closure, hp: target.entity.hp / AIRCRAFT_HP },
      lead: reachable ? solution!.lead : null,
      inRange: reachable && range <= EFFECTIVE_RANGE,
      // Within most of the target's size: rounds through that point hit the airframe.
      onSolution: reachable && miss <= radius * 0.6,
    }
  }
  return { update, reset }
}
