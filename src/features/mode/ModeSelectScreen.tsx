/*
Select Mode. Three columns of large type over the blurred scene, with no plates:
Campaign, PVE and Training, each on a hairline that turns cyan when pointed at.
Choosing a card saves it as the selected mode and opens its setup screen; it never
starts a flight by itself, except Training, which has no setup.
Shortcuts: 1 / 2 / 3 choose a card, Esc goes back.
*/
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { launchFlight, navigate } from '../../app/routes'
import { selectMode, useSessionSettings } from '../../app/sessionStore'
import { pveModes, teamSizeRange } from '../../content/pve/modes'
import type { SelectedMode } from '../../platform/storage'
import { useCampaignProgress } from '../campaign/useCampaignProgress'
import { useMenuHotkeys } from '../menu/hooks'
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
  useMenuHotkeys({ Digit1: () => choose('campaign'), Digit2: () => choose('pve'), Digit3: () => choose('training') })

  return <div className="mode menu-overlay">
    <header className="menu-topbar">
      <BackLink to="home" label={t('navHome')} />
      <HotkeyHints hints={[['1 · 2 · 3', t('modeHintChoose')], ['ESC', t('hintBack')]]} />
    </header>

    <div className="mode-heading">
      <Eyebrow>{t('modeEyebrow')}</Eyebrow>
      <h1>{t('modeTitle')}</h1>
    </div>

    <div className="mode-cards">
      <ModeCard index="1" title={t('modeCampaign')} text={t('modeCampaignText')} current={selectedMode === 'campaign'} action={t('modeOpenMap')} onClick={() => choose('campaign')}
        fact={`${campaign.done} / ${campaign.total} · ${campaign.next ? `${campaign.next.code} ${campaign.next.title[locale]}` : '—'}`} />
      <ModeCard index="2" title={t('modePve')} text={t('modePveText')} current={selectedMode === 'pve'} action={t('modeSetUpMatch')} onClick={() => choose('pve')}
        fact={`${pveModes.length} ${t('modeModes')} · ${t('modeUpTo', { count: teamSizeRange.max * 2 })}`} />
      <ModeCard index="3" title={t('modeTraining')} text={t('modeTrainingText')} current={selectedMode === 'training'} action={t('modeOpenTraining')} onClick={() => choose('training')}
        fact={`${t('modeTrainingMaps')} · ${t('modeTrainingOpponents')}`} />
    </div>
  </div>
}

/** One mode as a whole-column button: its key, its name in large type, one line of what it is, one fact, and the action. */
function ModeCard({ index, title, text, current, fact, action, onClick }: { index: string; title: string; text: string; current: boolean; fact: string; action: string; onClick: () => void }) {
  const { t } = useTranslation()
  return <button type="button" className="mode-card" aria-current={current || undefined} onClick={onClick}>
    <span className="mode-card-top">
      <kbd className="mv-key" aria-hidden="true">{index}</kbd>
      {current && <span className="mode-current">● {t('modeCurrent')}</span>}
    </span>
    <strong className="mode-card-title">{title}</strong>
    <span className="mode-card-text">{text}</span>
    <span className="mode-card-fact">{fact}</span>
    <span className="mode-card-action">{action}<ChevronRight size={20} aria-hidden="true" /></span>
  </button>
}
