import { MathUtils, Vector3, type Camera } from 'three';
import { CAMERA, DEG2RAD, MOUSE } from './config';
import { leveled } from './levelView';

/**
 * The view the mouse aims through: its axes and, for `MOUSE.fovSensitivity`,
 * its FOV as shown and from speed alone. In the game this is
 * `ChaseCamera.steady`, the view without camera shake.
 */
export type AimView = Camera & { fov?: number; speedFov?: number };

/**
 * The direction the player wants the nose to point, stored as a world-space
 * unit vector (never as screen position or yaw/pitch angles, so it has no
 * gimbal problems near vertical and does not drift when the camera moves).
 *
 * Mouse deltas rotate it about the *camera's* current right and up axes, so
 * "mouse up" means "up on screen" in every camera mode: body-up in aircraft
 * lock (even inverted), sky-up in horizon lock.
 */
export class MouseAim {
  readonly dir = new Vector3(0, 0, -1);
  /** Seconds since the aim was last moved by the mouse or a sync. */
  idle = 0;
  /**
   * This project's (not in the example): turn about the view's axes with its bank lean taken out
   * (./levelView.ts), so a hand moving right goes along the horizon however the picture leans.
   * Set for Horizon lock and Aim lock; off, the view's own axes as in the example.
   */
  level = false;
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();

  /** Rotate by a mouse delta in pixels, using `camera`'s axes (and its FOV as `MOUSE.fovSensitivity` says). */
  rotate(dx: number, dy: number, camera: AimView): void {
    if (dx === 0 && dy === 0) return;
    this.idle = 0;
    const k = MOUSE.sensitivityDegPerPx * DEG2RAD * fovScale(camera);
    const e = camera.matrixWorld.elements;
    // Camera basis from its world matrix: column 0 = right, column 1 = up.
    const right = this._a.set(e[0], e[1], e[2]).normalize();
    const up = this._b.set(e[4], e[5], e[6]).normalize();
    if (this.level) leveled(camera, right, up);
    // Mouse right turns the aim right: a negative rotation about camera up.
    this.dir.applyAxisAngle(up, -dx * k);
    // Pointer y grows downward: mouse up (dy < 0) rotates the aim up.
    this.dir.applyAxisAngle(right, (MOUSE.invertY ? dy : -dy) * k);
    this.dir.normalize();
  }

  /** Keep the aim within `MOUSE.coneDeg` of the nose. */
  clampToCone(nose: Vector3): void {
    const max = MOUSE.coneDeg * DEG2RAD;
    const angle = this.dir.angleTo(nose);
    if (angle <= max) return;
    // Rotate the aim back toward the nose along the great circle between them.
    const axis = this._a.crossVectors(nose, this.dir);
    if (axis.lengthSq() < 1e-12) {
      // Exactly opposite: any perpendicular works.
      axis.set(1, 0, 0).cross(nose);
      if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1).cross(nose);
    }
    axis.normalize();
    this.dir.copy(nose).applyAxisAngle(axis, max).normalize();
  }

  syncTo(nose: Vector3): void {
    this.dir.copy(nose).normalize();
    this.idle = 0;
  }

  /** Angle between aim and `nose`, degrees. */
  errorDeg(nose: Vector3): number {
    return MathUtils.radToDeg(this.dir.angleTo(nose));
  }
}

/** Aim rotation per pixel at this view's FOV, relative to `MOUSE.sensitivityDegPerPx`. */
function fovScale(camera: AimView): number {
  switch (MOUSE.fovSensitivity) {
    case 'angular':
      return 1;
    case 'screen':
      return (camera.fov ?? CAMERA.fovBase) / CAMERA.fovBase;
    case 'baseFov':
      return (camera.speedFov ?? camera.fov ?? CAMERA.fovBase) / CAMERA.fovBase;
    default: {
      const never: never = MOUSE.fovSensitivity;
      throw new Error(`unknown MOUSE.fovSensitivity ${never as string}`);
    }
  }
}
