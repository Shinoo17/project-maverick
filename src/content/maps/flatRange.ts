import type { MapDefinition } from './types'

/** The desert training range: the one hand-made map. */
export const flatRange: MapDefinition = {
  id: 'flat-range', status: 'ready', pveModes: ['tdm'],
  name: { en: 'Flat Training Range', th: 'สนามฝึกพื้นราบ' },
  info: { en: 'Radius 8 km · spawn 400 m · flat grid', th: 'รัศมี 8 กม. · เกิดที่ 400 ม. · พื้นตาราง' },
  flight: { scene: 'range' },
}
