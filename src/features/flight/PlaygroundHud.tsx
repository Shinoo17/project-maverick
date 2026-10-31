import { readFlight } from '../../game/flight/readout'
import { useTranslation } from 'react-i18next'
import { LegacyFlightLab } from './LegacyFlightLab'
import type { AircraftState } from '../../game/state/WorldState'
import type { PracticeState } from '../../game/playground/practice'
export const lessonLabels = ['lesson0', 'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5', 'lesson6'] as const
const lessonHints = ['lessonHint1', 'lessonHint1', 'lessonHint2', 'lessonHint3', 'lessonHint4', 'lessonHint5', 'lessonHint6'] as const
export function PlaygroundHud({ state, practice, lesson, cameraChanged, lab }: { state: AircraftState | null; practice?: PracticeState; lesson: number; cameraChanged: boolean; lab: boolean }) {
  const { t } = useTranslation()
  const flight = state ? readFlight(state) : null
  const complete = [false, cameraChanged,
    !!practice && practice.rings > 0 && Math.min(practice.pitch, practice.roll, practice.yaw) > 0.2,
    !!practice && practice.brakeSeconds >= 1,
    !!practice && practice.highGDegrees >= 90,
    !!practice?.recovered, (practice?.highAoaRecoveries ?? 0) > 0][lesson]
  const status = flight?.regime ?? 'NORMAL'
  return <>
    <section className="maneuver-instrument" data-details={lab || lesson > 0} data-phase={status} aria-label={t('maneuver')}>
      <div className="maneuver-status"><span>{t('maneuver')}</span><strong>{t(`envelope_${status}`)}</strong></div>
      <p>{t(status === 'RECOVERING' || status === 'DEPARTED' ? 'hudStallRecovering' : 'automaticPsmHint')}</p>
      <div className="maneuver-readings"><span>{t('noseOffPath')} <b>{flight ? `${flight.noseVelocityDeg.toFixed(0)}°` : '—'}</b></span></div>
    </section>
    {lesson > 0 && <section className="flight-lesson" aria-label={t('practiceLesson')}><span>{t(lessonLabels[lesson])}</span><strong role="status">{complete ? t('lessonDone') : t(lessonHints[lesson])}</strong><small>{t('ringsPassed', { count: practice?.rings ?? 0 })} · {t('psmCompleted', { count: practice?.highAoaRecoveries ?? 0 })}</small></section>}
    {lab && state && (state.flightCore ?? 'legacy') === 'legacy' && <LegacyFlightLab state={state} />}
  </>
}
