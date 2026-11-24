/*
The flight briefing / pause menu, drawn inside FlightPage's modal dialog over the
blurred, paused flight. Little on screen at rest; detail only when asked for.

  left      aircraft / map, the flight state as one large title, then four actions:
            the amber launch button (start / resume / respawn / retry), Restart,
            Settings, Exit
  bottom    the sortie strip: one cell per subject showing what is set now
            (AIRCRAFT · MAP · OPPONENT · SPAWN, and LAB for developer tools)
  right     the drawer, only while a cell is open: that subject's choices

Aircraft and Map open a grid of cards that wraps and scrolls, with a search field once
the list is long, so the roster and the map list can grow without a new layout. Picking
a card applies it and closes the drawer. Opponent and Spawn keep the drawer open.
Esc closes the drawer. Every setup choice restarts the flight; the drawer says so.
The drone and the bot share one opponent slot: FlightPage turns one off when the other
is chosen.
*/
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, LogOut, Play, RotateCcw, Search, Settings, X } from 'lucide-react'
import { useSessionSettings } from '../../app/sessionStore'
import { aircraft as roster } from '../../content/aircraft'
import { flightMaps, type MapDefinition } from '../../content/maps'
import { difficulties } from '../../content/pve/modes'
import { botDifficulties, botLoadouts, type BotDifficulty, type BotLoadout } from '../../game/bot/botSetup'
import { dronePaths } from '../../game/playground/dronePath'
import { MenuTile } from '../menu/parts'
import { BriefingChoice, type ChoiceOption } from './BriefingControls'

export type DroneChoice = 'off' | 'circle' | 'flares'
export type BotChoice = 'off' | BotDifficulty
type PanelId = 'aircraft' | 'map' | 'opponent' | 'spawn' | 'lab'
/** The search field appears once a list is longer than this. */
const SEARCH_FROM = 9

interface Props {
  /** Tone of the title: a stopped or failed flight reads as failure. */
  state: 'ready' | 'paused' | 'stopped'
  title: string
  /** Shown under the title only when there is something to explain (no WebGL, a failed load). */
  lede?: string
  /** The scene is loaded: setup choices may be changed. */
  ready: boolean
  pointerError: boolean
  launch: { label: string; disabled: boolean; retry: boolean; onClick: () => void; ref: Ref<HTMLButtonElement> }
  onRestart: () => void
  onSettings: () => void
  leaveHref: string
  onLeave: () => void
  aircraftId: string
  onAircraft: (id: string) => void
  mapId: string
  onMap: (id: string) => void
  drone: DroneChoice
  onDrone: (value: DroneChoice) => void
  bot: BotChoice
  onBot: (value: BotChoice) => void
  loadout: BotLoadout
  onLoadout: (value: BotLoadout) => void
  spawn: string
  spawnOptions: readonly ChoiceOption<string>[]
  onSpawn: (value: string) => void
  /** Developer tools (Flight Lab), shown in the LAB drawer. */
  children?: ReactNode
}

