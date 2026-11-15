import type { GameRuntime } from '../../game/runtime/GameRuntime'
import type { FlightInput, InputPreset } from '../../game/input/FlightInput'
import type { CameraSettings } from '../../game/camera/cameraSettings'
import type { GraphicsSettings } from '../../render/graphicsSettings'
import type { TargetDroneMode } from '../../game/playground/dronePath'
import type { RefusalTone } from '../../render/lockTone'
import type { FlightCoreId } from '../../game/flight/core'
import type { CameraTrace } from '../../render/cameraTrace'
import type { CoreTuning } from '../../game/flightCore/profile'
/** 'arcade': the chase camera ported from example/flight-control (the default); 'chase': the FR2
 * rewrite camera; 'legacy': FlightCamera. The last two are kept for Flight Lab comparison. */
export type CameraRigId = 'arcade' | 'chase' | 'legacy'
export interface FlightSession {
  runtime: GameRuntime | null
  input: FlightInput
  preset: InputPreset
  /** Mirrors the saved camera settings; the scene reads it every frame. */
  camera: CameraSettings
  /** Base vertical field of view (Settings › Camera). */
  cameraFov: number
  /** Mirrors the saved graphics settings; effects read it every frame. */
  graphics: GraphicsSettings
  running: boolean
  /** Playground modifier, null for none; read when the scene creates its runtime. */
  targetDrone: TargetDroneMode | null
  /** Flight Lab: the flight core the scene's runtime uses (src/game/flight/core.ts). */
  flightCore: FlightCoreId
  /** Flight Lab: the tuning panel's patch on the new core's profiles; outlives each runtime. */
  coreTuning: CoreTuning
  /** Flight Lab: the chase camera (see CameraRigId), on either core. Switches live. */
  cameraRig: CameraRigId
  /** Flight Lab: CAMERA_TRACE being recorded, or null (src/render/cameraTrace.ts). */
  cameraTrace: CameraTrace | null
  resetId: number
  timeScale: number
  reducedMotion: boolean
  /** Requests one frame while paused; set by the mounted scene. */
  invalidate?: () => void
  /** Plays the tone for a refused press; set by the mounted scene. */
  refused?: (kind: RefusalTone) => void
}
