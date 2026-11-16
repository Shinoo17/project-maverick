import type { MapDefinition } from './types'
import { allPveModes } from './shared'

/** Placeholder: a flat dev grid coloured like a relief map (valley, forest, rock, snow). */
export const mountains: MapDefinition = {
  id: 'mountains', status: 'planned', pveModes: allPveModes,
  name: { en: 'Mountains', th: 'เทือกเขา' },
  info: { en: 'Dev grid · flat placeholder · terrain comes later', th: 'Dev grid · พื้นราบจำลอง · ภูมิประเทศจริงทำภายหลัง' },
  flight: { scene: 'dev-grid', palette: { bands: ['#4f7a45', '#2f5a3a', '#7a6650', '#e8edf0'], levels: [0.42, 0.56, 0.68], scale: 2600, line: '#10180f' } },
}
