import type { FlightCoreId } from '../game/flight/core'
import { memo, Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Box3, Group, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { AssetLoaderProvider, useAircraftAsset } from './aircraft/assetLoader'
import { buildFlightModel } from './aircraft/flightModel'
import { applyEnvironment, createSkyEnvironment } from './aircraft/skyEnvironment'
import { DroneWrecks, TargetDrone } from './TargetDrone'
import { createCombatEffects } from './vfx/combatEffects'
import { HitboxWireframe } from './HitboxWireframe'
import { createTracers } from './tracers'
import { between, createGunnery } from './gunneryFrame'
import { radarFrame } from './radarFrame'
import { createLockFrame } from './lockFrame'
import { createLockTone } from './lockTone'
import { createAudioMixer } from './audio/mixer'
import { createFlightSound } from './audio/flightSound'
import { MissileModels, placeMissiles, type MissilePool } from './MissileModels'
import { distanceScale, zoomShare } from './targetVisibility'
import { aimAssist, withAimAssist } from '../game/combat/aimAssist'
import { createGunLock, releaseGunLock, stepGunLock, trackGoal } from '../game/combat/gunLock'
import { cursorRay } from '../game/control/Instructor'
import { gunMountOf } from '../game/combat/gunSolution'
import { getAircraft, modelUrl } from '../content/aircraft'
import type { AircraftId } from '../content/schemas'
import { GameRuntime } from '../game/runtime/GameRuntime'
import type { AircraftState, Vec3, WorldState } from '../game/state/WorldState'
import type { FlightSession } from '../features/flight/session'
import { FlightCamera } from './FlightCamera'
import { ChaseCamera } from './ChaseCamera'
import type { CameraRig } from './cameraRig'
import { WORLD_STEP } from '../game/runtime/clock'
import { ArcadeCamera } from './ArcadeCamera'
import { MapEnvironment } from './maps/MapEnvironment'
import { FlightEffects } from './FlightEffects'
import { createFlightRig } from './aircraft/flightRig'
import { createBayDoors, type BayDoors } from './aircraft/bayDoors'
import type { HudDriver } from '../features/flight/FlightInstruments'
import type { RadarDriver } from '../features/flight/RadarScope'
import type { RwrDriver } from '../features/flight/RwrScope'
import { createRwrFrame } from './rwrFrame'
import { canvasDpr, type GraphicsSettings } from './graphicsSettings'
import type { AudioSettings } from './audio/audioSettings'
import { applyCoreTuning } from '../features/flight/coreTuning'

export type FlightIndicators = { stick: RefObject<HTMLDivElement | null>; gate?: RefObject<HTMLDivElement | null>; hud: RefObject<HudDriver | null>; radar?: RefObject<RadarDriver | null>; rwr?: RefObject<RwrDriver | null>; fps?: RefObject<HTMLElement | null> }
interface Props { indicators: FlightIndicators; aircraftId: AircraftId; mapId: string; flightCore: FlightCoreId; session: FlightSession; running: boolean; targetDrone: boolean; graphics: GraphicsSettings; audio: AudioSettings; onReady: () => void; onTelemetry: (state: AircraftState, tick: number) => void; onDown: () => void }
/** Simulation seconds the player's wreck lies burning on the ground before the menu comes up. */
const DOWN_SETTLE = 1.5
function FlightWorld({ aircraftId, mapId, flightCore, session, running, targetDrone, audio, onReady, onTelemetry, onDown, indicators }: Props) {
  const definition = getAircraft(aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  // The chase camera ported from example/flight-control (ArcadeCamera) flies every core. Flight Lab
  // can still pick the FR2 rewrite camera or the legacy one for comparison. `?driftCamera` (the
  // fixed diagnostic view) is the legacy rig's.
  const diagnosticView = useMemo(() => new URLSearchParams(window.location.search).has('driftCamera'), [])
  const legacyRig = useMemo(() => new FlightCamera(diagnosticView), [diagnosticView])
  const chaseRig = useMemo(() => new ChaseCamera(), [])
  const arcadeRig = useMemo(() => new ArcadeCamera(), [])
  // The chase shot without shake or free look, which the mouse aims through.
  const steadyView = useMemo(() => new PerspectiveCamera(), [])
  const activeRig = useRef<CameraRig | null>(null)
  const showHitboxes = useMemo(() => new URLSearchParams(window.location.search).has('hitboxes'), [])
  // The latest whole-world snapshot, for views of other entities (the target drone).
  const world = useRef<WorldState | null>(null)
  // The snapshot before the last tick, for drawing the drone between ticks like the player.
  const previousWorld = useRef<WorldState | null>(null)
  // The last tick's hit points by round id, for tracers of rounds removed on that tick.
  const endedHits = useRef<{ tick: number; points: Map<number, Vec3> }>({ tick: -1, points: new Map() })
  const drone = useRef<Group>(null), droneModel = useRef<Group>(null)
  const missilePool = useRef<MissilePool | null>(null)
  const takeSnapshot = (runtime: GameRuntime) => { world.current = runtime.snapshot(); return world.current.aircraft[0] }
  const group = useRef<Group>(null)
  const elapsed = useRef(0), reset = useRef(-1)
  const rigTick = useRef(-1)
  const previous = useRef<AircraftState | null>(null), current = useRef<AircraftState | null>(null)
  const wasRunning = useRef(false), fps = useRef({ frames: 0, since: -1 })
  // When the menu comes up after the player's death (simulation seconds): once the wreck is down, or at once off the map.
  const downAt = useRef<number | null>(null), downed = useRef(false)
  const invalidate = useThree(state => state.invalidate)
  const gl = useThree(state => state.gl)
  const model = useMemo(() => buildFlightModel(asset, definition), [asset, definition])
  // Sky reflections on the airframe's own material copies; without them its metallic nacelles render black.
  const sky = useMemo(() => createSkyEnvironment(gl), [gl])
  const skinned = useMemo(() => applyEnvironment(model, sky, 1), [model, sky])
  useEffect(() => () => sky.dispose(), [sky])
  useEffect(() => () => skinned.forEach(material => material.dispose()), [skinned])
  const diagnosticBounds = useMemo(() => new Box3().setFromObject(model), [model])
  const updateRig = useMemo(() => createFlightRig(model, aircraftId), [model, aircraftId])
  // Built in the effect, not memoised: StrictMode's extra cleanup would leave a memoised mixer disposed.
  const bayDoors = useRef<BayDoors | null>(null)
  useEffect(() => {
    const doors = createBayDoors(model, asset.animations, aircraftId)
    bayDoors.current = doors
    return () => { doors?.dispose(); bayDoors.current = null }
  }, [model, asset, aircraftId])
  const tracers = useMemo(createTracers, [])
  const effects = useMemo(createCombatEffects, [])
  const wreckModels = useRef<(Group | null)[]>([])
  const gunnery = useMemo(() => createGunnery(aircraftId), [aircraftId])
  const lockFrame = useMemo(createLockFrame, [])
  // One audio context for the synthesised tones and the recorded sounds.
  const mixer = useMemo(createAudioMixer, [])
  const lockTone = useMemo(() => createLockTone(mixer), [mixer])
  const flightSound = useMemo(() => createFlightSound(mixer), [mixer])
  const rwrFrame = useMemo(createRwrFrame, [])
  useEffect(() => () => { flightSound.reset(); mixer.dispose() }, [mixer, flightSound])
  // Volumes apply at once, even paused: the mixer keeps them for a context it makes later.
  useEffect(() => { mixer.setVolumes(audio) }, [mixer, audio])
  // Paused or hidden, the loop may not draw again, so sound is cut here rather than in a frame.
  // Stopped by the death itself (the wreck down, or off the map), the explosion and the engine's fade
  // play out first; paused by the pilot, even while falling, everything stops at once.
  useEffect(() => { if (!running) { mixer.silence(downed.current ? 3 : 0); downed.current = false } }, [running, mixer])
  useEffect(() => { session.refused = lockTone.refuse; return () => { session.refused = undefined } }, [session, lockTone])
  useEffect(() => {
    const hidden = () => { if (document.hidden) mixer.silence() }, blur = () => mixer.silence()
    document.addEventListener('visibilitychange', hidden); addEventListener('blur', blur)
    return () => { document.removeEventListener('visibilitychange', hidden); removeEventListener('blur', blur) }
  }, [mixer])
  const mount = useMemo(() => gunMountOf(aircraftId), [aircraftId])
  const gunLock = useMemo(createGunLock, [])
  // Whether aim assist moved the stick on the last command; the HUD names it.
  const assisting = useRef(false)
  // Whether the pilot held the gun trigger on the last command; the camera zooms on the target while it is.
  const firing = useRef(false)
  useEffect(() => () => tracers.dispose(), [tracers])
  useEffect(() => () => effects.dispose(), [effects])
  useEffect(() => {
    const runtime = new GameRuntime({ mode: 'playground', mapId, aircraftIds: [aircraftId], flightCore, ...(session.targetDrone ? { targetDrone: session.targetDrone } : {}), ...(session.targetDrone === 'bot' ? { bot: session.bot } : {}) })
    session.runtime = runtime; runtime.start(); runtime.pause()
    // The new core starts on the Flight Lab's tuning: patch, then rebuild the world on it.
    applyCoreTuning(session, aircraftId); if (flightCore === 'new') runtime.reset()
    previous.current = current.current = takeSnapshot(runtime); previousWorld.current = world.current
    // Paused, the canvas draws on demand; the page asks for a frame after a paused change.
    session.invalidate = invalidate
    legacyRig.reset(); chaseRig.reset(); arcadeRig.reset(); onReady(); invalidate()
    return () => { runtime.dispose(); session.runtime = null; session.invalidate = undefined }
  }, [aircraftId, mapId, flightCore, session, legacyRig, chaseRig, arcadeRig, onReady, invalidate])
  useEffect(() => () => model.traverse(object => {
    if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
  }), [model])
  useFrame(({ camera, size, viewport }, dt) => {
    const runtime = session.runtime
    if (!runtime || !group.current) return
    const rigReset = reset.current !== session.resetId
    const rig: CameraRig = diagnosticView || session.cameraRig === 'legacy' ? legacyRig : session.cameraRig === 'chase' ? chaseRig : arcadeRig
    // A camera switched in mid-flight starts from its own first frame.
    if (activeRig.current !== rig) { activeRig.current = rig; rig.reset() }
    if (rigReset) {
      reset.current = session.resetId; downAt.current = null; rig.reset(); gunnery.reset(); effects.reset(); rwrFrame.reset(); flightSound.reset(); bayDoors.current?.reset(); session.input.resyncAim(); releaseGunLock(gunLock); assisting.current = false; firing.current = false
      previous.current = current.current = takeSnapshot(runtime); previousWorld.current = world.current
    }
    let alpha = 1
    // The first running frame after the menu closes carries the whole pause as its delta.
    const resumed = session.running && !wasRunning.current
    wasRunning.current = session.running
    if (session.running) {
      runtime.resume()
      alpha = runtime.advance(resumed ? 0 : dt * session.timeScale, (tick, id) => {
        previousWorld.current = runtime.snapshot()
        const live = previousWorld.current.aircraft[0]
        previous.current = live
        // Refreshed per simulation tick, not per rendered frame, so the aim controller answers
        // the same at 30 fps as at 144.
        session.input.pose = live
        const target = previousWorld.current.aircraft.find(entity => entity.id === live.targeting.targetId)
        session.input.target = target ?? null
        // Mouse aim: the assist draws the aim once per rendered frame (below), like the hand moving
        // the mouse, and the aim controller flies whatever aim this command finds.
        const aiming = session.preset === 'mouse'
        // Looking away (free look, look back) the jet holds its course, so no assist pulls it either.
        const away = session.input.lookingAway
        // The gun lock's magnet (arcade core): the command carries where the nose must point, and the
        // aim controller keeps off the stick meanwhile. Other cores have no magnet.
        const tracking = aiming && !away && gunLock.locked && flightCore === 'arcade'
        session.input.gunTracking = tracking
        // Aim assist joins the command here, so the simulation and a replay see the assisted stick.
        const command = session.input.command(tick, id, session.preset)
        // The goal is worked out here, on this tick's live state: a frame-old goal trails a crossing target.
        const track = tracking && target?.alive ? trackGoal(gunLock, live, target, mount, WORLD_STEP) : null
        if (track) command.gunTrack = track
        if (aiming || away) { if (!aiming) assisting.current = false; firing.current = command.gunHeld; return command }
        const assist = aimAssist(session.input.mouse.aimAssist, live, target, mount, command)
        assisting.current = assist.active
        firing.current = command.gunHeld
        return withAimAssist(command, assist)
      })
      current.current = takeSnapshot(runtime)
    } else { runtime.pause(); previous.current = current.current = takeSnapshot(runtime); previousWorld.current = world.current }
    const state = current.current!
    const tick = runtime.snapshot().tick
    const rigDt = session.running ? Math.min(dt, .1) * session.timeScale : rigTick.current >= 0 ? Math.max(0, tick - rigTick.current) * WORLD_STEP : 0
    updateRig(state, rigDt, rigReset)
    rigTick.current = tick
    const simClock = ((world.current?.tick ?? 0) - 1 + alpha) * WORLD_STEP
    // Shot down, the jet is drawn on its falling wreck, and the camera follows it there.
    const wreck = effects.ownWreck(simClock)
    // Velocity is interpolated with the pose, so the camera's path look and the drawn FPM agree between ticks.
    const pose = wreck ? { ...state, position: wreck.position.clone(), orientation: wreck.orientation.clone(), velocity: wreck.velocity.clone() }
      : { ...state, position: new Vector3().copy(previous.current!.position).lerp(state.position, alpha), orientation: new Quaternion().copy(previous.current!.orientation).slerp(new Quaternion().copy(state.orientation), alpha),
        velocity: new Vector3().copy(previous.current!.velocity).lerp(state.velocity, alpha) }
    group.current.position.copy(pose.position); group.current.quaternion.copy(pose.orientation)
    // Mouse aim's gun lock (game/combat/gunLock.ts), per rendered frame on the drawn poses, like
    // the hand on the mouse: the cursor held on the target charges a lock that puts it on the lead.
    // Looking away, flying the PSM virtual stick, or without a live aim, there is no lock. The aim
    // is the input, not the record: replays keep the commands.
    if (session.preset === 'mouse') {
      const drawnTarget = wreck || !state.alive || session.input.lookingAway || session.input.virtualStick || !session.input.aim.synced ? null
        : between(previousWorld.current, world.current, entity => entity.id === state.targeting.targetId, alpha)
      const shooter = { ...state, position: pose.position, orientation: pose.orientation, velocity: pose.velocity }
      const target = drawnTarget && { ...drawnTarget.entity, position: drawnTarget.position, orientation: drawnTarget.orientation, velocity: drawnTarget.velocity }
      const frameDt = session.running ? Math.min(dt, 0.1) * session.timeScale : 0
      // Screen steering: the lock works on the direction under the ×, read through the camera as last
      // drawn (the frame the hand saw). What the filling ring drew goes back into the × through that
      // same camera, so the × stays a place on the screen; once the lock holds, the × rides the
      // direction itself (placed below, through this frame's camera).
      const input = session.input, steered = input.screenAim
      if (steered && !input.aimHeld) input.readCursor(camera)
      stepGunLock(gunLock, { level: input.mouse.aimAssist, shooter, target, mount, aim: steered ? input.cursorAim.dir : input.aim.direction, dt: frameDt })
      if (steered && !input.aimHeld && !gunLock.locked && gunLock.charging) input.placeCursor(camera as PerspectiveCamera)
      input.aimHeld = steered && gunLock.locked
      if (session.running) assisting.current = gunLock.locked
    } else { releaseGunLock(gunLock); session.input.aimHeld = false }
    // Burst on the ground, the jet is gone: its wreck once down, or itself crashed into terrain.
    group.current.visible = !wreck?.landed && (state.alive || state.stopReason !== 'terrain')
    rig.baseFov = session.cameraFov; rig.snapFov = !session.running
    rig.gunZoom = session.running && firing.current && state.alive ? zoomOn(camera, world.current, state.targeting.targetId) : 0
    const aiming = session.preset === 'mouse' && session.input.aim.synced && state.alive
    // World aim looks along the aim; under screen steering the camera keeps the nose, and the × is a place on the screen.
    const steered = session.preset === 'mouse' && session.input.screenAim
    rig.aim = aiming && !steered ? session.input.aim.direction : null
    arcadeRig.psm = session.input.lastCommand?.psm ?? false
    arcadeRig.gunLock = session.preset === 'mouse' && gunLock.locked && !steered
    rig.lookTurn = session.input.lookTarget()
    rig.trace = session.cameraTrace
    // A tumbling wreck would spin an aircraft-locked camera with it, so the fall is watched horizon-locked.
    rig.update(camera as PerspectiveCamera, pose, wreck ? FALL_VIEW : session.camera, Math.min(dt, 0.1), session.reducedMotion, diagnosticBounds)
    camera.updateMatrixWorld()
    session.input.viewAway = rig.lookingAway
    // Mouse motion turns the aim about the view as drawn: right is right and up is up on screen.
    // The chase shot's view, so neither shake nor a view easing back from a free look can skew it.
    const lens = camera as PerspectiveCamera
    steadyView.position.copy(camera.position); steadyView.quaternion.copy(rig.chase)
    if (steadyView.fov !== lens.fov || steadyView.aspect !== lens.aspect) { steadyView.fov = lens.fov; steadyView.aspect = lens.aspect; steadyView.near = lens.near; steadyView.far = lens.far; steadyView.updateProjectionMatrix() }
    steadyView.updateMatrixWorld()
    session.input.setView(steadyView)
    // Screen steering: the × the gun lock holds is drawn on its direction; then the ray through the ×
    // for the next commands, and the lens it was read through.
    session.input.setViewport(size.width, size.height)
    if (steered) session.input.settleCursor(camera)
    if (steered && session.input.aimHeld) session.input.placeCursor(lens)
    // The hand steers along the horizon where the view only leans with the bank (control/levelView.ts).
    session.input.levelView = !wreck && session.camera.mode !== 'aircraft'
    const steerAt = steered && state.alive ? session.input.steerPoint(camera) : null
    session.input.cursorRay = steerAt ? cursorRay(camera, steerAt.px, steerAt.py, size.width, size.height, pose.position) : null
    session.input.setLens(lens.fov)
    const hits = runtime.drainHits(), events = runtime.drainEvents()
    // The player's bay doors open for each missile leaving them.
    for (const event of events) if (event.type === 'missile-launched' && event.entityId === state.id) bayDoors.current?.open(event.stationId, event.hardpoint.z, simClock)
    bayDoors.current?.update(simClock)
    // Rounds removed on the last tick still fly the part of it on screen, up to where they hit.
    // Frames between ticks reuse that tick's hit points: the queue is empty on those frames.
    const lastTick = world.current?.tick ?? -1
    if (lastTick !== endedHits.current.tick) endedHits.current = { tick: lastTick, points: new Map(hits.map(entry => [entry.projectileId, entry.hit.point])) }
    const ended = session.running && previousWorld.current ? { previous: previousWorld.current.projectiles, hits: endedHits.current.points } : undefined
    tracers.update(world.current?.projectiles ?? [], alpha, camera as PerspectiveCamera, size.height, viewport.dpr, ended)
    placeDrone(drone.current, droneModel.current, previousWorld.current, world.current, alpha, camera.position)
    placeMissiles(missilePool.current, previousWorld.current, world.current, alpha, camera.position)
    // Each queue is drained once a frame and shared: a second drain would come back empty.
    // Damage is applied inside the simulation; the HUD shows the player's confirmed hits, the effects show every hit and kill.
    effects.update({ clock: simClock, events, hits, world: world.current, camera: camera as PerspectiveCamera, viewportHeight: size.height, wreckModels: wreckModels.current })
    // The menu comes up once the player's wreck has burned a moment on the ground; a crash into the
    // ground waits the same, a flight off the map stops at once.
    for (const event of events) if (event.type === 'aircraft-destroyed' && event.entityId === state.id && event.cause !== 'weapon') downAt.current = simClock + (event.cause === 'terrain' ? DOWN_SETTLE : 0)
    if (wreck?.landedNow) downAt.current = simClock + DOWN_SETTLE
    // The menu reads the stop from telemetry, which may not have caught up with the death yet.
    if (session.running && downAt.current !== null && simClock >= downAt.current) { downAt.current = null; downed.current = true; onTelemetry(state, tick); onDown() }
    const marks = gunnery.update(previousWorld.current, world.current, alpha,
      { id: state.id, targetId: state.alive ? state.targeting.targetId : null, lockOutside: state.targeting.outside, position: pose.position, orientation: pose.orientation, velocity: pose.velocity }, events, session.running && assisting.current)
    // What the radar shows: the scope at the bottom left and the carets on the heading tape.
    const radar = radarFrame(previousWorld.current, world.current, alpha, state, pose)
    // The missile lock: the frame closing on the target, and its tones (silent unless flying).
    const seeker = lockFrame.update(previousWorld.current, world.current, alpha, state, camera.position, session.reducedMotion)
    lockTone.update(seeker, session.running && state.alive && !document.hidden)
    indicators.radar?.current?.(radar, ((world.current?.tick ?? 0) - 1 + alpha) * WORLD_STEP)
    // The warning gear: the RWR scope above the radar, and its tones.
    const warning = rwrFrame.update(world.current, state, simClock)
    indicators.rwr?.current?.(state.alive ? warning : null, simClock)
    lockTone.warn(warning, session.running && state.alive && !document.hidden)
    // The recorded sounds: engines, guns, missiles, explosions and the lock warning.
    flightSound.update({ active: session.running && !document.hidden, world: world.current, player: state, velocity: pose.velocity, camera, events, hits, warning: warning.top, crash: wreck?.landedNow ? wreck.position : null, falling: !!wreck && !wreck.landed })
    session.input.setViewport(size.width, size.height)
    // The PSM virtual stick: the cursor's place on the screen is the stick, centre = neutral.
    const marker = indicators.stick.current, stick = session.input.virtualStick
    if (marker) {
      marker.hidden = !stick
      if (stick) {
        marker.style.left = `${size.width / 2 * (1 + stick.x)}px`
        marker.style.top = `${size.height / 2 * (1 - stick.y)}px`
        marker.dataset.full = String(Math.max(Math.abs(stick.x), Math.abs(stick.y)) >= 0.999)
      }
    }
    // The HUD glass (ladder, nose pipper, tapes) is redrawn from the
    // rendered, interpolated pose through the same camera every frame; React only
    // receives the 10 Hz telemetry below for text status.
    indicators.hud.current?.({ camera, state, position: pose.position, orientation: pose.orientation, velocity: pose.velocity, gunnery: marks, radar, seeker,
      aim: !aiming || steered && rig.lookingAway ? null : { ...(steered ? { screen: { x: session.input.cursor.px, y: session.input.cursor.py } } : { direction: session.input.aim.direction }), share: session.input.aim.share, lock: { progress: gunLock.progress, locked: gunLock.locked } } })
    elapsed.current += dt
    if (elapsed.current >= 0.1) { elapsed.current = 0; onTelemetry(state, tick) }
    // Counted over wall time while flying only; the window restarts on resume.
    const now = performance.now(), counter = fps.current
    if (!session.running || resumed || counter.since < 0) { counter.frames = 0; counter.since = now }
    else counter.frames++
    if (counter.frames && now - counter.since >= 500) {
      if (indicators.fps?.current) indicators.fps.current.textContent = `${Math.round(counter.frames * 1000 / (now - counter.since))} FPS`
      counter.frames = 0; counter.since = now
    }
  })
  return <><group ref={group}><primitive object={model} dispose={null} />{showHitboxes && <HitboxWireframe profileId={definition.hitboxProfileId} />}</group>
    <primitive object={tracers.mesh} />
    <primitive object={effects.mesh} />
    <FlightEffects session={session} aircraft={group} aircraftId={aircraftId} nozzles={updateRig.exhaust} />
    <Suspense fallback={null}><MissileModels pool={missilePool} /></Suspense>
    {targetDrone && <Suspense fallback={null}><TargetDrone group={drone} scaled={droneModel} showHitboxes={showHitboxes} /><DroneWrecks models={wreckModels} /></Suspense>}</>
}
const FALL_VIEW = { mode: 'horizon', roll: 'horizon', horizonStyle: 'balanced' } as const
const view = new Vector3(), toTarget = new Vector3()
/** The gun zoom's share: none without a live target, fading as the target sits off the view axis (last frame's view). */
function zoomOn(camera: { position: Vector3; getWorldDirection(target: Vector3): Vector3 }, now: WorldState | null, targetId: string | null) {
  const target = now?.aircraft.find(entity => entity.id === targetId && entity.alive)
  if (!target) return 0
  toTarget.set(target.position.x, target.position.y, target.position.z).sub(camera.position)
  return zoomShare(camera.getWorldDirection(view).angleTo(toTarget) * 180 / Math.PI)
}
/** Draws the drone between ticks, larger with distance from the camera. Shot down it is hidden; just respawned it is drawn where it is, not swept from the wreck. */
function placeDrone(group: Group | null, model: Group | null, before: WorldState | null, now: WorldState | null, alpha: number, eye: Vector3) {
  if (!group) return
  const drone = between(before, now, entity => entity.control !== 'pilot', alpha)
  group.visible = !!drone
  if (!drone) return
  group.position.copy(drone.position); group.quaternion.copy(drone.orientation)
  model?.scale.setScalar(distanceScale(eye.distanceTo(drone.position)))
}
// Memoised: the page re-renders on every 10 Hz telemetry update, the scene never needs to.
// With the menu open nothing moves, so the loop stops and frames are drawn only on demand.
// Antialiasing comes from CondensationVolume's multisampled target, so the canvas carries none.
// A frame-rate limit (Graphics settings) switches the running loop to on-demand frames paced by FrameLimiter.
export default memo(function FlightScene(props: Props) {
  const limit = props.graphics.frameRate === 'unlimited' ? null : props.graphics.frameRate
  return <Canvas frameloop={props.running && limit === null ? 'always' : 'demand'} dpr={canvasDpr(props.graphics.renderScale)} gl={{ antialias: false }} camera={{ fov: 69, near: 0.5, far: 14000 }}>
    <MapEnvironment mapId={props.mapId} /><AssetLoaderProvider><Suspense fallback={null}><FlightWorld {...props} /></Suspense></AssetLoaderProvider>
    {props.running && limit !== null && <FrameLimiter fps={limit} />}
  </Canvas>
})

/** Renders at most `fps` times a second. The browser still caps it at the display's refresh rate. */
function FrameLimiter({ fps }: { fps: number }) {
  const advance = useThree(state => state.advance)
  useEffect(() => {
    const interval = 1000 / fps
    let last = -Infinity, id = requestAnimationFrame(loop)
    function loop(now: number) {
      id = requestAnimationFrame(loop)
      // 1 ms of slack: a 60 Hz display ticks at 16.6–16.8 ms, so a strict 60 FPS cap would drop frames.
      // Advancing by whole intervals keeps the average rate right on displays that are not a multiple.
      if (now - last < interval - 1) return
      last = Math.max(last + interval, now - interval)
      // Render in this frame. invalidate() would queue R3F's demand loop for the next one, and that
      // loop stops after each frame, so asking every refresh rendered only every other refresh:
      // a 120 FPS limit ran at 60 on a 120 Hz display.
      advance(now)
    }
    return () => cancelAnimationFrame(id)
  }, [fps, advance])
  return null
}
