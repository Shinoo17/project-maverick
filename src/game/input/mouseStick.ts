import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import type { CameraRollMode } from '../../render/FlightCamera'

/*
The mouse is a position on the glass, not an accumulation of travel.

Where the pointer sits inside the gate is where the stick sits: the middle of the screen is
neutral, the top of the gate is full aft, and the pilot's hand is a readout of the control
they are holding. Levelling out is "put the pointer back in the middle", a thing the hand
already knows how to do, rather than a travel to retrace by eye.

Ported from the F-22 reference implementation in example/F22, whose numbers this keeps.
*/

// Gate radius as a fraction of the shorter side of the surface, at 1x sensitivity. One
// radius rather than one per axis, because the gate is a disc: a diagonal must reach full
// deflection at the same distance from the middle as a straight pull, and a rolling pull-up
// is a diagonal.
export const MOUSE_STICK = {
  radius: 0.34,
  // Wide, because a positional stick has exactly one neutral. The dead zone is what makes
  // the middle a place the pointer can be put back into rather than a point to balance on.
  deadZone: 0.12,
  // Fine around neutral, decisive at the edges.
  curve: 2,
} as const

/*
How much of the screen the pilot has to cross for full stick, as a divisor on the gate
radius. A continuous setting rather than named steps, because the right number is a property
of the pilot's screen and how close they sit to it. At the floor the gate spans most of the
window — a pointer that roams the whole screen — and at the ceiling about a sixth of it.
*/
export const MOUSE_SENSITIVITY = { min: 0.5, max: 2, default: 1 } as const
export function clampSensitivity(value: number) {
  return Number.isFinite(value)
    ? Math.max(MOUSE_SENSITIVITY.min, Math.min(MOUSE_SENSITIVITY.max, value))
    : MOUSE_SENSITIVITY.default
}

export interface MouseStick { px: number; py: number; x: number; y: number; live: boolean }
export interface StickAxes { pitch: number; roll: number }

export const createMouseStick = (): MouseStick => ({ px: 0, py: 0, x: 0, y: 0, live: false })

export function stickRadiusPx(extent: number, sensitivity: number = MOUSE_SENSITIVITY.default) {
  return Math.max(Number(extent) || 0, 1) * MOUSE_STICK.radius / clampSensitivity(sensitivity)
}

// Pixels from the middle of the gate into gate radii, and into the aircraft's signs: right
// is positive roll, and up the screen — a negative pixel offset — is positive pitch.
function shape(stick: MouseStick, radius: number) {
  stick.x = stick.px / radius
  stick.y = -stick.py / radius
  return stick
}

/*
Walk the held position by the raw motion a locked pointer reports.

Clamped to the gate every step, by length rather than per axis. Unclamped, a hand shoved a
long way left would have to travel all of it back before the nose answered — the windup a
real stick's spring exists to prevent. Clamped per axis, the gate would quietly become a box
and a corner would take further to reach than a straight pull.
*/
export function moveStick(stick: MouseStick, deltaX: number, deltaY: number, extent: number, sensitivity?: number) {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return stick
  // Recomputed per step, so a resized window or a moved sensitivity simply re-clamps what is
  // held instead of stranding it outside a smaller gate.
  const radius = stickRadiusPx(extent, sensitivity)
  const px = stick.px + deltaX, py = stick.py + deltaY
  const magnitude = Math.hypot(px, py)
  const scale = magnitude > radius ? radius / magnitude : 1
  stick.px = px * scale; stick.py = py * scale
  return shape(stick, radius)
}

export const refitStick = (stick: MouseStick, extent: number, sensitivity?: number) =>
  moveStick(stick, 0, 0, extent, sensitivity)

// Neutral with the stick still flying. The held position goes too, or a locked pointer
// would resume from a deflection the hand had let go of.
export function centreStick(stick: MouseStick) {
  stick.px = 0; stick.py = 0; stick.x = 0; stick.y = 0
  return stick
}

// The surface has taken the pointer: centred first, then live, so the gate reads neutral
// from the first frame rather than appearing on the first twitch of the hand.
export const engageStick = (stick: MouseStick) => { centreStick(stick); stick.live = true; return stick }
export const clearStick = (stick: MouseStick) => { centreStick(stick); stick.live = false; return stick }

