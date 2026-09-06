import { Crosshair } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { trainingMap } from '../../content/maps'

/* Extend the existing rail: gray mission strip, blue training emblem, large amber
   Play below it, following the supplied reference. One real mode and one real map. */
export function LaunchPanel({ available }: { available: boolean }) {
  const { t } = useTranslation()
  return <section className="launch-panel" aria-label={t('mission')}>
    <div className="launch-setup">
      <div className="launch-fields">
        <label><span>{t('gameMode')}</span><select defaultValue="playground"><option value="playground">{t('training')}</option></select></label>
        <label><span>{t('map')}</span><select defaultValue={trainingMap.id}><option value={trainingMap.id}>{t('flatRange')}</option></select></label>
      </div>
      <div className="launch-emblem" aria-hidden="true"><Crosshair size={34} strokeWidth={1.5} /></div>
    </div>
    <button type="button" className="launch-play" disabled={!available} onClick={() => { location.hash = '/flight' }}>{t('launch')}</button>
    <p className="launch-caption">{t('flightBrief')}</p>
  </section>
}
