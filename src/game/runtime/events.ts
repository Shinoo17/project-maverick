export type GameEvent =
  | { id: string; tick: number; type: 'weapon-fired'; entityId: string; weaponId: string }
  | { id: string; tick: number; type: 'damage-applied'; targetId: string; sourceId: string | null; amount: number }
  | { id: string; tick: number; type: 'aircraft-destroyed'; entityId: string; sourceId: string | null; cause: 'weapon' | 'terrain' | 'boundary' }
  | { id: string; tick: number; type: 'match-ended'; winnerId: string | null }
  | { id: string; tick: number; type: 'missile-launched'; entityId: string; weaponId: string; missileId: number; targetId: string }
  /** `targetId`: the aircraft that set the burst off and took its damage; null for the ground or a self-destruct. */
  | { id: string; tick: number; type: 'missile-detonated'; missileId: number; ownerId: string; weaponId: string; position: { x: number; y: number; z: number }; cause: 'proximity' | 'impact' | 'ground' | 'expired'; targetId: string | null }
