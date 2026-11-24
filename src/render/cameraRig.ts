import type { Box3, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../game/state/WorldState'
import type { CameraSettings } from '../game/camera/cameraSettings'
import type { CameraTrace } from './cameraTrace'

/*
What the flight scene asks of a chase camera. Two rigs fill it: the legacy FlightCamera, and the
rewrite's ChaseCamera, which the new flight core uses by default.
A rig only reads the state and the aim it is given: it never changes velocity, rates or the aim
(spec §9.4).
*/
export interface CameraRig {
  /** Settings › Camera › Field of view (vertical degrees). */
  baseFov: number
  /** Jump straight to the target FOV (set while paused, so a Settings change shows at once). */
  snapFov: boolean
  /** 0–1: how much of the gun zoom applies this frame (targetVisibility.ts). */
  gunZoom: number
  /** Mouse aim: the world direction the view looks along instead of the nose, or null. */
  aim: Vector3 | null
  /** Free look and look back: how far the view should turn off the chase shot (radians, view frame). */
  lookTurn: { yaw: number; pitch: number }
  /** CAMERA_TRACE: while set, each update appends one frame. */
  trace: CameraTrace | null
  /** The chase shot before the look turn. Mouse aim and the × steer by this view. */
  readonly chase: Quaternion
  /** True while the view is turned off the chase shot, including while it eases back. */
  readonly lookingAway: boolean
  reset(): void
  update(camera: PerspectiveCamera, state: AircraftState, view: CameraSettings, dt: number, reducedMotion?: boolean, diagnosticBounds?: Box3): void
}
