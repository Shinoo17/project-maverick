import type { GameRuntime } from '../../game/runtime/GameRuntime'
import type { FlightInput, InputPreset } from '../../game/input/FlightInput'
import type { CameraRollMode } from '../../render/FlightCamera'
export interface FlightSession {
  runtime: GameRuntime | null
  input: FlightInput
  preset: InputPreset
  cameraMode: CameraRollMode
  running: boolean
  resetId: number
}
