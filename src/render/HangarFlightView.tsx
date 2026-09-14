import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Group, Quaternion, Vector3 } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { AircraftDefinition } from '../content/schemas'
import { modelUrl } from '../content/aircraft'
import { GameRuntime } from '../game/runtime/GameRuntime'
import { getFlightProfile } from '../game/flight/profile'
import { stepThrustVectoring } from '../game/flight/thrustVectoring'
import type { HangarFlightState } from '../features/hangar/useHangarFlight'
import { useAircraftAsset } from './aircraft/assetLoader'
import { prepareAnimations } from './aircraft/animationStages'
import { createFlightRig } from './aircraft/flightRig'
import { CondensationVolume } from './vapor/CondensationVolume'
import { flightExhaustConditions } from './exhaust/profile'

// Match the flight renderer's 18.9 m frame before scaling the entire preview,
// including its exhaust coordinate system, down to the hangar's 10-unit span.
export function HangarFlightView({ aircraft, input, playing, reducedMotion }: {
  aircraft: AircraftDefinition; input: HangarFlightState; playing: boolean; reducedMotion: boolean
}) {
  const asset = useAircraftAsset(modelUrl(aircraft))
  const { gl, invalidate } = useThree()
  const frame = useRef<Group>(null), reset = useRef(-1)
  const volume = useRef<CondensationVolume | null>(null)
  const data = useMemo(() => {
    const copy = clone(asset.scene)
    aircraft.removeNodes.forEach(name => copy.getObjectByName(name)?.removeFromParent())
    prepareAnimations(copy, asset.animations)
    const orientation = new Group(); orientation.rotation.set(...aircraft.rotation); orientation.add(copy)
    const bounds = new Box3().setFromObject(orientation)
    const root = new Group(); root.add(orientation)
    root.scale.setScalar(18.9 / Math.max(...bounds.getSize(new Vector3()).toArray()))
    orientation.position.copy(bounds.getCenter(new Vector3())).negate()
    const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: [aircraft.id] })
    const state = runtime.snapshot().aircraft[0]; runtime.dispose()
    return { root, state, rig: createFlightRig(root, aircraft.id), turn: new Quaternion(), axis: new Vector3() }
  }, [aircraft, asset])
  useEffect(() => {
    volume.current = new CondensationVolume(gl)
    return () => { volume.current?.dispose(); volume.current = null }
  }, [gl])
  useEffect(() => () => data.root.traverse(object => {
    if ('isSkinnedMesh' in object && object.isSkinnedMesh && 'skeleton' in object) (object.skeleton as { dispose(): void }).dispose()
  }), [data])
  useEffect(() => { invalidate() }, [input, playing, invalidate])
  useFrame(({ scene, camera }, delta) => {
    if (!frame.current || !volume.current) { gl.render(scene, camera); return }
    const dt = playing ? Math.min(delta, .05) : 0
    const { state, rig, axis, turn } = data
    const profile = getFlightProfile(aircraft.id)
    if (reset.current !== input.resetId) {
      frame.current.quaternion.identity(); reset.current = input.resetId
      volume.current.reset()
    }
    state.enginePower = input.throttle; state.maneuver.burnerActive = input.afterburner
    state.rates.pitch = input.pitch * profile.flight.pitchRate
    state.rates.roll = input.roll * profile.flight.rollRate
    state.rates.yaw = input.yaw * profile.flight.yawRate
    stepThrustVectoring(state, { pitch: input.pitch, roll: input.roll }, dt, 180, 0)
    rig(state, dt)
    // Local +X is the nose: +Z pitches up, +X rolls, -Y yaws right.
    axis.set(input.roll, -input.yaw, input.pitch)
    if (axis.lengthSq()) frame.current.quaternion.multiply(turn.setFromAxisAngle(axis.normalize(), dt * .65))
    frame.current.updateWorldMatrix(true, true)
    volume.current.updateExhaust({ ...flightExhaustConditions(state), nozzles: rig.exhaust }, dt, reducedMotion)
    volume.current.render(gl, scene, camera, frame.current.matrixWorld)
    if (playing) invalidate()
  }, 1)
  return <group ref={frame} position={[0, .35, 0]} scale={10 / 18.9}><primitive object={data.root} dispose={null} /></group>
}
