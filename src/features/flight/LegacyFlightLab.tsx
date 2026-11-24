import { flightInstrumentation } from '../../game/flight/instrumentation'
import { useTranslation } from 'react-i18next'
import type { AircraftState } from '../../game/state/WorldState'

/** The legacy flight core's own debug ledger (Flight Lab › telemetry). It reads that core's
 * internals by design, so it goes with the core at FR7; the rewrite's core has its own overlay. */
export function LegacyFlightLab({ state }: { state: AircraftState }) {
  const { t } = useTranslation()
  const instrumentation = flightInstrumentation(state)
  const axes = (value: { pitch: number; yaw: number; roll: number }, scale = 1) => [value.pitch, value.yaw, value.roll].map(v => (v * scale).toFixed(2)).join(' / ')
  const length = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z).toFixed(2)
  const m = state.maneuver
  const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
  return <dl className="flight-lab" aria-label={t('flightLab')}>
    <div><dt>{t('worldSpeed')}</dt><dd>{speed.toFixed(1)} m/s</dd></div>
    <div><dt>{t('pathTurn')}</dt><dd>{m.pathRate.toFixed(1)} °/s</dd></div>
    <div><dt>{t('bodyRates')}</dt><dd>{[state.rates.pitch, state.rates.roll, state.rates.yaw].map(v => (v * 180 / Math.PI).toFixed(0)).join(' / ')} °/s</dd></div>
    <div><dt>{t('dragForce')}</dt><dd>{m.drag.toFixed(1)} m/s²</dd></div>
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
      <div><dt>{t('labRecoveryAssist')}</dt><dd>{instrumentation.lastStep.envelope.recoveryAssist.toFixed(2)} / {state.intent.releaseSeconds.toFixed(1)} s</dd></div>
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
      <div><dt>{t('labNaturalDeparture')}</dt><dd>{axes(instrumentation.lastStep.naturalDeparture)} rad/s²</dd></div>
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
  </dl>
}
