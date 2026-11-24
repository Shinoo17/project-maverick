import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Quaternion, Vector3 } from 'three'
import { readFlight } from '../../game/flight/readout'
import { psmShareOf, driftShareOf } from '../../game/camera/cameraRoll'
import { driftWeight } from '../../game/camera/chaseBlend'
import { coreAssist, coreProfileOf, type AxisSet, type CoreAssist, type CoreProfile, type CoreTuning } from '../../game/flightCore/profile'
import { simulationSpeed, arcadeSpeed } from '../../game/flight/speedLimits'
import type { FlightInput } from '../../game/input/FlightInput'
import type { AircraftState } from '../../game/state/WorldState'

const deg = (radians: number) => radians * 180 / Math.PI
const axes = (value: AxisSet, format = (v: number) => v.toFixed(0)) => [value.pitch, value.roll, value.yaw].map(format).join(' / ')
type CoreLabKey = `coreLab${'Speed' | 'Velocity' | 'Forward' | 'Angles' | 'Command' | 'Rates' | 'Targets' | 'Saturation' | 'Band' | 'Control' | 'G' | 'Forces' | 'Psm' | 'Camera' | 'Drift' | 'Engine' | 'Airbrake' | 'Hold' | 'Aim'}`
const vector = (v: { x: number; y: number; z: number }, digits = 1) => [v.x, v.y, v.z].map(n => n.toFixed(digits)).join(', ')

/** The new core's debug overlay (Flight Lab › telemetry; spec §10.2). It reads the core's own
 * state by design, like LegacyFlightLab does for the legacy core. */
export function CoreFlightLab({ state, input }: { state: AircraftState; input: FlightInput }) {
  const { t } = useTranslation()
  const core = state.coreFlight
  if (!core) return null
  const flight = readFlight(state), p = coreProfileOf(state.aircraftId), d = core.diag
  const forward = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().copy(state.orientation))
  const command = input.lastCommand
  const rates = { pitch: deg(state.rates.pitch), roll: deg(state.rates.roll), yaw: deg(state.rates.yaw) }
  const targets = { pitch: deg(d.target.pitch), roll: deg(d.target.roll), yaw: deg(d.target.yaw) }
  const rows: Array<[CoreLabKey, string]> = [
    ['coreLabSpeed', `${flight.airspeed.toFixed(1)} m/s · ${flight.hudSpeed.toFixed(0)} km/h`],
    ['coreLabVelocity', `${vector(state.velocity)} m/s`],
    ['coreLabForward', vector(forward, 3)],
    ['coreLabAngles', `${flight.alphaDeg.toFixed(1)}° / ${flight.betaDeg.toFixed(1)}° / ${flight.noseVelocityDeg.toFixed(1)}°`],
    ['coreLabCommand', command ? axes(command, v => v.toFixed(2)) : '—'],
    ['coreLabRates', `${axes(rates)} °/s`],
    ['coreLabTargets', `${axes(targets)} °/s`],
    ['coreLabSaturation', `${d.limit.pitch} / ${d.limit.roll} / ${d.limit.yaw}${d.liftCapped ? ' · lift cap' : ''}`],
    ['coreLabBand', `${deg(d.pitchBand.low).toFixed(0)} … ${deg(d.pitchBand.high).toFixed(0)} °/s`],
    ['coreLabControl', `${(d.control * 100).toFixed(0)}% / ${(d.rollAxis * 100).toFixed(0)}%`],
    ['coreLabG', `${flight.g.toFixed(2)} (${p.gLimit} / −${p.gLimitNeg})`],
    ['coreLabForces', `${[d.lift, d.drag, d.side, d.thrust].map(v => v.toFixed(1)).join(' / ')} m/s²`],
    ['coreLabPsm', `${command?.psm ? 'ON' : '—'} / ${(core.psmAuthority * 100).toFixed(0)}%`],
    ['coreLabCamera', `${driftWeight(flight).toFixed(2)} · ${psmShareOf(state).toFixed(2)} / ${driftShareOf(state).toFixed(2)}`],
    ['coreLabDrift', `${flight.noseVelocityDeg.toFixed(1)}° / ${driftShareOf(state).toFixed(2)}`],
    ['coreLabEngine', `${(core.throttle * 100).toFixed(0)}% / ${(core.power * 100).toFixed(0)}%${core.burner.active ? ' · AB' : ''}`],
    ['coreLabAirbrake', `${(core.airbrake * 100).toFixed(0)}%`],
    ['coreLabHold', `${d.speed.mode}${d.speed.ratchet ? ' · ratchet' : ''} · ${arcadeSpeed(core.speedTarget).toFixed(0)} km/h · I ${d.speed.integral.toFixed(3)}`],
    ['coreLabAim', `${input.mixer.autopilot.errorDeg.toFixed(1)}° / ${input.mixer.psmWeight.toFixed(2)}${input.mixer.stickMode ? ' · stick' : ''}`],
  ]
  return <dl className="flight-lab" aria-label={t('coreLab')}>
    {rows.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
  </dl>
}

