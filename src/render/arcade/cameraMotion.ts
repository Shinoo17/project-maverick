import * as THREE from 'three';

/*
How hard the picture moves (camera plan C0): the numbers behind "too fast, makes me dizzy".

Fed the drawn view once per frame, it reads how fast the look direction turns (deg/s), how fast
that turn rate itself changes (deg/s², the jerk of a pan starting or stopping), how fast the view
rolls about its own axis (deg/s) and how far the FOV has swung. It keeps the latest values and the
peaks since the last reset. Only reads; used by the camera trace and the camera motion tests.
*/

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

export interface CameraMotionSample {
  /** Turn rate of the look direction (deg/s). */
  lookRateDeg: number;
  /** Change of the look turn rate vector (deg/s²). */
  lookAccelDeg: number;
  /** Roll rate about the look direction (deg/s, signed). */
  rollRateDeg: number;
}

export interface CameraMotionPeaks {
  lookRateDeg: number;
  lookAccelDeg: number;
  rollRateDeg: number;
  /** Smallest and largest FOV seen (deg). */
  fovMin: number;
  fovMax: number;
}

export class CameraMotionMeter {
  readonly last: CameraMotionSample = { lookRateDeg: 0, lookAccelDeg: 0, rollRateDeg: 0 };
  readonly peak: CameraMotionPeaks = { lookRateDeg: 0, lookAccelDeg: 0, rollRateDeg: 0, fovMin: Infinity, fovMax: -Infinity };
  private started = false;
  private hasRate = false;
  private readonly look = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly rate = new THREE.Vector3();
  private readonly _f = new THREE.Vector3();
  private readonly _u = new THREE.Vector3();
  private readonly _w = new THREE.Vector3();
  private readonly _p = new THREE.Vector3();

  reset(): void {
    this.started = this.hasRate = false;
    Object.assign(this.last, { lookRateDeg: 0, lookAccelDeg: 0, rollRateDeg: 0 });
    Object.assign(this.peak, { lookRateDeg: 0, lookAccelDeg: 0, rollRateDeg: 0, fovMin: Infinity, fovMax: -Infinity });
  }

  /** Read one frame: the drawn view's orientation (three.js camera, looking down -Z), its FOV and the frame's dt. */
  sample(quaternion: THREE.Quaternion, fov: number, dt: number): CameraMotionSample {
    const f = this._f.copy(FWD).applyQuaternion(quaternion);
    const u = this._u.copy(UP).applyQuaternion(quaternion);
    this.peak.fovMin = Math.min(this.peak.fovMin, fov);
    this.peak.fovMax = Math.max(this.peak.fovMax, fov);
    if (this.started && dt > 0) {
      // Look turn as a rotation vector (rad/s): axis look × f, size the angle.
      const w = this._w.crossVectors(this.look, f);
      const s = w.length();
      if (s > 1e-12) w.multiplyScalar(Math.atan2(s, this.look.dot(f)) / s / dt);
      const lookRate = THREE.MathUtils.radToDeg(w.length());
      const lookAccel = this.hasRate ? THREE.MathUtils.radToDeg(this._p.copy(w).sub(this.rate).length() / dt) : 0;
      this.rate.copy(w);
      this.hasRate = true;
      // Roll: the old up carried over to the new look by the least turn, against the new up.
      const carried = this._p.copy(this.up).addScaledVector(f, -this.up.dot(f));
      let roll = 0;
      if (carried.lengthSq() > 1e-10) {
        carried.normalize();
        roll = Math.atan2(this._w.crossVectors(carried, u).dot(f), carried.dot(u)) / dt;
      }
      const rollRate = THREE.MathUtils.radToDeg(roll);
      this.last.lookRateDeg = lookRate;
      this.last.lookAccelDeg = lookAccel;
      this.last.rollRateDeg = rollRate;
      this.peak.lookRateDeg = Math.max(this.peak.lookRateDeg, lookRate);
      this.peak.lookAccelDeg = Math.max(this.peak.lookAccelDeg, lookAccel);
      this.peak.rollRateDeg = Math.max(this.peak.rollRateDeg, Math.abs(rollRate));
    }
    this.look.copy(f);
    this.up.copy(u);
    this.started = true;
    return this.last;
  }
}
