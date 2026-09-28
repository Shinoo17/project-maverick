/*
Hitboxes: the simple shapes that bullets and missiles test against.

Shapes are in the aircraft body frame, in metres: +X forward, +Y up, +Z right,
origin at the centre of the model's bounding box in its first animation frame
(gear up). They were fitted to the flight models after scaling to
`flightModelLength` (see src/content/aircraft), so a change to that scale must
refit these shapes; tests/hitboxes.test.ts checks the fit. Visual LOD never
changes them.

A capsule is a segment `from`→`to` grown by `radius`. A box is axis-aligned in
the body frame, given by its centre and half size on each axis.
*/
export type Tuple3 = [number, number, number]
export type HitShape =
  | { kind: 'capsule'; from: Tuple3; to: Tuple3; radius: number }
  | { kind: 'box'; center: Tuple3; half: Tuple3 }

export const hitboxes: Record<string, HitShape[]> = {
  f22: [
    { kind: 'capsule', from: [-8, -1.1, 0], to: [6, -1.1, 0], radius: 0.9 }, // fuselage
    { kind: 'capsule', from: [6, -1.1, 0], to: [8.9, -1.1, 0], radius: 0.45 }, // nose cone
    { kind: 'capsule', from: [2.5, -0.4, 0], to: [5.8, -0.4, 0], radius: 0.7 }, // canopy
    { kind: 'box', center: [-2.25, -1.25, 0], half: [5.75, 0.75, 2] }, // flat centre body, intakes and engines
    { kind: 'box', center: [-3, -1.05, 0], half: [3, 0.3, 4.5] }, // inner wing
    { kind: 'box', center: [-4.9, -1.05, 0], half: [1.3, 0.25, 6.8] }, // outer wing to the tips
    { kind: 'box', center: [-8.3, -0.9, 0], half: [1.1, 0.35, 4.3] }, // horizontal tails
    { kind: 'box', center: [-6, 0.92, -2.35], half: [1.5, 1.1, 0.65] }, // left fin
    { kind: 'box', center: [-6, 0.92, 2.35], half: [1.5, 1.1, 0.65] }, // right fin
  ],
  su57: [
    { kind: 'capsule', from: [-8, -0.6, 0], to: [6, -0.6, 0], radius: 0.9 }, // fuselage
    { kind: 'capsule', from: [6, -0.6, 0], to: [8.9, -0.6, 0], radius: 0.45 }, // nose cone
    { kind: 'capsule', from: [2.5, -0.2, 0], to: [5.8, -0.2, 0], radius: 0.85 }, // canopy
    { kind: 'box', center: [-3.5, -0.7, 0], half: [4.5, 0.6, 2.4] }, // flat centre body and engines
    { kind: 'box', center: [-4.25, -0.7, 0], half: [2.75, 0.3, 4.5] }, // inner wing
    { kind: 'box', center: [-5.25, -0.7, 0], half: [1.25, 0.25, 6.8] }, // outer wing to the tips
    { kind: 'box', center: [-8.4, -0.7, 0], half: [1.1, 0.3, 4.8] }, // horizontal tails
    { kind: 'box', center: [-7.3, 0.9, -3.1], half: [0.9, 0.6, 0.3] }, // left fin
    { kind: 'box', center: [-7.3, 0.9, 3.1], half: [0.9, 0.6, 0.3] }, // right fin
  ],
}

export function validateHitboxes(shapes: readonly HitShape[], path: string) {
  if (!shapes.length) throw new Error(`${path}: expected at least one shape`)
  const finite = (values: readonly number[]) => values.length === 3 && values.every(Number.isFinite)
  shapes.forEach((shape, index) => {
    const at = `${path}[${index}]`
    if (shape.kind === 'capsule') {
      if (!finite(shape.from) || !finite(shape.to)) throw new Error(`${at}: expected finite capsule ends`)
      if (!(shape.radius > 0)) throw new Error(`${at}.radius: expected a positive number`)
    } else if (shape.kind === 'box') {
      if (!finite(shape.center)) throw new Error(`${at}.center: expected three finite numbers`)
      if (!finite(shape.half) || shape.half.some(value => value <= 0)) throw new Error(`${at}.half: expected three positive numbers`)
    } else throw new Error(`${at}.kind: unknown shape`)
  })
}
