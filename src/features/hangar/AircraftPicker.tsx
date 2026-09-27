/*
Row of aircraft cards along the bottom of the Hangar. Two extra locked slots
show that more aircraft are planned (mockup 2). Thumbnails are placeholders
until renders exist.
*/
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import { aircraft as roster } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'

/** Empty card slots after the real aircraft. */
const FUTURE_SLOTS = 2

interface AircraftPickerProps {
  viewedId: AircraftId
  activeId: AircraftId
  onView: (id: AircraftId) => void
}

export function AircraftPicker({ viewedId, activeId, onView }: AircraftPickerProps) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const total = roster.length + FUTURE_SLOTS
  const futureNumbers = Array.from({ length: FUTURE_SLOTS }, (_, index) => String(roster.length + index + 1).padStart(2, '0'))

  return <section className="hangar-picker" aria-label={t('selectAircraft')}>
    <p className="hangar-picker-title">{t('selectAircraft')} · {t('hangarAvailableCount', { count: roster.length, total })}</p>
    <div className="hangar-cards">
      {roster.map(entry => <button key={entry.id} type="button" className="hangar-card" aria-pressed={entry.id === viewedId}
        onClick={() => onView(entry.id)}>
        <span className="hangar-card-thumb">{entry.designation} · {t('hangarThumbPending')}</span>
        <span className="hangar-card-label">
          <strong>{entry.designation} {entry.name.toUpperCase()}</strong>
          <small>{entry.id === activeId ? `● ${t('hangarIsActive')}` : entry.hangar.gameRole[locale]}</small>
        </span>
      </button>)}
      {futureNumbers.map(number => <button key={number} type="button" className="hangar-card" disabled>
        <span className="hangar-card-thumb">{t('hangarLocked')}</span>
        <span className="hangar-card-label">
          <strong>{t('hangarFutureSlot', { number })}</strong>
          <small>{t('hangarLocked')}</small>
        </span>
      </button>)}
    </div>
  </section>
}
