import { observeAirflow } from '../game/flight/airflow'
import { interpretEnvelope } from '../game/flight/envelope'
import { getFlightProfile } from '../game/flight/profile'
import { memo, Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Box3, Group, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { AssetLoaderProvider, useAircraftAsset } from './aircraft/assetLoader'
import { prepareAnimations } from './aircraft/animationStages'
import { getAircraft, modelUrl } from '../content/aircraft'
import type { AircraftId } from '../content/schemas'
import { GameRuntime } from '../game/runtime/GameRuntime'
import type { AircraftState } from '../game/state/WorldState'
import type { FlightSession } from '../features/flight/session'
import { FlightCamera } from './FlightCamera'
import { WORLD_STEP } from '../game/runtime/clock'
import { screenFrame } from '../game/input/mouseStick'
import { TrainingRange } from './range/TrainingRange'
import { FlightEffects } from './FlightEffects'
import { createFlightRig } from './aircraft/flightRig'
import type { HudDriver } from '../features/flight/FlightInstruments'

export type FlightIndicators = { stick: RefObject<HTMLDivElement | null>; hud: RefObject<HudDriver | null> }
interface Props { indicators: FlightIndicators; aircraftId: AircraftId; session: FlightSession; onReady: () => void; onTelemetry: (state: AircraftState) => void }
function FlightWorld({ aircraftId, session, onReady, onTelemetry, indicators }: Props) {
  const definition = getAircraft(aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  const rig = useMemo(() => new FlightCamera(new URLSearchParams(window.location.search).has('driftCamera')), [])
  const group = useRef<Group>(null)
  const elapsed = useRef(0), reset = useRef(-1)
  const rigTick = useRef(-1)
  const previous = useRef<AircraftState | null>(null), current = useRef<AircraftState | null>(null)
  const model = useMemo(() => {
    const copy = clone(asset.scene)
    for (const name of definition.removeNodes) copy.getObjectByName(name)?.removeFromParent()
    prepareAnimations(copy, asset.animations)
    const orientation = new Group(); orientation.rotation.set(...definition.rotation); orientation.add(copy)
    const bounds = new Box3().setFromObject(orientation), size = bounds.getSize(new Vector3())
    const scale = 18.9 / Math.max(size.x, size.y, size.z)
    const root = new Group(); root.add(orientation); root.scale.setScalar(scale)
    orientation.position.copy(bounds.getCenter(new Vector3())).negate()
    return root
  }, [asset, definition])
  const diagnosticBounds = useMemo(() => new Box3().setFromObject(model), [model])
  const updateRig = useMemo(() => createFlightRig(model, aircraftId), [model, aircraftId])
  useEffect(() => {
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraftId] })
    session.runtime = runtime; runtime.start(); runtime.pause()
    previous.current = current.current = runtime.snapshot().aircraft[0]
    rig.reset(); onReady()
    return () => { runtime.dispose(); session.runtime = null }
  }, [aircraftId, session, rig, onReady])
  useEffect(() => () => model.traverse(object => {
    if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
  }), [model])
  useFrame(({ camera, size }, dt) => {
    const runtime = session.runtime
    if (!runtime || !group.current) return
    const rigReset = reset.current !== session.resetId
    if (rigReset) {
      reset.current = session.resetId; rig.reset()
      previous.current = current.current = runtime.snapshot().aircraft[0]
    }
    let alpha = 1
    if (session.running) {
      runtime.resume()
      alpha = runtime.advance(dt * session.timeScale, (tick, id) => {
        const live = runtime.snapshot().aircraft[0]
        previous.current = live
        // Refreshed per simulation tick, not per rendered frame: the sim steps at 120 Hz
        // inside one advance() call, and a correction held across four ticks of a 2 rad/s
        // roll would make the aircraft answer differently at 30 fps than at 144.
        const profile = getFlightProfile(live.aircraftId)
        session.input.highAoa = interpretEnvelope(live, observeAirflow(live, profile), profile).highAoa
        session.input.screen = screenFrame(live, session.cameraMode)
        return session.input.command(tick, id, session.preset)
      })
      current.current = runtime.snapshot().aircraft[0]
    } else { runtime.pause(); previous.current = current.current = runtime.snapshot().aircraft[0] }
    const state = current.current!
    const tick = runtime.snapshot().tick
    const rigDt = session.running ? Math.min(dt, .1) * session.timeScale : rigTick.current >= 0 ? Math.max(0, tick - rigTick.current) * WORLD_STEP : 0
    updateRig(state, rigDt, rigReset)
    rigTick.current = tick
    const pose = { ...state, position: new Vector3().copy(previous.current!.position).lerp(state.position, alpha), orientation: new Quaternion().copy(previous.current!.orientation).slerp(new Quaternion().copy(state.orientation), alpha) }
    group.current.position.copy(pose.position); group.current.quaternion.copy(pose.orientation)
    rig.update(camera as PerspectiveCamera, pose, session.cameraMode, Math.min(dt, 0.1), session.reducedMotion, diagnosticBounds)
    camera.updateMatrixWorld()
    // The gate is the window, so it follows a resized one.
    session.input.setViewport(size.width, size.height)
    // The held position is already clamped to the gate, so the marker is simply where it is.
    const marker = indicators.stick.current
    if (marker) {
      marker.style.left = `${size.width / 2 + session.input.stick.px}px`
      marker.style.top = `${size.height / 2 + session.input.stick.py}px`
    }
    // The HUD glass (ladder, nose pipper, tapes) is redrawn from the
    // rendered, interpolated pose through the same camera every frame; React only
    // receives the 10 Hz telemetry below for text status.
    indicators.hud.current?.({ camera, state, position: pose.position, orientation: pose.orientation, velocity: new Vector3().copy(previous.current!.velocity).lerp(state.velocity, alpha) })
    elapsed.current += dt
    if (elapsed.current >= 0.1) { elapsed.current = 0; onTelemetry(state) }
  })
  return <><group ref={group}><primitive object={model} dispose={null} /></group><FlightEffects session={session} aircraft={group} nozzles={updateRig.exhaust} /></>
}
// Memoised: the page re-renders on every 10 Hz telemetry update, the scene never needs to.
export default memo(function FlightScene(props: Props) {
  return <Canvas dpr={[1, 1.5]} camera={{ fov: 69, near: 0.5, far: 14000 }}>
    <TrainingRange /><AssetLoaderProvider><Suspense fallback={null}><FlightWorld {...props} /></Suspense></AssetLoaderProvider>
  </Canvas>
})
