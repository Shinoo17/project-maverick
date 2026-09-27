/*
Content checks for an operation. Throws on the first problem so a broken
campaign fails at start-up instead of showing a map that can never be finished.
*/
import { findMap } from '../maps'
import { getAircraft } from '../aircraft'
import type { OperationDefinition } from './types'

export function validateOperation(operation: OperationDefinition) {
  const path = `operation(${operation.id})`
  const ids = new Set<string>()
  for (const mission of operation.missions) {
    if (!mission.id || ids.has(mission.id)) throw new Error(`${path}.missions.id: missing or duplicate "${mission.id}"`)
    ids.add(mission.id)
  }

  for (const mission of operation.missions) {
    const at = `${path}.${mission.id}`
    for (const required of mission.requires) {
      if (!ids.has(required)) throw new Error(`${at}.requires: unknown mission "${required}"`)
    }
    if (!findMap(mission.mapId)) throw new Error(`${at}.mapId: unknown map "${mission.mapId}"`)
    if (mission.aircraft.kind === 'assigned') getAircraft(mission.aircraft.aircraftId)
    const [x, y] = mission.mapPosition
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new Error(`${at}.mapPosition: expected values from 0 to 1`)
  }

  if (!operation.missions.some(mission => mission.requires.length === 0)) {
    throw new Error(`${path}: needs at least one starting mission (requires: [])`)
  }
  assertNoCycle(operation, path)
}

/** Depth-first search: meeting a mission that is still "visiting" means a loop. */
function assertNoCycle(operation: OperationDefinition, path: string) {
  const requires = new Map(operation.missions.map(mission => [mission.id, mission.requires]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') throw new Error(`${path}.requires: cycle through "${id}"`)
    state.set(id, 'visiting')
    requires.get(id)?.forEach(visit)
    state.set(id, 'done')
  }
  operation.missions.forEach(mission => visit(mission.id))
}
