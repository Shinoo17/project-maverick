import { MathUtils, Quaternion, Vector3, type Box3, type PerspectiveCamera } from 'three'
import type { AircraftState } from '../game/state/WorldState'
import { readFlight } from '../game/flight/readout'
import { cameraFovRange, type CameraSettings } from '../game/camera/cameraSettings'
import { toExampleFrame } from '../game/control/controlAircraft'
import { ArcadeChase, CHASE_JET_LENGTH } from './arcade/ArcadeChase'
import { visibility } from './targetVisibility'
import type { CameraTrace } from './cameraTrace'
import { CameraMotionMeter } from './arcade/cameraMotion'
import type { CameraRig } from './cameraRig'

/*
The chase camera ported from example/flight-control (src/game/camera/ChaseCamera.ts, here
arcade/ArcadeChase.ts, unchanged apart from its imports and an outside free-look hook): Aircraft
lock, Horizon lock and Aim lock, with its post-stall view, acceleration spring, FOV by speed and
shake. This class only adapts it to the flight scene's CameraRig:

- The example camera reads the jet in its own body frame (forward +Z); the pose is turned into
  it with toExampleFrame. World vectors (position, aim, flight path) pass through as they are.
- On the arcade core (example/flight-control's physics, src/game/arcadeCore) the FCS mode, its
  recovery direction and the smoothed afterburner come from the aircraft's arcadeFlight state,
  as the example fed them. On the other cores, which have no such FCS, the mode is 'PSM' while
  the PSM key is held (`psm`, set by the scene) and 'NORMAL' otherwise, with no recovery lead.
- Settings › Camera › Field of view scales the example's FOV curve: at the setting's default
  the FOV is the example's own, and the gun zoom narrows it as the other rigs do.
- The chase offsets are scaled to the airframe's length from the model's bounds.
- The wreck view is the example's crash view, taken whenever the jet is no longer alive.
- With a trace attached (Flight Lab), each frame records the picture's motion (camera plan C0).

The camera only reads: it never writes the state or the aim it is given.
*/
/** How fast the gun zoom eases in and out (1/s): about 95 % of the way in 0.35 s. */
const ZOOM_RATE = 8.5

export class ArcadeCamera implements CameraRig {
  baseFov: number = cameraFovRange.default
  snapFov = false
  gunZoom = 0
  aim: Vector3 | null = null
  lookTurn = { yaw: 0, pitch: 0 }
  trace: CameraTrace | null = null
  /** The gun lock holds (game/combat/gunLock.ts): Aim lock looks at the lead with a level horizon. */
  gunLock = false
  /** The PSM key is held. Stands in for the FCS mode on cores without the example's FCS. */
  psm = false
  readonly chase = new Quaternion()
  private readonly rig = new ArcadeChase(1)
  // Smoothed afterburner engagement, 0..1, as the example's controls fed its camera.
  private burner = 0
  // The gun zoom as drawn: eases toward `gunZoom`, which the scene switches with the trigger.
  private zoom = 0
  private readonly quaternion = new Quaternion()
  private readonly path = new Vector3()
  private readonly position = new Vector3()
  private readonly size = new Vector3()
  private readonly recovery = new Vector3()
  private readonly meter = new CameraMotionMeter()

  get lookingAway() { return this.rig.lookingAway }
  /** The example camera itself, for tests and the debug overlay. */
  get arcade() { return this.rig }

  reset() { this.rig.snap(); this.burner = 0; this.zoom = 0; this.meter.reset() }

  update(camera: PerspectiveCamera, state: AircraftState, view: CameraSettings, dt: number, _reducedMotion = false, bounds?: Box3) {
    const rig = this.rig
    rig.mode = view.mode
    // The flat range: ground at sea level everywhere.
    rig.ground ??= () => 0
    if (bounds && !bounds.isEmpty()) rig.sizeScale = MathUtils.clamp(bounds.getSize(this.size).x / CHASE_JET_LENGTH, 0.5, 2)
    if (rig.camera.aspect !== camera.aspect) rig.setAspect(camera.aspect)
    const { yaw, pitch } = this.lookTurn
    // FlightInput's look pitch is positive up; the example's is positive down.
    rig.setLook(yaw, -pitch, yaw !== 0 || pitch !== 0)

    const flight = readFlight(state)
    const v = state.velocity, speed = Math.hypot(v.x, v.y, v.z)
    toExampleFrame(state.orientation, this.quaternion)
    if (speed > 0.5) this.path.set(v.x, v.y, v.z).divideScalar(speed)
    else this.path.set(0, 0, 1).applyQuaternion(this.quaternion)
    // On the arcade core (the example's physics) the FCS's own mode and its afterburner; on the
    // others the PSM key stands in for the mode.
    const arcade = state.arcadeFlight
    if (arcade) this.burner = arcade.afterburner
    else this.burner += ((flight.burner.active ? 1 : 0) - this.burner) * (1 - Math.exp(-3.5 * dt))
    const fcsMode = arcade?.fcs.mode ?? (this.psm ? 'PSM' : 'NORMAL')
    // The screen boxes of the camera's composer are in the picture as drawn: the base FOV setting and the gun zoom (last frame's).
    rig.fovScale = this.baseFov / cameraFovRange.default * (1 - visibility.zoom * this.zoom)
    rig.update({
      position: this.position.set(state.position.x, state.position.y, state.position.z),
      quaternion: this.quaternion,
      speed,
      afterburner: this.burner,
      airbrake: flight.airbrake,
      g: flight.g,
      aim: this.aim ?? undefined,
      pathDir: this.path,
      fcsMode,
      recoveryDir: fcsMode === 'RECOVERY' && arcade ? this.recovery.fromArray(arcade.fcs.recoveryDir) : undefined,
      crashed: !state.alive,
      gunLock: this.gunLock && state.alive,
    }, dt)

    camera.position.copy(rig.camera.position)
    camera.quaternion.copy(rig.camera.quaternion)
    // The trigger switches the zoom on and off at once; the lens closes and opens over about a third of a second.
    this.zoom = this.snapFov ? this.gunZoom : this.zoom + (this.gunZoom - this.zoom) * (1 - Math.exp(-ZOOM_RATE * dt))
    const fov = rig.camera.fov * this.baseFov / cameraFovRange.default * (1 - visibility.zoom * this.zoom)
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
    this.chase.copy(rig.steady.quaternion)
    if (this.trace) this.recordTrace(this.trace, camera, view, state, flight, dt)
  }

  private recordTrace(trace: CameraTrace, camera: PerspectiveCamera, view: CameraSettings, state: AircraftState, flight: ReturnType<typeof readFlight>, dt: number) {
    const motion = this.meter.sample(camera.quaternion, camera.fov, dt)
    const v = (x: Vector3): [number, number, number] => [x.x, x.y, x.z]
    const steady = this.rig.steady
    trace.record({ rig: 'arcade', dt, style: view.mode,
      position: v(camera.position), look: v(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion)), up: v(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)), fov: camera.fov,
      chase: { look: v(new Vector3(0, 0, -1).applyQuaternion(steady.quaternion)), up: v(new Vector3(0, 1, 0).applyQuaternion(steady.quaternion)), boom: v(camera.position.clone().sub(state.position as Vector3)) },
      flight: { alphaDeg: flight.alphaDeg, betaDeg: flight.betaDeg, incidenceDeg: flight.incidenceDeg, confidence: flight.angleConfidence, airspeed: flight.airspeed, rates: { ...state.rates } },
      blend: { ...motion, ...this.rig.followState, gunZoom: this.zoom, lookingAway: this.lookingAway } })
  }
}
