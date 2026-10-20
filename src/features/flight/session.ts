import type { GameRuntime } from '../../game/runtime/GameRuntime'
import type { FlightInput, InputPreset } from '../../game/input/FlightInput'
import type { CameraSettings } from '../../game/camera/cameraSettings'
import type { GraphicsSettings } from '../../render/graphicsSettings'
import type { TargetDroneMode } from '../../game/playground/dronePath'
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
  resetId: number
  timeScale: number
  reducedMotion: boolean
  /** Requests one frame while paused; set by the mounted scene. */
  invalidate?: () => void
}
