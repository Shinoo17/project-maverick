/*
Home. The active aircraft fills the screen and almost nothing covers it: its name at
the lower left, and at the lower right one line naming the sortie, the amber PLAY
button, and Mode, Hangar and Settings as quiet labels on hairlines, each with its key.
Shortcuts: Enter = Play, M = Mode, H = Hangar, S = Settings.
*/
import { useTranslation } from 'react-i18next'
import { Crosshair, Plane, Settings, Warehouse } from 'lucide-react'
import { navigate, openSettings, routes } from '../../app/routes'
import { selectLocale, useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import { getMap } from '../../content/maps'
import { difficulties, getPveMode } from '../../content/pve/modes'
import type { Locale } from '../../content/schemas'
import { useCampaignProgress } from '../campaign/useCampaignProgress'
import { useMenuHotkeys } from '../menu/hooks'
import { Eyebrow, LaunchButton, MenuTile } from '../menu/parts'
import { playSelectedMode } from '../menu/playSelectedMode'
import './home.css'

export function HomeScreen() {
  const { t } = useTranslation()
  const settings = useSessionSettings()
  const { locale, callsign } = settings
  const aircraft = getAircraft(settings.aircraftId)
  const mode = useSelectedModeSummary()
  const play = () => playSelectedMode(settings)

  useMenuHotkeys({ Enter: play, KeyM: () => navigate('mode'), KeyH: () => navigate('hangar'), KeyS: () => openSettings('home') })

  return <div className="home menu-overlay">
    <header className="menu-topbar">
      <p className="home-brand"><Plane size={22} strokeWidth={1.6} aria-hidden="true" />PROJECT MAVERICK</p>
      <div className="home-pilot">
        <span>{t('homePilot')}</span>
        <strong>{callsign}</strong>
      </div>
      <span className="home-divider" aria-hidden="true" />
      <div className="home-locale" role="group" aria-label={t('language')}>
        {(['en', 'th'] as Locale[]).map(value => <button key={value} type="button" aria-pressed={locale === value}
          onClick={() => selectLocale(value)}>{value.toUpperCase()}</button>)}
      </div>
    </header>

    <section className="home-aircraft" aria-label={t('homeActiveAircraft')}>
      <Eyebrow>{t('homeActiveAircraft')}</Eyebrow>
      <p className="home-designation">{aircraft.designation}</p>
      <h1 className="home-name">{aircraft.name}</h1>
      <p className="home-role">{aircraft.role[locale]}</p>
    </section>

    <nav className="home-nav" aria-label={t('homeMenu')}>
      <p className="home-sortie"><span aria-hidden="true" /><strong>{mode.title}</strong><small>{mode.detail}</small></p>
      <LaunchButton label={t('homePlay')} onClick={play} className="home-play" hotkey="ENTER" />
      <MenuTile href={routes.mode} icon={<Crosshair size={20} strokeWidth={1.6} aria-hidden="true" />} title={t('navMode')} detail={mode.title} hotkey="M" />
      <MenuTile href={routes.hangar} icon={<Warehouse size={20} strokeWidth={1.6} aria-hidden="true" />} title={t('navHangar')} detail={aircraft.designation} hotkey="H" />
      <MenuTile onClick={() => openSettings('home')} icon={<Settings size={20} strokeWidth={1.6} aria-hidden="true" />} title={t('homeSettings')} hotkey="S" />
    </nav>
  </div>
}

/** Title and one detail line for the "SELECTED MODE" block. */
function useSelectedModeSummary(): { title: string; detail: string } {
  const { t } = useTranslation()
  const { selectedMode, pveSetup, locale } = useSessionSettings()
  const campaign = useCampaignProgress()

  if (selectedMode === 'training') return { title: t('modeTraining'), detail: t('homeTrainingDetail') }
  if (selectedMode === 'campaign') {
    return {
      title: `${t('modeCampaign')} · ${campaign.next?.code ?? '—'}`,
      detail: t('homeCampaignDetail', { operation: campaign.operation.name[locale], done: campaign.done, total: campaign.total }),
    }
  }
  const difficulty = difficulties.find(item => item.id === pveSetup.difficulty)!
  return {
    title: `PVE · ${getPveMode(pveSetup.modeId).name[locale]}`,
    detail: `${getMap(pveSetup.mapId).name[locale]} · ${pveSetup.teamSize}v${pveSetup.teamSize} · ${difficulty.label[locale]}`,
  }
}
