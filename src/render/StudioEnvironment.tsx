/*
Studio look shared by the aircraft studio (ObsidianScene) and the menu scene:
room-environment reflections, three rim lights and a dark reflective deck.
*/
import { useEffect, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Grid, MeshReflectorMaterial } from '@react-three/drei'
import { PMREMGenerator } from 'three'
import type { MeshReflectorMaterial as ReflectorMaterialImpl } from '@react-three/drei/materials/MeshReflectorMaterial'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

export const DECK_Y = -2.1

export function Lighting({ studioLights, weaponsShown, deckMaterial }: { studioLights: boolean; weaponsShown: boolean; deckMaterial: RefObject<ReflectorMaterialImpl | null> }) {
  const { gl, scene, invalidate } = useThree()
  useEffect(() => {
    const room = new RoomEnvironment()
    const generator = new PMREMGenerator(gl)
    const target = generator.fromScene(room, 0.04)
    scene.environment = target.texture
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
  // With them off the airframe falls back to a soft fill and a brighter room
  // environment: its skin is mostly metallic, so it reads through reflections.
  // Missile skins are metallic too, so weapons always get the bright room.
  // The deck keeps its own envMapIntensity and is unaffected.
  useEffect(() => {
    scene.environmentIntensity = weaponsShown ? 0.75 : studioLights ? 0.18 : 0.62
    invalidate()
  }, [scene, studioLights, weaponsShown, invalidate])
  return <>
    <ambientLight intensity={studioLights ? 0.15 : 0.5} />
    {!studioLights && <hemisphereLight args={['#dfe6ee', '#15181c', 0.85]} />}
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

/** Reflective deck and optional grid under the aircraft. Shared with the menu scene. */
export function StudioFloor({ deckMaterial, grid }: { deckMaterial: RefObject<ReflectorMaterialImpl | null>; grid: boolean }) {
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, DECK_Y, 0]} receiveShadow>
      <planeGeometry args={[90, 90]} />
      {/* A translucent deck keeps the inspection grid while exposing airframe
          parts below it. It must not occlude the exhaust's depth-based pass. */}
      <MeshReflectorMaterial transparent opacity={0.2} depthWrite={false} ref={deckMaterial} envMapIntensity={0} resolution={512} blur={[80, 26]} mixBlur={0.7} mixStrength={0.75} mixContrast={1.25} depthScale={1.2} minDepthThreshold={0.4} maxDepthThreshold={1.05} mirror={0.68} color="#010206" metalness={1} roughness={0.34} />
    </mesh>
    {grid && <Grid material-depthWrite={false} position={[0, DECK_Y + 0.012, 0]} args={[120, 120]} cellSize={1} sectionSize={5} cellColor="#1c2c36" sectionColor="#3d6274" cellThickness={0.6} sectionThickness={0.9} fadeDistance={42} fadeStrength={2.4} infiniteGrid />}
  </>
}
