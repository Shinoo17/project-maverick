/*
Campaign Map (mockup 3a). Mission boxes sit on a placeholder theatre map;
dashed lines join each mission to the ones it requires. Selecting a box shows
its briefing on the right. Locked and planned missions stay readable so the
player can see what is needed first. No mission can launch until the mission
runtime exists (after P5).
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import { missionStatus } from '../../content/campaign/missionStatus'
import { BackLink, HotkeyHints } from '../menu/parts'
import { MissionBriefing } from './MissionBriefing'
import { statusLabel } from './statusLabel'
import { TheatreBackdrop } from './TheatreBackdrop'
import { useCampaignProgress } from './useCampaignProgress'
import './campaign.css'

export function CampaignScreen() {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const { operation, completed, done, total, next } = useCampaignProgress()
  const [selectedId, setSelectedId] = useState(next?.id ?? operation.missions[0].id)
  const selected = operation.missions.find(mission => mission.id === selectedId) ?? operation.missions[0]
  const byId = new Map(operation.missions.map(mission => [mission.id, mission]))

  return <div className="campaign menu-overlay">
    <TheatreBackdrop />

    <header className="menu-topbar">
      <BackLink to="mode" label={t('navMode')} />
      <span className="menu-topbar-divider" aria-hidden="true" />
      <p className="menu-topbar-title">{t('modeCampaign')}</p>
      <p className="campaign-operation">{operation.name[locale]}</p>
      <div className="campaign-progress" aria-label={`${t('modeProgress')} ${done} / ${total}`}>
        <span>{t('modeProgress')}</span>
        <span className="campaign-progress-bar" aria-hidden="true">
          {operation.missions.map(mission => <i key={mission.id} data-done={completed.has(mission.id) || undefined} />)}
        </span>
        <b>{done} / {total}</b>
      </div>
      <HotkeyHints hints={[['ESC', t('hintBack')]]} />
    </header>

    {/* Requirement links: from each required mission to the mission that waits for it. */}
    <svg className="campaign-links menu-backdrop" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {operation.missions.flatMap(mission => mission.requires.map(requiredId => {
        const from = byId.get(requiredId)!.mapPosition
        const to = mission.mapPosition
        return <line key={`${requiredId}-${mission.id}`} x1={from[0] * 100} y1={from[1] * 100} x2={to[0] * 100} y2={to[1] * 100}
          data-status={missionStatus(mission, completed)} />
      }))}
    </svg>

    <ol className="campaign-missions">
      {operation.missions.map(mission => {
        const status = missionStatus(mission, completed)
        return <li key={mission.id} style={{ left: `${mission.mapPosition[0] * 100}%`, top: `${mission.mapPosition[1] * 100}%` }}>
          <button type="button" className="campaign-node" data-status={status} aria-pressed={mission.id === selected.id}
            onClick={() => setSelectedId(mission.id)}>
            <span className="campaign-node-meta"><span>{mission.code}</span><span>{t(statusLabel[status])}</span></span>
            <strong>{mission.title[locale]}</strong>
          </button>
        </li>
      })}
    </ol>


    <ul className="campaign-legend">
      <li><span className="campaign-legend-line" aria-hidden="true" />{t('campaignLegendRequires')}</li>
      <li><span className="campaign-legend-box" data-status="available" aria-hidden="true" />{t('statusAvailable')}</li>
      <li><span className="campaign-legend-box" data-status="locked" aria-hidden="true" />{t('statusLocked')}</li>
      <li><span className="campaign-legend-box" data-status="planned" aria-hidden="true" />{t('statusPlanned')}</li>
    </ul>

    <MissionBriefing mission={selected} status={missionStatus(selected, completed)} missions={operation.missions} />
  </div>
}
