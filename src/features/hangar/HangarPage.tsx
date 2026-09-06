/*
THESIS: The hangar. A black void with a reflective deck, grid lines and a lit airframe,
wearing the F-22 prototype's chrome: one hairline instrument panel on the right, the
airframe name bottom left, nothing else on the glass.
LAYOUT: Top left is deliberately empty — it is reserved for the live airframe state
readout that lands later. Every control lives in the right panel; the only surface that
breaks that rule is the airframe picker, which is a full-stage overlay of its own.
TABS: Systems is live. Flight and Weapons are wired shells — the panel chrome and the
tab routing exist so the future flight model and loadout drop straight in.
NOTE: Every rule in hangar.css is scoped under .is-hangar, so the sheet cannot reach
the shell chrome by accident.
*/
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Box, ChevronRight, CircleSlash, Grid2X2, Lightbulb, Plane, Rocket, Rotate3D, RotateCcw, Scan, X } from 'lucide-react'
import { aircraft, getAircraft, modelUrl } from '../../content/aircraft'
import type { AircraftId } from '../../content/schemas'
import { selectAircraft, useSessionSettings } from '../../app/sessionStore'
import { useTexts } from '../../locales'
import type { Stage } from '../../render/aircraft/animationStages'
import type { CameraCommand, CameraReport, CameraRequest, ViewPreset } from '../../render/ObsidianScene'
import { retryAircraftAsset } from '../../render/aircraft/assetLoader'
import { SceneBoundary } from '../../ui/components/SceneBoundary'
import { supportsWebGL2 } from '../../platform/webgl'
import { clipLabel, clipOrder } from './clipLabels'
import { LaunchPanel } from './LaunchPanel'
import './hangar.css'

