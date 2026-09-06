import { useEffect, useState } from 'react'
import { Check, ChevronRight, Crosshair, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { trainingMap } from '../../content/maps'

/* Foot of the rail: one mission line, then the amber Play. The line states the
   current mode and map and opens the picker; one real mode and one real map so far. */
export function LaunchPanel({ available }: { available: boolean }) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)
  const modes = [{ id: 'playground', label: t('training') }]
  const maps = [{ id: trainingMap.id, label: t('flatRange') }]
  const [modeId, setModeId] = useState(modes[0].id)
  const [mapId, setMapId] = useState(maps[0].id)
  const modeLabel = modes.find((mode) => mode.id === modeId)?.label ?? modes[0].label
  const mapLabel = maps.find((map) => map.id === mapId)?.label ?? maps[0].label

  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickerOpen(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [pickerOpen])

  return <section className="launch-panel" aria-label={t('mission')}>
    {/* Mode and map read as one line; the line itself is the control that opens the
        picker, same affordance as the airframe row above. Labels live in the aria
        name and in the overlay — the rail has no room to repeat them. */}
    <button type="button" className="launch-setup" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-expanded={pickerOpen}
      aria-label={`${t('gameMode')}: ${modeLabel} · ${t('map')}: ${mapLabel} · ${t('changeMission')}`}>
      <Crosshair size={17} strokeWidth={1.6} aria-hidden="true" />
      <span className="launch-setup-copy"><strong>{modeLabel}</strong><i aria-hidden="true" /><small>{mapLabel}</small></span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
    <button type="button" className="launch-play" disabled={!available} onClick={() => { location.hash = '/flight' }}>{t('launch')}</button>
    {/* <p className="launch-caption">{t('flightBrief')}</p> */}

    {/* Fixed, not absolute: this panel lives inside the positioned .hangar-rail column,
        so an inset:0 overlay would be trapped in the rail instead of covering the stage. */}
    {pickerOpen && <div className="hangar-picker launch-picker" role="dialog" aria-modal="true" aria-label={t('changeMission')}>
      <button type="button" className="hangar-picker-scrim" aria-label={t('close')} onClick={() => setPickerOpen(false)} />
      <div className="hangar-picker-frame launch-picker-frame">
        <header className="hangar-picker-head">
          <div><span>{t('mission')}</span><strong>{t('changeMission')}</strong></div>
          <button type="button" className="hangar-picker-close" onClick={() => setPickerOpen(false)} aria-label={t('close')}><X size={18} /></button>
        </header>
        <div className="launch-picker-body">
          <div className="launch-picker-group">
            <span className="hangar-label">{t('gameMode')}</span>
            <div className="launch-picker-options">
              {modes.map((mode) => <button type="button" key={mode.id} className={`launch-option${mode.id === modeId ? ' is-active' : ''}`}
                aria-pressed={mode.id === modeId} onClick={() => setModeId(mode.id)}>{mode.label}{mode.id === modeId && <Check size={14} strokeWidth={2} />}</button>)}
            </div>
          </div>
          <div className="launch-picker-group">
            <span className="hangar-label">{t('map')}</span>
            <div className="launch-picker-options">
              {maps.map((map) => <button type="button" key={map.id} className={`launch-option${map.id === mapId ? ' is-active' : ''}`}
                aria-pressed={map.id === mapId} onClick={() => setMapId(map.id)}>{map.label}{map.id === mapId && <Check size={14} strokeWidth={2} />}</button>)}
            </div>
          </div>
        </div>
      </div>
    </div>}
  </section>
}