export function PauseMenu(props: Props) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const { state, ready, launch } = props
  const [panel, setPanel] = useState<PanelId | null>(null)
  const toggle = (id: PanelId) => setPanel(open => open === id ? null : id)
  // A validation variant picked in Flight Lab is not in the roster; the strip still names it.
  const flown = roster.find(entry => entry.id === props.aircraftId)
  const map = flightMaps.find(entry => entry.id === props.mapId) ?? flightMaps[0]
  const reaction = (id: BotDifficulty) => difficulties.find(item => item.id === id)?.reaction
  const opponent = props.bot !== 'off' ? { value: `${t('combatBot')} · ${t(`botLevel_${props.bot}`)}`, sub: t(`botLoadout_${props.loadout}`) }
    : props.drone !== 'off' ? { value: t('targetDrone'), sub: t(`drone_${props.drone}`) } : { value: t('drone_off'), sub: t('pauseOpponentNone') }
  const spawn = props.spawnOptions.find(option => option.value === props.spawn)

  // Esc closes the drawer. The dialog itself ignores Esc (FlightPage), so nothing else hears it.
  useEffect(() => {
    if (!panel) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.code === 'Escape') { event.preventDefault(); setPanel(null) } }
    addEventListener('keydown', onKeyDown, true)
    return () => removeEventListener('keydown', onKeyDown, true)
  }, [panel])

  const titles: Record<PanelId, string> = { aircraft: t('pauseAircraft'), map: t('pauseMap'), opponent: t('pauseOpponent'), spawn: t('pauseSpawn'), lab: t('flightLab') }
  return <div className="settings-scope pause" data-state={state} data-panel={panel ?? undefined}>
    <div className="pause-side">
      <p className="pause-eyebrow"><span aria-hidden="true" />{flown ? `${flown.designation} ${flown.name}` : props.aircraftId}<i aria-hidden="true">/</i>{map.name[locale]}</p>
      <h1 id="flight-menu-title">{props.title}</h1>
      {props.lede && <p className="pause-lede">{props.lede}</p>}

      <nav className="pause-actions" aria-label={t('pauseActions')}>
        {props.pointerError && <p className="pause-alert" role="alert">{t('pointerError')}</p>}
        <button ref={launch.ref} type="button" className="menu-launch" disabled={launch.disabled} onClick={launch.onClick}>
          <span>{launch.label}</span>
          {!launch.disabled && <kbd className="mv-key" aria-hidden="true">ENTER</kbd>}
          {!launch.disabled && (launch.retry ? <RotateCcw size={24} aria-hidden="true" /> : <Play size={24} fill="currentColor" aria-hidden="true" />)}
        </button>
        {ready && <MenuTile onClick={props.onRestart} icon={<RotateCcw size={20} aria-hidden="true" />} title={t('resetFlight')} />}
        <MenuTile onClick={props.onSettings} icon={<Settings size={20} aria-hidden="true" />} title={t('homeSettings')} />
        <MenuTile href={props.leaveHref} onClick={props.onLeave} icon={<LogOut size={20} aria-hidden="true" />} title={t('leaveFlight')} />
      </nav>
    </div>

    {panel && <section className="pause-drawer mv-panel" aria-label={titles[panel]} key={panel}>
      <header className="pause-drawer-top">
        <h2>{titles[panel]}</h2>
        {panel !== 'lab' && <small>{t('pauseRestarts')}</small>}
        <button type="button" className="pause-close" aria-label={t('pauseClose')} onClick={() => setPanel(null)}><kbd className="mv-key" aria-hidden="true">ESC</kbd><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="pause-drawer-body">
        {panel === 'aircraft' && <CardGrid label={titles.aircraft} value={props.aircraftId} onChange={id => { props.onAircraft(id); setPanel(null) }}
          options={roster.map(entry => ({ value: entry.id, title: entry.designation, subtitle: entry.name, tag: entry.hangar.playStyle[locale], search: `${entry.designation} ${entry.name} ${entry.hangar.playStyle.en} ${entry.hangar.gameRole.en}` }))} />}
        {panel === 'map' && <CardGrid label={titles.map} value={props.mapId} onChange={id => { props.onMap(id); setPanel(null) }}
          options={flightMaps.map(entry => ({ value: entry.id, title: entry.name[locale], subtitle: entry.info[locale], swatch: mapSwatch(entry), tag: entry.flight?.scene === 'dev-grid' ? 'DEV GRID' : undefined, search: `${entry.name.en} ${entry.name.th} ${entry.id}` }))} />}
        {panel === 'opponent' && <>
          <BriefingChoice label={t('targetDrone')} value={props.drone} onChange={props.onDrone}
            hint={props.drone === 'off' ? undefined : t(props.drone === 'flares' ? 'droneFlaresHint' : 'targetDroneHint')}
            options={[
              { value: 'off', name: t('drone_off') },
              { value: 'circle', name: t('drone_circle'), detail: `${dronePaths.speed} m/s · r ${dronePaths.circleRadius / 1000} km` },
              { value: 'flares', name: t('drone_flares'), detail: t('droneFlaresDetail') },
            ]} />
          <BriefingChoice label={t('combatBot')} value={props.bot} onChange={props.onBot}
            hint={props.bot === 'off' ? undefined : t(`botLevelHint_${props.bot}`)}
            options={[{ value: 'off' as BotChoice, name: t('drone_off') }, ...botDifficulties.map(id => ({ value: id as BotChoice, name: t(`botLevel_${id}`), detail: reaction(id) }))]} />
          {props.bot !== 'off' && <BriefingChoice label={t('botLoadout')} value={props.loadout} onChange={props.onLoadout}
            options={botLoadouts.map(id => ({ value: id, name: t(`botLoadout_${id}`), detail: t(`botLoadoutDetail_${id}`) }))} />}
        </>}
        {panel === 'spawn' && <BriefingChoice label={t('pauseSpawn')} hideLabel stacked value={props.spawn} onChange={props.onSpawn} options={props.spawnOptions} />}
        {panel === 'lab' && <div className="flight-lab-settings">{props.children}</div>}
      </div>
    </section>}

    <div className="pause-strip" role="group" aria-label={t('pauseSetup')}>
      <StripCell label={t('pauseAircraft')} value={flown?.designation ?? props.aircraftId} sub={flown?.name} open={panel === 'aircraft'} disabled={!ready} onClick={() => toggle('aircraft')} />
      <StripCell label={t('pauseMap')} value={map.name[locale]} sub={map.flight?.scene === 'dev-grid' ? 'DEV GRID' : undefined} swatch={mapSwatch(map)} open={panel === 'map'} disabled={!ready} onClick={() => toggle('map')} />
      <StripCell label={t('pauseOpponent')} value={opponent.value} sub={opponent.sub} open={panel === 'opponent'} disabled={!ready} onClick={() => toggle('opponent')} />
      <StripCell label={t('pauseSpawn')} value={spawn?.name ?? props.spawn} sub={spawn?.detail} open={panel === 'spawn'} disabled={!ready} onClick={() => toggle('spawn')} />
      {props.children && <button type="button" className="pause-cell is-lab" aria-expanded={panel === 'lab'} onClick={() => toggle('lab')}><small>DEV</small><strong>LAB</strong></button>}
    </div>
  </div>
}

