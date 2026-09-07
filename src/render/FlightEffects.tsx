import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Quaternion, Vector3 } from 'three'
import type { FlightSession } from '../features/flight/session'

// A bounded, reusable world-space trail. No particles or React updates per frame.
export function FlightEffects({ session }: { session: FlightSession }) {
  const engines = useRef<Group>(null), vapor = useRef<Group>(null)
  const last = useRef(-1), reset = useRef(-1), points = useRef(0)
  const trails = useMemo(() => [-1, 1].map(side => {
    const geometry = new BufferGeometry(), positions = new Float32Array(120 * 3)
    geometry.setAttribute('position', new BufferAttribute(positions, 3)); geometry.setDrawRange(0, 0)
    const material = new LineBasicMaterial({ color: '#edf5ff', transparent: true, opacity: 0.55, depthWrite: false })
    const line = new Line(geometry, material); line.frustumCulled = false
    return { side, positions, geometry, material, line }
  }), [])
  useEffect(() => () => trails.forEach(t => { t.geometry.dispose(); t.material.dispose() }), [trails])
  useFrame(() => {
    const world = session.runtime?.snapshot(), state = world?.aircraft[0]
    if (!world || !state || !engines.current || !vapor.current) return
    if (reset.current !== session.resetId) { reset.current = session.resetId; points.current = 0; last.current = -1; trails.forEach(t => t.geometry.setDrawRange(0, 0)) }
    const q = new Quaternion().copy(state.orientation), position = new Vector3().copy(state.position)
    engines.current.position.copy(position); engines.current.quaternion.copy(q)
    engines.current.visible = state.maneuver.burnerActive
    vapor.current.position.copy(position); vapor.current.quaternion.copy(q)
    const strength = Math.min(1, state.maneuver.highG + Math.max(0, state.maneuver.alpha - 25) / 55)
    vapor.current.visible = strength > 0.1 && !session.reducedMotion
    vapor.current.scale.set(1, Math.max(0.1, strength), 1)
    if (world.tick === last.current || !session.running) return
    last.current = world.tick
    if (strength < 0.1 || session.reducedMotion) { points.current = 0; trails.forEach(t => t.geometry.setDrawRange(0, 0)); return }
    points.current = Math.min(120, points.current + 1)
    for (const t of trails) {
      t.positions.copyWithin(3, 0, 357)
      const point = new Vector3(-2, 0, t.side * 6).applyQuaternion(q).add(position)
      t.positions[0] = point.x; t.positions[1] = point.y; t.positions[2] = point.z
      t.geometry.attributes.position.needsUpdate = true; t.geometry.setDrawRange(0, points.current)
    }
  })
  return <>
    {trails.map(t => <primitive key={t.side} object={t.line} />)}
    <group ref={engines}>{[-1.5, 1.5].map(z => <mesh key={z} position={[-11, 0, z]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.65, 7, 12]} /><meshBasicMaterial color="#ffc786" transparent opacity={0.8} depthWrite={false} /></mesh>)}</group>
    <group ref={vapor}>{[-1, 1].map(side => <mesh key={side} position={[-1, 0.35, side * 3.7]} scale={[3.5, 0.22, 2.2]}><sphereGeometry args={[1, 16, 8]} /><meshBasicMaterial color="#edf5ff" transparent opacity={0.2} depthWrite={false} /></mesh>)}</group>
  </>
}
