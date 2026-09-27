/*
PVE Setup (mockup 3b, with the five team modes from docs 09 instead of
1v1/FFA). Every choice is saved at once, so Home can show and replay it.
Options the game cannot run yet stay visible with a reason:
- planned maps, and maps without objectives for the chosen mode, are disabled;
- START only opens free flight on a ready map, because bots arrive in P4.
Weapons rules are left out for now.
*/
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { launchFlight, routes } from '../../app/routes'
import { updatePveSetup, useSessionSettings } from '../../app/sessionStore'
import { getAircraft } from '../../content/aircraft'
import { canPlayPve, getMap, pveMaps } from '../../content/maps'
import { difficulties, getPveMode, pveModes, teamSizeRange } from '../../content/pve/modes'
import { BackLink, FactRows, HotkeyHints, LaunchButton, SectionHeading } from '../menu/parts'
import { canStartPve } from '../menu/playSelectedMode'
import { MapPreview } from './MapPreview'
import { TeamRoster } from './TeamRoster'
import './pve.css'

export function PveSetupScreen() {
  const { t } = useTranslation()
  const settings = useSessionSettings()
  const { pveSetup: setup, locale } = settings
  const mode = getPveMode(setup.modeId)
  const map = getMap(setup.mapId)
  const difficulty = difficulties.find(item => item.id === setup.difficulty)!
  const player = getAircraft(settings.aircraftId)
  const canStart = canStartPve(settings)
  const matchLine = `${mode.name[locale]} · ${setup.teamSize}v${setup.teamSize}`

  return <div className="pve menu-overlay">
    <MapPreview map={map} modeId={setup.modeId} />

    <header className="menu-topbar">
      <BackLink to="mode" label={t('navMode')} />
      <span className="menu-topbar-divider" aria-hidden="true" />
      <p className="menu-topbar-title">PVE</p>
      <p className="pve-summary">{matchLine}</p>
      <HotkeyHints hints={[['ESC', t('hintBack')]]} />
    </header>

    <div className="pve-column is-left">
      <SectionHeading title={t('gameMode')} />
      <div className="pve-list">
        {pveModes.map(item => <button key={item.id} type="button" className="pve-row is-compact" aria-pressed={item.id === setup.modeId}
          onClick={() => updatePveSetup({ modeId: item.id })}>
          <strong>{item.name[locale]}</strong>
        </button>)}
      </div>
      <p className="pve-note">{mode.summary[locale]}</p>

      <SectionHeading title={t('map')} />
      <div className="pve-list">
        {pveMaps.map(item => {
          const reason = item.status === 'planned' ? t('statusPlanned')
            : !item.pveModes.includes(setup.modeId) ? t('pveModeUnsupported', { mode: mode.name[locale] }) : null
          return <button key={item.id} type="button" className="pve-row" aria-pressed={item.id === setup.mapId}
            disabled={!canPlayPve(item, setup.modeId)} onClick={() => updatePveSetup({ mapId: item.id })}>
            <strong>{item.name[locale]}<span className="pve-tag" data-ready={!reason || undefined}>{reason ?? t('pveReady')}</span></strong>
            <small>{item.info[locale]}</small>
          </button>
        })}
      </div>
    </div>

    <div className="pve-column is-right">
      <SectionHeading title={t('pveTeamSize')} aside={t('pveMaxAircraft', { count: teamSizeRange.max * 2 })} />
      <div className="pve-stepper">
        <button type="button" aria-label={t('pveSmaller')} disabled={setup.teamSize <= teamSizeRange.min}
          onClick={() => updatePveSetup({ teamSize: setup.teamSize - 1 })}><Minus size={16} aria-hidden="true" /></button>
        <output aria-live="polite">{setup.teamSize}v{setup.teamSize}</output>
        <button type="button" aria-label={t('pveLarger')} disabled={setup.teamSize >= teamSizeRange.max}
          onClick={() => updatePveSetup({ teamSize: setup.teamSize + 1 })}><Plus size={16} aria-hidden="true" /></button>
      </div>

      <SectionHeading title={t('pveDifficulty')} />
      <div className="pve-difficulty">
        {difficulties.map(item => <button key={item.id} type="button" aria-pressed={item.id === setup.difficulty}
          onClick={() => updatePveSetup({ difficulty: item.id })}>
          <strong>{item.label[locale]}</strong><small>{item.reaction}</small>
        </button>)}
      </div>
      <p className="pve-note">{difficulty.note[locale]}</p>

      <TeamRoster setup={setup} player={player} callsign={settings.callsign} />

      <SectionHeading title={t('pveRules')} />
      <FactRows rows={[
        [t('pveTimeLimit'), t('pveMinutes', { count: mode.timeLimitMinutes })],
        [t('pveScoreLimit'), mode.scoreLimit[locale]],
      ]} />
    </div>

    <div className="pve-match">
      <span>{t('pveMatch')}</span>
      <strong>{matchLine} · {difficulty.label[locale]} · {map.name[locale]}</strong>
      <small>{canStart ? t('pveNoBotsYet') : t('pveNoReadyMap')}</small>
    </div>

    <div className="pve-launch">
      <div className="pve-player">
        <span>{t('pveYourAircraft')}</span>
        <strong>{player.designation} {player.name.toUpperCase()}</strong>
        <a className="menu-link" href={routes.hangar}>{t('homeChangeInHangar')} →</a>
      </div>
      <LaunchButton label={t('pveStart')} onClick={() => launchFlight('pve')} disabled={!canStart} />
    </div>
  </div>
}
