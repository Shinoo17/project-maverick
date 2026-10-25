import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createAircraft } from '../benchmarks/flight/harness'
import { FlightCamera } from '../src/render/FlightCamera'
import { FlightInput } from '../src/game/input/FlightInput'
import { defaultCameraSettings } from '../src/game/camera/cameraSettings'

function level() {
  const state = createAircraft('f22')
  state.position = { x: 0, y: 3000, z: 0 }
  state.velocity = { x: 150, y: 0, z: 0 }
  return state
}
const viewOf = (camera: PerspectiveCamera) => new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)

describe('free look and look back', () => {
  it('free look takes the mouse from the aim, and lets go on release', () => {
    const input = new FlightInput(); input.setViewport(1600, 900); input.engage()
    const aim = input.aim.direction.clone()
    input.press('KeyC')
    input.move(200, -100)
    expect(input.aim.direction.equals(aim)).toBe(true)
    const turn = input.lookTarget()
    expect(turn.yaw).toBeLessThan(0)
    expect(turn.pitch).toBeGreaterThan(0)
    expect(input.lookingAway).toBe(true)
    input.held.delete('KeyC')
    expect(input.lookTarget()).toEqual({ yaw: 0, pitch: 0 })
  })

  it('look back holds the aim and the stick still under mouse motion', () => {
    for (const mode of ['aim', 'cursor'] as const) {
      const input = new FlightInput({ ...new FlightInput().mouse, mode }); input.setViewport(1600, 900); input.engage()
      const aim = input.aim.direction.clone(), { px, py } = input.stick
      input.press('KeyR')
      input.move(200, -100)
      expect(input.aim.direction.equals(aim)).toBe(true)
      expect([input.stick.px, input.stick.py]).toEqual([px, py])
      expect(Math.abs(input.lookTarget().yaw)).toBeCloseTo(Math.PI)
    }
  })

  it('look back turns the view half round, ahead of the jet looking back at it', () => {
    const input = new FlightInput(), rig = new FlightCamera(), camera = new PerspectiveCamera(69, 16 / 9, 0.5, 14000)
    const state = level()
    rig.update(camera, state, defaultCameraSettings, 1 / 60)
    const chase = viewOf(camera)
    input.press('KeyR')
    for (let frame = 0; frame < 120; frame++) { rig.lookTurn = input.lookTarget(); rig.update(camera, state, defaultCameraSettings, 1 / 60) }
    expect(rig.lookingAway).toBe(true)
    expect(viewOf(camera).dot(chase)).toBeLessThan(-0.99)
    expect(camera.position.x).toBeGreaterThan(state.position.x)
    // The aim and the × still steer by the chase shot.
    expect(new Vector3(0, 0, -1).applyQuaternion(rig.chase).dot(chase)).toBeGreaterThan(0.99)
    input.held.delete('KeyR')
    for (let frame = 0; frame < 120; frame++) { rig.lookTurn = input.lookTarget(); rig.update(camera, state, defaultCameraSettings, 1 / 60) }
    expect(rig.lookingAway).toBe(false)
    expect(camera.quaternion.angleTo(new Quaternion().copy(rig.chase))).toBe(0)
  })
})
