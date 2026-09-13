import { arcadeSpeed } from '../../game/flight/speed'
import { maneuverProfile } from '../../game/flight/maneuvers'
import { useTranslation } from 'react-i18next'
import type { AircraftState } from '../../game/state/WorldState'
import type { PracticeState } from '../../game/playground/practice'
export const lessonLabels = ['lesson0', 'lesson1', 'lesson2', 'lesson3', 'lesson4', 'lesson5', 'lesson6'] as const
const lessonHints = ['lessonHint1', 'lessonHint1', 'lessonHint2', 'lessonHint3', 'lessonHint4', 'lessonHint5', 'lessonHint6'] as const
export function PlaygroundHud({ state, practice, lesson, cameraChanged, lab }: { state: AircraftState | null; practice?: PracticeState; lesson: number; cameraChanged: boolean; lab: boolean }) {
  const { t } = useTranslation()
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
  const psmReady = !!state && !low && !outsideSpeed
  return <>
    <section className="maneuver-instrument" data-details={lab || lesson > 0} data-phase={status} aria-label={t('maneuver')}>
      <div className="maneuver-status"><span>{t('maneuver')}</span><strong>{t(status === 'normal' ? psmReady ? 'psmReady' : 'psmUnavailable' : `psm_${status}`)}</strong></div>
      <p>{status === 'normal' ? t(low ? 'psmLow' : outsideSpeed ? 'psmSpeed' : 'psmHold') : t(`psmHint_${status}`)}</p>
      <div className="psm-speed-band" data-ready={psmReady}>{t('psmBand', { min: Math.round(arcadeSpeed(maneuverProfile.entryMin)), max: Math.round(arcadeSpeed(maneuverProfile.entryMax)) })}</div>
      <div className="maneuver-readings"><span>{t('noseOffPath')} <b>{state ? `${(m?.alpha ?? 0).toFixed(0)}°` : '—'}</b></span>{status === 'cooldown' && <span>{t('psm_cooldown')} <b>{(m?.cooldown ?? 0).toFixed(1)} s</b></span>}</div>
    </section>
    {lesson > 0 && <section className="flight-lesson" aria-label={t('practiceLesson')}><span>{t(lessonLabels[lesson])}</span><strong role="status">{complete ? t('lessonDone') : t(lessonHints[lesson])}</strong><small>{t('ringsPassed', { count: practice?.rings ?? 0 })} · {t('psmCompleted', { count: m?.completed ?? 0 })}</small></section>}
    {lab && state && <dl className="flight-lab"><div><dt>{t('worldSpeed')}</dt><dd>{Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z).toFixed(1)} m/s</dd></div><div><dt>{t('pathTurn')}</dt><dd>{m!.pathRate.toFixed(1)} °/s</dd></div><div><dt>{t('bodyRates')}</dt><dd>{[state.rates.pitch, state.rates.roll, state.rates.yaw].map(v => (v * 180 / Math.PI).toFixed(0)).join(' / ')} °/s</dd></div><div><dt>{t('dragForce')}</dt><dd>{m!.drag.toFixed(1)} m/s²</dd></div><div><dt>{t('engineOutput')}</dt><dd>{Math.round(state.enginePower * 100)}%</dd></div><div><dt>{t('lastCobra')}</dt><dd>{m!.peakAlpha.toFixed(0)}° · {m!.entrySpeed.toFixed(0)} → {m!.exitSpeed.toFixed(0)} m/s</dd></div></dl>}
  </>
}
