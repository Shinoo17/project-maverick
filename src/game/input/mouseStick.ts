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

export const MOUSE_STICK = {
  // A fraction of the gate radius, but sized as hand travel: the dead zone is what makes the
  // middle a place the pointer can be put back into rather than a point to balance on, and
  // that is a distance the hand feels, not a share of the deflection.
  deadZone: 0.08,
  // Fine around neutral, decisive at the edges.
  curve: 2,
} as const

export interface MouseStick { px: number; py: number; x: number; y: number; live: boolean }
export interface StickAxes { pitch: number; roll: number }

export const createMouseStick = (): MouseStick => ({ px: 0, py: 0, x: 0, y: 0, live: false })

/*
The gate is the window: a rectangle the pointer roams to its corners, not a disc drawn inside
it. `halfWidth` and `halfHeight` are where the pointer stops, and `radius` — the shorter of
the two — is where full deflection is reached.

Two numbers rather than one because a screen is not square, and one scale rather than two
because the aircraft does not care that it isn't. Dividing each axis by its own half would
stretch the drawn vector, and a stretched vector cannot be turned into the airframe's frame
by a rotation: a hand moving in a circle would come out as an ellipse, and the roll rate
would throb through a swirl. So the pointer is measured in one currency, and the rectangle
only says how far it may go. Past the radius — the sides on a wide window, the corners on any
window — the command is already full, and the extra room buys direction rather than travel.

No sensitivity divisor: the gate is the screen the pilot is looking at, which is the one
number that needs no setting.
*/
export interface StickGate { halfWidth: number; halfHeight: number; radius: number }
export function stickGate(width: number, height: number): StickGate {
  const halfWidth = Math.max(Number(width) || 0, 1) / 2, halfHeight = Math.max(Number(height) || 0, 1) / 2
  return { halfWidth, halfHeight, radius: Math.min(halfWidth, halfHeight) }
}

// Pixels from the middle of the gate into gate radii — past one radius on the long axis this
// runs over 1, and the shaping saturates it — and into the aircraft's signs: right
// is positive roll, and up the screen — a negative pixel offset — is positive pitch.
function shape(stick: MouseStick, radius: number) {
  stick.x = stick.px / radius
  stick.y = -stick.py / radius
  return stick
}

/*
Walk the held position by the raw motion a locked pointer reports.

Clamped to the edges of the gate every step. Unclamped, a hand shoved a long way left would
have to travel all of it back before the nose answered — the windup a real stick's spring
exists to prevent. Clamped to the rectangle the windup is bounded by the gate itself: a
corner is a gate diagonal from the middle rather than a radius, and that is the price of
being able to put the pointer there at all.
*/
export function moveStick(stick: MouseStick, deltaX: number, deltaY: number, gate: StickGate) {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return stick
  const hold = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))
  // Clamped per step, so a resized window re-clamps what is held instead of stranding it
  // outside a smaller gate.
  stick.px = hold(stick.px + deltaX, gate.halfWidth)
  stick.py = hold(stick.py + deltaY, gate.halfHeight)
  return shape(stick, gate.radius)
}

export const refitStick = (stick: MouseStick, gate: StickGate) => moveStick(stick, 0, 0, gate)

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
a knife edge and it is a pure roll back to level; swirl the pointer around the gate and
the aircraft rolls with it, because the command has to keep turning to stay ahead of the
bank it is producing; and throw the pointer edge to edge and the aircraft rolls the half
turn across to the mirrored bank instead of stalling.

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
    /*
    In the airframe's frame the command is polar: roll is the sine of how far the bank is
    from the one the pointer asks for, pitch its cosine. A pointer thrown from one edge of
    the gate to the other lands half a turn away, where that sine is zero and the cosine is a
    push — the aircraft holds its bank and shoves. Past a quarter turn rolling further is
    never wrong, so the sine is held at full instead of decaying back to zero.

    Weighted by how sideways the pointer is: straight down is the one place the antipode is a
    real command, and a held pull through the vertical must stay a push. Sign is the sine's
    own, except within about fifteen degrees of the half turn where a degree of bank flips
    it — there the pointer's side of the gate decides, the one thing the hand can see.
    */
    if (y < 0) {
      const reach = Math.hypot(x, y)
      const side = Math.abs(x) > reach * 0.25 ? Math.sign(x) : Math.sign(stick.x) || Math.sign(x)
      if (side) x += (side * reach - x) * (Math.abs(stick.x) / magnitude)
    }
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