/*
Shape the stick into pitch/roll. Null when the mouse is not flying, which the caller reads as
"no mouse axis" rather than as a neutral stick — only the first leaves the keyboard alone.

`screen` is the frame the drawn vector is read in: `angle` is how far the airframe appears
rotated inside it, in radians, clockwise positive on screen, and `blend` is how much of that
correction applies — see `screenFrame`. It exists because a position on the glass only means anything while
screen-up is body pitch-up, and a camera that holds the horizon breaks that. Turning the
drawn vector into the airframe's frame first is what makes every one of these true at once:
pull down and the nose goes down; pull down while inverted and the correction turns it into
body pitch-up, so the nose still goes toward the ground; point at the top of the screen from
a knife edge and it is a pure roll back to level; and swirl the pointer around the gate and
the aircraft rolls with it, because the command has to keep turning to stay ahead of the
bank it is producing.

The shaping is radial: the length is clamped to the gate, the dead zone is taken off it, the
curve is applied to what is left, and the direction is carried through untouched.
*/
export function readStickAxes(stick: MouseStick, screen: ScreenFrame = LEVEL_FRAME): StickAxes | null {
  if (!stick.live) return null
  const magnitude = Math.hypot(stick.x, stick.y)
  if (magnitude < 1e-6) return { pitch: 0, roll: 0 }
  const travel = Math.min(magnitude, 1)
  if (travel <= MOUSE_STICK.deadZone) return { pitch: 0, roll: 0 }
  let x = stick.x, y = stick.y
  if (screen.angle && screen.blend) {
    const cos = Math.cos(screen.angle), sin = Math.sin(screen.angle)
    x += (stick.x * cos - stick.y * sin - stick.x) * screen.blend
    y += (stick.x * sin + stick.y * cos - stick.y) * screen.blend
  }
  const live = (travel - MOUSE_STICK.deadZone) / (1 - MOUSE_STICK.deadZone)
  const scale = live ** MOUSE_STICK.curve / magnitude
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  return { pitch: clamp(y * scale), roll: clamp(x * scale) }
}

/*
How far the airframe appears rotated inside the frame, in radians, clockwise positive on
screen: its bank about the flight axis, measured against the horizon the camera is holding.

Read off the attitude rather than off the camera's own up on purpose. The camera's up is
smoothed, and a control that reads a smoothed vector which is itself chasing the aircraft
closes a loop: in a steep dive the correction turns elevator into aileron, the roll moves the
horizon reference, and the aircraft settles into a barrel roll nobody asked for. The two
camera modes are the two ends of the same quantity — 'aircraft' rides the whole bank and
leaves nothing on screen, 'horizon' holds level and leaves all of it — so neither needs the
rig to say so, and the answer is identical at every render rate.
*/
export interface ScreenFrame { angle: number; blend: number }
export const LEVEL_FRAME: ScreenFrame = { angle: 0, blend: 1 }
const FORWARD = new Vector3(), BODY_UP = new Vector3(), LEVEL_UP = new Vector3(), LEVEL_RIGHT = new Vector3()
const ORIENTATION = new Quaternion()
/*
Half-width of the cone around the vertical, as the horizontal length of the nose, over which
the correction is blended out.

Blended between the two *commands* rather than applied as a fraction of the angle. Scaling
the angle is the tempting version and it is wrong: half of a 180-degree bank is a knife edge,
so a pull straight down would find a bank nobody asked for and sit on it. Blending the
commands has the property the attitude actually calls for — straight down, "further down" is
not a direction, and the two readings cancel to neutral, so the aircraft holds the dive
instead of chattering across the branch cut at the pole.
*/
const VERTICAL_CONE = { start: 0.1, end: 0.35 }
/*
How far the airframe appears rotated inside the frame, in radians, clockwise positive on
screen: its bank about the flight axis, measured against the horizon the camera is holding.

Read off the attitude rather than off the camera's own up on purpose. The camera's up is
smoothed, and a control that reads a smoothed vector which is itself chasing the aircraft
closes a loop: in a steep dive the correction turns elevator into aileron, the roll moves the
horizon reference, and the aircraft settles into a barrel roll nobody asked for. The two
camera modes are the two ends of the same quantity — 'aircraft' rides the whole bank and
leaves nothing on screen, 'horizon' holds level and leaves all of it — so neither needs the
rig to say so, and the answer is identical at every render rate.
*/
export function screenFrame(state: AircraftState, mode: CameraRollMode): ScreenFrame {
  if (mode === 'aircraft') return LEVEL_FRAME
  ORIENTATION.copy(state.orientation as Quaternion)
  FORWARD.set(1, 0, 0).applyQuaternion(ORIENTATION)
  BODY_UP.set(0, 1, 0).applyQuaternion(ORIENTATION)
  const horizon = Math.hypot(FORWARD.x, FORWARD.z)
  const t = Math.min(Math.max((horizon - VERTICAL_CONE.start) / (VERTICAL_CONE.end - VERTICAL_CONE.start), 0), 1)
  if (t === 0) return LEVEL_FRAME
  LEVEL_UP.set(0, 1, 0).addScaledVector(FORWARD, -FORWARD.y).normalize()
  LEVEL_RIGHT.crossVectors(FORWARD, LEVEL_UP)
  return { angle: Math.atan2(BODY_UP.dot(LEVEL_RIGHT), BODY_UP.dot(LEVEL_UP)), blend: t * t * (3 - 2 * t) }
}
