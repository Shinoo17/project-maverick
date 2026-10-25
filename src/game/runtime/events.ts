export type GameEvent =
  | { id: string; tick: number; type: 'weapon-fired'; entityId: string; weaponId: string }
  | { id: string; tick: number; type: 'damage-applied'; targetId: string; sourceId: string | null; amount: number }
  | { id: string; tick: number; type: 'aircraft-destroyed'; entityId: string; sourceId: string | null; cause: 'weapon' | 'terrain' | 'boundary' }
  | { id: string; tick: number; type: 'match-ended'; winnerId: string | null }
  /** A countermeasure burst started; `bursts` is what is left after it. */
  | { id: string; tick: number; type: 'countermeasure-dispensed'; entityId: string; bursts: number }
  | { id: string; tick: number; type: 'missile-launched'; entityId: string; weaponId: string; missileId: number; targetId: string; stationId: string; hardpoint: { x: number; y: number; z: number } }
  /** A missile's seeker changed what it follows: to flare or chaff `decoyId`, or back to its target (null). */
  | { id: string; tick: number; type: 'missile-decoyed'; missileId: number; ownerId: string; targetId: string; decoyId: number | null }
  /** `targetId`: the aircraft that set the burst off and took its damage; null for the ground or a self-destruct. */
  | { id: string; tick: number; type: 'missile-detonated'; missileId: number; ownerId: string; weaponId: string; position: { x: number; y: number; z: number }; cause: 'proximity' | 'impact' | 'ground' | 'expired' | 'dud'; targetId: string | null }
