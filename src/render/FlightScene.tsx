import { observeAirflow } from '../game/flight/airflow'
import { interpretEnvelope } from '../game/flight/envelope'
import { getFlightProfile } from '../game/flight/profile'
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
import { between, createGunnery, lockOf } from './gunneryFrame'
import { radarFrame } from './radarFrame'
import { distanceScale, zoomShare } from './targetVisibility'
import { aimAssist, aimMagnet, withAimAssist } from '../game/combat/aimAssist'
import { gunMountOf } from '../game/combat/gunSolution'
import { getAircraft, modelUrl } from '../content/aircraft'
import type { AircraftId } from '../content/schemas'
import { GameRuntime } from '../game/runtime/GameRuntime'
import type { AircraftState, Vec3, WorldState } from '../game/state/WorldState'
import type { FlightSession } from '../features/flight/session'
import { FlightCamera } from './FlightCamera'
import { WORLD_STEP } from '../game/runtime/clock'
import { MOUSE_RELATIVE, MOUSE_STICK, screenFrame } from '../game/input/mouseStick'
import { cursorRay, markOnScreen } from '../game/input/mouseAim'
import { TrainingRange } from './range/TrainingRange'
import { FlightEffects } from './FlightEffects'
import { createFlightRig } from './aircraft/flightRig'
import type { HudDriver } from '../features/flight/FlightInstruments'
import type { RadarDriver } from '../features/flight/RadarScope'
import { canvasDpr, type GraphicsSettings } from './graphicsSettings'

