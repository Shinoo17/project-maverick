/*
Slowly spins its children around the vertical axis. When spinning stops, the
model turns back to its start angle so every other shot frames it the same way.
*/
import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'

/** Radians per second: one full turn in about 70 s. */
const SPIN_SPEED = 0.09
const RETURN_SPEED = 3

export function Turntable({ spinning, reducedMotion, children }: { spinning: boolean; reducedMotion: boolean; children: ReactNode }) {
  const group = useRef<Group>(null)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => { invalidate() }, [spinning, invalidate])

  useFrame((_, delta) => {
    const node = group.current
    if (!node) return
    if (spinning) {
      node.rotation.y = (node.rotation.y + delta * SPIN_SPEED) % (Math.PI * 2)
      invalidate()
      return
    }
    // Take the short way back to 0: map the angle to -π…π first.
    const angle = Math.atan2(Math.sin(node.rotation.y), Math.cos(node.rotation.y))
    if (Math.abs(angle) < 0.001) { node.rotation.y = 0; return }
    node.rotation.y = reducedMotion ? 0 : angle * Math.exp(-delta * RETURN_SPEED)
    invalidate()
  })

  return <group ref={group}>{children}</group>
}
