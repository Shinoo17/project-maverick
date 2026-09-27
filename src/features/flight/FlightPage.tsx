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
import { flightWarning, holdWarning, warningSeverity, type HeldWarning } from './telemetry'
import { practiceSpawns, type PracticePreset } from '../../game/playground/practice'
import './flight.css'
const FlightScene = lazy(() => import('../../render/FlightScene'))
export function FlightPage() {
  const { t } = useTranslation()
  const { aircraftId: selectedAircraftId, controls, camera, cameraFov, keyboard, graphics } = useSessionSettings()
  const reducedMotion = useReducedMotion(), uiScale = useUiScale()
  const [aircraftId, setAircraftId] = useState(selectedAircraftId)
  const session = useMemo<FlightSession>(() => ({ runtime: null, input: new FlightInput(controls, keyboard), preset: keyboard.preset, camera: { ...camera }, cameraFov, graphics, running: false, resetId: 0, timeScale: 1, reducedMotion }), [])
  const [practicePreset, setPracticePreset] = useState<PracticePreset>('free')
  const [lesson, setLesson] = useState(0), [lab, setLab] = useState(false), [cameraChanged, setCameraChanged] = useState(false)
  const [timeScale, setTimeScale] = useState(1)
  const [view, setView] = useState<'pause' | 'settings'>('pause')
  const [hasStarted, setHasStarted] = useState(false)
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0), [pointerError, setPointerError] = useState(false)
  const preset = keyboard.preset
  const [telemetry, setTelemetry] = useState<AircraftState | null>(null)
  const [webgl] = useState(supportsWebGL2)
  const indicators = useMemo(() => ({ stick: createRef<HTMLDivElement>(), gate: createRef<HTMLDivElement>(), hud: createRef<HudDriver>(), fps: createRef<HTMLSpanElement>() }), [])
  // Mouse settings are input only; the next command tick reads them.
  useEffect(() => { session.input.mouse = { ...controls } }, [session, controls])
  // Camera settings are saved; the scene reads the session copy on its next frame.
  useEffect(() => { session.camera = { ...camera }; session.invalidate?.() }, [session, camera])
  // The rest of Settings, mirrored the same way. A preset or binding change drops held keys.
  useEffect(() => { session.input.keyboard = keyboard; session.preset = keyboard.preset; session.input.clear(); setPointerError(false) }, [session, keyboard])
  useEffect(() => { session.cameraFov = cameraFov; session.graphics = graphics; session.reducedMotion = reducedMotion; session.invalidate?.() }, [session, cameraFov, graphics, reducedMotion])
  const surface = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null)
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
  const onTelemetry = useCallback((state: AircraftState) => { setTelemetry(state); if (!state.alive) pause() }, [pause])
  useEffect(() => {
    if (!running) { if (!dialog.current?.open) dialog.current?.showModal() }
    else { closeDialog(); setView('pause') }
  }, [running, closeDialog])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((e.target as HTMLElement)?.tagName)) return
      if (!session.running) return
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); pause(); return }
      const bound = actionForCode(session.input.keyboard.bindings, e.code)
      if (!bound) return
      e.preventDefault()
      if (bound.action === 'cameraCycle') { if (!e.repeat) { selectCamera(nextCameraSettings(session.camera)); setCameraChanged(true) }; return }
      // Look back is bound but has no camera behind it yet (Settings lists it as pending).
      if (bound.action !== 'lookBack') session.input.press(e.code, e.repeat)
    }
    const keyup = (e: KeyboardEvent) => session.input.held.delete(e.code)
    const move = (e: MouseEvent) => { if (session.running && document.pointerLockElement === surface.current && session.preset === 'mouse') session.input.move(e.movementX, e.movementY) }
    const lock = () => { session.input.clear(); if (!document.pointerLockElement && session.preset === 'mouse' && session.running) pause() }
    const hidden = () => { if (document.hidden) pause() }
    addEventListener('keydown', keydown); addEventListener('keyup', keyup); addEventListener('mousemove', move); addEventListener('blur', pause)
    document.addEventListener('pointerlockchange', lock); document.addEventListener('visibilitychange', hidden)
    return () => {
      removeEventListener('keydown', keydown); removeEventListener('keyup', keyup); removeEventListener('mousemove', move); removeEventListener('blur', pause)
      document.removeEventListener('pointerlockchange', lock); document.removeEventListener('visibilitychange', hidden)
      session.running = false; session.input.clear(); if (document.pointerLockElement === surface.current) document.exitPointerLock()
    }
  }, [pause, session])
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
  // Names the keys actually bound, so the hint stays right after a rebind.
  const controlsHint = t('controlsHint', bindingNames(keyboard.bindings))
  return <main className="flight-root" data-settings={inSettings || undefined} style={{ '--ui-scale': uiScale } as CSSProperties}>
    <div className="flight-scene" ref={surface} tabIndex={-1} aria-label={t('flightTitle')}>
      {webgl && !failed && <SceneBoundary key={`${aircraftId}-${retry}`} fallback={null} onError={onError}><Suspense fallback={null}>
        <FlightScene indicators={indicators} aircraftId={aircraftId} session={session} running={running} graphics={graphics} onReady={onReady} onTelemetry={onTelemetry} />
      </Suspense></SceneBoundary>}
    </div>
    <div className="flight-hud">
      <FlightInstruments driver={indicators.hud} />
      <div className="flight-identity"><strong>{getAircraft(aircraftId).designation}</strong><span>{t('training')} / {t('flatRange')}</span></div>
      <div className="flight-actions">{graphics.showFps && <span ref={indicators.fps} className="flight-fps" aria-hidden="true" />}<span>{t(cameraRollOption(camera.roll).labelKey)}{camera.roll === 'horizon' ? ` · ${t(horizonStyleOption(camera.horizonStyle).labelKey)}` : ''}</span><button onClick={pause}>{t('pauseFlight')} · Esc</button></div>
      <FlightSystemStatus state={telemetry} />
      <PlaygroundHud state={telemetry} practice={session.runtime?.snapshot().practice} lesson={lesson} cameraChanged={cameraChanged} lab={lab} />
      {running && warning && <p className="flight-warning" data-severity={warningSeverity(warning)} role="status">{t(warning)}</p>}
      {running && preset === 'mouse' && <div ref={indicators.gate} className="flight-stick-gate" aria-hidden="true" />}
      {running && preset === 'mouse' && <div ref={indicators.stick} className="flight-stick" aria-hidden="true">
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="36" pathLength="96" /><path d="M50 14V8M86 50H92M50 86V92M14 50H8" /></svg>
      </div>}
      {timeScale !== 1 && <p className="flight-timescale">{t('practiceSpeed')} ×{timeScale}</p>}
      <p className="flight-controls">{controlsHint}</p>
    </div>
    <dialog ref={dialog} className={inSettings ? 'flight-settings' : 'flight-menu'} aria-labelledby={inSettings ? 'settings-title' : 'flight-menu-title'} onCancel={e => e.preventDefault()}
      onClose={() => { if (closingDialog.current) closingDialog.current = false; else if (!session.running) dialog.current?.showModal() }}>
      {inSettings ? <div className="settings-scope"><SettingsPanel backLabel={t('pauseFlight')} onBack={() => setView('pause')} /></div> : <>
      <p className="flight-menu-kicker">{t('training')} / {t('flatRange')}</p>
      <h1 id="flight-menu-title">{!webgl ? t('unsupported') : failed ? t('error') : stopped ? t(telemetry.stopReason === 'boundary' ? 'boundaryReached' : 'crashed') : hasStarted ? t('pausedFlight') : t('flightReady')}</h1>
      <p>{!webgl ? t('unsupportedHint') : failed ? t('errorHint') : t('flightHelp')}</p>
      <p className="flight-baseline">{t('baseline')}</p>
      {/* Input, mouse and camera choices moved to Settings. */}
      <button className="flight-settings-open" onClick={() => setView('settings')}>{t('homeSettings')}</button>
      <label htmlFor="practice-preset">{t('practicePreset')}</label><select id="practice-preset" disabled={!ready} value={practicePreset} onChange={e => { const value = e.target.value as PracticePreset; setPracticePreset(value); resetFlight(value) }}>{(Object.keys(practiceSpawns) as PracticePreset[]).map(id => <option key={id} value={id}>{t(`spawn_${id}`)}</option>)}</select>
      <label htmlFor="practice-lesson">{t('practiceLesson')}</label><select id="practice-lesson" disabled={!ready} value={lesson} onChange={e => { const value = Number(e.target.value); setLesson(value); const spawn: PracticePreset = value === 6 ? 'cobra' : value === 5 ? 'recovery' : value === 4 ? 'highG' : 'free'; setPracticePreset(spawn); resetFlight(spawn) }}>{[0, 1, 2, 3, 4, 5, 6].map(id => <option key={id} value={id}>{t(lessonLabels[id])}</option>)}</select>
      <details className="flight-lab-settings"><summary>{t('flightLab')}</summary>
        <label htmlFor="validation-aircraft">{t('labAircraft')}</label><select id="validation-aircraft" value={aircraftId} onChange={e => { pause(); setReady(false); setHasStarted(false); setFailed(false); setTelemetry(null); setPracticePreset('free'); setAircraftId(e.target.value) }}>{playgroundAircraft.map(entry => <option key={entry.id} value={entry.id}>{entry.designation} · {entry.name}</option>)}</select>
        <label htmlFor="practice-speed">{t('practiceSpeed')}</label><select id="practice-speed" value={timeScale} onChange={e => { session.timeScale = Number(e.target.value); setTimeScale(session.timeScale) }}>{[1, 0.5, 0.25].map(value => <option key={value} value={value}>×{value}</option>)}</select>
        <label><input type="checkbox" checked={lab} onChange={e => setLab(e.target.checked)} /> {t('showTelemetry')}</label>
        <button disabled={!ready || !!stopped} onClick={() => { session.runtime?.singleStep(); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null); session.invalidate?.() }}>{t('singleStep')}</button>
        <button disabled={!ready} onClick={exportFlight}>{t('exportFlight')}</button><p>{t('exportFlightHint')}</p>
      </details>
      <p className="flight-instructions">{controlsHint}</p>
      {preset === 'mouse' && <details className="flight-mouse-help"><summary>{t('mousePreset')}</summary><p>{t(controls.mode === 'relative' ? 'mouseHintRelative' : 'mouseHint')}</p><p>{t('mouseTips')}</p></details>}
      <details className="flight-mouse-help"><summary>{t('psmControlsHelp')}</summary><p>{t('psmControlsDetail')}</p></details>
      {pointerError && <p role="alert">{t('pointerError')}</p>}
      {failed ? <button className="flight-primary" onClick={() => { retryAircraftAsset(modelUrl(getAircraft(aircraftId))); setReady(false); setFailed(false); setRetry(x => x + 1) }}>{t('retry')}</button>
        : <button className="flight-primary" disabled={!ready || !webgl || !!stopped} onClick={() => void begin()}>{!ready && webgl ? t('flightLoading') : hasStarted ? t('resumeFlight') : t('beginFlight')}</button>}
      {ready && <button onClick={() => resetFlight()}>{t('resetFlight')}</button>}
      <a href={routes[flightReturnRoute()]} onClick={pause}>{t('leaveFlight')}</a>
      </>}
    </dialog>
  </main>
}
