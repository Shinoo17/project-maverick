import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../../src/game/runtime/GameRuntime'
import { FlightInput } from '../../src/game/input/FlightInput'
import { defaultMouseSettings, screenFrame } from '../../src/game/input/mouseStick'
import { cursorRay } from '../../src/game/input/mouseAim'
import { gunLine, gunMountOf, solveGun } from '../../src/game/combat/gunSolution'
import { boundingRadius } from '../../src/game/combat/collision'
import { hitboxes } from '../../src/content/hitboxes'
import { getAircraft } from '../../src/content/aircraft'
import { FlightCamera } from '../../src/render/FlightCamera'
import { WORLD_STEP } from '../../src/game/runtime/clock'
import type { AircraftState } from '../../src/game/state/WorldState'

/* Screen-locked aim tracking a moving target (report only). The hand keeps the × exactly on the
   lead marker every frame, as a perfect aim assist would; what is left is the instructor's own
   lag: how far the gun line trails the solution, and how often the reticle is on the lead
   (gunneryFrame's onSolution: miss within 0.6 × the hitbox radius), the HUD's red. */
const W = 1600, H = 900
const deg = (r: number) => r * 180 / Math.PI

type Path = (t: number, start: Vector3, nose: Vector3, right: Vector3) => { position: Vector3; velocity: Vector3; acceleration: Vector3 }
export const trackPaths: Record<string, Path> = {
  // 600 m ahead, crossing left to right at 150 m/s.
  crossing150: (t, start, nose, right) => ({ position: start.clone().addScaledVector(nose, 600).addScaledVector(right, -200 + 150 * t), velocity: right.clone().multiplyScalar(150), acceleration: new Vector3() }),
  crossing250: (t, start, nose, right) => ({ position: start.clone().addScaledVector(nose, 650).addScaledVector(right, -350 + 250 * t), velocity: right.clone().multiplyScalar(250), acceleration: new Vector3() }),
  // A level turn 700 m ahead, radius 400 m at 150 m/s (~5.7 g... 56 m/s², a hard break turn).
  turning: (t, start, nose, right) => {
    const w = 150 / 400, a = w * t
    const centre = start.clone().addScaledVector(nose, 700)
    const radial = nose.clone().multiplyScalar(-Math.cos(a)).addScaledVector(right, -Math.sin(a))
    const tangent = nose.clone().multiplyScalar(Math.sin(a)).addScaledVector(right, -Math.cos(a))
    return { position: centre.addScaledVector(radial, 400), velocity: tangent.multiplyScalar(150), acceleration: radial.clone().multiplyScalar(-150 * w) }
  },
}

export function trackLeadRun(name: string, seconds = 3) {
  const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'], targetDrone: 'still' })
  runtime.reset('free'); runtime.start()
  const input = new FlightInput({ ...defaultMouseSettings, mode: 'cursor', aimAssist: 'off' }); input.setViewport(W, H); input.engage()
  const rig = new FlightCamera(), camera = new PerspectiveCamera(56, W / H, 0.5, 14000), mount = gunMountOf('f22')
  const first = runtime.snapshot().aircraft[0], q = new Quaternion().copy(first.orientation)
  const start = new Vector3().copy(first.position), nose = new Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize(), right = new Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize()
  const drone = runtime.snapshot().aircraft.find(entity => entity.id !== first.id)!
  const radius = boundingRadius(hitboxes[getAircraft(drone.aircraftId).hitboxProfileId])
  const targetAt = (t: number): AircraftState => { const p = trackPaths[name](t, start, nose, right); return { ...drone, position: { ...p.position }, velocity: { ...p.velocity }, acceleration: { ...p.acceleration } } }
  let state = first
  const errors: number[] = [], on: boolean[] = []
  for (let frame = 0; frame < 60 * seconds; frame++) {
    const t = runtime.snapshot().tick * WORLD_STEP, target = targetAt(t)
    rig.update(camera, state, { roll: 'horizon', horizonStyle: 'balanced' }, 1 / 60); camera.updateMatrixWorld()
    input.setLens(camera.fov)
    const solution = solveGun(state, mount, target)
    if (solution) {
      const p = new Vector3().copy(solution.lead as Vector3).project(camera)
      if (p.z < 1) input.move(p.x * W / 2 - input.stick.px, -p.y * H / 2 - input.stick.py)
      if (frame > 60) {
        errors.push(deg(new Vector3().copy(gunLine(state.orientation, mount.elevationDeg) as Vector3).angleTo(new Vector3().copy(solution.aim as Vector3))))
        on.push(new Vector3().copy(solution.reticle as Vector3).distanceTo(new Vector3().copy(solution.lead as Vector3)) <= radius * 0.6)
      }
    }
    input.cursorRay = cursorRay(camera, input.stick.px, input.stick.py, W, H, state.position)
    runtime.advance(1 / 60, (tick, id) => {
      const live = runtime.snapshot().aircraft[0]
      input.pose = live
      input.target = targetAt(tick * WORLD_STEP)
      input.cursorFrame = screenFrame(live, { roll: 'horizon', horizonStyle: 'dynamic' })
      return input.command(tick, id, 'mouse')
    })
    state = runtime.snapshot().aircraft[0]
  }
  runtime.dispose()
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length
  return { path: name, meanErrorDeg: Number(mean.toFixed(2)), worstDeg: Number(Math.max(...errors).toFixed(2)), onSolutionShare: Number((on.filter(Boolean).length / on.length).toFixed(2)) }
}