// The tuning panel's fields, in profile order: plain numbers, or a pitch/roll/yaw set.
type ProfileKey = { [K in keyof CoreProfile]: CoreProfile[K] extends number | AxisSet ? K : never }[keyof CoreProfile]
const profileFields: Array<[ProfileKey, string]> = [
  ['maxRate', '°/s'], ['tau', 's'], ['maxAccel', '°/s²'], ['controlSpeedKph', 'km/h'], ['gLimit', 'G'], ['gLimitNeg', 'G'],
  ['aoaLimitDeg', '°'], ['weathervane', '1/s'], ['rollAxisWeight', '0..1'], ['cornerSpeedKph', 'km/h'], ['clAlpha', '/rad'],
  ['alphaCritDeg', '°'], ['clMax', ''], ['clPost', ''], ['cd0', ''], ['inducedK', ''], ['cdHigh', ''], ['cyBeta', ''],
  ['airbrakeCd', ''], ['brakeCd', ''], ['thrustDry', 'm/s²'], ['thrustBurner', 'm/s²'], ['spool', '1/s'],
  ['burnerSeconds', 's'], ['burnerRecharge', 's'], ['psmRate', '°/s (FR4)'],
]
const assistFields: Array<[keyof CoreAssist, string]> = [
  ['holdGain', '/(m/s)'], ['holdIntegral', '/(m/s·s)'], ['ratchetG', 'G'], ['digitalRise', 's'], ['digitalRelease', 's'],
  ['turnBankDeg', '°'], ['turnBankSeconds', 's'], ['turnHoldSeconds', 's'],
]

/** Flight Lab's live tuning of the new core (FR1). Never mutates the content profiles: it edits
 * a patch the session hands the runtime (`apply`), which validates it first. */
export function CoreTuningPanel({ aircraftId, tuning, apply }: { aircraftId: string; tuning: CoreTuning; apply: (next: CoreTuning) => void }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  const profile = coreProfileOf(aircraftId, tuning), base = coreProfileOf(aircraftId), assist = { ...coreAssist, ...tuning.assist }
  const commit = (next: CoreTuning) => { try { apply(next); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  const setProfile = (patch: Partial<CoreProfile>) => commit({ ...tuning, profiles: { ...tuning.profiles, [aircraftId]: { ...tuning.profiles?.[aircraftId], ...patch } } })
  const number = (id: string, value: number, changed: boolean, set: (value: number) => void) =>
    <input id={id} type="number" step="any" defaultValue={value} key={`${id}:${value}`} data-modified={changed}
      onBlur={e => { const next = Number(e.target.value); if (Number.isFinite(next) && next !== value) set(next) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  const copy = () => { void navigator.clipboard?.writeText(JSON.stringify(tuning, null, 2)) }
  return <div className="core-tuning">
    <h3>{t('coreTuning')} · {aircraftId}</h3>
    <div className="core-tuning-grid">
      {profileFields.map(([key, unit]) => {
        const value = profile[key], original = base[key]
        return <div key={key} className="core-tuning-row">
          <label htmlFor={`tune-${key}`}>{key} <small>{unit}</small></label>
          {typeof value === 'number'
            ? number(`tune-${key}`, value, value !== original, next => setProfile({ [key]: next }))
            : <span className="core-tuning-axes">{(['pitch', 'roll', 'yaw'] as const).map(axis =>
              <span key={axis}>{number(`tune-${key}-${axis}`, value[axis], value[axis] !== (original as AxisSet)[axis], next => setProfile({ [key]: { ...value, [axis]: next } }))}</span>)}</span>}
        </div>
      })}
    </div>
    <h3>{t('coreTuningAssist')}</h3>
    <div className="core-tuning-grid">
      {assistFields.map(([key, unit]) => <div key={key} className="core-tuning-row">
        <label htmlFor={`tune-assist-${key}`}>{key} <small>{unit}</small></label>
        {number(`tune-assist-${key}`, assist[key], assist[key] !== coreAssist[key], next => commit({ ...tuning, assist: { ...tuning.assist, [key]: next } }))}
      </div>)}
    </div>
    {error && <p className="flight-brief-alert" role="alert">{error}</p>}
    <div className="flight-lab-actions">
      <button onClick={() => commit({})}>{t('coreTuningReset')}</button>
      <button onClick={copy}>{t('coreTuningCopy')}</button>
    </div>
    <p>{t('coreTuningHint')} control {simulationSpeed(profile.controlSpeedKph).toFixed(0)} m/s · corner {simulationSpeed(profile.cornerSpeedKph).toFixed(0)} m/s</p>
  </div>
}
