/*
Small building blocks shared by the menu screens. Each one is a styled
element with no state; the look lives in menu.css.
*/
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Play, Settings } from 'lucide-react'
import { openSettings, routes, type MenuRouteId } from '../../app/routes'

/** Top-left link back to the parent screen, e.g. "‹ HOME". */
export function BackLink({ to, label }: { to: MenuRouteId; label: string }) {
  return <a className="menu-back" href={routes[to]}><ChevronLeft size={18} aria-hidden="true" />{label}</a>
}

/** Keyboard hints in mono type, e.g. "ESC  Back". */
export function HotkeyHints({ hints }: { hints: [key: string, label: string][] }) {
  return <ul className="menu-hints">
    {hints.map(([key, label]) => <li key={key}><kbd>{key}</kbd>{label}</li>)}
  </ul>
}

/** Short cyan rule followed by a small caps label. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="menu-eyebrow"><span aria-hidden="true" />{children}</p>
}

/** Section title with a hairline under it and optional text on the right. */
export function SectionHeading({ title, aside }: { title: string; aside?: ReactNode }) {
  return <div className="menu-section-heading"><h2>{title}</h2>{aside && <span>{aside}</span>}</div>
}

/** The amber button that starts a flight (PLAY, START, LAUNCH). */
export function LaunchButton({ label, onClick, disabled = false, className = '', hotkey }: { label: string; onClick: () => void; disabled?: boolean; className?: string; hotkey?: string }) {
  return <button type="button" className={`menu-launch ${className}`} onClick={onClick} disabled={disabled}>
    <span>{label}</span>{hotkey && <kbd className="mv-key" aria-hidden="true">{hotkey}</kbd>}<Play size={24} fill="currentColor" aria-hidden="true" />
  </button>
}

/** A large menu row: icon, title, one line of state, and the key that does the same. A link with `href`, else a button. */
export function MenuTile({ icon, title, detail, hotkey, href, onClick }: { icon: ReactNode; title: string; detail?: string; hotkey?: string; href?: string; onClick?: () => void }) {
  const body = <>{icon}<span className="mv-tile-text"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{hotkey && <kbd className="mv-key" aria-hidden="true">{hotkey}</kbd>}</>
  return href ? <a className="mv-tile" href={href} onClick={onClick}>{body}</a> : <button type="button" className="mv-tile" onClick={onClick}>{body}</button>
}

/** Label/value rows, e.g. MAP · Flat Training Range. */
export function FactRows({ rows }: { rows: [label: string, value: ReactNode][] }) {
  return <dl className="menu-facts">
    {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>
}

/** Gear button that opens Settings; Back there returns to `from`. */
export function SettingsButton({ from }: { from: MenuRouteId }) {
  const { t } = useTranslation()
  return <button type="button" className="menu-icon-button" aria-label={t('homeSettings')} title={t('homeSettings')} onClick={() => openSettings(from)}>
    <Settings size={20} strokeWidth={1.6} aria-hidden="true" />
  </button>
}
