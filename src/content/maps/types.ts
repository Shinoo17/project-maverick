import type { LocalizedText } from '../schemas'
import type { PveModeId } from '../pve/modes'

/*
One map = one file in this folder, listed in index.ts.

A map the flight page can fly declares `flight`:
- 'range'     the hand-made desert range (src/render/range/TrainingRange.tsx)
- 'dev-grid'  a flat placeholder: a coloured survey grid drawn from `palette`
              (src/render/maps/DevGridMap.tsx). No terrain height and no collision
              beyond the flat ground, until the real map is built.
A new scene kind gets its component in src/render/maps/ and a case in MapEnvironment.tsx.
*/
export type MapStatus = 'ready' | 'planned'

/** Colours of a dev-grid map, low ground to high, as CSS hex. `levels` are the three
 * noise heights (0..1) where one band gives way to the next; `scale` is the size of a
 * land feature in metres. */
export interface DevGridPalette {
  bands: readonly [low: string, mid: string, high: string, peak: string]
  levels: readonly [number, number, number]
  scale: number
  line: string
}

export type FlightSceneSpec = { scene: 'range' } | { scene: 'dev-grid'; palette: DevGridPalette }

export interface MapDefinition {
  id: string
  name: LocalizedText
  info: LocalizedText
  /** PVE and Campaign readiness (objectives, spawns). Free flight reads `flight` instead. */
  status: MapStatus
  /** PVE modes whose objectives this map declares. Empty = Campaign only. */
  pveModes: PveModeId[]
  /** Present when the flight page can fly this map. */
  flight?: FlightSceneSpec
}
