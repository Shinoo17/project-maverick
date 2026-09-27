/*
PERFORMANCE block of the Hangar: stat bars (0–100) or, after D / DETAIL,
a table of the underlying numbers. Values come from performance.ts.
*/
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { AircraftDefinition } from '../../content/schemas'
import { SectionHeading } from '../menu/parts'
import { performanceBars, performanceDetail } from './performance'

interface PerformancePanelProps {
  aircraft: AircraftDefinition
  /** Aircraft drawn as a tick on each bar, for comparison. */
  compared?: AircraftDefinition
  showDetail: boolean
  onToggle: () => void
}

export function PerformancePanel({ aircraft, compared, showDetail, onToggle }: PerformancePanelProps) {
  const { t } = useTranslation()
  const bars = performanceBars(aircraft)
  const comparedBars = compared ? performanceBars(compared) : []

  return <div className="hangar-performance">
    <SectionHeading title={t('hangarPerformance')} aside={<>
      <span className="hangar-scale">{showDetail ? t('hangarDetailScale') : t('hangarBarsScale')}</span>
      <button type="button" className="menu-link" onClick={onToggle} aria-pressed={showDetail}>
        {showDetail ? t('hangarShowBars') : t('hangarShowDetail')}<ChevronRight size={14} aria-hidden="true" />
      </button>
    </>} />

    {!showDetail && <>
      <ul className="hangar-bars">
        {bars.map((bar, index) => <li key={bar.label}>
          <span>{t(bar.label)}</span>
          <span className="hangar-bar-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar.value} aria-label={t(bar.label)}>
            <span className="hangar-bar-fill" style={{ width: `${bar.value}%` }} />
            {compared && <span className="hangar-bar-tick" style={{ left: `${comparedBars[index].value}%` }} />}
          </span>
          <span className="hangar-bar-value">{bar.value}</span>
        </li>)}
      </ul>
      {compared && <p className="hangar-note"><span className="hangar-tick-key" aria-hidden="true" />
        {t('hangarCompareNote', { name: `${compared.designation} ${compared.name}` })}</p>}
    </>}

    {showDetail && <dl className="hangar-detail">
      {performanceDetail(aircraft).map(row => <div key={row.label}><dt>{t(row.label)}</dt><dd>{row.value}</dd></div>)}
    </dl>}

    <p className="hangar-note">{t('profileExperimental')}</p>
  </div>
}
