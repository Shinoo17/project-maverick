import { Quaternion, Vector3 } from 'three'

/*
Body frames. example/flight-control's are forward +Z, up +Y, left +X; this project's are forward
+X, up +Y, right +Z. The same airframe in the example's frame is this project's orientation
turned a quarter turn about body Y. World axes are the same in both (Y up).
*/
/** This project's body frame → the example's: a quarter turn about body Y (+Z → +X). */
export const EXAMPLE_BODY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)

/** Writes the example-frame orientation of a project orientation into `out`. */
export function toExampleFrame(orientation: { x: number; y: number; z: number; w: number }, out = new Quaternion()) {
  return out.set(orientation.x, orientation.y, orientation.z, orientation.w).multiply(EXAMPLE_BODY)
}
