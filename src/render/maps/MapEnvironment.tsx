/*
The world a flight is drawn in, chosen by map id. Each scene kind (content/maps/types.ts)
has one component; a new kind adds its component in this folder and a case here.
*/
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { defaultFlightMapId, findMap } from '../../content/maps'
import { TrainingRange } from '../range/TrainingRange'
import { DevGridMap } from './DevGridMap'

export function MapEnvironment({ mapId }: { mapId: string }) {
  const flight = (findMap(mapId) ?? findMap(defaultFlightMapId))?.flight
  // Paused, the canvas draws on demand: draw the new map once it is in.
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => { invalidate() }, [mapId, invalidate])
  if (flight?.scene === 'dev-grid') return <DevGridMap palette={flight.palette} />
  return <TrainingRange />
}
