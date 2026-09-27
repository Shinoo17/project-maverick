/*
Right-hand briefing for the selected mission. The main button follows the
status: LAUNCH (available), REPLAY (complete), REQUIRES … (locked) or
PLANNED with the missing system. While the mission runtime does not exist,
LAUNCH and REPLAY are disabled and say so.
*/
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import { missionRuntimeReady, type MissionStatus } from '../../content/campaign/missionStatus'
import type { MissionDefinition } from '../../content/campaign/types'
import { getMap } from '../../content/maps'
import { FactRows, LaunchButton } from '../menu/parts'
import { statusLabel } from './statusLabel'

interface MissionBriefingProps {
  mission: MissionDefinition
  status: MissionStatus
  missions: readonly MissionDefinition[]
}

export function MissionBriefing({ mission, status, missions }: MissionBriefingProps) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const codeOf = (id: string) => missions.find(item => item.id === id)?.code ?? id
  const requires = mission.requires.map(codeOf).join(' + ')
  const aircraft = mission.aircraft.kind === 'assigned'
    ? t('campaignAssigned', { name: `${getAircraft(mission.aircraft.aircraftId).designation} ${getAircraft(mission.aircraft.aircraftId).name}` })
    : t('campaignPilotChoice')

  return <section className="campaign-briefing" aria-live="polite">
    <p className="campaign-briefing-meta">
      <span>{mission.code}</span>
      <span data-status={status}>{t(statusLabel[status])}</span>
    </p>
    <h1>{mission.title[locale]}</h1>
    <p className="campaign-objective">{mission.briefing[locale]}</p>
    <div className="menu-placeholder campaign-thumb">{getMap(mission.mapId).name[locale]} · {t('campaignThumbPending')}</div>
    <FactRows rows={[
      [t('map'), getMap(mission.mapId).name[locale]],
      [t('aircraft'), aircraft],
      [t('campaignThreats'), mission.threats[locale]],
      [t('campaignRequires'), requires || t('campaignNone')],
    ]} />

    {(status === 'available' || status === 'complete') && <>
      <LaunchButton label={t(status === 'complete' ? 'campaignReplay' : 'campaignLaunch')} onClick={() => {}} disabled={!missionRuntimeReady} />
      {!missionRuntimeReady && <p className="campaign-reason">{t('campaignRuntimePending')}</p>}
    </>}
    {status === 'locked' && <p className="campaign-blocked"><Lock size={18} aria-hidden="true" />{t('campaignRequiresCta', { list: requires })}</p>}
    {status === 'planned' && <>
      <p className="campaign-blocked"><Lock size={18} aria-hidden="true" />{t('statusPlanned')}</p>
      {mission.plannedReason && <p className="campaign-reason">{mission.plannedReason[locale]}</p>}
    </>}
  </section>
}
