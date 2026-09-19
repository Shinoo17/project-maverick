import { goldenComparisonPolicy, phase0ArchiveVersion } from '../../benchmarks/flight/goldenPolicy'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { aircraftIds, scenarioNames, replayGolden, compareRecordedLeaves, createAircraft, type Golden } from '../../benchmarks/flight/harness'
import { flightProfileVersion } from '../../src/game/flight/profile'
import { goldenAtFps } from './helpers'

describe.each(aircraftIds)('%s Phase 0 golden tracks', aircraftId => {
  it.each(scenarioNames)('%s preserves archived commands and is exact at 30/60/144 FPS', scenario => {
    const golden: Golden = JSON.parse(readFileSync(new URL(`../../benchmarks/flight/golden/${scenario}.${aircraftId}.json`, import.meta.url), 'utf8'))
    // I4 deliberately retired in Phase 2: natural aero changes physics. Preserve
    // Phase 0 outputs for benchmark deltas; never silently replace the archive.
    const policy = goldenComparisonPolicy(flightProfileVersion, golden.recordedWithProfileVersion)
    const replay = replayGolden(golden)
    expect(replay.samples.at(-1)!.step).toBe(golden.totalSteps)
    if (policy === 'equivalence') for (const sample of golden.samples) {
      expect(compareRecordedLeaves(replay.samples[sample.step].state, sample.state)).toEqual([])
    }
    const at60 = goldenAtFps(golden, 60)
    expect(goldenAtFps(golden, 30)).toEqual(at60)
    expect(goldenAtFps(golden, 144)).toEqual(at60)
    expect(at60).toEqual(replay.samples.map(sample => sample.state))
  })
})

it('compares numeric leaves with relative tolerance, ignoring new fields only', () => {
  expect(compareRecordedLeaves({ x: 100 + 1e-8, added: 20 }, { x: 100 })).toEqual([])
  expect(compareRecordedLeaves({ x: 100 + 1e-6 }, { x: 100 })).not.toEqual([])
  expect(compareRecordedLeaves({}, { x: 0 })).not.toEqual([])
  expect(compareRecordedLeaves({ x: NaN }, { x: 0 })).not.toEqual([])
})

it.each([
  ['maneuver.phase', 'active', 'normal'], ['stall.cause', 'aoa', 'none'],
  ['stopReason', 'terrain', 'boundary'], ['alive', true, false],
  ['burnerActive', true, false], ['burnerLocked', false, true],
  ['optional', null, undefined],
] as const)('compares recorded nonnumeric %s exactly', (field, expected, changed) => {
  expect(compareRecordedLeaves({ [field]: expected, added: 1 }, { [field]: expected })).toEqual([])
  expect(compareRecordedLeaves({ [field]: changed }, { [field]: expected })).toHaveLength(1)
  expect(compareRecordedLeaves({}, { [field]: expected })).toHaveLength(1)
})

it('golden replay ignores recorded profile version and merges fields introduced after capture', () => {
  const recorded: Golden = JSON.parse(readFileSync(new URL('../../benchmarks/flight/golden/cobraC.f22.json', import.meta.url), 'utf8'))
  recorded.recordedWithProfileVersion = 'old-physics'
  // Simulate an older golden without a now-existing leaf.
  const oldInitial = recorded.initialState as unknown as { stall: { cause?: string } }
  delete oldInitial.stall.cause
  const replay = replayGolden(recorded)
  expect(replay.initialState.stall.cause).toBe(createAircraft('f22').stall.cause)
  expect(replay.samples.at(-1)!.step).toBe(recorded.totalSteps)
})

it('requires an explicit regenerate/retire decision for unknown physics or archive versions', () => {
  expect(goldenComparisonPolicy(phase0ArchiveVersion, phase0ArchiveVersion)).toBe('equivalence')
  expect(goldenComparisonPolicy(flightProfileVersion, phase0ArchiveVersion)).toBe('archived-inputs')
  expect(() => goldenComparisonPolicy('future-physics', phase0ArchiveVersion)).toThrow(/regenerate goldens.*retire I4/)
  expect(() => goldenComparisonPolicy(flightProfileVersion, 'unexpected-archive')).toThrow(/never silently skip/)
})
