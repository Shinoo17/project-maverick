/*
The one 3D scene behind Home, Select Mode and Hangar.
It stays mounted while the player moves between menu screens, so the aircraft
GLB loads once and the WebGL context is never rebuilt. A screen only chooses a
camera shot. Rendering is on demand: a frame is drawn only while something
moves (turntable, camera transition, orbit).
*/
import { Suspense, memo, useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import type { MeshReflectorMaterial as ReflectorMaterialImpl } from '@react-three/drei/materials/MeshReflectorMaterial'
import type { AircraftDefinition } from '../../content/schemas'
import { AircraftView } from '../AircraftView'
import { AssetLoaderProvider } from '../aircraft/assetLoader'
import { Lighting, StudioFloor } from '../StudioEnvironment'
import { SceneBoundary } from '../../ui/components/SceneBoundary'
import { MenuCamera, type MenuShot } from './MenuCamera'
import { Turntable } from './Turntable'

export type { MenuShot }

export interface MenuSceneProps {
  aircraft: AircraftDefinition
  shot: MenuShot
  /** True while a menu screen covers the scene (Campaign, PVE): draw nothing. */
  paused: boolean
  /** Slow spin on Home. */
  turntable: boolean
  reducedMotion: boolean
  /** Increase to send the hangar camera back to its start position. */
  resetViewId: number
  /** Increase to try loading the aircraft again after an error. */
  retryId: number
  onReady: () => void
  onError: () => void
}

// Menu screens never play animation stages, so the target list stays empty.
const noStages: Record<string, boolean> = {}

function MenuScene({ aircraft, shot, paused, turntable, reducedMotion, resetViewId, retryId, onReady, onError }: MenuSceneProps) {
  const deckMaterial = useRef<ReflectorMaterialImpl>(null)
  return <Canvas shadows frameloop={paused ? 'never' : 'demand'} dpr={[1, 1.5]}
    camera={{ position: [12, 5, -14], fov: 36, near: 0.1, far: 200 }}
    gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.98 }}>
    <color attach="background" args={['#050507']} />
    <fog attach="fog" args={['#050507', 24, 62]} />
    <Lighting studioLights weaponsShown={false} deckMaterial={deckMaterial} />
    <AssetLoaderProvider>
      <SceneBoundary key={`${aircraft.id}-${retryId}`} fallback={null} onError={onError}>
        <Suspense fallback={null}>
          <Turntable spinning={turntable} reducedMotion={reducedMotion}>
            <AircraftView key={aircraft.id} aircraft={aircraft} targets={noStages} playing={false} speed={1} resetId={0} onReady={onReady} />
          </Turntable>
        </Suspense>
      </SceneBoundary>
    </AssetLoaderProvider>
    <StudioFloor deckMaterial={deckMaterial} grid />
    <MenuCamera shot={shot} reducedMotion={reducedMotion} resetViewId={resetViewId} />
    <RedrawOnResume paused={paused} />
  </Canvas>
}

/** Draws one fresh frame when the scene becomes visible again. */
function RedrawOnResume({ paused }: { paused: boolean }) {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => { if (!paused) invalidate() }, [paused, invalidate])
  return null
}

export default memo(MenuScene)
