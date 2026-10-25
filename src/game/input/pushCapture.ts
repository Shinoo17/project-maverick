import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'

/*
Post-stall push capture (owner request, 23 Oct 2026). An input-side assist, like mouse aim's
instructor: it shapes the pitch command the pilot sends and records nothing in the aircraft,
so the flight model keeps no PSM state and a replay of the commands flies the same. Keyboard
and the stick mouse modes only: mouse aim's instructor has its own hands-off recovery.

A push started in post-stall (a Cobra being brought back) stops the nose on the horizon instead
of carrying it on down into an outside tumble. It holds there for as long as the push is held.
Throttle lets it go: with W or the afterburner on, the push goes on below the horizon, and when
the stick is centred the nose is held at the elevation it was let go at while the
thrust brings the flight path round behind it, so a pilot can follow a target downhill at, say,
-20° with speed building and the jet under control. That hold lasts until the flow reattaches.

A pull, a centred stick without throttle (the ordinary recovery takes over) or a centred hold
reaching reattached flow disarms it, so a push started later in attached flight is an ordinary
push. A push held all along stays on the horizon even after the flow reattaches.

Only the upright side is captured (body up pointing up): past the vertical in a deep Cobra
the push is still bringing the nose back over the top, and nothing there is below the horizon
in the sense the pilot means.
*/
export const PUSH_CAPTURE = {
  /** highAoa a push has to start in (or reach) to arm the capture. */
  armHighAoa: 0.5,
  /** Body up's world-up component below which the capture stands down. */
  upright: 0.2,
  /** Rate at which the nose is brought onto the horizon, per second of elevation (1/s). */
  captureRate: 5,
  /** Pitch command per rad/s of elevation-rate error. */
  gain: 1.5,
  /** highAoa below which the flow counts as reattached and the hold lets go. */
  attached: 0.05,
}

/** `hold`: the elevation (radians) the stick was centred at under throttle, flown until reattached flow. */
export interface PushCapture { armed: boolean; hold: number | null }
export const createPushCapture = (): PushCapture => ({ armed: false, hold: null })

const ORIENTATION = new Quaternion(), NOSE = new Vector3(), UP = new Vector3(), RIGHT = new Vector3()

/**
 * The pitch command after the capture. `pitch` is the pilot's (stick, keys or instructor);
 * `throttle` is W or the afterburner. Never touches a pull or a throttled push: it eases an
 * unthrottled push onto the horizon, and holds the nose still for a centred stick under throttle.
 */
export function capturePush(capture: PushCapture, pose: AircraftState | null, highAoa: number, pitch: number, throttle: boolean) {
  // A held push stays captured even once the flow reattaches at level: only the throttle or
  // letting go releases it. The centred hold under throttle ends with reattached flow.
  if (pitch > 0 || !pose?.alive || (pitch === 0 && (!throttle || highAoa <= PUSH_CAPTURE.attached))) { capture.armed = false; capture.hold = null; return pitch }
  if (pitch < 0) capture.hold = null
  if (pitch < 0 && highAoa > PUSH_CAPTURE.armHighAoa) capture.armed = true
  // A throttled push is the pilot's to fly.
  if (!capture.armed || (pitch < 0 && throttle)) return pitch
  ORIENTATION.copy(pose.orientation as Quaternion)
  NOSE.set(1, 0, 0).applyQuaternion(ORIENTATION)
  UP.set(0, 1, 0).applyQuaternion(ORIENTATION)
  if (UP.y < PUSH_CAPTURE.upright) return pitch
  RIGHT.set(0, 0, 1).applyQuaternion(ORIENTATION)
  const elevation = Math.asin(Math.max(-1, Math.min(1, NOSE.y)))
  // The nose turns at pitch·up + yaw·right (canonical body axes), so this is how fast the
  // elevation is changing now.
  const rate = (pose.rates.pitch * UP.y + pose.rates.yaw * RIGHT.y) / Math.max(Math.cos(elevation), 0.05)
  // Centred under throttle: hold the elevation it was let go at (the nose is still turning when
  // the stick reaches the middle, so stopping it wherever it is would land well past that).
  // Pushing: bring it onto the horizon.
  if (pitch === 0 && capture.hold === null) capture.hold = elevation
  const wanted = -PUSH_CAPTURE.captureRate * (elevation - (pitch === 0 ? capture.hold! : 0))
  const command = Math.max(-1, Math.min(1, PUSH_CAPTURE.gain * (wanted - rate) / UP.y))
  return pitch === 0 ? command : Math.max(pitch, command)
}
