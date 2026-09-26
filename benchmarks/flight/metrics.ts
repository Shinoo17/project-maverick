import { Vector3 } from 'three'
import { observeAirflow } from '../../src/game/flight/airflow'
import { getFlightProfile } from '../../src/game/flight/profile'
import { arcadeSpeed } from '../../src/game/flight/speedLimits'
import { envelopeLabel } from '../../src/game/flight/envelope'
import type { Trace, Sample } from './harness'
import { benchmarkTarget, naturalObservationWindowSeconds, targetStatus } from './targets'

const speed = (sample: Sample) => new Vector3().copy(sample.state.velocity).length()
const incidence = (sample: Sample) => observeAirflow(sample.state, getFlightProfile(sample.state.aircraftId)).incidenceDeg
const peak = (samples: Sample[], read: (sample: Sample) => number) => Math.max(...samples.map(read))
export const firstTime = (samples: Sample[], test: (sample: Sample) => boolean) => samples.find(test)?.time ?? null
export function measure(trace: Trace) {
  const { samples, commands, scenario, initialState } = trace
  const entry = samples[0]
  // Archived *C tracks released C together with the stick, so the neutral-stick rule finds the same step.
  const release = commands.find(run => run.command.pitch === 0 && run.command.yaw === 0 && run.startStep > 0)?.startStep
  const maneuver = release === undefined ? samples : samples.filter(sample => sample.step <= release)
  const headingChange = (sample: Sample) => speed(entry) < 1 || speed(sample) < 1 ? null
    : new Vector3().copy(entry.state.velocity).angleTo(new Vector3().copy(sample.state.velocity)) * 180 / Math.PI
  const rows: { id: string; value: number | null; unit: string }[] = []
  const add = (id: string, value: number | null, unit: string) => rows.push({ id, value, unit })
  if ((scenario === 'cobraC' || scenario === 'cobra')) {
    add('B1.cobra.peakAoa', peak(maneuver, incidence), 'deg')
    add('B2.cobra.timeTo90', firstTime(maneuver, sample => incidence(sample) >= 90), 's')
    add('B3.cobra.speedLoss', arcadeSpeed(speed(entry) - Math.min(...maneuver.map(speed))), 'arcade km/h')
    add('B4.cobra.headingChange', headingChange(maneuver.at(-1)!), 'deg')
  }
  if ((scenario === 'kulbitC' || scenario === 'kulbit')) add('B5.kulbit.time360', firstTime(samples, sample => sample.noseRotationDeg >= 360), 's')
  if (scenario === 'hardTurn900') {
    add('B13.hardTurn900.peakLimiter', peak(samples, s => s.state.limiterOpen), 'fraction')
    add('B13.hardTurn900.peakGAllowance', peak(samples, s => s.state.flightForces?.envelope.gAllowance ?? 1), 'multiplier')
    add('B13.hardTurn900.peakAoa', peak(samples, incidence), 'deg')
    add('B13.hardTurn900.meanG', samples.slice(1).reduce((sum, sample) => sum + sample.state.maneuver.g, 0) / (samples.length - 1), 'G')
    add('B13.hardTurn900.speedLoss', arcadeSpeed(speed(entry) - speed(samples.at(-1)!)), 'arcade km/h')
  }
  if ((scenario === 'reversal180C' || scenario === 'reversal180')) {
    add('B15.reversal.headingChange', headingChange(samples.at(-1)!), 'deg at 10 s / stop')
    add('B15.reversal.altitudeLoss', initialState.position.y - Math.min(...samples.map(sample => sample.state.position.y)), 'm')
  }
  if (scenario === 'release45') {
    // Neutral input from t = 0. The 0.2 s window lies inside recovery.delaySeconds
    // (pinned in tests/recovery.test.ts), so B8 measures natural response only.
    add('B8.recovery.naturalDuringDelay', incidence(entry) - incidence(samples[Math.round(naturalObservationWindowSeconds * 120)]), 'deg reduction / 0.2 s without assist')
    add('B6.recovery.assistFull', firstTime(samples, s => (s.state.flightForces?.envelope.recoveryAssist ?? 0) >= 0.9), 's after release')
    add('B7.recovery.backToNormal', firstTime(samples, s => !!s.state.flightForces && envelopeLabel(s.state.flightForces.envelope, s.state.intent.activity) === 'NORMAL'), 's after release')
    for (const seconds of [0, 0.2, 0.5, 1, 1.5]) add(`B9.natural.release45.incidence${seconds}s`, incidence(samples[Math.round(seconds * 120)]), 'deg')
    add('B9.natural.release45.maxAttitudeStep', peak(samples.slice(1), sample => sample.noseRotationDeg - samples[sample.step - 1].noseRotationDeg), 'deg/substep')
    add('B9.natural.release45.maxRate', peak(samples, sample => Math.hypot(...Object.values(sample.state.rates))) * 180 / Math.PI, 'deg/s')
  }
  if (scenario === 'fullStick500') {
    add('baseline.fullStick500.peakAoa', peak(samples, incidence), 'deg')
    add('B12.fullStick500.peakIncidence', peak(samples, incidence), 'deg')
    add('B12.fullStick500.limiterOpen', peak(samples, s => s.state.limiterOpen), 'fraction')
  }
  if (scenario === 'psmIntent450') {
    add('B14.psmIntent.timeTo70', firstTime(samples, sample => incidence(sample) >= 70), 's')
    add('psmIntent.timeToLimiter90', firstTime(samples, s => s.state.limiterOpen >= 0.9), 's')
    add('psmIntent.peakIncidence', peak(samples, incidence), 'deg')
    add('psmIntent.peakLimiter', peak(samples, sample => sample.state.limiterOpen), 'fraction')
  }
  if ((scenario === 'pedalC' || scenario === 'pedal')) add('baseline.pedal.yawRate', samples[Math.min(240, samples.length - 1)].state.rates.yaw * 180 / Math.PI, 'deg/s at 2 s')
  if (scenario === 'tailSlide') {
    const apex = firstTime(samples, sample => sample.state.velocity.y <= 0)
    const flip = firstTime(samples, sample => {
      const q = sample.state.orientation
      return 2 * (q.x * q.y + q.z * q.w) < 0
    })
    add('B10.tailSlide.flipTime', apex === null || flip === null ? null : flip - apex, 's after apex')
  }
  if (scenario === 'sideslip60') add('B20.sideslip60.speedLoss1s', arcadeSpeed(speed(entry) - speed(samples.at(-1)!)), 'arcade km/h')
  return rows.map(row => {
    const target = benchmarkTarget(row.id, trace.aircraftId)
    return { ...row, target: target ?? null,
      status: row.id.startsWith('B9.') && !target ? 'pending playtest' as const : targetStatus(row.value, target) }
  })
}

/** No gameplay deadband: discard only numerical roundoff in a normalized factor. */
export function limiterDirectionChanges(values: number[]) {
  let direction = 0, changes = 0
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1]
    if (Math.abs(delta) <= 16 * Number.EPSILON) continue
    const next = Math.sign(delta)
    if (direction && direction !== next) changes++
    direction = next
  }
  return changes
}
