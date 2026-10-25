/* Training extends the aircraft-first instrument language: full viewport range,
   compact telemetry at top left, visible aircraft in chase view, controls below.
   A focused briefing/pause dialog owns setup, launch, reset and return; its
   SETTINGS button swaps the dialog to the shared Settings panel (same component as
   #/settings). The dialog is modal, so Settings must live inside it. */
import { createRef, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { selectCamera, useSessionSettings } from '../../app/sessionStore'
import { cameraRollOption, horizonStyleOption, nextCameraSettings } from '../../game/camera/cameraSettings'
import { actionForCode } from '../../game/input/keyBindings'
import { mouseHintKey } from '../../game/input/mouseStick'
import { useReducedMotion, useUiScale } from '../menu/hooks'
import { SettingsPanel } from '../settings/SettingsPanel'
import { bindingNames } from '../settings/KeyPrompt'
import { flightReturnRoute, routes } from '../../app/routes'
import { getAircraft, modelUrl, playgroundAircraft } from '../../content/aircraft'
import { FlightInput } from '../../game/input/FlightInput'
import { FlightInstruments, FlightSystemStatus, type HudDriver } from './FlightInstruments'
import type { AircraftState } from '../../game/state/WorldState'
import { SceneBoundary } from '../../ui/components/SceneBoundary'
import { supportsWebGL2 } from '../../platform/webgl'
import { retryAircraftAsset } from '../../render/aircraft/assetLoader'
import type { FlightSession } from './session'
import { PlaygroundHud, lessonLabels } from './PlaygroundHud'
import { RadarScope, type RadarDriver } from './RadarScope'
import { RwrScope, type RwrDriver } from './RwrScope'
import { WeaponPanel } from './WeaponPanel'
import { flightWarning, holdWarning, warningSeverity, type HeldWarning } from './telemetry'
import { practiceSpawns, targetDrone as droneSpawn, type PracticePreset } from '../../game/playground/practice'
import { dronePaths, type TargetDroneMode } from '../../game/playground/dronePath'
import { BriefingChoice, BriefingStepper } from './BriefingControls'
import { LogOut, Play, RotateCcw, Settings } from 'lucide-react'
import './flight.css'
const FlightScene = lazy(() => import('../../render/FlightScene'))
// Menu title for each way a flight can stop.
const stopTitle = { weapon: 'shotDown', terrain: 'crashed', boundary: 'boundaryReached' } as const
// Speed and size of each drone, from the same values the runtime flies.
const droneDetail = (mode: TargetDroneMode | 'off') => mode === 'still' ? '0 m/s' : mode === 'racetrack' ? `${dronePaths.speed} m/s` : mode === 'circle' ? `${dronePaths.speed} m/s · r ${dronePaths.circleRadius / 1000} km` : mode === 'bot' ? 'GUN · MSL' : undefined
export function FlightPage() {
  const { t } = useTranslation()
  const { aircraftId: selectedAircraftId, controls, camera, cameraFov, keyboard, graphics } = useSessionSettings()
  const reducedMotion = useReducedMotion(), uiScale = useUiScale()
  const [aircraftId, setAircraftId] = useState(selectedAircraftId)
  const session = useMemo<FlightSession>(() => ({ runtime: null, input: new FlightInput(controls, keyboard), preset: keyboard.preset, camera: { ...camera }, cameraFov, graphics, running: false, targetDrone: null, resetId: 0, timeScale: 1, reducedMotion }), [])
  const [practicePreset, setPracticePreset] = useState<PracticePreset>('free')
  const [lesson, setLesson] = useState(0), [lab, setLab] = useState(false), [cameraChanged, setCameraChanged] = useState(false)
  const [timeScale, setTimeScale] = useState(1), [targetDrone, setTargetDrone] = useState<TargetDroneMode | null>(null)
  const [view, setView] = useState<'pause' | 'settings'>('pause')
  // Trigger presses refused by a locked gun (cooling or overheated); each one shakes the gun card.
  const [gunDenied, setGunDenied] = useState(0)
  const latest = useRef<AircraftState | null>(null)
  const denyIfLocked = useCallback(() => { const gun = latest.current?.gun; if (gun && (gun.overheated || gun.cooling)) setGunDenied(count => count + 1) }, [])
  const [hasStarted, setHasStarted] = useState(false)
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0), [pointerError, setPointerError] = useState(false)
  const preset = keyboard.preset
  const [telemetry, setTelemetry] = useState<AircraftState | null>(null)
  const [webgl] = useState(supportsWebGL2)
  const indicators = useMemo(() => ({ stick: createRef<HTMLDivElement>(), gate: createRef<HTMLDivElement>(), hud: createRef<HudDriver>(), radar: createRef<RadarDriver>(), rwr: createRef<RwrDriver>(), fps: createRef<HTMLSpanElement>() }), [])
  // Mouse settings are input only; the next command tick reads them.
  useEffect(() => { session.input.mouse = { ...controls } }, [session, controls])
  // Camera settings are saved; the scene reads the session copy on its next frame.
  useEffect(() => { session.camera = { ...camera }; session.invalidate?.() }, [session, camera])
  // The rest of Settings, mirrored the same way. A preset or binding change drops held keys.
  useEffect(() => { session.input.keyboard = keyboard; session.preset = keyboard.preset; session.input.clear(); setPointerError(false) }, [session, keyboard])
  useEffect(() => { session.cameraFov = cameraFov; session.graphics = graphics; session.reducedMotion = reducedMotion; session.invalidate?.() }, [session, cameraFov, graphics, reducedMotion])
  const surface = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null), launch = useRef<HTMLButtonElement>(null)
  // True while the page itself closes the dialog; any other close (Chrome force-closes a modal
  // after repeated Esc) reopens it, so a paused flight always has its menu.
  const closingDialog = useRef(false)
  // The close event arrives a task later, so the flag is cleared there, not here.
  const closeDialog = useCallback(() => { if (dialog.current?.open) { closingDialog.current = true; dialog.current.close() } }, [])
  const heldWarning = useRef<HeldWarning>({ warning: null, until: 0 })
  const pause = useCallback(() => {
    session.running = false; session.runtime?.pause(); session.input.clear(); setRunning(false)
    if (document.pointerLockElement) document.exitPointerLock()
  }, [session])
  const onReady = useCallback(() => setReady(true), [])
  const onError = useCallback(() => { setFailed(true); pause() }, [pause])
  const onTelemetry = useCallback((state: AircraftState) => { latest.current = state; setTelemetry(state); if (!state.alive) pause() }, [pause])
  useEffect(() => {
    if (!running) { if (!dialog.current?.open) dialog.current?.showModal() }
    else { closeDialog(); setView('pause') }
  }, [running, closeDialog])
  // The launch button takes focus once it can be used, so Enter starts or resumes the flight.
  // It is disabled while loading, so the dialog's own first focus cannot land on it.
  useEffect(() => { if (ready && !running && view === 'pause') launch.current?.focus({ preventScroll: true }) }, [ready, running, view])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((e.target as HTMLElement)?.tagName)) return
      if (!session.running) return
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); pause(); return }
      const bound = actionForCode(session.input.keyboard.bindings, e.code)
      if (!bound) return
      e.preventDefault()
      if (bound.action === 'cameraCycle') { if (!e.repeat) { selectCamera(nextCameraSettings(session.camera)); setCameraChanged(true) }; return }
      if (bound.action === 'fireGun' && !e.repeat) denyIfLocked()
      session.input.press(e.code, e.repeat)
    }
    const keyup = (e: KeyboardEvent) => session.input.held.delete(e.code)
    // The keyboard preset has no pointer lock, but free look still turns the camera with the mouse.
    const move = (e: MouseEvent) => { if (session.running && (document.pointerLockElement === surface.current && session.preset === 'mouse' || session.preset === 'keyboard' && session.input.holds('freeLook'))) session.input.move(e.movementX, e.movementY) }
    // Only a press made while already locked fires: the click that takes the lock never does (doc 02).
    const mousedown = (e: MouseEvent) => {
      if (!session.running || document.pointerLockElement !== surface.current || session.preset !== 'mouse') return
      if (e.button === 0) { session.input.mouseGun = true; denyIfLocked() }
      // Right button: launch the selected missile (weapon panel rules).
      if (e.button === 2) session.input.pressLaunch()
    }
    // The right button launches; it never opens the browser menu over the flight.
    const menu = (e: MouseEvent) => { if (session.running) e.preventDefault() }
    const mouseup = (e: MouseEvent) => { if (e.button === 0) session.input.mouseGun = false }
    const lock = () => { session.input.clear(); if (!document.pointerLockElement && session.preset === 'mouse' && session.running) pause() }
    const hidden = () => { if (document.hidden) pause() }
    addEventListener('keydown', keydown); addEventListener('keyup', keyup); addEventListener('mousemove', move); addEventListener('blur', pause)
    addEventListener('mousedown', mousedown); addEventListener('mouseup', mouseup); addEventListener('contextmenu', menu)
    document.addEventListener('pointerlockchange', lock); document.addEventListener('visibilitychange', hidden)
    return () => {
      removeEventListener('keydown', keydown); removeEventListener('keyup', keyup); removeEventListener('mousemove', move); removeEventListener('blur', pause)
      removeEventListener('mousedown', mousedown); removeEventListener('mouseup', mouseup); removeEventListener('contextmenu', menu)
      document.removeEventListener('pointerlockchange', lock); document.removeEventListener('visibilitychange', hidden)
      session.running = false; session.input.clear(); if (document.pointerLockElement === surface.current) document.exitPointerLock()
    }
  }, [pause, session, denyIfLocked])
  async function begin() {
    session.input.clear(); setPointerError(false)
    // Close the top-layer dialog before asking the browser to lock the scene.
    closeDialog()
    try {
      if (session.preset === 'mouse') {
        if (!surface.current?.requestPointerLock) throw new Error('Pointer lock unavailable')
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { document.removeEventListener('pointerlockchange', changed); document.removeEventListener('pointerlockerror', denied); clearTimeout(timeout) }
          const changed = () => { if (document.pointerLockElement === surface.current) { cleanup(); resolve() } }
          const denied = (reason?: unknown) => { cleanup(); reject(reason instanceof Error ? reason : new Error('Pointer lock denied')) }
          const timeout = setTimeout(denied, 3000)
          document.addEventListener('pointerlockchange', changed); document.addEventListener('pointerlockerror', denied)
          try { const request = surface.current!.requestPointerLock(); request?.catch(denied) } catch { denied() }
        })
      }
      if (session.preset === 'mouse') session.input.engage()
      session.running = true; session.runtime?.resume(); setRunning(true); setHasStarted(true); surface.current?.focus()
    } catch (error) { if (import.meta.env.DEV) console.warn('Flight pointer lock:', error); setPointerError(true); dialog.current?.showModal() }
  }
  function resetFlight(nextPreset: PracticePreset = practicePreset) {
    pause(); setHasStarted(false); session.resetId++; session.runtime?.reset(nextPreset); setCameraChanged(false); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null); session.invalidate?.()
  }
  function chooseTargetDrone(mode: TargetDroneMode | null) {
    session.targetDrone = mode; setTargetDrone(mode)
    session.runtime?.setTargetDrone(mode); resetFlight()
  }
  function exportFlight() {
    const replay = session.runtime?.exportReplay()
    if (!replay) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'maverick-flight-p3.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const stopped = telemetry && !telemetry.alive
  heldWarning.current = holdWarning(heldWarning.current, flightWarning(telemetry), performance.now())
  const warning = heldWarning.current.warning
  const inSettings = view === 'settings'
  // The title's tone: a stopped or failed flight reads as failure.
  const briefState = !webgl || failed || stopped ? 'stopped' : hasStarted ? 'paused' : 'ready'
  // Names the keys actually bound, so the hint stays right after a rebind.
  const controlsHint = t('controlsHint', bindingNames(keyboard.bindings))
  return <main className="flight-root" data-settings={inSettings || undefined} style={{ '--ui-scale': uiScale } as CSSProperties}>
    <div className="flight-scene" ref={surface} tabIndex={-1} aria-label={t('flightTitle')}>
      {webgl && !failed && <SceneBoundary key={`${aircraftId}-${retry}`} fallback={null} onError={onError}><Suspense fallback={null}>
        <FlightScene indicators={indicators} aircraftId={aircraftId} session={session} running={running} targetDrone={targetDrone !== null} graphics={graphics} onReady={onReady} onTelemetry={onTelemetry} />
      </Suspense></SceneBoundary>}
    </div>
    <div className="flight-hud">
      <FlightInstruments driver={indicators.hud} />
      <RadarScope driver={indicators.radar} />
      <RwrScope driver={indicators.rwr} />
      <div className="flight-identity"><strong>{getAircraft(aircraftId).designation}</strong><span>{t('training')} / {t('flatRange')}</span></div>
      <div className="flight-actions">{graphics.showFps && <span ref={indicators.fps} className="flight-fps" aria-hidden="true" />}<span>{t(cameraRollOption(camera.roll).labelKey)}{camera.roll === 'horizon' ? ` · ${t(horizonStyleOption(camera.horizonStyle).labelKey)}` : ''}</span><button onClick={pause}>{t('pauseFlight')} · Esc</button></div>
      <FlightSystemStatus state={telemetry} />
      {/* The Flight Lab readout takes the same corner, so the column steps aside while it is open. */}
      {!lab && <WeaponPanel aircraftId={aircraftId} state={telemetry} selected={telemetry?.targeting.seeker.slot ?? 0} denied={gunDenied} preset={preset} bindings={keyboard.bindings} reducedMotion={reducedMotion} />}
      <PlaygroundHud state={telemetry} practice={session.runtime?.snapshot().practice} lesson={lesson} cameraChanged={cameraChanged} lab={lab} />
      {running && warning && <p className="flight-warning" data-severity={warningSeverity(warning)} role="status">{t(warning)}</p>}
      {running && preset === 'mouse' && controls.mode !== 'aim' && controls.mode !== 'cursor' && <div ref={indicators.gate} className="flight-stick-gate" aria-hidden="true" />}
      {running && preset === 'mouse' && controls.mode !== 'aim' && controls.mode !== 'cursor' && <div ref={indicators.stick} className="flight-stick" aria-hidden="true">
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="36" pathLength="96" /><path d="M50 14V8M86 50H92M50 86V92M14 50H8" /></svg>
      </div>}
      {/* Active practice modifiers stay on screen while flying (docs/game-design/10-playground.md). */}
      {(timeScale !== 1 || targetDrone) && <p className="flight-timescale">{[timeScale !== 1 && `${t('practiceSpeed')} ×${timeScale}`, targetDrone && `${t('targetDrone')} · ${t(`drone_${targetDrone}`)}`].filter(Boolean).join(' · ')}</p>}
      <p className="flight-controls">{controlsHint}</p>
    </div>
    <dialog ref={dialog} className={inSettings ? 'flight-settings' : 'flight-menu'} aria-labelledby={inSettings ? 'settings-title' : 'flight-menu-title'} onCancel={e => e.preventDefault()}
      onClose={() => { if (closingDialog.current) closingDialog.current = false; else if (!session.running) dialog.current?.showModal() }}>
      {inSettings ? <div className="settings-scope"><SettingsPanel backLabel={t('pauseFlight')} onBack={() => setView('pause')} /></div> : <div className="settings-scope flight-brief" data-state={briefState}>
        <header className="flight-brief-top">
          <strong>{getAircraft(aircraftId).designation}</strong><span aria-hidden="true" />
          <p>{t('training')} / {t('flatRange')}</p>
        </header>
        <div className="flight-brief-body">
          <h1 id="flight-menu-title">{!webgl ? t('unsupported') : failed ? t('error') : stopped ? t(stopTitle[telemetry.stopReason ?? 'terrain']) : hasStarted ? t('pausedFlight') : t('flightReady')}</h1>
          <p className="flight-brief-lede">{!webgl ? t('unsupportedHint') : failed ? t('errorHint') : t('flightHelp')}</p>
          <p className="flight-brief-note">{t('baseline')}</p>
          <section className="flight-brief-section" aria-labelledby="flight-brief-practice">
            <h2 id="flight-brief-practice">{t('briefPractice')}</h2>
            <BriefingChoice label={t('practicePreset')} disabled={!ready} value={practicePreset} onChange={value => { setPracticePreset(value); resetFlight(value) }}
              options={(Object.keys(practiceSpawns) as PracticePreset[]).map(id => { const [name, detail] = t(`spawn_${id}`).split(' · '); return { value: id, name, detail } })} />
            <BriefingStepper label={t('practiceLesson')} disabled={!ready} values={lessonLabels.map(key => t(key))} index={lesson} previousLabel={t('lessonPrevious')} nextLabel={t('lessonNext')}
              onChange={value => { setLesson(value); const spawn: PracticePreset = value === 6 ? 'cobra' : value === 5 ? 'recovery' : value === 4 ? 'highG' : 'free'; setPracticePreset(spawn); resetFlight(spawn) }} />
            <BriefingChoice label={t('targetDroneToggle')} hint={targetDrone ? t(targetDrone === 'bot' ? 'combatBotHint' : 'targetDroneHint') : undefined} disabled={!ready} value={targetDrone ?? 'off'}
              onChange={value => chooseTargetDrone(value === 'off' ? null : value)}
              options={(['off', 'still', 'racetrack', 'circle', 'bot'] as const).map(id => ({ value: id, name: t(`drone_${id}`), detail: droneDetail(id) }))} />
          </section>
          <section className="flight-brief-section" aria-labelledby="flight-brief-controls">
            <h2 id="flight-brief-controls">{t('briefControls')}</h2>
            <p className="flight-brief-keys">{controlsHint}</p>
            {preset === 'mouse' && <details className="flight-brief-more"><summary>{t('mousePreset')}</summary><p>{t(mouseHintKey(controls.mode))}</p>{controls.mode !== 'aim' && controls.mode !== 'cursor' && <p>{t('mouseTips')}</p>}</details>}
            <details className="flight-brief-more"><summary>{t('psmControlsHelp')}</summary><p>{t('psmControlsDetail')}</p></details>
            <details className="flight-brief-more flight-lab-settings"><summary>{t('flightLab')}</summary>
              <div className="flight-lab-grid">
                <label htmlFor="validation-aircraft">{t('labAircraft')}</label><select id="validation-aircraft" value={aircraftId} onChange={e => { pause(); setReady(false); setHasStarted(false); setFailed(false); setTelemetry(null); setPracticePreset('free'); setAircraftId(e.target.value) }}>{playgroundAircraft.map(entry => <option key={entry.id} value={entry.id}>{entry.designation} · {entry.name}</option>)}</select>
                <label htmlFor="practice-speed">{t('practiceSpeed')}</label><select id="practice-speed" value={timeScale} onChange={e => { session.timeScale = Number(e.target.value); setTimeScale(session.timeScale) }}>{[1, 0.5, 0.25].map(value => <option key={value} value={value}>×{value}</option>)}</select>
              </div>
              <label className="flight-lab-check"><input type="checkbox" checked={lab} onChange={e => setLab(e.target.checked)} /> {t('showTelemetry')}</label>
              <div className="flight-lab-actions">
                <button disabled={!ready || !!stopped} onClick={() => { session.runtime?.singleStep(); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null); session.invalidate?.() }}>{t('singleStep')}</button>
                <button disabled={!ready} onClick={exportFlight}>{t('exportFlight')}</button>
              </div>
              <p>{t('exportFlightHint')}</p>
            </details>
          </section>
        </div>
        <footer className="flight-brief-actions">
          {pointerError && <p className="flight-brief-alert" role="alert">{t('pointerError')}</p>}
          {failed ? <button className="menu-launch" onClick={() => { retryAircraftAsset(modelUrl(getAircraft(aircraftId))); if (targetDrone) retryAircraftAsset(modelUrl(getAircraft(droneSpawn.aircraftId))); setReady(false); setFailed(false); setRetry(x => x + 1) }}><span>{t('retry')}</span><RotateCcw size={24} aria-hidden="true" /></button>
            : <button ref={launch} className="menu-launch" disabled={!ready || !webgl || !!stopped} onClick={() => void begin()}><span>{!ready && webgl ? t('flightLoading') : hasStarted ? t('resumeFlight') : t('beginFlight')}</span>{ready && webgl && !stopped && <Play size={24} fill="currentColor" aria-hidden="true" />}</button>}
          <div className="flight-brief-secondary">
            {ready && <button onClick={() => resetFlight()}><RotateCcw size={16} aria-hidden="true" />{t('resetFlight')}</button>}
            <button onClick={() => setView('settings')}><Settings size={16} aria-hidden="true" />{t('homeSettings')}</button>
            <a href={routes[flightReturnRoute()]} onClick={pause}><LogOut size={16} aria-hidden="true" />{t('leaveFlight')}</a>
          </div>
        </footer>
      </div>}
    </dialog>
  </main>
}
