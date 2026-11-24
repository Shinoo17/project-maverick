import type { MapDefinition } from './types'
import { allPveModes } from './shared'

/** Placeholder: a flat dev grid of open sea with sand-ringed islands. */
export const islands: MapDefinition = {
  id: 'islands', status: 'planned', pveModes: allPveModes,
  name: { en: 'Sea & Islands', th: 'ทะเลและหมู่เกาะ' },
  info: { en: 'Dev grid · flat placeholder · sea and islands come later', th: 'Dev grid · พื้นราบจำลอง · ทะเลและเกาะจริงทำภายหลัง' },
  flight: { scene: 'dev-grid', palette: { bands: ['#1f5f8f', '#d9c48a', '#4c8a4a', '#6f6a5c'], levels: [0.6, 0.64, 0.74], scale: 3400, line: '#0b2233' } },
}
