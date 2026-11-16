import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { FlightInput } from '../src/game/input/FlightInput'
import { ArcadeCamera } from '../src/render/ArcadeCamera'
import { defaultCameraSettings } from '../src/game/camera/cameraSettings'
import { defaultMouseSettings } from '../src/game/control/mouseSettings'

/*
World aim (Aim point): how far the nose runs past the aim once the hand has stopped. Flown in the
loop the game runs: the real mouse aim, the arcade core and the Aim lock camera.
`px`, `py` pixels of mouse travel spread over `seconds`, then the hand rests.
*/
const DT = 1 / 60, DEG = 180 / Math.PI

function fly(px: number, py: number, seconds: number) {
  const runtime = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'], flightCore: 'arcade' })
  runtime.start()
  const input = new FlightInput({ ...defaultMouseSettings, aimMode: 'world' })
  input.setViewport(1280, 720)
  const rig = new ArcadeCamera(), camera = new PerspectiveCamera(56, 16 / 9, 0.5, 14000), steady = new PerspectiveCamera()
  const settings = { ...defaultCameraSettings, mode: 'aim' as const }
  const n = Math.round(seconds / DT), nose = new Vector3(), start = new Vector3()
  let past = 0, settle = 0
  for (let i = 0; i < 120 + n + 300; i++) {
    if (i >= 120 && i < 120 + n) input.move(px / n, py / n)
    runtime.advance(DT, (tick, id) => { input.pose = runtime.snapshot().aircraft[0]; return input.command(tick, id, 'mouse') })
    const s = runtime.snapshot().aircraft[0]
    rig.aim = input.aim.synced && s.alive ? input.aim.direction : null
    rig.update(camera, s, settings, DT); camera.updateMatrixWorld()
    steady.position.copy(camera.position); steady.quaternion.copy(rig.chase); steady.fov = camera.fov; steady.aspect = camera.aspect; steady.updateProjectionMatrix(); steady.updateMatrixWorld()
    input.setView(steady)
    const o = s.orientation
    nose.set(1, 0, 0).applyQuaternion(new Quaternion(o.x, o.y, o.z, o.w))
    if (i === 119) start.copy(nose)
    if (i < 120 + n) continue
    // Past the aim: the nose's angle beyond it, along the way it came from where it started.
    const aim = input.aim.direction as Vector3
    const beyond = new Vector3().crossVectors(new Vector3().crossVectors(start, aim).normalize(), aim)
    past = Math.max(past, Math.asin(Math.max(-1, Math.min(1, nose.dot(beyond)))) * DEG)
    if (nose.angleTo(aim) * DEG > 1) settle = (i - 120 - n) * DT
  }
  return { past, settle }
}

describe('world aim: the nose stops on the aim', () => {
  // Was 3.3°, 3.3°, 2.7°, 1.0° and 3.7° past.
  it.each([[0, -300, 0.3], [0, 300, 0.3], [0, -150, 0.15], [0, -60, 0.1], [300, -300, 0.5], [100, 0, 0.2]])('a flick of %i, %i px in %f s', (px, py, seconds) => {
    const r = fly(px, py, seconds)
    expect(r.past).toBeLessThan(0.5)
    expect(r.settle).toBeLessThan(0.9)
  })
  // The nose is on the aim and turning with it when the hand stops: what is left is the jet's own stop. Was 4.4°, 5.0° and 4.7°.
  it.each([[0, -600, 1.5], [600, 0, 1.5], [1200, 0, 3]])('a steady drag of %i, %i px over %f s that stops', (px, py, seconds) => {
    const r = fly(px, py, seconds)
    expect(r.past).toBeLessThan(3.5)
    expect(r.settle).toBeLessThan(0.8)
  })
})
