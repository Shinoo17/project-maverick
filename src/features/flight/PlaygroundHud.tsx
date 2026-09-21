import { observeAirflow } from '../../game/flight/airflow'
import { envelopeLabel, interpretEnvelope } from '../../game/flight/envelope'
import { flightInstrumentation } from '../../game/flight/instrumentation'
import { arcadeSpeed } from '../../game/flight/speed'
import { getFlightProfile } from '../../game/flight/profile'
import { aircraft } from '../../content/aircraft'
import { useTranslation } from 'react-i18next'
import type { AircraftState } from '../../game/state/WorldState'
import type { PracticeState } from '../../game/playground/practice'
export const lessonLabels = ['lesson0', 'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5', 'lesson6'] as const
const lessonHints = ['lessonHint1', 'lessonHint1', 'lessonHint2', 'lessonHint3', 'lessonHint4', 'lessonHint5', 'lessonHint6'] as const
export function PlaygroundHud({ state, practice, lesson, cameraChanged, lab }: { state: AircraftState | null; practice?: PracticeState; lesson: number; cameraChanged: boolean; lab: boolean }) {
  const { t } = useTranslation()
  const profile = getFlightProfile(state?.aircraftId ?? aircraft[0].id), maneuverProfile = profile.maneuver
  const instrumentation = lab && state ? flightInstrumentation(state) : null
  const axes = (value: { pitch: number; yaw: number; roll: number }, scale = 1) => [value.pitch, value.yaw, value.roll].map(v => (v * scale).toFixed(2)).join(' / ')
  const length = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z).toFixed(2)
  const m = state?.maneuver
  const complete = [false, cameraChanged,
    !!practice && practice.rings > 0 && Math.min(practice.pitch, practice.roll, practice.yaw) > 0.2,
    !!practice && practice.brakeSeconds >= 1,
    !!practice && practice.highGDegrees >= 90,
    !!practice?.recovered, (m?.completed ?? 0) > 0][lesson]
  const status = state ? envelopeLabel(interpretEnvelope(state, observeAirflow(state, profile), profile), state.intent.activity) : 'NORMAL'
  const speed = state ? Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) : 0
  const low = !!state && state.position.y < maneuverProfile.minAltitude
  const outsideSpeed = speed < maneuverProfile.entryMin || speed > maneuverProfile.entryMax
  const psmReady = maneuverProfile.psmEnabled && !!state && !low && !outsideSpeed
  return <>
    <section className="maneuver-instrument" data-details={lab || lesson > 0} data-phase={status} aria-label={t('maneuver')}>
      <div className="maneuver-status"><span>{t('maneuver')}</span><strong>{t(`envelope_${status}`)}</strong></div>
      <p>{t(status === 'RECOVERING' || status === 'DEPARTED' ? 'hudStallRecovering' : 'automaticPsmHint')}</p>
      {lab && maneuverProfile.psmEnabled && <div className="psm-speed-band" data-ready={psmReady}>{t('debugC')} · {t('psmBand', { min: Math.round(arcadeSpeed(maneuverProfile.entryMin)), max: Math.round(arcadeSpeed(maneuverProfile.entryMax)) })}</div>}
      <div className="maneuver-readings"><span>{t('noseOffPath')} <b>{state ? `${(m?.alpha ?? 0).toFixed(0)}°` : '—'}</b></span></div>
    </section>
    {lesson > 0 && <section className="flight-lesson" aria-label={t('practiceLesson')}><span>{t(lessonLabels[lesson])}</span><strong role="status">{complete ? t('lessonDone') : t(lessonHints[lesson])}</strong><small>{t('ringsPassed', { count: practice?.rings ?? 0 })} · {t('psmCompleted', { count: m?.completed ?? 0 })}</small></section>}
    {lab && state && instrumentation && <dl className="flight-lab" aria-label={t('flightLab')}>
      <div><dt>{t('worldSpeed')}</dt><dd>{speed.toFixed(1)} m/s</dd></div>
      <div><dt>{t('pathTurn')}</dt><dd>{m!.pathRate.toFixed(1)} °/s</dd></div>
      <div><dt>{t('bodyRates')}</dt><dd>{[state.rates.pitch, state.rates.roll, state.rates.yaw].map(v => (v * 180 / Math.PI).toFixed(0)).join(' / ')} °/s</dd></div>
      <div><dt>{t('dragForce')}</dt><dd>{m!.drag.toFixed(1)} m/s²</dd></div>
      <div><dt>{t('engineOutput')}</dt><dd>{Math.round(state.enginePower * 100)}%</dd></div>
      <div><dt>{t('psmAuthority')}</dt><dd>{Math.round(instrumentation.budget.poweredControlAvailable * 100)}%</dd></div>
      <div><dt>{t('tvcAngles')}</dt><dd>{state.thrustVectoring.left.toFixed(1)}° / {state.thrustVectoring.right.toFixed(1)}°</dd></div>
      <div><dt>{t('stallSeverity')}</dt><dd>{Math.round(state.stall.severity * 100)}%</dd></div>
      <div><dt>{t('stallAoa')}</dt><dd>{state.stall.aoaDeg.toFixed(1)}°</dd></div>
      <div><dt>{t('stallCause')}</dt><dd>{t(`stallCause_${state.stall.cause}`)}</dd></div>
      <div><dt>{t('labAngles')}</dt><dd>{[instrumentation.alphaDeg, instrumentation.betaDeg, instrumentation.incidenceDeg].map(v => v.toFixed(1)).join(' / ')}°</dd></div>
      <div><dt>{t('labQ')}</dt><dd>{instrumentation.dynamicPressureProxy.toFixed(3)}</dd></div>
      <div><dt>{t('labThrust')}</dt><dd>{instrumentation.actualThrust.toFixed(2)} m/s²</dd></div>
      <div><dt>{t('labCapacity')}</dt><dd>{axes(instrumentation.budget.tvc.positive)} / −{axes(instrumentation.budget.tvc.negative)} rad/s²</dd></div>
      <div><dt>{t('labPhysicalAero')}</dt><dd>{axes(instrumentation.budget.physicalAero)} rad/s²</dd></div>
      <div><dt>{t('labFloorBudget')}</dt><dd>{axes(instrumentation.budget.arcadeFloor.acceleration)} rad/s² · {axes(instrumentation.budget.arcadeFloor.maxRate)} rad/s</dd></div>
      {instrumentation.lastStep && <>
        <div><dt>{t('labDriftActivity')}</dt><dd>{state.intent.demand.toFixed(2)} / {state.intent.activity.toFixed(2)} / {state.intent.continuation.toFixed(2)}</dd></div>
        <div><dt>{t('labControlPower')}</dt><dd>{(instrumentation.lastStep.power.controlPower * 100).toFixed(0)}%</dd></div>
        <div><dt>{t('labPowerSources')}</dt><dd>{[instrumentation.lastStep.power.baseTrim, instrumentation.lastStep.power.drive, instrumentation.lastStep.power.controlThrust, instrumentation.lastStep.power.burner].map(v => v.toFixed(1)).join(' / ')} m/s²</dd></div>
        {instrumentation.lastStep.path && <div><dt>{t('labPathSources')}</dt><dd>{length(instrumentation.lastStep.path.physical)} / {length(instrumentation.lastStep.path.assist)} m/s²</dd></div>}
        <div><dt>{t('labBrakeAxes')}</dt><dd>{instrumentation.lastStep.brakes.forward.toFixed(1)} / {instrumentation.lastStep.brakes.crossflow.toFixed(1)} m/s²</dd></div>
        <div><dt>{t('labWork')}</dt><dd>{instrumentation.lastStep.translation.thrustWork.toFixed(2)} / {instrumentation.lastStep.translation.dragWork.toFixed(2)} / {instrumentation.lastStep.translation.brakeWork.toFixed(2)} J/kg</dd></div>
        <div><dt>{t('labLimits')}</dt><dd>{(['permission', 'authority', 'spool', 'path', 'flow'] as const).filter(key => instrumentation.limitations[key]).map(key => t(`labLimit_${key}`)).join(' · ') || '—'}</dd></div>
        <div><dt>{t('labRequestedResponse')}</dt><dd>{axes(instrumentation.lastStep.allocation.request)} rad/s²</dd></div>
        <div><dt>{t('labNozzleTargets')}</dt><dd>{instrumentation.lastStep.nozzleTargets.left.toFixed(1)}° / {instrumentation.lastStep.nozzleTargets.right.toFixed(1)}°</dd></div>
        <div><dt>{t('labPathCap')}</dt><dd>{instrumentation.lastStep.translation.controlPathRate.toFixed(3)} / {instrumentation.lastStep.translation.controlPathCap.toFixed(3)} rad/s · {instrumentation.lastStep.translation.pathCapActive ? t('labCapActive') : '—'}</dd></div>
        <div><dt>{t('labDamping')}</dt><dd>{axes(instrumentation.lastStep.stabilityDamping)} rad/s²</dd></div>
        <div><dt>{t('labNaturalRestoring')}</dt><dd>{axes(instrumentation.lastStep.naturalRestoring)} rad/s²</dd></div>
        <div><dt>{t('labNaturalDamping')}</dt><dd>{axes(instrumentation.lastStep.naturalDamping)} rad/s²</dd></div>
        <div><dt>{t('labAllocatedAero')}</dt><dd>{axes(instrumentation.lastStep.allocation.aero)} rad/s²</dd></div>
        <div><dt>{t('labAllocatedTvc')}</dt><dd>{axes(instrumentation.lastStep.allocation.tvc)} rad/s²</dd></div>
        <div><dt>{t('labAllocatedFloor')}</dt><dd>{axes(instrumentation.lastStep.allocation.floor)} rad/s²</dd></div>
        <div><dt>{t('labUnmet')}</dt><dd>{axes(instrumentation.lastStep.allocation.unmet)} rad/s²</dd></div>
        <div><dt>{t('labActualTorque')}</dt><dd>{axes(instrumentation.lastStep.tvc)} rad/s²</dd></div>
        <div><dt>{t('labActuatorLag')}</dt><dd>{axes(instrumentation.lastStep.actuatorLag)} rad/s²</dd></div>
        <div><dt>{t('labCoupledTorque')}</dt><dd>{axes(instrumentation.lastStep.coupledTarget)} rad/s²</dd></div>
      </>}
      <div><dt>{t('labRequestedPower')}</dt><dd>{(state.engine.requestedPower * 100).toFixed(1)}%</dd></div>
      <div><dt>{t('labPowerIntent')}</dt><dd>{state.intent.powerIntent.toFixed(2)}</dd></div>
      <div><dt>{t('labSeparation')}</dt><dd>{instrumentation.envelope.separation.toFixed(3)}</dd></div>
      <div><dt>{t('labLimiter')}</dt><dd>{instrumentation.envelope.limiterOpen.toFixed(3)}</dd></div>
      <div><dt>{t('lastCobra')}</dt><dd>{m!.peakAlpha.toFixed(0)}° · {m!.entrySpeed.toFixed(0)} → {m!.exitSpeed.toFixed(0)} m/s</dd></div>
    </dl>}
  </>
}