const ObsidianScene = lazy(() => import('../../render/ObsidianScene'))
// The panel shows no camera instrument, so the rig's read-only channel has no listener.
// Module scope keeps the identity stable — the memo'd scene must not re-render for it.
const ignoreCameraReport = (_report: CameraReport) => {}
type PanelTab = 'systems' | 'flight' | 'weapons'

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function HangarPage() {
  const { aircraftId, locale } = useSessionSettings()
  const current = getAircraft(aircraftId)
  const text = useTexts()
  const [loaded, setLoaded] = useState<{ id: AircraftId; stages: Stage[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [webglAvailable] = useState(supportsWebGL2)
  const [retryId, setRetryId] = useState(0)
  const [targets, setTargets] = useState<Record<string, boolean>>({})
  const [resetId, setResetId] = useState(0)
  const [grid, setGrid] = useState(true)
  const [studioLights, setStudioLights] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [visible, setVisible] = useState(!document.hidden)
  const [tab, setTab] = useState<PanelTab>('systems')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [request, setRequest] = useState<CameraRequest>({ command: { kind: 'preset', preset: 'hero' }, sequence: 0 })
  const reducedMotion = useReducedMotion()

  const ready = loaded?.id === aircraftId && !failed
  const stages = ready ? loaded.stages : []
  const deployed = stages.filter((clip) => targets[clip.id]).length

  const onReady = useCallback((clips: Stage[]) => {
    setLoaded({ id: aircraftId, stages: [...clips].sort((a, b) => {
      const left = clipOrder.indexOf(a.id), right = clipOrder.indexOf(b.id)
      return (left < 0 ? 100 : left) - (right < 0 ? 100 : right)
    }) })
    setFailed(false)
  }, [aircraftId])
  const onError = useCallback(() => setFailed(true), [])
  useEffect(() => {
    const update = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickerOpen(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [pickerOpen])

  const send = useCallback((command: CameraCommand) => setRequest((value) => ({ command, sequence: value.sequence + 1 })), [])
  const preset = useCallback((value: ViewPreset) => send({ kind: 'preset', preset: value }), [send])

  function choose(id: AircraftId) {
    setPickerOpen(false)
    if (id === aircraftId) return
    setLoaded(null); setFailed(false); setTargets({}); setAutoRotate(false)
    preset('hero')
    selectAircraft(id)
  }
  function retry() {
    retryAircraftAsset(modelUrl(current))
    setLoaded(null); setFailed(false); setRetryId((value) => value + 1)
  }
  function stageKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'r' || event.key === 'R') { event.preventDefault(); preset('hero') }
  }

  const statusCode = !webglAvailable ? 'NO GPU' : failed ? 'FAULT' : ready ? 'READY' : 'SYNC'
  const panelTitle = tab === 'weapons' ? text.weaponsControl : tab === 'flight' ? text.flightControl : text.airframeControl
  const views: [ViewPreset, string][] = [['hero', text.viewPerspective], ['front', text.viewFront], ['side', text.viewSide], ['top', text.viewTop]]
  const tabs: [PanelTab, string, typeof Scan][] = [['systems', text.tabSystems, Scan], ['flight', text.tabFlight, Plane], ['weapons', text.tabWeapons, Rocket]]

  return <main className="hangar-root">
    <section className="hangar-stage" aria-label={`${current.designation} ${text.model}`} tabIndex={0} aria-describedby="hangar-hint" onKeyDown={stageKeys}>
      <div className="scene-canvas">
        {webglAvailable && <SceneBoundary key={retryId} fallback={null} onError={onError}>
          <Suspense fallback={null}>
            <ObsidianScene aircraft={current} targets={targets} playing={visible} speed={1} resetId={resetId} onReady={onReady}
              onError={onError} retryId={retryId} grid={grid} studioLights={studioLights} autoRotate={autoRotate && visible} reducedMotion={reducedMotion}
              cameraRequest={request} onCameraReport={ignoreCameraReport} />
          </Suspense>
        </SceneBoundary>}
      </div>
      <div className="hangar-vignette" aria-hidden="true" />
      {!webglAvailable && <div className="hangar-overlay is-fault" role="alert"><CircleSlash size={26} /><strong>{text.unsupported}</strong><p>{text.unsupportedHint}</p></div>}
      {webglAvailable && failed && <div className="hangar-overlay is-fault" role="alert"><CircleSlash size={26} /><strong>{text.error}</strong><p>{text.errorHint}</p><button type="button" className="hangar-cta" onClick={retry}><RotateCcw size={15} />{text.retry}</button></div>}
      {webglAvailable && !ready && !failed && <div className="hangar-overlay" role="status"><span className="hangar-sweep" /><strong>{text.loading} · {current.designation}</strong><p>{text.preparing}</p></div>}
    </section>

    <div className="hangar-hud">
      {/* Reserved: the airframe state readout lands in this corner. */}
      <div className="hangar-state-slot" aria-hidden="true" />

      <div className="hangar-sight" aria-hidden="true"><i /><i /><b /></div>

      <div className="hangar-title">
        <strong>{`${current.designation} ${current.name}`.toUpperCase()}</strong>
        <p>{current.role[locale]}</p>
      </div>

      <div className="hangar-rail">
      <aside className="hangar-panel" aria-label={text.hangar}>
        <div className="hangar-panel-heading">
          <span>{panelTitle}</span>
          <strong>{current.designation} / {statusCode}</strong>
        </div>

        <div className="hangar-tabs" role="tablist" aria-label={text.hangar}>
          {tabs.map(([id, label, Icon]) => <button type="button" key={id} role="tab" aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={13} />{label}</button>)}
        </div>

        {tab === 'systems' && <section className="hangar-section hangar-systems" role="tabpanel">
          <p className="hangar-label"><Scan size={13} />{text.stage}<span className="hangar-count">{String(deployed).padStart(2, '0')} / {String(stages.length).padStart(2, '0')}</span></p>
          {ready && stages.length > 0 && <>
            <div className="hangar-transport">
              <button type="button" onClick={() => { setTargets({}); setResetId((value) => value + 1) }}><RotateCcw size={13} />{text.resetStages}</button>
            </div>
            <div className="hangar-system-list" tabIndex={0} aria-label={text.stage}>
              {stages.map((clip, index) => {
                const active = Boolean(targets[clip.id])
                return <button type="button" key={clip.id} className={`hangar-system${active ? ' is-active' : ''}`} aria-pressed={active}
                  onClick={() => setTargets((value) => ({ ...value, [clip.id]: !value[clip.id] }))}>
                  <span className="hangar-system-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="hangar-system-copy">
                    <strong>{clipLabel(clip.id, text)}</strong>
                    <small>{clip.id === 'Aero_Demo' ? active ? text.demoActive : text.demoRest : active ? text.active : text.rest} · {clip.duration.toFixed(1)}s</small>
                  </span>
                  <i className="hangar-switch" aria-hidden="true" />
                </button>
              })}
            </div>
          </>}
          {ready && stages.length === 0 && <div className="hangar-empty"><CircleSlash size={20} strokeWidth={1.5} /><strong>{text.noAnimation}</strong><p>{text.noAnimationHint}</p></div>}
          {!ready && <p className="hangar-waiting" role="status">{!webglAvailable ? text.unsupportedHint : failed ? text.errorHint : text.preparing}</p>}
        </section>}

        {tab === 'flight' && <section className="hangar-section hangar-pending" role="tabpanel">
          <p className="hangar-label"><Plane size={13} />{text.flightControl}<span className="hangar-count">{text.standby}</span></p>
          <div className="hangar-empty"><Plane size={20} strokeWidth={1.5} /><strong>{text.standby}</strong><p>{text.flightSoon}</p></div>
        </section>}

        {tab === 'weapons' && <section className="hangar-section hangar-pending" role="tabpanel">
          <p className="hangar-label"><Rocket size={13} />{text.weaponsControl}<span className="hangar-count">{text.standby}</span></p>
          <div className="hangar-empty"><Rocket size={20} strokeWidth={1.5} /><strong>{text.standby}</strong><p>{text.weaponsSoon}</p></div>
        </section>}

        <section className="hangar-section">
          <p className="hangar-label"><Box size={13} />{text.cameraVector}</p>
          <div className="hangar-view-grid">{views.map(([value, label]) => <button type="button" key={value} onClick={() => preset(value)}>{label}</button>)}</div>
        </section>

        <section className="hangar-section">
          <p className="hangar-label"><Plane size={13} />{text.hangarBay}<span className="hangar-count">{String(aircraft.length).padStart(2, '0')} {text.airframes}</span></p>
          <button type="button" className="hangar-hangar-open" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" aria-expanded={pickerOpen}>
            <span className="hangar-system-copy"><strong>{current.designation} {current.name}</strong><small>{text.changeAirframe}</small></span>
            <ChevronRight size={15} />
          </button>
        </section>

        <section className="hangar-section hangar-toggle-stack">
          <button type="button" className={`hangar-toggle${autoRotate ? ' is-active' : ''}`} aria-pressed={autoRotate} onClick={() => setAutoRotate((value) => !value)}>
            <Rotate3D size={16} strokeWidth={1.7} /><span>{text.autoRotate}</span><i aria-hidden="true" />
          </button>
          <button type="button" className={`hangar-toggle${grid ? ' is-active' : ''}`} aria-pressed={grid} onClick={() => setGrid((value) => !value)}>
            <Grid2X2 size={16} strokeWidth={1.7} /><span>{text.grid}</span><i aria-hidden="true" />
          </button>
          <button type="button" className={`hangar-toggle${studioLights ? ' is-active' : ''}`} aria-pressed={studioLights} onClick={() => setStudioLights((value) => !value)}>
            <Lightbulb size={16} strokeWidth={1.7} /><span>{text.studioLight}</span><i aria-hidden="true" />
          </button>
        </section>

        <p className="hangar-note" id="hangar-hint">{text.panelNote}</p>
      </aside>

      <LaunchPanel available={webglAvailable} />
      </div>
    </div>

    {pickerOpen && <div className="hangar-picker" role="dialog" aria-modal="true" aria-label={text.selectAircraft}>
      <button type="button" className="hangar-picker-scrim" aria-label={text.close} onClick={() => setPickerOpen(false)} />
      <div className="hangar-picker-frame">
        <header className="hangar-picker-head">
          <div><span>{text.hangarBay}</span><strong>{text.selectAircraft}</strong></div>
          <button type="button" className="hangar-picker-close" onClick={() => setPickerOpen(false)} aria-label={text.close}><X size={18} /></button>
        </header>
        <div className="hangar-picker-grid">
          {aircraft.map((entry, index) => <button type="button" key={entry.id} className={`hangar-card${entry.id === aircraftId ? ' is-active' : ''}`}
            aria-pressed={entry.id === aircraftId} onClick={() => choose(entry.id)}>
            {/* Placeholder art: swap the hatch pattern for a background-image once renders exist. */}
            <span className="hangar-card-art" aria-hidden="true"><em>{text.imagePending}</em></span>
            <span className="hangar-card-copy">
              <span className="hangar-card-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{entry.designation}</strong>
              <small>{entry.name}</small>
            </span>
          </button>)}
        </div>
      </div>
    </div>}
  </main>
}
