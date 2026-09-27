/*
Select Mode (mockup 1b). Two large options float over the dimmed aircraft:
Campaign and PVE. Training is a smaller third line (decision D15).
Choosing an option saves it as the selected mode and opens its setup screen;
it never starts a flight by itself, except Training, which has no setup.
*/
import { useTranslation } from 'react-i18next'
import { launchFlight, navigate } from '../../app/routes'
import { selectMode, useSessionSettings } from '../../app/sessionStore'
import { pveModes, teamSizeRange } from '../../content/pve/modes'
import type { SelectedMode } from '../../platform/storage'
import { useCampaignProgress } from '../campaign/useCampaignProgress'
import { BackLink, Eyebrow, HotkeyHints } from '../menu/parts'
import './mode.css'

export function ModeSelectScreen() {
  const { t } = useTranslation()
  const { selectedMode, locale } = useSessionSettings()
  const campaign = useCampaignProgress()

  function choose(mode: SelectedMode) {
    selectMode(mode)
    if (mode === 'campaign') navigate('campaign')
    if (mode === 'pve') navigate('pve')
    if (mode === 'training') launchFlight('mode')
  }
  const current = (mode: SelectedMode) => selectedMode === mode

  return <div className="mode menu-overlay">
    <header className="menu-topbar">
      <BackLink to="home" label={t('navHome')} />
      <HotkeyHints hints={[['ESC', t('hintBack')]]} />
    </header>

    <div className="mode-heading">
      <Eyebrow>{t('modeEyebrow')}</Eyebrow>
      <h1>{t('modeTitle')}</h1>
    </div>

    <div className="mode-options">
      <button type="button" className="mode-option" aria-current={current('campaign') || undefined} onClick={() => choose('campaign')}>
        <OptionTitle index="01" title={t('modeCampaign')} current={current('campaign')} />
        <span className="mode-option-text">{t('modeCampaignText')}</span>
        <span className="mode-option-facts">
          <span>{t('modeProgress')} <b>{campaign.done} / {campaign.total}</b></span>
          <span>{t('modeNext')} <b>{campaign.next ? `${campaign.next.code} ${campaign.next.title[locale]}` : '—'}</b></span>
          <span className="mode-option-go">{t('modeOpenMap')} →</span>
        </span>
      </button>

      <button type="button" className="mode-option" aria-current={current('pve') || undefined} onClick={() => choose('pve')}>
        <OptionTitle index="02" title={t('modePve')} current={current('pve')} />
        <span className="mode-option-text">{t('modePveText')}</span>
        <span className="mode-chips">{pveModes.map(mode => <span key={mode.id}>{mode.short[locale]}</span>)}</span>
        <span className="mode-option-facts">
          <b>{t('modeUpTo', { count: teamSizeRange.max * 2 })}</b>
          <span>{t('modeOffline')}</span>
          <span className="mode-option-go">{t('modeSetUpMatch')} →</span>
        </span>
      </button>
    </div>

    <button type="button" className="mode-training" aria-current={current('training') || undefined} onClick={() => choose('training')}>
      <span className="mode-index">03</span>
      <strong>{t('modeTraining')}</strong>
      <span>{t('modeTrainingText')}</span>
      {current('training') && <span className="mode-current">● {t('modeCurrent')}</span>}
      <span className="mode-option-go">{t('modeOpenTraining')} →</span>
    </button>
  </div>
}

function OptionTitle({ index, title, current }: { index: string; title: string; current: boolean }) {
  const { t } = useTranslation()
  return <span className="mode-option-title">
    <span className="mode-index">{index}</span>
    <strong>{title}</strong>
    {current && <span className="mode-current">● {t('modeCurrent')}</span>}
  </span>
}