/** One cell of the sortie strip: what is set now; opens its drawer. */
function StripCell({ label, value, sub, swatch, open, disabled, onClick }: { label: string; value: string; sub?: string; swatch?: string; open: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="pause-cell" aria-expanded={open} disabled={disabled} onClick={onClick}>
    {swatch && <span className="pause-cell-swatch" style={{ background: swatch }} aria-hidden="true" />}
    <small>{label}</small>
    <strong>{value}</strong>
    {sub && <span>{sub}</span>}
    <ChevronUp size={18} aria-hidden="true" />
  </button>
}

interface CardOption<T extends string> { value: T; title: string; subtitle?: string; tag?: string; swatch?: string; search: string }

/** A wrapping, scrolling grid of large radio cards (arrow keys move between them), with a search
 * field once the list is long. It needs no new layout however long the list grows. */
function CardGrid<T extends string>({ label, options, value, onChange }: { label: string; options: readonly CardOption<T>[]; value: T; onChange: (value: T) => void }) {
  const { t } = useTranslation()
  const name = useId()
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const searchable = options.length >= SEARCH_FROM
  useEffect(() => { field.current?.focus() }, [])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = options.filter(option => words.every(word => `${option.title} ${option.subtitle ?? ''} ${option.search}`.toLowerCase().includes(word)))
  return <>
    {searchable && <label className="pick-search"><Search size={16} aria-hidden="true" />
      <input ref={field} type="search" value={query} placeholder={t('pauseSearch')} aria-label={t('pauseSearch')} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && shown.length === 1) onChange(shown[0].value) }} />
      <span>{shown.length} / {options.length}</span></label>}
    <fieldset className="pick-grid" aria-label={label}>
      {shown.map(option => <label key={option.value} className="pick">
        {/* onClick as well as onChange: clicking the card already selected closes the drawer too. */}
        <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} onClick={() => { if (value === option.value) onChange(option.value) }} />
        {option.swatch && <span className="pick-swatch" style={{ background: option.swatch }} aria-hidden="true" />}
        <span className="pick-title">{option.title}</span>
        {option.subtitle && <span className="pick-sub">{option.subtitle}</span>}
        {option.tag && <span className="pick-tag">{option.tag}</span>}
      </label>)}
    </fieldset>
    {shown.length === 0 && <p className="pick-empty">{t('pauseSearchNone')}</p>}
  </>
}

const gridLines = 'linear-gradient(90deg, rgba(0, 0, 0, 0.32) 1px, transparent 1px) 0 0 / 14px 14px, linear-gradient(rgba(0, 0, 0, 0.32) 1px, transparent 1px) 0 0 / 14px 14px'
/** A map's swatch: its ground colours under a survey grid. */
function mapSwatch(map: MapDefinition) {
  if (map.flight?.scene !== 'dev-grid') return `${gridLines}, linear-gradient(120deg, #b9a37c, #8d7a5c 60%, #a39074)`
  const [low, mid, high, peak] = map.flight.palette.bands
  return `${gridLines}, linear-gradient(120deg, ${low} 0 46%, ${mid} 46% 60%, ${high} 60% 84%, ${peak} 84%)`
}
