/*
Scene for studio V3. Kept separate from StudioScene so V1/V2 keep their exact
look: a black void, a reflective deck, and cool rim light doing the drawing.
The rig takes absolute camera commands and reports its own spherical state back
so an external dial can display where the camera actually is.
*/
import { Suspense, memo, useEffect, useRef, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, MeshReflectorMaterial, OrbitControls } from '@react-three/drei'
import { ACESFilmicToneMapping, MathUtils, PerspectiveCamera, PMREMGenerator, Spherical, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { MeshReflectorMaterial as ReflectorMaterialImpl } from '@react-three/drei/materials/MeshReflectorMaterial'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { AircraftView, type AircraftViewProps } from './AircraftView'
import { AssetLoaderProvider } from './aircraft/assetLoader'
import { SceneBoundary } from '../ui/components/SceneBoundary'

// Nose points down +X in scene space (Sensor_PitotTube_Nose sits at +X, the
// nozzle rig at -X), so front/rear are the X poles and side is the -Z flank.
export type ViewPreset = 'hero' | 'top' | 'side' | 'front' | 'rear'
const presetDirections: Record<ViewPreset, [number, number, number]> = {
  // Hero sits ahead of the nose on the -Z flank: nose reads to screen-left, canopy
  // and upper surfaces stay visible, and the cool kicker rims the far edge.
  hero: [1.05, 0.42, -1.2], top: [0.001, 1, 0.001], side: [0, 0.16, -1], front: [1, 0.11, 0.001], rear: [-1, 0.11, 0.001],
}

export type CameraCommand =
  | { kind: 'preset'; preset: ViewPreset }
  | { kind: 'azimuth'; value: number }
  | { kind: 'elevation'; value: number }
  | { kind: 'zoom'; value: number }
export interface CameraRequest { command: CameraCommand; sequence: number }
export interface CameraReport { azimuth: number; elevation: number; zoom: number }

export const DECK_Y = -2.1
const MIN_PHI = 0.06
const MAX_PHI = Math.PI * 0.78
const MIN_RADIUS = 6

function Lighting({ studioLights, deckMaterial }: { studioLights: boolean; deckMaterial: RefObject<ReflectorMaterialImpl | null> }) {
  const { gl, scene, invalidate } = useThree()
  useEffect(() => {
    const room = new RoomEnvironment()
    const generator = new PMREMGenerator(gl)
    const target = generator.fromScene(room, 0.04)
    scene.environment = target.texture
    scene.environmentIntensity = 0.18
    // An explicit map makes Three honor the deck's own envMapIntensity.
    // With envMap=null, WebGLRenderer overrides it with scene.environmentIntensity.
    const deck = deckMaterial.current
    if (deck) {
      deck.envMap = target.texture
      deck.envMapIntensity = 0
      deck.needsUpdate = true
    }
    invalidate()
    room.dispose()
    generator.dispose()
    return () => {
      scene.environment = null
      if (deck) { deck.envMap = null; deck.needsUpdate = true }
      target.dispose()
    }
  }, [gl, scene, invalidate, deckMaterial])
  // Key, cool kicker and warm kicker are the "studio lights" a viewer can cut.
  // With them off the airframe keeps only ambient and the room environment.
  useEffect(() => { invalidate() }, [studioLights, invalidate])
  return <>
    <ambientLight intensity={studioLights ? 0.15 : 0.34} />
    {studioLights && <>
    {/* Three lights on one 9-unit ring, 120° apart, laid out around the hero camera
        (which sits at ~139°): white key 60° to one side, warm kicker 60° to the other,
        cool kicker dead opposite so the blue reads as a rim on the far edge. Only the
        heights differ — the key rides high because it casts the shadows.
        The deck retains the three direct-light highlights, but excludes room lighting. */}
    <directionalLight position={[8.8, 8.5, 1.7]} intensity={2.45} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-normalBias={0.045} shadow-radius={3.5} />
    <directionalLight position={[-5.9, 2.4, 6.8]} intensity={1.35} color="#8fd9f2" />
    <directionalLight position={[-2.9, 2, -8.5]} intensity={0.7} color="#ffd2a8" />
    </>}
  </>
}

function CameraRig({ request, autoRotate, reducedMotion, onReport }: { request: CameraRequest; autoRotate: boolean; reducedMotion: boolean; onReport: (report: CameraReport) => void }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, size, invalidate } = useThree()
  const fov = MathUtils.degToRad((camera as PerspectiveCamera).fov)
  const limitingFov = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * size.width / size.height))
  const framedRadius = 4.9 / Math.sin(limitingFov / 2)
  const maxRadius = framedRadius * 1.7
  const report = useRef(onReport)
  const last = useRef<{ sent: CameraReport | null; at: number }>({ sent: null, at: 0 })
  report.current = onReport

  function spherical(orbit: OrbitControlsImpl) { return new Spherical().setFromVector3(camera.position.clone().sub(orbit.target)) }
  function apply(orbit: OrbitControlsImpl, value: Spherical) {
    value.phi = MathUtils.clamp(value.phi, MIN_PHI, MAX_PHI)
    value.radius = MathUtils.clamp(value.radius, MIN_RADIUS, maxRadius)
    camera.position.setFromSpherical(value).add(orbit.target)
    orbit.update()
    invalidate()
  }

  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    orbit.target.set(0, 0, 0)
    camera.position.copy(new Vector3(...presetDirections.hero).normalize().multiplyScalar(framedRadius))
    orbit.update()
    invalidate()
  }, [camera, framedRadius, invalidate])

  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    const command = request.command
    if (command.kind === 'preset') {
      orbit.target.set(0, 0, 0)
      camera.position.copy(new Vector3(...presetDirections[command.preset]).normalize().multiplyScalar(command.preset === 'hero' ? framedRadius : framedRadius * 0.94))
      orbit.update()
      invalidate()
      return
    }
    const value = spherical(orbit)
    if (command.kind === 'azimuth') value.theta = command.value
    if (command.kind === 'elevation') value.phi = MathUtils.lerp(MAX_PHI, MIN_PHI, command.value)
    if (command.kind === 'zoom') value.radius = MathUtils.lerp(maxRadius, MIN_RADIUS, command.value)
    apply(orbit, value)
    // Keyed on the command sequence by design: a report must never re-enter here,
    // or the dial and the controls would drive each other in a loop.
  }, [request, camera, framedRadius, maxRadius, invalidate])

  useEffect(() => { invalidate() }, [autoRotate, invalidate])

  // Read-only channel. Rate limited so an auto-rotating scene cannot drive a
  // React render per frame; the dial transitions between samples in CSS.
  useFrame(() => {
    if (autoRotate) invalidate()
    const orbit = controls.current
    if (!orbit) return
    const value = spherical(orbit)
    const azimuth = value.theta
    const elevation = MathUtils.clamp((MAX_PHI - value.phi) / (MAX_PHI - MIN_PHI), 0, 1)
    const zoom = MathUtils.clamp((maxRadius - value.radius) / (maxRadius - MIN_RADIUS), 0, 1)
    const now = performance.now()
    const sent = last.current.sent
    if (sent) {
      const moved = Math.abs(azimuth - sent.azimuth) > 0.004 || Math.abs(elevation - sent.elevation) > 0.004 || Math.abs(zoom - sent.zoom) > 0.004
      if (!moved || now - last.current.at < 60) return
    }
    const next: CameraReport = { azimuth, elevation, zoom }
    last.current = { sent: next, at: now }
    report.current(next)
  })

  return <OrbitControls ref={controls} makeDefault autoRotate={autoRotate} autoRotateSpeed={0.45} enableDamping={!reducedMotion} dampingFactor={0.075} enablePan={false} minDistance={MIN_RADIUS} maxDistance={maxRadius} minPolarAngle={MIN_PHI} maxPolarAngle={MAX_PHI} />
}

