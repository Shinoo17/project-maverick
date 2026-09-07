/* Training extends the aircraft-first instrument language: full viewport range,
   compact telemetry at top left, visible aircraft in chase view, controls below.
   A focused briefing/pause dialog owns setup, launch, reset and return. */
import { createRef, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import { getAircraft, modelUrl } from '../../content/aircraft'
import { FlightInput } from '../../game/input/FlightInput'
import { arcadeSpeed } from '../../game/flight/speed'
import type { AircraftState } from '../../game/state/WorldState'
import { SceneBoundary } from '../../ui/components/SceneBoundary'
import { supportsWebGL2 } from '../../platform/webgl'
import { retryAircraftAsset } from '../../render/aircraft/assetLoader'
import type { FlightSession } from './session'
import { PlaygroundHud, lessonLabels } from './PlaygroundHud'
import { practiceSpawns, type PracticePreset } from '../../game/playground/practice'
import './flight.css'
const FlightScene = lazy(() => import('../../render/FlightScene'))
export function FlightPage() {
  const { t } = useTranslation()
  const { aircraftId, locale } = useSessionSettings()
  const session = useMemo<FlightSession>(() => ({ runtime: null, input: new FlightInput(), preset: 'mouse', cameraMode: 'horizon', running: false, resetId: 0, timeScale: 1, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }), [])
  const [practicePreset, setPracticePreset] = useState<PracticePreset>('free')
  const [lesson, setLesson] = useState(0), [lab, setLab] = useState(false), [cameraChanged, setCameraChanged] = useState(false)
  const [timeScale, setTimeScale] = useState(1), [reducedMotion, setReducedMotion] = useState(session.reducedMotion)
  const [hasStarted, setHasStarted] = useState(false)
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false), [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0), [pointerError, setPointerError] = useState(false)
  const [preset, setPreset] = useState(session.preset), [cameraMode, setCameraMode] = useState(session.cameraMode)
  const [telemetry, setTelemetry] = useState<AircraftState | null>(null)
  const [webgl] = useState(supportsWebGL2)
  const indicators = useMemo(() => ({ nose: createRef<HTMLDivElement>(), path: createRef<HTMLDivElement>(), stick: createRef<HTMLDivElement>() }), [])
  const surface = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null)
  const pause = useCallback(() => {
    session.running = false; session.runtime?.pause(); session.input.clear(); setRunning(false)
    if (document.pointerLockElement) document.exitPointerLock()
  }, [session])
  const onReady = useCallback(() => setReady(true), [])
  const onError = useCallback(() => { setFailed(true); pause() }, [pause])
  const onTelemetry = useCallback((state: AircraftState) => { setTelemetry(state); if (!state.alive) pause() }, [pause])
  useEffect(() => {
    if (!running) { if (!dialog.current?.open) dialog.current?.showModal() }
    else dialog.current?.close()
  }, [running])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((e.target as HTMLElement)?.tagName)) return
      if (!session.running) return
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); pause(); return }
      if (e.code === 'KeyR' && !e.repeat) { e.preventDefault(); session.input.clear(); if (session.preset === 'mouse') session.input.engage(); session.resetId++; session.runtime?.reset(); setCameraChanged(false); return }
      if (e.code === 'KeyV') { if (!e.repeat) { session.cameraMode = session.cameraMode === 'horizon' ? 'aircraft' : 'horizon'; setCameraMode(session.cameraMode); setCameraChanged(true) }; return }
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyX', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); session.input.press(e.code) }
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
    dialog.current?.close()
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
    pause(); setHasStarted(false); session.resetId++; session.runtime?.reset(nextPreset); setCameraChanged(false); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null)
  }
  function exportFlight() {
    const replay = session.runtime?.exportReplay()
    if (!replay) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'maverick-flight-p2.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const speed = telemetry ? Math.hypot(telemetry.velocity.x, telemetry.velocity.y, telemetry.velocity.z) : 130
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
  const stopped = telemetry && !telemetry.alive
  return <main className="flight-root">
    <div className="flight-scene" ref={surface} tabIndex={-1} aria-label={t('flightTitle')}>
      {webgl && !failed && <SceneBoundary key={retry} fallback={null} onError={onError}><Suspense fallback={null}>
        <FlightScene indicators={indicators} aircraftId={aircraftId} session={session} onReady={onReady} onTelemetry={onTelemetry} />
      </Suspense></SceneBoundary>}
    </div>
    <div className="flight-hud">
      <div className="flight-identity"><strong>{getAircraft(aircraftId).designation}</strong><span>{t('training')} / {t('flatRange')}</span></div>
      <dl className="flight-telemetry">
        <div><dt>{t('actualSpeed')}</dt><dd>{number(arcadeSpeed(speed))}<small>{t('arcadeUnit')}</small></dd></div>
        <div><dt>{t('altitude')}</dt><dd>{number(telemetry?.position.y ?? 400)}<small>{t('metres')}</small></dd></div>
      </dl>
      <div className="flight-actions"><span>{t(cameraMode === 'horizon' ? 'horizonCamera' : 'aircraftCamera')}</span><button onClick={pause}>{t('pauseFlight')} · Esc</button></div>
      {running && telemetry && <p className="flight-warning" role="status">{Math.hypot(telemetry.position.x, telemetry.position.z) > 6500 || telemetry.position.y > 6500 ? t('boundaryWarning') : telemetry.position.y < 100 ? t('lowAltitude') : ''}</p>}
      <div ref={indicators.nose} className="flight-reticle" aria-hidden="true">+</div>
      <div ref={indicators.path} className="flight-path" aria-hidden="true">◇</div>
      {running && preset === 'mouse' && <div ref={indicators.stick} className="flight-stick" aria-hidden="true" />}
      <PlaygroundHud state={telemetry} practice={session.runtime?.snapshot().practice} lesson={lesson} cameraChanged={cameraChanged} lab={lab} />
      {timeScale !== 1 && <p className="flight-timescale">{t('practiceSpeed')} ×{timeScale}</p>}
      <p className="flight-controls">{t('controlsHint')}</p>
    </div>
    <dialog ref={dialog} className="flight-menu" aria-labelledby="flight-menu-title" onCancel={e => e.preventDefault()}>
      <p className="flight-menu-kicker">{t('training')} / {t('flatRange')}</p>
      <h1 id="flight-menu-title">{!webgl ? t('unsupported') : failed ? t('error') : stopped ? t(telemetry.stopReason === 'boundary' ? 'boundaryReached' : 'crashed') : hasStarted ? t('pausedFlight') : t('flightReady')}</h1>
      <p>{!webgl ? t('unsupportedHint') : failed ? t('errorHint') : t('flightHelp')}</p>
      <p className="flight-baseline">{t('baseline')}</p>
      <label htmlFor="flight-input">{t('inputPreset')}</label><select id="flight-input" value={preset} onChange={e => { session.preset = e.target.value as typeof preset; setPreset(session.preset); session.input.clear(); setPointerError(false) }}><option value="mouse">{t('mousePreset')}</option><option value="keyboard">{t('keyboardPreset')}</option></select>
      <label htmlFor="flight-camera">{t('camera')}</label><select id="flight-camera" value={cameraMode} onChange={e => { session.cameraMode = e.target.value as typeof cameraMode; setCameraMode(session.cameraMode) }}><option value="horizon">{t('horizonCamera')}</option><option value="aircraft">{t('aircraftCamera')}</option></select>
      <label htmlFor="practice-preset">{t('practicePreset')}</label><select id="practice-preset" disabled={!ready} value={practicePreset} onChange={e => { const value = e.target.value as PracticePreset; setPracticePreset(value); resetFlight(value) }}>{(Object.keys(practiceSpawns) as PracticePreset[]).map(id => <option key={id} value={id}>{t(`spawn_${id}`)}</option>)}</select>
      <label htmlFor="practice-lesson">{t('practiceLesson')}</label><select id="practice-lesson" disabled={!ready} value={lesson} onChange={e => { const value = Number(e.target.value); setLesson(value); const spawn: PracticePreset = value === 6 ? 'cobra' : value === 5 ? 'recovery' : value === 4 ? 'highG' : 'free'; setPracticePreset(spawn); resetFlight(spawn) }}>{[0, 1, 2, 3, 4, 5, 6].map(id => <option key={id} value={id}>{t(lessonLabels[id])}</option>)}</select>
      <details className="flight-lab-settings"><summary>{t('flightLab')}</summary>
        <label htmlFor="practice-speed">{t('practiceSpeed')}</label><select id="practice-speed" value={timeScale} onChange={e => { session.timeScale = Number(e.target.value); setTimeScale(session.timeScale) }}>{[1, 0.5, 0.25].map(value => <option key={value} value={value}>×{value}</option>)}</select>
        <label><input type="checkbox" checked={lab} onChange={e => setLab(e.target.checked)} /> {t('showTelemetry')}</label>
        <label><input type="checkbox" checked={reducedMotion} onChange={e => { session.reducedMotion = e.target.checked; setReducedMotion(e.target.checked) }} /> {t('reducedFlightMotion')}</label>
        <button disabled={!ready || !!stopped} onClick={() => { session.runtime?.singleStep(); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null) }}>{t('singleStep')}</button>
        <button disabled={!ready} onClick={exportFlight}>{t('exportFlight')}</button><p>{t('exportFlightHint')}</p>
      </details>
      <p className="flight-instructions">{t('controlsHint')}</p>
      {preset === 'mouse' && <details className="flight-mouse-help"><summary>{t('mousePreset')}</summary><p>{t('mouseHint')}</p></details>}
      <details className="flight-mouse-help"><summary>{t('psmControlsHelp')}</summary><p>{t('psmControlsDetail')}</p></details>
      {pointerError && <p role="alert">{t('pointerError')}</p>}
      {failed ? <button className="flight-primary" onClick={() => { retryAircraftAsset(modelUrl(getAircraft(aircraftId))); setReady(false); setFailed(false); setRetry(x => x + 1) }}>{t('retry')}</button>
        : <button className="flight-primary" disabled={!ready || !webgl || !!stopped} onClick={() => void begin()}>{!ready && webgl ? t('flightLoading') : hasStarted ? t('resumeFlight') : t('beginFlight')}</button>}
      {ready && <button onClick={() => resetFlight()}>{t('resetFlight')}</button>}
      <a href="#/" onClick={pause}>{t('backHangar')}</a>
    </dialog>
  </main>
}
