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
  const maneuverProfile = getFlightProfile(state?.aircraftId ?? aircraft[0].id).maneuver
  const m = state?.maneuver
  const complete = [false, cameraChanged,
    !!practice && practice.rings > 0 && Math.min(practice.pitch, practice.roll, practice.yaw) > 0.2,
    !!practice && practice.brakeSeconds >= 1,
    !!practice && practice.highGDegrees >= 90,
    !!practice?.recovered, (m?.completed ?? 0) > 0][lesson]
  const status = m?.phase ?? 'normal'
  const speed = state ? Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) : 0
  const low = !!state && state.position.y < maneuverProfile.minAltitude
  const outsideSpeed = speed < maneuverProfile.entryMin || speed > maneuverProfile.entryMax
  const psmReady = maneuverProfile.psmEnabled && !!state && !low && !outsideSpeed
  return <>
    <section className="maneuver-instrument" data-details={lab || lesson > 0} data-phase={status} aria-label={t('maneuver')}>
      <div className="maneuver-status"><span>{t('maneuver')}</span><strong>{t(status === 'normal' ? psmReady ? 'psmReady' : 'psmUnavailable' : `psm_${status}`)}</strong></div>
      <p>{!maneuverProfile.psmEnabled ? t('profileUnsupported') : status === 'normal' ? t(low ? 'psmLow' : outsideSpeed ? 'psmSpeed' : 'psmHold') : t(`psmHint_${status}`)}</p>
      {maneuverProfile.psmEnabled && <div className="psm-speed-band" data-ready={psmReady}>{t('psmBand', { min: Math.round(arcadeSpeed(maneuverProfile.entryMin)), max: Math.round(arcadeSpeed(maneuverProfile.entryMax)) })}</div>}
      <div className="maneuver-readings"><span>{t('noseOffPath')} <b>{state ? `${(m?.alpha ?? 0).toFixed(0)}°` : '—'}</b></span></div>
    </section>
    {lesson > 0 && <section className="flight-lesson" aria-label={t('practiceLesson')}><span>{t(lessonLabels[lesson])}</span><strong role="status">{complete ? t('lessonDone') : t(lessonHints[lesson])}</strong><small>{t('ringsPassed', { count: practice?.rings ?? 0 })} · {t('psmCompleted', { count: m?.completed ?? 0 })}</small></section>}
    {lab && state && <dl className="flight-lab">
      <div><dt>{t('worldSpeed')}</dt><dd>{speed.toFixed(1)} m/s</dd></div>
      <div><dt>{t('pathTurn')}</dt><dd>{m!.pathRate.toFixed(1)} °/s</dd></div>
      <div><dt>{t('bodyRates')}</dt><dd>{[state.rates.pitch, state.rates.roll, state.rates.yaw].map(v => (v * 180 / Math.PI).toFixed(0)).join(' / ')} °/s</dd></div>
      <div><dt>{t('dragForce')}</dt><dd>{m!.drag.toFixed(1)} m/s²</dd></div>
      <div><dt>{t('engineOutput')}</dt><dd>{Math.round(state.enginePower * 100)}%</dd></div>
      <div><dt>{t('psmAuthority')}</dt><dd>{Math.round(m!.controlAuthority * 100)}%</dd></div>
      <div><dt>{t('tvcAngles')}</dt><dd>{state.thrustVectoring.left.toFixed(1)}° / {state.thrustVectoring.right.toFixed(1)}°</dd></div>
      <div><dt>{t('stallSeverity')}</dt><dd>{Math.round(state.stall.severity * 100)}%</dd></div>
      <div><dt>{t('stallAoa')}</dt><dd>{state.stall.aoaDeg.toFixed(1)}°</dd></div>
      <div><dt>{t('stallCause')}</dt><dd>{t(`stallCause_${state.stall.cause}`)}</dd></div>
      <div><dt>{t('lastCobra')}</dt><dd>{m!.peakAlpha.toFixed(0)}° · {m!.entrySpeed.toFixed(0)} → {m!.exitSpeed.toFixed(0)} m/s</dd></div>
    </dl>}
  </>
}
