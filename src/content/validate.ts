import { getAircraft } from './aircraft'
import type { AircraftDefinition, SessionConfig } from './schemas'

export function validateAircraft(entries: readonly AircraftDefinition[]) {
  const ids = new Set<string>()
  entries.forEach((entry, index) => {
    const path = `aircraft[${index}]`
    if (!entry.id || ids.has(entry.id)) throw new Error(`${path}.id: missing or duplicate`)
    ids.add(entry.id)
    if (!/^[\w-]+\.glb$/.test(entry.modelFile)) throw new Error(`${path}.modelFile: expected local GLB filename`)
    if (entry.rotation.length !== 3 || entry.rotation.some((value) => !Number.isFinite(value))) {
      throw new Error(`${path}.rotation: expected three finite numbers`)
    }
    for (const locale of ['th', 'en'] as const) {
      if (!entry.description[locale]?.trim()) throw new Error(`${path}.description.${locale}: required`)
      if (!entry.role[locale]?.trim()) throw new Error(`${path}.role.${locale}: required`)
    }
  })
}

export function validateSession(config: SessionConfig) {
  if (!['playground', 'offline'].includes(config.mode)) throw new Error('session.mode: unsupported mode')
  if (!config.aircraftIds.length) throw new Error('session.aircraftIds: expected at least one aircraft')
  config.aircraftIds.forEach((id, index) => {
    try { getAircraft(id) } catch { throw new Error(`session.aircraftIds[${index}]: unknown id "${id}"`) }
  })
}
