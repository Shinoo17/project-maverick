import type { GameRuntime } from '../../game/runtime/GameRuntime'
import type { FlightInput, InputPreset } from '../../game/input/FlightInput'
import type { CameraSettings } from '../../game/camera/cameraSettings'
export interface FlightSession {
  runtime: GameRuntime | null
  input: FlightInput
  preset: InputPreset
  /** Mirrors the saved camera settings; the scene reads it every frame. */
  camera: CameraSettings
  running: boolean
  resetId: number
  timeScale: number
  reducedMotion: boolean
  /** Requests one frame while paused; set by the mounted scene. */
  invalidate?: () => void
}
