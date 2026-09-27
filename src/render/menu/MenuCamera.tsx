/*
Camera shots for the menu scene. Each screen names a shot; the camera glides
there (or jumps, with reduced motion). The aircraft sits at the origin and is
scaled to 10 units long.

On Hangar and Armament, dragging orbits the camera around the aircraft: all
the way round sideways, and from almost straight above to almost straight
below. The camera never rolls, so the floor stays level. Vertical travel
stops a little short of straight up/down, where orbiting would spin the
view on the spot. Releasing the mouse leaves the camera where it is (no
drift); R, or any change of shot, glides back.
*/
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

export type MenuShot = 'home' | 'mode' | 'hangar' | 'armament' | 'settings'

/** Direction from the aircraft to the camera, and distance as a multiple of the framing distance. */
const shots: Record<MenuShot, { direction: [number, number, number]; distance: number }> = {
  // 3/4 front hero: nose to screen-left, upper surfaces visible.
  home: { direction: [1.05, 0.42, -1.2], distance: 0.95 },
  // Same angle, pulled back so the aircraft sits behind the mode list.
  mode: { direction: [1.05, 0.5, -1.2], distance: 1.4 },
  hangar: { direction: [1.15, 0.36, -1.05], distance: 1.05 },
  // Side view of a weapon, far enough back to fit between the text columns.
  armament: { direction: [0.12, 0.16, -1], distance: 1.4 },
  // Side-on, nose to screen-left (towards the panel), pulled back to fit the right side.
  settings: { direction: [0.2, 0.2, -1], distance: 1.5 },
}

/** How far the aircraft sits right of centre, as a share of the window width. */
const viewShift: Record<MenuShot, number> = { home: 0, mode: 0, hangar: 0, armament: 0, settings: 0.26 }
/** Below this width the Settings panel covers the window, so the lens stays centred. */
const NARROW_WIDTH = 900

/** Screens where dragging orbits the camera. */
const orbitShots: readonly MenuShot[] = ['hangar', 'armament']

const MIN_DISTANCE = 6
// Vertical limits, as angles from straight up. About 6° short of each pole.
// They apply to every shot, because OrbitControls clamps the camera even
// while dragging is disabled.
const MIN_POLAR = 0.1
const MAX_POLAR = Math.PI - 0.1
/** Higher = faster glide between shots. */
const GLIDE_SPEED = 4

/** Distance at which a 10-unit aircraft fills the narrower side of the view. */
function framingDistance(camera: PerspectiveCamera, aspect: number) {
  const fov = MathUtils.degToRad(camera.fov)
  const limitingFov = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect))
  return 4.9 / Math.sin(limitingFov / 2)
}

/** Shortest signed angle from `from` to `to`, in -π…π. */
function angleBetween(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

export function MenuCamera({ shot, reducedMotion, resetViewId }: { shot: MenuShot; reducedMotion: boolean; resetViewId: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const goal = useRef<Spherical | null>(null)
  const { camera, size, invalidate } = useThree()
  const framing = framingDistance(camera as PerspectiveCamera, size.width / size.height)
  const shift = useRef(0)
  const shiftGoal = size.width < NARROW_WIDTH ? 0 : viewShift[shot]

  // The view offset is stored in window pixels, so it is written again after a resize.
  useEffect(() => {
    if (reducedMotion) shift.current = shiftGoal
    applyShift(camera as PerspectiveCamera, shift.current, size.width, size.height)
    invalidate()
  }, [shiftGoal, reducedMotion, size.width, size.height, camera, invalidate])

  // A new shot (or a reset) sets a goal position; the frame loop moves toward it.
  useEffect(() => {
    const { direction, distance } = shots[shot]
    goal.current = new Spherical().setFromVector3(new Vector3(...direction).normalize().multiplyScalar(framing * distance))
    if (reducedMotion) {
      camera.position.setFromSpherical(goal.current)
      goal.current = null
      controls.current?.update()
    }
    invalidate()
  }, [shot, resetViewId, framing, reducedMotion, camera, invalidate])

  // The glide moves around the aircraft (angle and distance), not in a straight
  // line: from underneath, a straight line would pass through the airframe.
  useFrame((_, delta) => {
    const step = 1 - Math.exp(-delta * GLIDE_SPEED)
    if (shift.current !== shiftGoal) {
      shift.current = Math.abs(shiftGoal - shift.current) < 0.0005 ? shiftGoal : shift.current + (shiftGoal - shift.current) * step
      applyShift(camera as PerspectiveCamera, shift.current, size.width, size.height)
      invalidate()
    }
    const target = goal.current
    if (!target) return
    const current = new Spherical().setFromVector3(camera.position)
    const turn = angleBetween(current.theta, target.theta)
    current.theta += turn * step
    current.phi += (target.phi - current.phi) * step
    current.radius += (target.radius - current.radius) * step
    camera.position.setFromSpherical(current)
    const arrived = Math.abs(turn) < 0.001 && Math.abs(target.phi - current.phi) < 0.001 && Math.abs(target.radius - current.radius) < 0.01
    if (arrived) {
      camera.position.setFromSpherical(target)
      goal.current = null
    }
    controls.current?.update()
    invalidate()
  })

  // Grabbing the view stops any glide, so the two never fight.
  function onStart() { goal.current = null }

  return <OrbitControls ref={controls} makeDefault enabled={orbitShots.includes(shot)} enablePan={false} enableDamping={false}
    minDistance={MIN_DISTANCE} maxDistance={framing * 1.7} minPolarAngle={MIN_POLAR} maxPolarAngle={MAX_POLAR}
    onStart={onStart} />
}

function applyShift(camera: PerspectiveCamera, shift: number, width: number, height: number) {
  if (shift === 0) camera.clearViewOffset()
  else camera.setViewOffset(width, height, -shift * width, 0, width, height)
}
