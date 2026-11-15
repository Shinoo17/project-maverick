/*
CAMERA_TRACE: a per-frame dump of the chase camera (C4), for
reading a camera glitch from numbers instead of from memory. The active rig (FlightCamera, or the
rewrite's ChaseCamera) writes one frame at the end of each update while a trace is attached
(`rig.trace`); it only reads what the update already computed, so the shot is the same with or
without it. Flight Lab records and exports it. `rig` says which camera wrote the frame; the two
carry different blend weights.

Version 2 (FR2) added `rig` and the ChaseCamera frames; legacy frames are otherwise as in version 1.
*/
type V3 = [number, number, number]
interface TraceFrameBase {
  /** Frame index since the trace started, and the summed camera dt (s). */
  frame: number; t: number; dt: number
  style: 'balanced' | 'dynamic' | 'aircraft'
  /** The rendered view after free look: eye, look direction, up, vertical FOV (degrees). */
  position: V3; look: V3; up: V3; fov: number
  /** The chase shot before free look: its look and up, and the boom offset from the jet. */
  chase: { look: V3; up: V3; boom: V3 }
  /** The flight it framed (readout at the drawn pose; rates in rad/s). */
  flight: { alphaDeg: number; betaDeg: number; incidenceDeg: number; confidence: number; airspeed: number; rates: { pitch: number; yaw: number; roll: number } }
}
/** Legacy FlightCamera blend weights, 0..1 unless noted. psm and decoupled are the PSM-shot and decouple shares the
 * frame used (after Aircraft locked's drift took its part); gap, boomGap and rollLag are roll angles (rad). */
export interface LegacyCameraBlend { decouple: number; handover: number; drift: number; driftLag: number; psm: number; decoupled: number; aimShare: number; gunZoom: number; gap: number; boomGap: number; rollLag: number; lookingAway: boolean }
/** ChaseCamera blend. drift 0..1 (game/camera/chaseBlend.ts); pathOffsetDeg how far the look target left the
 * nose toward the path; levelShare the level horizon's share (0 inside the vertical cone); rollTarget,
 * levelGap and orbitLag roll angles (rad); rollRate rad/s, lookRate rad/s; lookLag and rollLag the springs' lags (s). */
export interface ChaseCameraBlend { drift: number; pathOffsetDeg: number; levelShare: number; rollTarget: number; levelGap: number; rollRate: number; lookRate: number; lookLag: number; rollLag: number; orbitLag: number; aimShare: number; gunZoom: number; lookingAway: boolean }
export type CameraTraceFrame = TraceFrameBase & ({ rig: 'legacy'; blend: LegacyCameraBlend } | { rig: 'chase'; blend: ChaseCameraBlend })
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export const CAMERA_TRACE_VERSION = 2
// Two minutes at 144 FPS; older frames drop first.
const CAPACITY = 17280

export class CameraTrace {
  frames: CameraTraceFrame[] = []
  private count = 0
  private time = 0
  constructor(readonly capacity = CAPACITY) {}
  record(frame: DistributiveOmit<CameraTraceFrame, 'frame' | 't'>) {
    this.time += frame.dt
    this.frames.push({ frame: this.count++, t: this.time, ...frame } as CameraTraceFrame)
    if (this.frames.length > this.capacity) this.frames.splice(0, this.frames.length - this.capacity)
  }
  clear() { this.frames = []; this.count = 0; this.time = 0 }
  toJSON() { return { version: CAMERA_TRACE_VERSION, frames: this.frames } }
}
