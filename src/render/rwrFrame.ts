/*
Builds the warning picture for one rendered frame: the player's radar warning receiver and MAWS
(rwr.ts), for the RWR scope (rwrPainter.ts) and the warning tones (lockTone.ts).

The simulation reads the warning gear fresh each tick; the display holds it. An emitter that stops
painting stays on the scope for `HOLD` seconds, fading, as a real RWR keeps a symbol after the
last pulse: a radar that sweeps past is still marked for a moment. Only threats shown this tick
set the level the tones sound for. A new aircraft emitter reports `newEmitter` once, for the
"new guy" chirp.

Timed by simulation seconds, so pause freezes the fade; a jump back in time (a reset) starts afresh.
*/
import { getAircraft } from '../content/aircraft'
import { rwrPicture, threatRank, type RwrThreat, type ThreatLevel } from '../game/combat/rwr'
import type { AircraftState, WorldState } from '../game/state/WorldState'

/** Seconds a symbol stays after its emitter was last shown. Provisional. */
export const HOLD = 2

export interface RwrMark {
  sourceId: string
  kind: RwrThreat['kind']
  level: ThreatLevel
  /** Degrees in the player's frame: 0 on the nose, positive right. */
  bearing: number
  /** What the scope prints: the aircraft type's number ('57'), or M for a missile. */
  label: string
  maws: boolean
  /** 1 while shown, fading to 0 over HOLD once it is not. */
  strength: number
}
export interface RwrDisplay {
  marks: RwrMark[]
  /** The highest level shown this tick, for the tones; null when nothing is. */
  top: ThreatLevel | null
  /** An aircraft emitter appeared this frame. */
  newEmitter: boolean
}

/** '57' from 'Su-57', '22' from 'F-22': what an RWR prints for a type. */
export const emitterLabel = (designation: string) => designation.replace(/\D/g, '') || designation.slice(0, 3).toUpperCase()

export function createRwrFrame() {
  const held = new Map<string, { threat: RwrThreat; seen: number }>()
  let last = -Infinity

  function update(world: WorldState | null, self: AircraftState, seconds: number): RwrDisplay {
    if (seconds < last) held.clear()
    last = seconds
    if (!world || !self.alive) { held.clear(); return { marks: [], top: null, newEmitter: false } }
    const live = rwrPicture(self, world)
    let newEmitter = false, top: ThreatLevel | null = null
    for (const threat of live) {
      if (threat.kind === 'aircraft' && !held.has(threat.sourceId)) newEmitter = true
      held.set(threat.sourceId, { threat, seen: seconds })
      if (top === null || threatRank(threat.level) > threatRank(top)) top = threat.level
    }
    const marks: RwrMark[] = []
    for (const [id, { threat, seen }] of held) {
      const strength = 1 - (seconds - seen) / HOLD
      if (strength <= 0) { held.delete(id); continue }
      const aircraft = threat.kind === 'aircraft' ? world.aircraft.find(entity => entity.id === threat.sourceId) : undefined
      marks.push({ sourceId: id, kind: threat.kind, level: threat.level, bearing: threat.bearing, maws: threat.maws, strength,
        label: aircraft ? emitterLabel(getAircraft(aircraft.aircraftId).designation) : 'M' })
    }
    marks.sort((a, b) => threatRank(a.level) - threatRank(b.level))
    return { marks, top, newEmitter }
  }
  function reset() { held.clear(); last = -Infinity }
  return { update, reset }
}
