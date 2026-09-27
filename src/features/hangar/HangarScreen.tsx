/*
Hangar (mockup 2 · Hangar). Browse aircraft over the shared 3D scene.
The aircraft you look at (viewed) is separate from the one you fly (active):
← → only changes the view; SET ACTIVE makes it the active aircraft. Leaving
without SET ACTIVE keeps the old one (MenuLayout drops the preview).
Armament is left out for now.
Shortcuts: ← → aircraft, D detail, R reset view, Esc back.
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { selectAircraft, useSessionSettings } from '../../app/sessionStore'
import { aircraft as roster, getAircraft } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import { useMenuHotkeys } from '../menu/hooks'
import { BackLink, HotkeyHints } from '../menu/parts'
import { AircraftPicker } from './AircraftPicker'
import { PerformancePanel } from './PerformancePanel'
import './hangar.css'

interface HangarScreenProps {
  viewedId: AircraftId
  onView: (id: AircraftId) => void
  onResetView: () => void
}

export function HangarScreen({ viewedId, onView, onResetView }: HangarScreenProps) {
  const { t } = useTranslation()
  const { aircraftId: activeId, locale } = useSessionSettings()
  const [showDetail, setShowDetail] = useState(false)
  const viewed = getAircraft(viewedId)
  // Bars show a tick for another aircraft: the active one, or the next one when viewing the active.
  const compared = viewedId !== activeId ? getAircraft(activeId) : roster.find(entry => entry.id !== viewedId)
  const isActive = viewedId === activeId

  function step(direction: 1 | -1) {
    const index = roster.findIndex(entry => entry.id === viewedId)
    onView(roster[(index + direction + roster.length) % roster.length].id)
  }

  useMenuHotkeys({
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    KeyD: () => setShowDetail(value => !value),
    KeyR: onResetView,
  })

  return <div className="hangar menu-overlay">
    <header className="menu-topbar">
      <BackLink to="home" label={t('navHome')} />
      <span className="menu-topbar-divider" aria-hidden="true" />
      <p className="menu-topbar-title">{t('navHangar')}</p>
      <HotkeyHints hints={[['← →', t('hangarHintAircraft')], ['D', t('hangarShowDetail')], ['R', t('resetView')], ['ESC', t('hintBack')]]} />
    </header>

    <section className="hangar-identity" aria-live="polite">
      <p className="hangar-designation">{viewed.designation}</p>
      <h1 className="hangar-name">{viewed.name}</h1>
      <p className="hangar-tags">
        <span className="hangar-role">{viewed.hangar.gameRole[locale]}</span>
        <span>{viewed.hangar.playStyle[locale]}</span>
      </p>
      <p className="hangar-tip">{viewed.hangar.tip[locale]}</p>
      <p className="hangar-history">{viewed.hangar.history[locale]}</p>
      <PerformancePanel aircraft={viewed} compared={compared} showDetail={showDetail} onToggle={() => setShowDetail(value => !value)} />
    </section>

    <AircraftPicker viewedId={viewedId} activeId={activeId} onView={onView} />

    <div className="hangar-confirm">
      <p className="hangar-orbit-hint">{t('cameraHint')}</p>
      {isActive
        ? <p className="hangar-active-state"><Check size={18} aria-hidden="true" />{t('hangarIsActive')}</p>
        : <button type="button" className="menu-confirm" onClick={() => selectAircraft(viewedId)}>
          <Check size={18} strokeWidth={2.2} aria-hidden="true" />{t('hangarSetActive')}
        </button>}
    </div>
  </div>
}
