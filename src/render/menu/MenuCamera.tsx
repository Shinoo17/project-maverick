/*
Camera shots for the menu scene. Each screen names a shot; the camera glides
there (or jumps, with reduced motion). Only the Hangar lets the player orbit
and zoom. The aircraft sits at the origin and is scaled to 10 units long.
*/
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

export type MenuShot = 'home' | 'mode' | 'hangar'

/** Direction from the aircraft to the camera, and distance as a multiple of the framing distance. */
const shots: Record<MenuShot, { direction: [number, number, number]; distance: number }> = {
  // 3/4 front hero: nose to screen-left, upper surfaces visible.
  home: { direction: [1.05, 0.42, -1.2], distance: 0.95 },
  // Same angle, pulled back so the aircraft sits behind the mode list.
  mode: { direction: [1.05, 0.5, -1.2], distance: 1.4 },
  hangar: { direction: [1.15, 0.36, -1.05], distance: 1.05 },
}

const MIN_DISTANCE = 6
const MIN_POLAR = 0.06
const MAX_POLAR = Math.PI * 0.78
/** Higher = faster glide between shots. */
const GLIDE_SPEED = 4

/** Distance at which a 10-unit aircraft fills the narrower side of the view. */
function framingDistance(camera: PerspectiveCamera, aspect: number) {
  const fov = MathUtils.degToRad(camera.fov)
  const limitingFov = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect))
  return 4.9 / Math.sin(limitingFov / 2)
}

export function MenuCamera({ shot, reducedMotion, resetViewId }: { shot: MenuShot; reducedMotion: boolean; resetViewId: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const goal = useRef<Vector3 | null>(null)
  const { camera, size, invalidate } = useThree()
  const framing = framingDistance(camera as PerspectiveCamera, size.width / size.height)

  // A new shot (or a reset) sets a goal position; the frame loop moves toward it.
  useEffect(() => {
    const { direction, distance } = shots[shot]
    goal.current = new Vector3(...direction).normalize().multiplyScalar(framing * distance)
    if (reducedMotion) {
      camera.position.copy(goal.current)
      goal.current = null
      controls.current?.update()
    }
    invalidate()
  }, [shot, resetViewId, framing, reducedMotion, camera, invalidate])

  useFrame((_, delta) => {
    const target = goal.current
    if (!target) return
    camera.position.lerp(target, 1 - Math.exp(-delta * GLIDE_SPEED))
    if (camera.position.distanceTo(target) < 0.01) {
      camera.position.copy(target)
      goal.current = null
    }
    controls.current?.update()
    invalidate()
  })

  return <OrbitControls ref={controls} makeDefault enabled={shot === 'hangar'} enablePan={false}
    enableDamping={!reducedMotion} dampingFactor={0.075}
    minDistance={MIN_DISTANCE} maxDistance={framing * 1.7} minPolarAngle={MIN_POLAR} maxPolarAngle={MAX_POLAR} />
}
