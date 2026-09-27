/*
The Settings panel, shared by the menu (#/settings) and the flight pause dialog.

  header       ‹ BACK   SETTINGS
  tabs         [Q] KEYBOARD & MOUSE · CONTROLLER · CAMERA · GRAPHICS · AUDIO · INTERFACE [E]
  body         sections of rows (rows.ts), or the Key bindings sub-page
  description  what the pointed-at row does, or why it is unavailable
  hints        Q/E tab · ↑↓ select · ←→ change · F reset · C reset tab · Esc back

Every change applies at once and is saved; there is no Apply button.
Keys are read in the capture phase so Esc here never also closes the screen behind.
*/
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { useSessionSettings } from '../../app/sessionStore'
import { KeyBindingsPage } from './KeyBindingsPage'
import { KeyPrompt, PromptHints } from './KeyPrompt'
import { buildSettingsTabs, settingsTabIds, stepChoice, stepSlider, tabRows, type SettingsRow, type SettingsTabId } from './rows'
import { SettingsRowView } from './SettingsRow'
import './settings.css'

interface Props {
  /** Label of the back button, e.g. "Home" or "Pause". */
  backLabel: string
  onBack: () => void
}

export function SettingsPanel({ backLabel, onBack }: Props) {
  const { t } = useTranslation()
  const settings = useSessionSettings()
  const tabs = buildSettingsTabs(settings, t)
  const [tabId, setTabId] = useState<SettingsTabId>('keyboard')
  const [selected, setSelected] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const [page, setPage] = useState<'list' | 'bindings'>('list')
  const rowNodes = useRef<(HTMLDivElement | null)[]>([])

  const tab = tabs.find(item => item.id === tabId)!
  const rows = tabRows(tab)
  const current = rows[Math.min(selected, rows.length - 1)]
  const described = rows.find(row => row.id === hovered) ?? current

  // Keyboard moves take the description bar back from the mouse.
  const focusRow = useCallback((index: number) => {
    setSelected(index); setHovered(null)
    const node = rowNodes.current[index]
    node?.focus({ preventScroll: true })
    node?.scrollIntoView({ block: 'nearest' })
  }, [])
  const switchTab = useCallback((id: SettingsTabId) => { setTabId(id); setSelected(0); setHovered(null) }, [])
  const closePage = useCallback(() => { setPage('list'); requestAnimationFrame(() => rowNodes.current[selected]?.focus()) }, [selected])

  // Start on the first row so the keyboard works without a click.
  useEffect(() => { if (page === 'list') rowNodes.current[0]?.focus({ preventScroll: true }) }, [tabId, page])

  useEffect(() => {
    if (page !== 'list') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const typing = target instanceof HTMLInputElement && target.type === 'text'
      if (typing) {
        // Esc leaves the field (its blur saves) instead of leaving the screen.
        if (event.code === 'Escape') { event.preventDefault(); target.blur(); rowNodes.current[selected]?.focus() }
        return
      }
      const step = (direction: -1 | 1) => { event.preventDefault(); setHovered(null); if (!event.repeat || current.kind === 'slider') change(current, direction) }
      switch (event.code) {
        case 'Escape': event.preventDefault(); onBack(); return
        case 'KeyQ': case 'KeyE': {
          event.preventDefault()
          const index = settingsTabIds.indexOf(tabId) + (event.code === 'KeyE' ? 1 : -1)
          if (index >= 0 && index < settingsTabIds.length) switchTab(settingsTabIds[index])
          return
        }
        case 'ArrowUp': event.preventDefault(); if (selected > 0) focusRow(selected - 1); return
        case 'ArrowDown': event.preventDefault(); if (selected < rows.length - 1) focusRow(selected + 1); return
        case 'ArrowLeft': step(-1); return
        case 'ArrowRight': step(1); return
        case 'KeyF': event.preventDefault(); if (!current.disabled) current.reset?.(); return
        case 'KeyC': event.preventDefault(); rows.forEach(row => row.reset?.()); return
        case 'Enter': case 'Space':
          if (current.kind === 'page' && target?.classList.contains('settings-row')) { event.preventDefault(); setPage('bindings') }
          return
      }
    }
    addEventListener('keydown', onKeyDown, true)
    return () => removeEventListener('keydown', onKeyDown, true)
  }, [page, current, rows, selected, tabId, onBack, focusRow, switchTab])

  const inBindings = page === 'bindings'
  return <section className="settings-panel" aria-labelledby="settings-title">
    <header className="settings-header">
      <button type="button" className="settings-back" onClick={inBindings ? closePage : onBack}>
        <ChevronLeft size={18} aria-hidden="true" />{inBindings ? t('settingsTitle') : backLabel}
      </button>
      <span className="settings-header-divider" aria-hidden="true" />
      <h1 id="settings-title">{inBindings ? t('settingsBindings') : t('settingsTitle')}</h1>
    </header>

    {!inBindings && <div className="settings-tabs" role="tablist" aria-label={t('settingsTitle')}>
      <KeyPrompt code="KeyQ" />
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === tabId} data-pending={item.pending ? true : undefined}
        onClick={() => switchTab(item.id)}>{item.label}</button>)}
      <KeyPrompt code="KeyE" />
    </div>}

    <div className="settings-body" role={inBindings ? undefined : 'tabpanel'} aria-label={inBindings ? undefined : tab.label}>
      {inBindings ? <KeyBindingsPage onBack={closePage} /> : <>
        {tab.pending && <p className="settings-tab-pending">{tab.pending}</p>}
        {tab.sections.map(section => <div key={section.title} className="settings-section">
          <h2>{section.title}</h2>
          {section.rows.map(row => {
            const index = rows.indexOf(row)
            return <SettingsRowView key={row.id} ref={node => { rowNodes.current[index] = node }} row={row} selected={index === selected}
              onFocus={() => setSelected(index)} onHover={hovering => setHovered(hovering ? row.id : null)} onOpenPage={() => { setSelected(index); setPage('bindings') }} />
          })}
        </div>)}
      </>}
    </div>

    <footer className="settings-footer">
      {!inBindings && described && <div className="settings-detail" aria-live="polite">
        <strong>{described.label}</strong>
        <p>{described.detail}</p>
        {described.disabled && described.disabled !== described.detail && <p className="settings-detail-reason">{described.disabled}</p>}
      </div>}
      <PromptHints hints={inBindings
        ? [[['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], t('settingsHintSelect')], [['Enter'], t('settingsHintRebind')], [['Delete'], t('settingsHintClear')], [['KeyC'], t('settingsHintResetAll')], [['Escape'], t('hintBack')]]
        : [[['KeyQ', 'KeyE'], t('settingsHintTab')], [['ArrowUp', 'ArrowDown'], t('settingsHintSelect')], [['ArrowLeft', 'ArrowRight'], t('settingsHintChange')], [['KeyF'], t('settingsHintReset')], [['KeyC'], t('settingsHintResetTab')], [['Escape'], t('hintBack')]]} />
    </footer>
  </section>
}

/** ← / → on a row: next option, or one slider step. */
function change(row: SettingsRow, direction: -1 | 1) {
  if (row.disabled) return
  if (row.kind === 'choice') {
    const index = stepChoice(row, direction)
    if (index !== null) row.set(row.options[index].value)
  }
  if (row.kind === 'slider') row.set(stepSlider(row, direction))
}
