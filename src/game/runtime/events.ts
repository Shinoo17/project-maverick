export type GameEvent =
  | { id: string; tick: number; type: 'weapon-fired'; entityId: string; weaponId: string }
  | { id: string; tick: number; type: 'damage-applied'; targetId: string; sourceId: string | null; amount: number }
  | { id: string; tick: number; type: 'aircraft-destroyed'; entityId: string; sourceId: string | null; cause: 'weapon' | 'terrain' | 'boundary' }
  | { id: string; tick: number; type: 'match-ended'; winnerId: string | null }
