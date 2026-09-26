import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { bell, bellProbe, cobraEntry, cobraExit, herbst, immelmann, kulbit, loop, maneuverIds, pedalTurn, powerLoop, rollMetrics, rollSpeeds, smoothnessMetrics, spawnAt } from './maneuvers'
import { maneuverTargets, targetStatus, type Target } from './targets'
import { flightProfileVersion } from '../../src/game/flight/profile'
import { createMouseStick, readStickAxes, screenFrame } from '../../src/game/input/mouseStick'

/** MR0 maneuver instrumentation (docs/psm-maneuver-control-plan.md §3, §5 MR0). Report only.
 * MANEUVER_REPORT_LABEL names out/<label>.{json,md} so before/after pairs sit side by side. */
const label = process.env.MANEUVER_REPORT_LABEL ?? 'maneuvers'
type Row = Record<string, unknown>

/** RC5: pointer held at the top-right corner (45°, full deflection) while the bank sweeps. */
function mouseProbe() {
  const stick = createMouseStick()
  stick.live = true; stick.x = Math.SQRT1_2; stick.y = Math.SQRT1_2
  return [0, 45, 90, 135, 180].flatMap(bankDeg => (['horizon', 'aircraft'] as const).map(mode => {
    const state = spawnAt('f22', 450), q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -bankDeg * Math.PI / 180)
    state.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }
    const axes = readStickAxes(stick, screenFrame(state, mode), 0)!
    return { bankDeg, mode, pitch: Math.round(axes.pitch * 100) / 100, roll: Math.round(axes.roll * 100) / 100 }
  }))
}

