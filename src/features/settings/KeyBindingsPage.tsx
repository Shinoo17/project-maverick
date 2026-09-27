/*
Keyboard & Mouse › Key bindings. One line per flight action with a primary and a
secondary key. Choosing a slot waits for the next key press:
  Esc cancels · Backspace/Delete clears the slot · Esc and P are kept for pause.
A key that already belongs to another action is never taken silently: the page asks
whether to swap the two.
*/
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectKeyboard, useSessionSettings } from '../../app/sessionStore'
import {
  assignBinding, clearBinding, defaultBindings, flightActions, pendingActions, reservedCodes, type FlightAction, type KeyBindings,
} from '../../game/input/keyBindings'
import { KeyPrompt, keyName } from './KeyPrompt'

type Slot = { action: FlightAction; slot: 0 | 1 }
type Notice = { kind: 'reserved'; code: string } | { kind: 'conflict'; code: string; owner: FlightAction; swap: KeyBindings; target: Slot } | null

export function KeyBindingsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const { keyboard } = useSessionSettings()
  const bindings = keyboard.bindings
  const [focus, setFocus] = useState<Slot>({ action: flightActions[0], slot: 0 })
  const [listening, setListening] = useState<Slot | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const keyOf = (slot: Slot) => `${slot.action}-${slot.slot}`

  useEffect(() => { buttons.current.get(keyOf(focus))?.focus() }, [focus])

  // Capture phase, so the menu's own Esc (and the flight dialog's cancel) never see these keys.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return
      if (listening) {
        event.preventDefault(); event.stopPropagation()
        if (event.repeat) return
        if (event.code === 'Escape') { setListening(null); return }
        if (event.code === 'Backspace' || event.code === 'Delete') {
          selectKeyboard({ bindings: clearBinding(bindings, listening.action, listening.slot) }); setListening(null); return
        }
        const result = assignBinding(bindings, listening.action, listening.slot, event.code)
        if (result.status === 'done') selectKeyboard({ bindings: result.bindings })
        else if (result.status === 'reserved') setNotice({ kind: 'reserved', code: event.code })
        else setNotice({ kind: 'conflict', code: event.code, owner: result.owner, swap: result.swap, target: listening })
        setListening(null)
        return
      }
      if (notice?.kind === 'conflict') {
        if (event.code === 'Escape') { event.preventDefault(); setNotice(null) }
        return
      }
      const index = flightActions.indexOf(focus.action)
      const move = (next: Slot) => { event.preventDefault(); setNotice(null); setFocus(next) }
      switch (event.code) {
        case 'Escape': event.preventDefault(); onBack(); return
        case 'ArrowUp': if (index > 0) move({ action: flightActions[index - 1], slot: focus.slot }); else event.preventDefault(); return
        case 'ArrowDown': if (index < flightActions.length - 1) move({ action: flightActions[index + 1], slot: focus.slot }); else event.preventDefault(); return
        case 'ArrowLeft': move({ ...focus, slot: 0 }); return
        case 'ArrowRight': move({ ...focus, slot: 1 }); return
        case 'Backspace': case 'Delete': event.preventDefault(); selectKeyboard({ bindings: clearBinding(bindings, focus.action, focus.slot) }); return
        case 'KeyC': event.preventDefault(); setNotice(null); selectKeyboard({ bindings: defaultBindings }); return
      }
    }
    addEventListener('keydown', onKeyDown, true)
    return () => removeEventListener('keydown', onKeyDown, true)
  }, [listening, notice, focus, bindings, onBack])

  function listen(slot: Slot) { setNotice(null); setFocus(slot); setListening(slot) }

  return <div className="settings-bindings">
    <div className="settings-bindings-head" aria-hidden="true">
      <span>{t('settingsBindAction')}</span><span>{t('settingsBindPrimary')}</span><span>{t('settingsBindSecondary')}</span>
    </div>
    <ul>
      {flightActions.map(action => <li key={action} className="settings-binding" data-pending={pendingActions.includes(action) || undefined}>
        <span className="settings-binding-label">
          {t(`bindAction_${action}` as const)}
          {pendingActions.includes(action) && <small>{t('settingsBindPending')}</small>}
        </span>
        {([0, 1] as const).map(slot => {
          const code = bindings[action][slot]
          const waiting = listening?.action === action && listening.slot === slot
          return <button key={slot} type="button" className="settings-binding-slot" data-listening={waiting || undefined}
            ref={node => { if (node) buttons.current.set(keyOf({ action, slot }), node); else buttons.current.delete(keyOf({ action, slot })) }}
            aria-label={`${t(`bindAction_${action}` as const)} · ${slot === 0 ? t('settingsBindPrimary') : t('settingsBindSecondary')} · ${code ? keyName(code) : t('settingsBindEmpty')}`}
            onFocus={() => setFocus({ action, slot })} onClick={() => listen({ action, slot })}>
            {waiting ? t('settingsBindListening') : code ? <KeyPrompt code={code} /> : <span className="settings-binding-empty">—</span>}
          </button>
        })}
      </li>)}
      <li className="settings-binding is-fixed">
        <span className="settings-binding-label">{t('bindAction_pause')}<small>{t('settingsBindFixed')}</small></span>
        {reservedCodes.map(code => <span key={code} className="settings-binding-slot"><KeyPrompt code={code} /></span>)}
      </li>
    </ul>
    <p className="settings-bindings-notice" role="status">
      {notice?.kind === 'reserved' && t('settingsBindReserved', { key: keyName(notice.code) })}
      {notice?.kind === 'conflict' && <>
        {t('settingsBindConflict', { key: keyName(notice.code), action: t(`bindAction_${notice.owner}` as const) })}
        <button type="button" className="settings-modify" onClick={() => { selectKeyboard({ bindings: notice.swap }); setNotice(null); setFocus(notice.target) }}>{t('settingsBindSwap')}</button>
        <button type="button" className="settings-modify" onClick={() => { setNotice(null); setFocus(notice.target) }}>{t('settingsBindCancel')}</button>
      </>}
      {listening && !notice && t('settingsBindHint')}
    </p>
  </div>
}