export type FlightIndicators = { stick: RefObject<HTMLDivElement | null>; gate?: RefObject<HTMLDivElement | null>; hud: RefObject<HudDriver | null>; radar?: RefObject<RadarDriver | null>; fps?: RefObject<HTMLElement | null> }
interface Props { indicators: FlightIndicators; aircraftId: AircraftId; session: FlightSession; running: boolean; targetDrone: boolean; graphics: GraphicsSettings; onReady: () => void; onTelemetry: (state: AircraftState) => void }
function FlightWorld({ aircraftId, session, targetDrone, onReady, onTelemetry, indicators }: Props) {
  const definition = getAircraft(aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  const rig = useMemo(() => new FlightCamera(new URLSearchParams(window.location.search).has('driftCamera')), [])
  const showHitboxes = useMemo(() => new URLSearchParams(window.location.search).has('hitboxes'), [])
  // The latest whole-world snapshot, for views of other entities (the target drone).
  const world = useRef<WorldState | null>(null)
  // The snapshot before the last tick, for drawing the drone between ticks like the player.
  const previousWorld = useRef<WorldState | null>(null)
  // The last tick's hit points by round id, for tracers of rounds removed on that tick.
  const endedHits = useRef<{ tick: number; points: Map<number, Vec3> }>({ tick: -1, points: new Map() })
  const drone = useRef<Group>(null), droneModel = useRef<Group>(null)
  const takeSnapshot = (runtime: GameRuntime) => { world.current = runtime.snapshot(); return world.current.aircraft[0] }
  const group = useRef<Group>(null)
  const elapsed = useRef(0), reset = useRef(-1)
  const rigTick = useRef(-1)
  const previous = useRef<AircraftState | null>(null), current = useRef<AircraftState | null>(null)
  const wasRunning = useRef(false), fps = useRef({ frames: 0, since: -1 })
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
  const tracers = useMemo(createTracers, [])
  const effects = useMemo(createCombatEffects, [])
  const wreckModels = useRef<(Group | null)[]>([])
  const gunnery = useMemo(() => createGunnery(aircraftId), [aircraftId])
  const mount = useMemo(() => gunMountOf(aircraftId), [aircraftId])
  // Whether aim assist moved the stick on the last command; the HUD names it.
  const assisting = useRef(false)
  // Whether the pilot held the gun trigger on the last command; the camera zooms on the target while it is.
  const firing = useRef(false)
  useEffect(() => () => tracers.dispose(), [tracers])
  useEffect(() => () => effects.dispose(), [effects])
  useEffect(() => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraftId], ...(session.targetDrone ? { targetDrone: session.targetDrone } : {}) })
    session.runtime = runtime; runtime.start(); runtime.pause()
    previous.current = current.current = takeSnapshot(runtime); previousWorld.current = world.current
    // Paused, the canvas draws on demand; the page asks for a frame after a paused change.
    session.invalidate = invalidate
    rig.reset(); onReady(); invalidate()
    return () => { runtime.dispose(); session.runtime = null; session.invalidate = undefined }
  }, [aircraftId, session, rig, onReady, invalidate])
  useEffect(() => () => model.traverse(object => {
    if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
  }), [model])
  useFrame(({ camera, size, viewport }, dt) => {
    const runtime = session.runtime
    if (!runtime || !group.current) return
    const rigReset = reset.current !== session.resetId
    if (rigReset) {
      reset.current = session.resetId; rig.reset(); gunnery.reset(); effects.reset(); session.input.resyncAim(); assisting.current = false; firing.current = false
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
        // Refreshed per simulation tick, not per rendered frame: the sim steps at 120 Hz
        // inside one advance() call, and a correction held across four ticks of a 2 rad/s
        // roll would make the aircraft answer differently at 30 fps than at 144.
        const profile = getFlightProfile(live.aircraftId)
        session.input.highAoa = interpretEnvelope(live, observeAirflow(live, profile), profile).highAoa
        session.input.screen = screenFrame(live, session.camera)
        session.input.cursorFrame = session.camera.roll === 'horizon' ? screenFrame(live, { roll: 'horizon', horizonStyle: 'dynamic' }) : session.input.screen
        session.input.pose = live
        const target = previousWorld.current.aircraft.find(entity => entity.id === live.targeting.targetId)
        session.input.target = target ?? null
        // World-locked mouse aim: the assist draws the aim, which the instructor then flies in this
        // same command. Screen-locked aim reads the aim off the × every tick; its assist moves the
        // × itself, once per frame below.
        const aiming = session.preset === 'mouse' && session.input.aiming
        const worldAim = aiming && session.input.mouse.mode === 'aim'
        // Looking away (free look, look back) the jet holds its course, so no assist pulls it either.
        const away = session.input.lookingAway
        const drawn = worldAim && !away && session.input.aim.synced && aimMagnet(session.input.mouse.aimAssist, live, target, mount, session.input.aim.direction, WORLD_STEP, session.input.triggerHeld)
        // Aim assist joins the command here, so the simulation and a replay see the assisted stick.
        const command = session.input.command(tick, id, session.preset)
        if (aiming) { if (worldAim) assisting.current = drawn && session.input.aim.share > 0; firing.current = command.gunHeld; return command }
        if (away) { assisting.current = false; firing.current = command.gunHeld; return command }
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
    // Velocity is interpolated with the pose, so the camera's path look and the drawn FPM agree between ticks.
    const pose = { ...state, position: new Vector3().copy(previous.current!.position).lerp(state.position, alpha), orientation: new Quaternion().copy(previous.current!.orientation).slerp(new Quaternion().copy(state.orientation), alpha),
      velocity: new Vector3().copy(previous.current!.velocity).lerp(state.velocity, alpha) }
    group.current.position.copy(pose.position); group.current.quaternion.copy(pose.orientation)
    rig.baseFov = session.cameraFov; rig.snapFov = !session.running
    rig.gunZoom = session.running && firing.current && state.alive ? zoomOn(camera, world.current, state.targeting.targetId) : 0
    const aiming = session.preset === 'mouse' && session.input.aiming && session.input.aim.synced && state.alive
    // World aim looks along the aim; the screen-locked cursor keeps the ordinary nose camera.
    const cursor = session.input.mouse.mode === 'cursor'
    rig.aim = aiming && !cursor ? session.input.aim.direction : null
    rig.lookTurn = session.input.lookTarget()
    rig.update(camera as PerspectiveCamera, pose, session.camera, Math.min(dt, 0.1), session.reducedMotion, diagnosticBounds)
    camera.updateMatrixWorld()
    session.input.viewAway = rig.lookingAway
    // Mouse motion turns the aim about the view as drawn: right is right and up is up on screen.
    // The chase shot's view, so a view still easing back from a free look cannot skew it.
    session.input.setView(viewRight.set(1, 0, 0).applyQuaternion(rig.chase), viewUp.set(0, 1, 0).applyQuaternion(rig.chase))
    // The × keeps its angle through a change of lens (speed, burner, the gun zoom).
    session.input.setLens((camera as PerspectiveCamera).fov)
    const hits = runtime.drainHits(), events = runtime.drainEvents()
    // Rounds removed on the last tick still fly the part of it on screen, up to where they hit.
    // Frames between ticks reuse that tick's hit points: the queue is empty on those frames.
    const lastTick = world.current?.tick ?? -1
    if (lastTick !== endedHits.current.tick) endedHits.current = { tick: lastTick, points: new Map(hits.map(entry => [entry.projectileId, entry.hit.point])) }
    const ended = session.running && previousWorld.current ? { previous: previousWorld.current.projectiles, hits: endedHits.current.points } : undefined
    tracers.update(world.current?.projectiles ?? [], alpha, camera as PerspectiveCamera, size.height, viewport.dpr, ended)
    placeDrone(drone.current, droneModel.current, previousWorld.current, world.current, alpha, camera.position)
    // Each queue is drained once a frame and shared: a second drain would come back empty.
    // Damage is applied inside the simulation; the HUD shows the player's confirmed hits, the effects show every hit and kill.
    effects.update({ clock: ((world.current?.tick ?? 0) - 1 + alpha) * WORLD_STEP, events, hits, world: world.current, camera: camera as PerspectiveCamera, viewportHeight: size.height, wreckModels: wreckModels.current })
    let marks = gunnery.update(previousWorld.current, world.current, alpha,
      { id: state.id, targetId: state.alive ? state.targeting.targetId : null, lockOutside: state.targeting.outside, position: pose.position, orientation: pose.orientation, velocity: pose.velocity }, events, session.running && assisting.current)
    // What the radar shows: the scope at the bottom left and the carets on the heading tape.
    const radar = radarFrame(previousWorld.current, world.current, alpha, state, pose)
    indicators.radar?.current?.(radar, ((world.current?.tick ?? 0) - 1 + alpha) * WORLD_STEP)
    if (cursor && aiming) {
      // Screen-locked aim assist: the × drawn toward the lead marker as this frame shows it.
      const lead = session.running && marks.lead ? markOnScreen(camera, marks.lead, session.input.stick, size.width, size.height) : null
      const target = lead && marks.target ? markOnScreen(camera, marks.target.position, session.input.stick, size.width, size.height) : null
      assisting.current = session.input.drawCursor(lead && lead.point, lead?.errorDeg ?? Infinity, target?.errorDeg ?? Infinity, Math.min(dt, 0.1) * session.timeScale, marks.target?.range ?? Infinity)
      marks = { ...marks, assist: session.running && assisting.current }
      marks.lock = lockOf(marks)
    } else if (cursor && session.preset === 'mouse') assisting.current = false
    // Cursor mode reads the × through this very camera, so the × and the drawn reticle meet.
    session.input.cursorRay = cursor && state.alive ? cursorRay(camera, session.input.stick.px, session.input.stick.py, size.width, size.height, pose.position) : null
    // The gate is the window, so it follows a resized one.
    session.input.setViewport(size.width, size.height)
    session.input.fov = session.cameraFov
    // The held position is already clamped to the gate, so the marker is simply where it is.
    const marker = indicators.stick.current, input = session.input
    const reach = input.mouse.mode === 'stick' ? input.stickRadius : (input.mouse.mode === 'relative' ? MOUSE_RELATIVE : MOUSE_STICK).reach * input.gate.radius
    if (marker) {
      marker.style.left = `${size.width / 2 + input.stick.px}px`
      marker.style.top = `${size.height / 2 + input.stick.py}px`
      // Full deflection is marked on the stick itself, so the hand learns where the edge is.
      marker.dataset.full = String(Math.hypot(input.stick.px, input.stick.py) >= reach * 0.999)
    }
    // The full-deflection circle, drawn where the stick reads full.
    const gate = indicators.gate?.current
    if (gate) gate.style.width = gate.style.height = `${2 * reach}px`
    // The HUD glass (ladder, nose pipper, tapes) is redrawn from the
    // rendered, interpolated pose through the same camera every frame; React only
    // receives the 10 Hz telemetry below for text status.
    indicators.hud.current?.({ camera, state, position: pose.position, orientation: pose.orientation, velocity: pose.velocity, gunnery: marks, radar,
      // The × is a point on the chase shot; on a turned view it marks nothing, so it is hidden.
      aim: aiming ? cursor ? rig.lookingAway ? null : { screen: { x: input.stick.px, y: input.stick.py }, share: session.input.aim.share } : { direction: session.input.aim.direction, share: session.input.aim.share } : null })
    elapsed.current += dt
    if (elapsed.current >= 0.1) { elapsed.current = 0; onTelemetry(state) }
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
    {targetDrone && <Suspense fallback={null}><TargetDrone group={drone} scaled={droneModel} showHitboxes={showHitboxes} /><DroneWrecks models={wreckModels} /></Suspense>}</>
}
const view = new Vector3(), toTarget = new Vector3(), viewRight = new Vector3(), viewUp = new Vector3()
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
    <TrainingRange /><AssetLoaderProvider><Suspense fallback={null}><FlightWorld {...props} /></Suspense></AssetLoaderProvider>
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
