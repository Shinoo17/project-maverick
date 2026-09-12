import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
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
import { screenFrame } from '../game/input/mouseStick'
import { trainingRings } from '../game/playground/practice'
import { FlightEffects } from './FlightEffects'
import { createFlightRig } from './aircraft/flightRig'

export type FlightIndicators = Record<'nose' | 'path' | 'stick', RefObject<HTMLDivElement | null>>
interface Props { indicators: FlightIndicators; aircraftId: AircraftId; session: FlightSession; onReady: () => void; onTelemetry: (state: AircraftState) => void }
function FlightWorld({ aircraftId, session, onReady, onTelemetry, indicators }: Props) {
  const definition = getAircraft(aircraftId)
  const asset = useAircraftAsset(modelUrl(definition))
  const rig = useMemo(() => new FlightCamera(), [])
  const group = useRef<Group>(null)
  const elapsed = useRef(0), reset = useRef(-1)
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
  const updateRig = useMemo(() => createFlightRig(model), [model])
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
    if (reset.current !== session.resetId) {
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
        session.input.psmControl = live.maneuver.phase === 'active' || live.maneuver.phase === 'recovery'
        session.input.screen = screenFrame(live, session.cameraMode)
        return session.input.command(tick, id, session.preset)
      })
      current.current = runtime.snapshot().aircraft[0]
    } else { runtime.pause(); previous.current = current.current = runtime.snapshot().aircraft[0] }
    const state = current.current!
    updateRig(state)
    const pose = { ...state, position: new Vector3().copy(previous.current!.position).lerp(state.position, alpha), orientation: new Quaternion().copy(previous.current!.orientation).slerp(new Quaternion().copy(state.orientation), alpha) }
    group.current.position.copy(pose.position); group.current.quaternion.copy(pose.orientation)
    rig.update(camera as PerspectiveCamera, pose, session.cameraMode, Math.min(dt, 0.1), session.reducedMotion)
    camera.updateMatrixWorld()
    // The gate is the window, so it follows a resized one.
    session.input.setViewport(size.width, size.height)
    // The held position is already clamped to the gate, so the marker is simply where it is.
    const marker = indicators.stick.current
    if (marker) {
      marker.style.left = `${size.width / 2 + session.input.stick.px}px`
      marker.style.top = `${size.height / 2 + session.input.stick.py}px`
    }
    const nose = new Vector3(1, 0, 0).applyQuaternion(pose.orientation)
    const directions = { nose, path: new Vector3().copy(state.velocity).normalize() }
    for (const key of ['nose', 'path'] as const) {
      const element = indicators[key].current
      if (!element) continue
      const point = new Vector3().copy(pose.position).addScaledVector(directions[key], 1000).project(camera)
      element.style.visibility = directions[key].lengthSq() > 0 && point.z < 1 && point.z > -1 ? 'visible' : 'hidden'
      element.style.left = `${(point.x * 0.5 + 0.5) * size.width}px`
      element.style.top = `${(-point.y * 0.5 + 0.5) * size.height}px`
    }
    elapsed.current += dt
    if (elapsed.current >= 0.1) { elapsed.current = 0; onTelemetry(state) }
  })
  return <><group ref={group}><primitive object={model} dispose={null} /></group><FlightEffects session={session} aircraft={group} /></>
}
function Range() {
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}><planeGeometry args={[20000, 20000]} /><meshStandardMaterial color="#8a947e" roughness={1} /></mesh>
    <gridHelper args={[16000, 160, '#6a7964', '#7e8b73']} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[600, 0.1, 0]}><planeGeometry args={[1400, 65]} /><meshStandardMaterial color="#535b59" /></mesh>
    {Array.from({ length: 18 }, (_, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[i * 70, 0.2, 0]}><planeGeometry args={[35, 2]} /><meshBasicMaterial color="#eee8cb" /></mesh>)}
    {trainingRings.map(x => <mesh key={x} rotation={[0, Math.PI / 2, 0]} position={[x, 400, 0]}><torusGeometry args={[65, 2, 8, 48]} /><meshStandardMaterial color="#f1cd61" /></mesh>)}
  </>
}
export default function FlightScene(props: Props) {
  return <Canvas dpr={[1, 1.5]} camera={{ fov: 69, near: 0.5, far: 14000 }}>
    <color attach="background" args={['#acc5d2']} /><fog attach="fog" args={['#acc5d2', 4500, 12000]} />
    <hemisphereLight args={['#edf5ff', '#707958', 2]} /><directionalLight position={[100, 600, 300]} intensity={3} />
    <Range /><AssetLoaderProvider><Suspense fallback={null}><FlightWorld {...props} /></Suspense></AssetLoaderProvider>
  </Canvas>
}