export interface ObsidianSceneProps extends AircraftViewProps {
  grid: boolean
  /* V3 never cuts the studio lights, so this defaults to on. */
  studioLights?: boolean
  autoRotate: boolean
  reducedMotion: boolean
  cameraRequest: CameraRequest
  onCameraReport: (report: CameraReport) => void
  onError: () => void
  retryId: number
}

function ObsidianScene({ grid, studioLights = true, autoRotate, reducedMotion, cameraRequest, onCameraReport, onError, retryId, ...aircraftProps }: ObsidianSceneProps) {
  const deckMaterial = useRef<ReflectorMaterialImpl>(null)
  return <Canvas shadows frameloop="demand" dpr={[1, 1.5]} camera={{ position: [12, 5, -14], fov: 36, near: 0.1, far: 200 }} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.98 }}>
    <color attach="background" args={['#050507']} />
    <fog attach="fog" args={['#050507', 24, 62]} />
    <Lighting studioLights={studioLights} deckMaterial={deckMaterial} />
    <AssetLoaderProvider>
      <SceneBoundary key={`${aircraftProps.aircraft.id}-${retryId}`} fallback={null} onError={onError}>
        <Suspense fallback={null}><AircraftView key={aircraftProps.aircraft.id} {...aircraftProps} /></Suspense>
      </SceneBoundary>
    </AssetLoaderProvider>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, DECK_Y, 0]} receiveShadow>
      <planeGeometry args={[90, 90]} />
      <MeshReflectorMaterial ref={deckMaterial} envMapIntensity={0} resolution={1024} blur={[80, 26]} mixBlur={0.7} mixStrength={0.75} mixContrast={1.25} depthScale={1.2} minDepthThreshold={0.4} maxDepthThreshold={1.05} mirror={0.68} color="#010206" metalness={1} roughness={0.34} />
    </mesh>
    {grid && <Grid position={[0, DECK_Y + 0.012, 0]} args={[120, 120]} cellSize={1} sectionSize={5} cellColor="#1c2c36" sectionColor="#3d6274" cellThickness={0.6} sectionThickness={0.9} fadeDistance={42} fadeStrength={2.4} infiniteGrid />}
    <CameraRig request={cameraRequest} autoRotate={autoRotate} reducedMotion={reducedMotion} onReport={onCameraReport} />
  </Canvas>
}

export default memo(ObsidianScene)
