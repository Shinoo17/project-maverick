/* Training extends the aircraft-first instrument language: full viewport range,
   compact telemetry at top left, visible aircraft in chase view, controls below.
   A modal briefing/pause dialog (PauseMenu.tsx) owns the sortie setup (aircraft, map,
   opponent, spawn), launch, restart and exit, over the blurred paused flight; its
   SETTINGS tile swaps the dialog to the shared Settings panel (same component as
   #/settings). The dialog is modal, so Settings must live inside it. */
import { createRef, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { selectAircraft, selectCamera, selectControls, selectKeyboard, useSessionSettings } from '../../app/sessionStore'
import { cameraModeOption, nextCameraSettings } from '../../game/camera/cameraSettings'
import { actionForCode, type FlightAction } from '../../game/input/keyBindings'
import { useReducedMotion, useUiScale } from '../menu/hooks'
import { SettingsPanel } from '../settings/SettingsPanel'
import { bindingNames } from '../settings/KeyPrompt'
import { flightReturnRoute, routes } from '../../app/routes'
import { aircraft as roster, getAircraft, modelUrl, playgroundAircraft } from '../../content/aircraft'
import { defaultFlightMapId, getMap } from '../../content/maps'
import { defaultBotSetup, type BotLoadout } from '../../game/bot/botSetup'
import { FlightInput } from '../../game/input/FlightInput'
import { MOUSE } from '../../game/control/config'
import { FlightInstruments, FlightSystemStatus, type HudDriver } from './FlightInstruments'
import type { AircraftState } from '../../game/state/WorldState'
import { SceneBoundary } from '../../ui/components/SceneBoundary'
import { supportsWebGL2 } from '../../platform/webgl'
import { retryAircraftAsset } from '../../render/aircraft/assetLoader'
import type { CameraRigId, FlightSession } from './session'
import { PlaygroundHud } from './PlaygroundHud'
import { PauseMenu, type BotChoice, type DroneChoice } from './PauseMenu'
import { RadarScope, type RadarDriver } from './RadarScope'
import { RwrScope, type RwrDriver } from './RwrScope'
import { WeaponPanel, type SlotRefusal } from './WeaponPanel'
import { pressedSlot, weaponSlots } from './weaponSlots'
import { flightWarning, holdWarning, warningSeverity, type HeldWarning } from './telemetry'
import { practiceSpawns, targetDrone as droneSpawn, type PracticePreset } from '../../game/playground/practice'
import { arcadeSpawnSpeeds } from '../../game/arcadeCore/step'
import type { TargetDroneMode } from '../../game/playground/dronePath'
import { flightCoreAvailable, flightCoreIds, type FlightCoreId } from '../../game/flight/core'
import type { CoreTuning } from '../../game/flightCore/profile'
import { CoreTuningPanel } from './CoreFlightLab'
import { setCoreTuning } from './coreTuning'
import { CameraTrace } from '../../render/cameraTrace'
import './flight.css'

/*
Takes the pointer with the system's pointer acceleration off where the browser can (raw counts,
as example/flight-control's MouseInput asks): the same travel of the hand is then the same turn of
the aim whether the hand moves fast or slowly, which is what makes a flick repeatable. A browser
that does not know the option locks the ordinary way.
*/
function lockPointer(element: Element): Promise<void> | void {
  const ask = (options?: { unadjustedMovement: boolean }) => (element.requestPointerLock as (options?: { unadjustedMovement: boolean }) => Promise<void> | void).call(element, options)
  const request = ask({ unadjustedMovement: true })
  return request?.catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'NotSupportedError') return ask()
    throw error
  })
}
const FlightScene = lazy(() => import('../../render/FlightScene'))
// Menu title for each way a flight can stop.
const stopTitle = { weapon: 'shotDown', terrain: 'crashed', boundary: 'boundaryReached' } as const
export function FlightPage() {
  const { t } = useTranslation()
  const { aircraftId: selectedAircraftId, controls, camera, cameraFov, keyboard, graphics, audio, locale } = useSessionSettings()
  const reducedMotion = useReducedMotion(), uiScale = useUiScale()
  const [aircraftId, setAircraftId] = useState(selectedAircraftId)
  const session = useMemo<FlightSession>(() => ({ runtime: null, input: new FlightInput(controls, keyboard), preset: keyboard.preset, camera: { ...camera }, cameraFov, graphics, running: false, targetDrone: null, bot: { ...defaultBotSetup }, flightCore: 'arcade', cameraRig: 'arcade', coreTuning: {}, cameraTrace: null, resetId: 0, timeScale: 1, reducedMotion }), [])
  const [practicePreset, setPracticePreset] = useState<PracticePreset>('free')
  const [lab, setLab] = useState(false), [cameraChanged, setCameraChanged] = useState(false)
  const [timeScale, setTimeScale] = useState(1)
  const [mapId, setMapId] = useState(defaultFlightMapId)
  // The opponent slot: a target drone or the combat bot, never both (one drone entity in the runtime).
  const [drone, setDrone] = useState<DroneChoice>('off'), [bot, setBot] = useState<BotChoice>('off'), [loadout, setLoadout] = useState<BotLoadout>(defaultBotSetup.loadout)
  const targetDrone: TargetDroneMode | null = bot !== 'off' ? 'bot' : drone === 'off' ? null : drone
  const [flightCore, setFlightCore] = useState<FlightCoreId>('arcade'), [tracing, setTracing] = useState(false)
  const [cameraRig, setCameraRig] = useState<CameraRigId>('arcade')
  const [coreTuning, setTuning] = useState<CoreTuning>({})
  const [view, setView] = useState<'pause' | 'settings'>('pause')
  // Presses the aircraft refuses, by weapon slot (weaponSlots.ts): each plays on the card it was
  // made on, whatever is selected after, with a tone: a wait or no lock (the card shakes, a low
  // knock) or empty (EMPTY flashes red, two flat beeps). Read from the live world, not the 10 Hz
  // telemetry, so a press just as a wait ends is never refused on screen while the shot goes out.
  const [refusals, setRefusals] = useState<Record<string, SlotRefusal>>({})
  const refuseIfBlocked = useCallback((action: FlightAction) => {
    const world = session.runtime?.snapshot(), state = world?.aircraft[0]
    if (!world || !state?.alive) return
    const slot = pressedSlot(weaponSlots(state.aircraftId, state, world.tick), action), reason = slot?.blocked
    if (!slot || !reason) return
    setRefusals(last => ({ ...last, [slot.id]: { count: (last[slot.id]?.count ?? 0) + 1, reason } }))
    session.refused?.(reason === 'empty' ? 'empty' : 'wait')
  }, [session])
  const [telemetryTick, setTelemetryTick] = useState<number | undefined>(undefined)
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
  const onTelemetry = useCallback((state: AircraftState, tick: number) => { setTelemetry(state); setTelemetryTick(tick) }, [])
  // Shot down, the flight runs on while the wreck falls; the scene calls this once it is down.
  const onDown = useCallback(() => pause(), [pause])
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
      // G: Aim limited ↔ Aim free (example/flight-control). Saved with the mouse settings.
      if (bound.action === 'aimLimit') { if (!e.repeat) selectControls({ aimLimit: session.input.mouse.aimLimit === 'limited' ? 'free' : 'limited' }); return }
      // M: Mouse + Keyboard ↔ Keyboard only, in flight. Keyboard only lets the pointer go and keeps
      // flying; Mouse + Keyboard takes the pointer (a key press is a user gesture) or pauses if refused.
      if (bound.action === 'inputMode') { if (!e.repeat) switchPreset(session.preset === 'mouse' ? 'keyboard' : 'mouse'); return }
      if ((bound.action === 'fireGun' || bound.action === 'fireMissile' || bound.action === 'countermeasure') && !e.repeat) refuseIfBlocked(bound.action)
      session.input.press(e.code, e.repeat)
    }
    const switchPreset = (next: 'mouse' | 'keyboard') => {
      session.preset = next
      selectKeyboard({ preset: next })
      if (next === 'keyboard') { if (document.pointerLockElement === surface.current) document.exitPointerLock(); return }
      try { const request = surface.current ? lockPointer(surface.current) : undefined; request?.then(() => session.input.engage(), pause) } catch { pause() }
    }
    const keyup = (e: KeyboardEvent) => session.input.held.delete(e.code)
    // The keyboard preset has no pointer lock, but free look still turns the camera with the mouse.
    // A delta past MOUSE.maxEventDelta is a pointer-lock glitch, not the hand (as the example's MouseInput drops it): it would throw the aim tens of degrees.
    const move = (e: MouseEvent) => { if (Math.abs(e.movementX) > MOUSE.maxEventDelta || Math.abs(e.movementY) > MOUSE.maxEventDelta) return; if (session.running && (document.pointerLockElement === surface.current && session.preset === 'mouse' || session.preset === 'keyboard' && session.input.holds('freeLook'))) session.input.move(e.movementX, e.movementY) }
    // Only a press made while already locked fires: the click that takes the lock never does (doc 02).
    const mousedown = (e: MouseEvent) => {
      if (!session.running || document.pointerLockElement !== surface.current || session.preset !== 'mouse') return
      if (e.button === 0) { session.input.mouseGun = true; refuseIfBlocked('fireGun') }
      // Right button: launch the selected missile (weapon panel rules).
      if (e.button === 2) { session.input.pressLaunch(); refuseIfBlocked('fireMissile') }
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
  }, [pause, session, refuseIfBlocked])
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
          try { const request = lockPointer(surface.current!); request?.catch(denied) } catch { denied() }
        })
      }
      if (session.preset === 'mouse') session.input.engage()
      session.running = true; session.runtime?.resume(); setRunning(true); setHasStarted(true); surface.current?.focus()
    } catch (error) { if (import.meta.env.DEV) console.warn('Flight pointer lock:', error); setPointerError(true); dialog.current?.showModal() }
  }
  function resetFlight(nextPreset: PracticePreset = practicePreset) {
    pause(); setHasStarted(false); session.resetId++; session.runtime?.reset(nextPreset); setCameraChanged(false); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null); session.invalidate?.()
  }
  /** After a death: a fresh flight, flying at once. */
  function respawn() { resetFlight(); void begin() }
  /** Sets the opponent slot and restarts the flight. Choosing the bot turns the drone off, and the other way round. */
  function chooseOpponent(nextDrone: DroneChoice, nextBot: BotChoice, nextLoadout: BotLoadout) {
    setDrone(nextDrone); setBot(nextBot); setLoadout(nextLoadout)
    const mode: TargetDroneMode | null = nextBot !== 'off' ? 'bot' : nextDrone === 'off' ? null : nextDrone
    session.targetDrone = mode
    session.bot = { difficulty: nextBot === 'off' ? defaultBotSetup.difficulty : nextBot, loadout: nextLoadout }
    session.runtime?.setTargetDrone(mode, session.bot); resetFlight()
  }
  /** The scene builds a new runtime for another aircraft, map or flight core: back to a fresh briefing meanwhile. */
  function rebuild() { pause(); setReady(false); setHasStarted(false); setFailed(false); setTelemetry(null); setPracticePreset('free'); session.resetId++ }
  function chooseAircraft(id: string) {
    if (id === aircraftId) return
    rebuild(); setAircraftId(id)
    // A roster aircraft becomes the active one everywhere (Home, Hangar); a Flight Lab variant does not.
    if (roster.some(entry => entry.id === id)) selectAircraft(id)
  }
  function chooseMap(id: string) { if (id !== mapId) { rebuild(); setMapId(id) } }
  function download(data: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = name; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function exportFlight() {
    const replay = session.runtime?.exportReplay()
    if (replay) download(replay, 'maverick-flight-p3.json')
  }
  // CAMERA_TRACE: recording starts empty each time it is switched on; the export keeps the frames.
  function traceCamera(on: boolean) { session.cameraTrace = on ? new CameraTrace() : null; setTracing(on) }
  function exportCameraTrace() { if (session.cameraTrace) download(session.cameraTrace, 'maverick-camera-trace.json') }
  const stopped = telemetry && !telemetry.alive
  heldWarning.current = holdWarning(heldWarning.current, flightWarning(telemetry), performance.now())
  const warning = heldWarning.current.warning
  const inSettings = view === 'settings'
  // The title's tone: a stopped or failed flight reads as failure.
  const briefState = !webgl || failed || stopped ? 'stopped' : hasStarted ? 'paused' : 'ready'
  const mapName = getMap(mapId).name[locale]
  // What flies against the player, for the line that stays on screen in flight.
  const opponentLabel = bot !== 'off' ? `${t('combatBot')} · ${t(`botLevel_${bot}`)} · ${t(`botLoadout_${loadout}`)}` : drone !== 'off' ? `${t('targetDrone')} · ${t(`drone_${drone}`)}` : null
  // Names the keys actually bound, so the hint stays right after a rebind.
  const controlsHint = t('controlsHint', bindingNames(keyboard.bindings))
  return <main className="flight-root" data-settings={inSettings || undefined} style={{ '--ui-scale': uiScale } as CSSProperties}>
    <div className="flight-scene" ref={surface} tabIndex={-1} aria-label={t('flightTitle')}>
      {webgl && !failed && <SceneBoundary key={`${aircraftId}-${retry}`} fallback={null} onError={onError}><Suspense fallback={null}>
        <FlightScene indicators={indicators} aircraftId={aircraftId} mapId={mapId} flightCore={flightCore} session={session} running={running} targetDrone={targetDrone !== null} graphics={graphics} audio={audio} onReady={onReady} onTelemetry={onTelemetry} onDown={onDown} />
      </Suspense></SceneBoundary>}
    </div>
    <div className="flight-hud">
      <FlightInstruments driver={indicators.hud} />
      <RadarScope driver={indicators.radar} />
      <RwrScope driver={indicators.rwr} />
      <div className="flight-identity"><strong>{getAircraft(aircraftId).designation}</strong><span>{t('training')} / {mapName}</span></div>
      <div className="flight-actions">{graphics.showFps && <span ref={indicators.fps} className="flight-fps" aria-hidden="true" />}<span>{t(cameraModeOption(camera.mode).labelKey)}</span><button onClick={pause}>{t('pauseFlight')} · Esc</button></div>
      <FlightSystemStatus state={telemetry} />
      {/* The Flight Lab readout takes the same corner, so the column steps aside while it is open. */}
      {!lab && <WeaponPanel aircraftId={aircraftId} state={telemetry} tick={telemetryTick} refusals={refusals} preset={preset} bindings={keyboard.bindings} reducedMotion={reducedMotion} />}
      <PlaygroundHud state={telemetry} practice={session.runtime?.snapshot().practice} lesson={0} cameraChanged={cameraChanged} lab={lab} input={session.input} />
      {running && warning && <p className="flight-warning" data-severity={warningSeverity(warning)} role="status">{t(warning)}</p>}
      {/* The PSM virtual stick (Space + mouse): shown by the scene only while the mouse flies it. */}
      {running && preset === 'mouse' && <div ref={indicators.stick} className="flight-stick" aria-hidden="true" hidden>
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="36" pathLength="96" /><path d="M50 14V8M86 50H92M50 86V92M14 50H8" /></svg>
      </div>}
      {/* Active practice modifiers stay on screen while flying (docs/game-design/10-playground.md). */}
      {(timeScale !== 1 || opponentLabel) && <p className="flight-timescale">{[timeScale !== 1 && `${t('practiceSpeed')} ×${timeScale}`, opponentLabel].filter(Boolean).join(' · ')}</p>}
      <p className="flight-controls">{controlsHint}</p>
    </div>
    <dialog ref={dialog} className={inSettings ? 'flight-settings' : 'flight-menu'} aria-labelledby={inSettings ? 'settings-title' : 'flight-menu-title'} onCancel={e => e.preventDefault()}
      onClose={() => { if (closingDialog.current) closingDialog.current = false; else if (!session.running) dialog.current?.showModal() }}>
      {inSettings ? <div className="settings-scope"><SettingsPanel backLabel={t('pauseFlight')} onBack={() => setView('pause')} /></div> : <PauseMenu
        state={briefState}
        title={!webgl ? t('unsupported') : failed ? t('error') : stopped ? t(stopTitle[telemetry.stopReason ?? 'terrain']) : hasStarted ? t('pausedFlight') : t('flightReady')}
        lede={!webgl ? t('unsupportedHint') : failed ? t('errorHint') : undefined}
        ready={ready} pointerError={pointerError}
        launch={failed
          ? { ref: launch, retry: true, disabled: false, label: t('retry'), onClick: () => { retryAircraftAsset(modelUrl(getAircraft(aircraftId))); if (targetDrone) retryAircraftAsset(modelUrl(getAircraft(droneSpawn.aircraftId))); setReady(false); setFailed(false); setRetry(x => x + 1) } }
          : { ref: launch, retry: false, disabled: !ready || !webgl, label: !ready && webgl ? t('flightLoading') : stopped ? t('respawn') : hasStarted ? t('resumeFlight') : t('beginFlight'), onClick: () => stopped ? respawn() : void begin() }}
        onRestart={() => resetFlight()} onSettings={() => setView('settings')} leaveHref={routes[flightReturnRoute()]} onLeave={pause}
        aircraftId={aircraftId} onAircraft={chooseAircraft} mapId={mapId} onMap={chooseMap}
        drone={drone} onDrone={value => chooseOpponent(value, value === 'off' ? bot : 'off', loadout)}
        bot={bot} onBot={value => chooseOpponent(value === 'off' ? drone : 'off', value, loadout)}
        loadout={loadout} onLoadout={value => chooseOpponent(drone, bot, value)}
        spawn={practicePreset} onSpawn={value => { setPracticePreset(value as PracticePreset); resetFlight(value as PracticePreset) }}
        spawnOptions={(Object.keys(practiceSpawns) as PracticePreset[]).map(id => { const [name, detail] = t(`spawn_${id}`).split(' · '); return { value: id, name, detail: flightCore === 'arcade' ? detail.replace(/\d+ m\/s/, `${Math.round(arcadeSpawnSpeeds[id])} m/s`) : detail } })}>
        {/* Developer tools: the LAB drawer, not part of the sortie setup. */}
        <>
          <div className="flight-lab-grid">
            <label htmlFor="validation-aircraft">{t('labAircraft')}</label><select id="validation-aircraft" value={aircraftId} onChange={e => chooseAircraft(e.target.value)}>{playgroundAircraft.map(entry => <option key={entry.id} value={entry.id}>{entry.designation} · {entry.name}</option>)}</select>
            <label htmlFor="flight-core">{t('labFlightCore')}</label><select id="flight-core" value={flightCore} onChange={e => { rebuild(); session.flightCore = e.target.value as FlightCoreId; setFlightCore(session.flightCore) }}>{flightCoreIds.map(id => <option key={id} value={id} disabled={!flightCoreAvailable(id)}>{t(`flightCore_${id}`)}</option>)}</select>
            <label htmlFor="camera-rig">{t('labCameraRig')}</label><select id="camera-rig" value={cameraRig} onChange={e => { session.cameraRig = e.target.value as CameraRigId; setCameraRig(session.cameraRig); session.invalidate?.() }}>{(['arcade', 'chase', 'legacy'] as const).map(id => <option key={id} value={id}>{t(`cameraRig_${id}`)}</option>)}</select>
            <label htmlFor="practice-speed">{t('practiceSpeed')}</label><select id="practice-speed" value={timeScale} onChange={e => { session.timeScale = Number(e.target.value); setTimeScale(session.timeScale) }}>{[1, 0.5, 0.25].map(value => <option key={value} value={value}>×{value}</option>)}</select>
          </div>
          <label className="flight-lab-check"><input type="checkbox" checked={lab} onChange={e => setLab(e.target.checked)} /> {t('showTelemetry')}</label>
          <label className="flight-lab-check"><input type="checkbox" checked={tracing} onChange={e => traceCamera(e.target.checked)} /> {t('labCameraTrace')}</label>
          <div className="flight-lab-actions">
            <button disabled={!ready || !!stopped} onClick={() => { session.runtime?.singleStep(); setTelemetry(session.runtime?.snapshot().aircraft[0] ?? null); session.invalidate?.() }}>{t('singleStep')}</button>
            <button disabled={!ready} onClick={exportFlight}>{t('exportFlight')}</button>
            <button disabled={!tracing} onClick={exportCameraTrace}>{t('exportCameraTrace')}</button>
          </div>
          <p>{t('exportFlightHint')}</p>
          <p>{t('cameraTraceHint')}</p>
          {flightCore === 'new' && <CoreTuningPanel aircraftId={aircraftId} tuning={coreTuning} apply={next => { setCoreTuning(session, aircraftId, next); setTuning(session.coreTuning) }} />}
        </>
      </PauseMenu>}
    </dialog>
  </main>
}
