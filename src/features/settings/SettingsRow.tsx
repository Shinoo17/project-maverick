/*
One Settings row: label on the left, its control on the right.
  choice   ‹ VALUE ›   (← → on the keyboard)
  slider   value + track
  text     input, saved on Enter or when it loses focus
  page     current state + MODIFY, opens a sub-page
  pending  greyed, says why in the description bar
The row itself takes focus; ← → change the value there, so the inner buttons and the
slider stay out of the Tab order.
*/
import { forwardRef, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { stepChoice, type SettingsRow, type TextRow } from './rows'

interface Props {
  row: SettingsRow
  selected: boolean
  onFocus: () => void
  onHover: (hovering: boolean) => void
  onOpenPage: () => void
}

export const SettingsRowView = forwardRef<HTMLDivElement, Props>(function SettingsRowView({ row, selected, onFocus, onHover, onOpenPage }, ref) {
  const { t } = useTranslation()
  const disabled = row.disabled !== null
  return <div ref={ref} className="settings-row" data-kind={row.kind} data-selected={selected || undefined} aria-disabled={disabled || undefined}
    role="group" aria-label={row.label} tabIndex={0} onFocus={onFocus} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
    onClick={() => { if (row.kind === 'page') onOpenPage() }}>
    <span className="settings-row-label">
      {row.modified && <span className="settings-modified" title={t('settingsModified')} aria-label={t('settingsModified')} />}
      {row.label}
    </span>
    <span className="settings-row-control"><Control row={row} disabled={disabled} onOpenPage={onOpenPage} /></span>
  </div>
})

function Control({ row, disabled, onOpenPage }: { row: SettingsRow; disabled: boolean; onOpenPage: () => void }) {
  const { t } = useTranslation()
  switch (row.kind) {
    case 'choice': {
      const label = row.valueLabel ?? row.options[row.index]?.label ?? '—'
      if (disabled) return <output className="settings-value">{label}</output>
      const previous = stepChoice(row, -1), next = stepChoice(row, 1)
      return <span className="settings-stepper">
        <button type="button" tabIndex={-1} aria-label={t('settingsPrevious')} disabled={previous === null}
          onClick={() => previous !== null && row.set(row.options[previous].value)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <output className="settings-value">{label}</output>
        <button type="button" tabIndex={-1} aria-label={t('settingsNext')} disabled={next === null}
          onClick={() => next !== null && row.set(row.options[next].value)}><ChevronRight size={16} aria-hidden="true" /></button>
      </span>
    }
    case 'slider':
      return <span className="settings-slider">
        <output className="settings-value">{row.format(row.value)}</output>
        <input type="range" tabIndex={-1} min={row.min} max={row.max} step={row.step} value={row.value} disabled={disabled}
          aria-label={row.label} onChange={event => row.set(Number(event.target.value))} />
      </span>
    case 'text': return <TextControl row={row} />
    case 'page':
      return <span className="settings-page-control">
        <output className="settings-value">{row.valueLabel}</output>
        <button type="button" tabIndex={-1} className="settings-modify" onClick={event => { event.stopPropagation(); onOpenPage() }}>{t('settingsModify')}</button>
      </span>
    case 'pending': return <output className="settings-value is-pending">{t('settingsPending')}</output>
  }
}

/** Keeps a local draft so typing is free (the saved value is trimmed), and saves when done. */
function TextControl({ row }: { row: TextRow }) {
  const [draft, setDraft] = useState(row.value)
  useEffect(() => setDraft(row.value), [row.value])
  function commit() {
    const cleaned = draft.trim()
    row.set(cleaned)
    // An empty name falls back to the default; the effect above shows it once saved.
    setDraft(cleaned || row.value)
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur() }
  }
  return <input className="settings-text" type="text" value={draft} maxLength={row.maxLength} aria-label={row.label} spellCheck={false}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
}
