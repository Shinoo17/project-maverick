import { Vector3 } from 'three'
import { flightInstrumentation } from '../../src/game/flight/instrumentation'
import { arcadeSpeed } from '../../src/game/flight/speedLimits'
import type { Trace, Sample } from './harness'
import { targets, targetStatus } from './targets'

const speed = (sample: Sample) => new Vector3().copy(sample.state.velocity).length()
const incidence = (sample: Sample) => flightInstrumentation(sample.state).incidenceDeg
const peak = (samples: Sample[], read: (sample: Sample) => number) => Math.max(...samples.map(read))
export const firstTime = (samples: Sample[], test: (sample: Sample) => boolean) => samples.find(test)?.time ?? null
export function measure(trace: Trace) {
  const { samples, commands, scenario, initialState } = trace
  const entry = samples[0]
  const release = commands.find(run => !run.command.psmArm && run.startStep > 0)?.startStep
  const maneuver = release === undefined ? samples : samples.filter(sample => sample.step <= release)
  const headingChange = (sample: Sample) => speed(entry) < 1 || speed(sample) < 1 ? null
    : new Vector3().copy(entry.state.velocity).angleTo(new Vector3().copy(sample.state.velocity)) * 180 / Math.PI
  const rows: { id: string; value: number | null; unit: string }[] = []
  const add = (id: string, value: number | null, unit: string) => rows.push({ id, value, unit })
  if (scenario === 'cobraC') {
    add('B1.cobra.peakAoa', peak(maneuver, incidence), 'deg')
    add('B2.cobra.timeTo90', firstTime(maneuver, sample => incidence(sample) >= 90), 's')
    add('B3.cobra.speedLoss', arcadeSpeed(speed(entry) - Math.min(...maneuver.map(speed))), 'arcade km/h')
    add('B4.cobra.headingChange', headingChange(maneuver.at(-1)!), 'deg')
    const normal = release === undefined ? undefined : samples.find(sample => sample.step > release && sample.state.maneuver.phase === 'normal')
    add('legacy.recovery.backToNormal', normal ? normal.time - samples[release!].time : null, 's after C release')
  }
  if (scenario === 'kulbitC') add('B5.kulbit.time360', firstTime(samples, sample => sample.noseRotationDeg >= 360), 's')
  if (scenario === 'hardTurn900') {
    add('B13.hardTurn900.peakAoa', peak(samples, incidence), 'deg')
    add('B13.hardTurn900.meanG', samples.slice(1).reduce((sum, sample) => sum + sample.state.maneuver.g, 0) / (samples.length - 1), 'G')
    add('B13.hardTurn900.speedLoss', arcadeSpeed(speed(entry) - speed(samples.at(-1)!)), 'arcade km/h')
  }
  if (scenario === 'reversal180C') {
    add('B15.reversal.headingChange', headingChange(samples.at(-1)!), 'deg at 10 s / stop')
    add('B15.reversal.altitudeLoss', initialState.position.y - Math.min(...samples.map(sample => sample.state.position.y)), 'm')
  }
  if (scenario === 'release45') {
    for (const seconds of [0.2, 0.5, 1.5]) add(`B9.natural.release45.incidence${seconds}s`, incidence(samples[Math.round(seconds * 120)]), 'deg')
    add('B9.natural.release45.maxRate', peak(samples, sample => Math.hypot(...Object.values(sample.state.rates))) * 180 / Math.PI, 'deg/s')
  }
  if (scenario === 'fullStick500') add('baseline.fullStick500.peakAoa', peak(samples, incidence), 'deg')
  if (scenario === 'pedalC') add('baseline.pedal.yawRate', samples[Math.min(240, samples.length - 1)].state.rates.yaw * 180 / Math.PI, 'deg/s at 2 s')
  if (scenario === 'tailSlide') add('baseline.tailSlide.flipTime', firstTime(samples, sample => {
    const q = sample.state.orientation
    return 2 * (q.x * q.y + q.z * q.w) < 0
  }), 's')
  if (scenario === 'sideslip60') add('baseline.sideslip60.speedLoss1s', arcadeSpeed(speed(entry) - speed(samples.at(-1)!)), 'arcade km/h')
  return rows.map(row => ({ ...row, target: targets[row.id] ?? null, status: targetStatus(row.value, targets[row.id]) }))
}
