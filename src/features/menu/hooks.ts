/*
Small browser hooks used by the menu screens.
*/
import { useEffect, useRef, useState } from 'react'
import { useSessionSettings } from '../../app/sessionStore'
import { effectiveUiScale, resolveReducedMotion } from '../../platform/storage'

/**
 * True when motion should be reduced: the Settings choice (Interface › Reduced motion),
 * which on Auto follows the system setting.
 */
export function useReducedMotion(): boolean {
  const { display } = useSessionSettings()
  const [system, setSystem] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystem(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return resolveReducedMotion(display.reducedMotion, system)
}

/**
 * Interface › UI scale as a zoom factor, limited so enlarged menus never outgrow the window
 * (see `effectiveUiScale`). Updates on resize.
 */
export function useUiScale(): number {
  const { display } = useSessionSettings()
  const [size, setSize] = useState(() => ({ width: innerWidth, height: innerHeight }))
  useEffect(() => {
    const update = () => setSize({ width: innerWidth, height: innerHeight })
    addEventListener('resize', update)
    return () => removeEventListener('resize', update)
  }, [])
  return effectiveUiScale(display.uiScale, size.width, size.height)
}

/** False while the browser tab is hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

/**
 * Keyboard shortcuts for a menu screen, keyed by `KeyboardEvent.code`
 * ('KeyM', 'Enter', 'Escape', 'ArrowLeft', …). Codes name the physical key,
 * so shortcuts also work with a Thai keyboard layout.
 *
 * Shortcuts are only a quicker path: every action also has a button.
 * They pause while the player types in a field, and Enter is left to the
 * focused button or link so it does not fire twice.
 */
export function useMenuHotkeys(bindings: Record<string, () => void>) {
  const latest = useRef(bindings)
  useEffect(() => { latest.current = bindings })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Enter' && target?.closest('button, a')) return
      const action = latest.current[event.code]
      if (!action) return
      event.preventDefault()
      action()
    }
    addEventListener('keydown', onKeyDown)
    return () => removeEventListener('keydown', onKeyDown)
  }, [])
}