it('reports the maneuver catalogue and control smoothness', () => {
  const ids = [...maneuverIds]
  const roll = ids.flatMap(id => rollSpeeds.map(kph => rollMetrics(id, kph)))
  const smoothness = ids.flatMap(id => (['pitch', 'roll', 'yaw'] as const).flatMap(axis => [450, 700].map(kph => smoothnessMetrics(id, axis, kph))))
  const entry = [...ids.flatMap(id => [false, true].map(shift => cobraEntry(id, 450, shift))), ...[350, 550].map(kph => cobraEntry('f22', kph, false))]
  const exit = ids.flatMap(id => [cobraExit(id, 450, 'push'), cobraExit(id, 450, 'release')])
  const pedal = ids.map(pedalTurn)
  const herbsts = ids.flatMap(id => [herbst(id, false), herbst(id, true)])
  const loops = ids.flatMap(id => [loop(id, 'plain'), loop(id, 'powered')])
  const powerLoops = ids.flatMap(id => [400, 450].flatMap(kph => (['none', 'W', 'Shift', 'Shift+Space'] as const).map(flow => powerLoop(id, kph, flow))))
  const bells = ids.flatMap(id => [bellProbe(id), bell(id)])
  const immelmanns = ids.map(id => immelmann(id))
  const kulbits = ids.map(id => kulbit(id))
  const mouse = mouseProbe()

  const check = (id: string, aircraft: string, value: number | null | undefined, target: Target) => ({ id, aircraft, value: value ?? null, target: `${target.min ?? '−∞'} … ${target.max ?? '∞'}`, status: targetStatus(value ?? null, target) })
  const t = maneuverTargets
  const checks = ['f22', 'su57'].flatMap(id => {
    const rows: Row[] = []
    for (const r of roll.filter(r => r.aircraft === id && (r.speedKph === 450 || r.speedKph === 700))) {
      rows.push(check(`B26.roll.peakRate.${r.speedKph}`, id, r.peakRateDegS, t.rollPeakRate), check(`B26.roll.time90.${r.speedKph}`, id, r.time90, t.rollTime90))
    }
    const e = entry.find(r => r.aircraft === id && r.speedKph === 450 && !r.shift)!
    rows.push(check('B2.cobra.timeTo90NoShift', id, e.time90, t.cobraTime90NoShift), check('B1.cobra.peakAoa (Space + Shift)', id, entry.find(r => r.aircraft === id && r.speedKph === 450 && r.shift)!.peakIncidence, t.cobraPeakAoa))
    const x = exit.find(r => r.aircraft === id && r.mode === 'push')! as ReturnType<typeof cobraExit> & Row
    rows.push(check('B27.cobraExit.toEntryAttitude10', id, x.toEntryAttitude10 as number, t.cobraExitSeconds), check('B27.cobraExit.maxPathAngle', id, x.maxPathAngle as number, t.cobraExitPathClimb),
      check('B27.cobraExit.altitudeGainAtLevel', id, x.altitudeGainAtLevel as number, t.cobraExitAltitude))
    const h = herbsts.filter(r => r.aircraft === id).sort((a, b) => (a.time170 ?? 99) - (b.time170 ?? 99))[0]
    rows.push(check(`B28.herbst.time170 (${h.withYaw ? 'roll+yaw' : 'roll'})`, id, h.time170, t.herbstSeconds), check('B28.herbst.altitudeRange', id, h.altitudeRange, t.herbstAltitude))
    const p = powerLoops.filter(r => r.aircraft === id && r.flow !== 'Shift+Space').sort((a, b) => a.widthM! - b.widthM!)[0]
    rows.push(check(`B29.powerLoop.width (${p.speedKph} ${p.flow})`, id, p.widthM, t.powerLoopWidth), check('B29.powerLoop.time270', id, p.time270, t.powerLoopSeconds),
      check('B29.powerLoop.peakIncidence', id, p.peakIncidence, t.powerLoopIncidence), check('B29.powerLoop.noseMinusPath', id, p.maxNoseMinusPath, t.powerLoopIncidence), check('B29.powerLoop.minKph', id, p.minKph, t.powerLoopMinKph))
    const b = bells.find(r => r.aircraft === id && r.flow.startsWith('recipe'))!
    rows.push(check('B30.bell.minKph', id, b.minKph, t.bellMinKph), check('B30.bell.backSlideM', id, b.backSlideM, t.bellBackSlide), check('B30.bell.noseDropAfterApex', id, b.noseDropAfterApex, t.bellNoseDrop))
    const m = immelmanns.find(r => r.aircraft === id)!
    rows.push(check('B31.immelmann.halfLoop', id, m.halfLoop, t.immelmannHalfLoop), check('B31.immelmann.rollOut', id, m.rollOut, t.immelmannRollOut), check('B31.immelmann.topKph', id, m.topKph, t.immelmannTopKph))
    rows.push(check('B5.kulbit350.time360', id, kulbits.find(r => r.aircraft === id)!.time360, t.kulbitTime360))
    return rows
  })
  const pedalRatio = pedal.find(r => r.aircraft === 'f22')!.travel8sDeg! / pedal.find(r => r.aircraft === 'su57')!.travel8sDeg!
  checks.push(check('B11.pedal.su57Time360', 'su57', pedal.find(r => r.aircraft === 'su57')!.time360, t.pedalSu57Time360), check('B11.pedal.f22ToSu57Travel8s', 'f22', Math.round(pedalRatio * 1000) / 1000, t.pedalRatio))

  const sections = { roll, smoothness, cobraEntry: entry, cobraExit: exit, pedal, herbst: herbsts, loops, powerLoops, bell: bells, immelmann: immelmanns, kulbit: kulbits, mouse, checks }
  const table = (rows: Row[]) => {
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))]
    return [`| ${keys.join(' | ')} |`, `|${keys.map(() => '---').join('|')}|`, ...rows.map(row => `| ${keys.map(key => row[key] ?? '—').join(' | ')} |`)].join('\n')
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  mkdirSync('benchmarks/flight/out', { recursive: true })
  writeFileSync(`benchmarks/flight/out/${label}.json`, JSON.stringify({ flightProfileVersion, sourceCommit, ...sections }, null, 2) + '\n')
  writeFileSync(`benchmarks/flight/out/${label}.md`, [`# Maneuvers — ${flightProfileVersion} (${label})`,
    `Source commit ${sourceCommit} plus working tree. Report only. Speeds are arcade km/h, times seconds, rates °/s unless named. See benchmarks/flight/maneuvers.ts for each recipe.`,
    ...Object.entries(sections).map(([name, rows]) => `## ${name}\n\n${table(rows as Row[])}`)].join('\n\n') + '\n')
  console.table(checks)
}, 120000)
