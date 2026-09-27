/*
Home (mockup 1 · Home). The active aircraft fills the screen; all text floats
over it. PLAY starts the saved mode; MODE and HANGAR open those screens.
Shortcuts: Enter = Play, M = Mode, H = Hangar.
*/
import { useTranslation } from 'react-i18next'
import { House, Menu, Plane, Settings as SettingsIcon } from 'lucide-react'
import { navigate, routes } from '../../app/routes'
import { selectLocale, useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import { getMap } from '../../content/maps'
import { difficulties, getPveMode } from '../../content/pve/modes'
import type { Locale } from '../../content/schemas'
import { useCampaignProgress } from '../campaign/useCampaignProgress'
import { useMenuHotkeys } from '../menu/hooks'
import { Eyebrow, HotkeyHints, LaunchButton } from '../menu/parts'
import { playSelectedMode } from '../menu/playSelectedMode'
import './home.css'

export function HomeScreen() {
  const { t } = useTranslation()
  const settings = useSessionSettings()
  const { locale, callsign } = settings
  const aircraft = getAircraft(settings.aircraftId)
  const mode = useSelectedModeSummary()
  const play = () => playSelectedMode(settings)

  useMenuHotkeys({ Enter: play, KeyM: () => navigate('mode'), KeyH: () => navigate('hangar') })

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
      {/* Settings has no screen design yet (docs 20). The button stays visible and says why. */}
      <button type="button" className="home-settings" disabled aria-label={`${t('homeSettings')} · ${t('homeSettingsPending')}`}
        title={t('homeSettingsPending')}><SettingsIcon size={20} strokeWidth={1.6} aria-hidden="true" /></button>
    </header>

    <section className="home-aircraft" aria-label={t('homeActiveAircraft')}>
      <Eyebrow>{t('homeActiveAircraft')}</Eyebrow>
      <p className="home-designation">{aircraft.designation}</p>
      <h1 className="home-name">{aircraft.name}</h1>
      <p className="home-role">{aircraft.role[locale]}</p>
      <a className="menu-link" href={routes.hangar}>{t('homeChangeInHangar')} →</a>
    </section>

    <section className="home-actions" aria-label={t('homeSelectedMode')}>
      <div className="home-mode">
        <span>{t('homeSelectedMode')}</span>
        <strong>{mode.title}</strong>
        <small>{mode.detail}</small>
      </div>
      <div className="home-secondary">
        <a className="menu-button" href={routes.mode}><Menu size={18} aria-hidden="true" />{t('navMode')}</a>
        <a className="menu-button" href={routes.hangar}><House size={18} aria-hidden="true" />{t('navHangar')}</a>
      </div>
      <LaunchButton label={t('homePlay')} onClick={play} className="home-play" />
    </section>

    <footer className="home-footer">
      <span>{t('homeBuild')}</span>
      <HotkeyHints hints={[['ENTER', t('homePlay')], ['M', t('navMode')], ['H', t('navHangar')]]} />
    </footer>
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
