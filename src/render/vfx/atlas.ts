/*
The particle sprite atlas: sprites drawn at load into one 4 × 4 canvas so every particle of a
layer is one draw call. Two sprite sets fill it, both CC0 from Kenney (License.txt beside each):

- classic: eight sprites from the Particle Pack (public/assets/vfx/kenney-particle). Each is
  a grey shape with alpha; particles tint it.
- smoke: the Smoke Particles pack (public/assets/vfx/kenney-smoke-particles) for the
  fireball, smoke and hot core, painted in colour, with several shapes of each so a cluster
  does not repeat one puff. The rays, streak, glow and ring stay from the Particle Pack.

A particle names a role (Sprite), not a cell; the set maps each role to its cells and the
layer picks one per particle. A painted cell keeps its own colour: the particle's tint is
divided by the cell's reference tint, so a particle at that tint draws the sprite as painted
and the recipe's fade (fire cooling to char, dark smoke thinning to grey) shifts it from there.

The sprites are data, not colour: the texture has no colour space, so nothing converts them.
The shader decodes painted cells from sRGB itself.
*/
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, type Texture } from 'three'

export const ATLAS = { columns: 4, rows: 4, cell: 256 } as const

/** Particle roles. */
export const Sprite = {
  /** Lumpy smoke puff. */
  smoke: 0,
  /** Rounder, denser puff, for fireballs. */
  puff: 1,
  /** Bright ragged burst, the fireball's hot core. */
  fire: 2,
  /** Star burst with rays. */
  burst: 3,
  /** Four-point flash. */
  flash: 4,
  /** Thin vertical streak, stretched along a spark's motion. */
  streak: 5,
  /** Soft round glow. */
  glow: 6,
  /** Ring, for the shock wave. */
  ring: 7,
} as const
export type SpriteIndex = typeof Sprite[keyof typeof Sprite]
const ROLES = Object.keys(Sprite).length

export type SpriteSet = 'classic' | 'smoke'
export const SPRITE_SETS: readonly SpriteSet[] = ['classic', 'smoke']

const PARTICLE = `${import.meta.env.BASE_URL}assets/vfx/kenney-particle/png_transparent/`
const SMOKE = `${import.meta.env.BASE_URL}assets/vfx/kenney-smoke-particles/PNG/`
interface Cell {
  file: string
  role: SpriteIndex
  /** Painted cells only: the linear tint at which the sprite draws as painted. */
  reference?: readonly [number, number, number]
}
const grey = (role: SpriteIndex, name: string): Cell => ({ file: `${PARTICLE}${name}.png`, role })
// The tints effects.ts starts each painted role at: SMOKE, FIRE and HOT.
const painted = (role: SpriteIndex, reference: Cell['reference'], folder: string, names: string[]) =>
  names.map((name): Cell => ({ file: `${SMOKE}${folder}/${name}.png`, role, reference }))
const SHARED = [grey(Sprite.burst, 'scorch_02'), grey(Sprite.flash, 'star_06'), grey(Sprite.streak, 'trace_01'), grey(Sprite.glow, 'circle_05'), grey(Sprite.ring, 'circle_02')]
const SETS: Record<SpriteSet, Cell[]> = {
  classic: [grey(Sprite.smoke, 'smoke_04'), grey(Sprite.puff, 'smoke_07'), grey(Sprite.fire, 'fire_01'), ...SHARED],
  smoke: [
    ...painted(Sprite.smoke, [0.13, 0.12, 0.11], 'Black smoke', ['blackSmoke00', 'blackSmoke06', 'blackSmoke12', 'blackSmoke18']),
    ...painted(Sprite.puff, [1, 0.42, 0.06], 'Explosion', ['explosion00', 'explosion02', 'explosion04', 'explosion06']),
    ...painted(Sprite.fire, [1, 0.85, 0.5], 'Flash', ['flash01', 'flash03']),
    ...SHARED,
  ],
}

export interface ParticleAtlas {
  texture: Texture
  /** Atlas cells by role. */
  cells: readonly (readonly number[])[]
  /** Per cell: reference tint and 1 for a painted cell, zeros for a grey one. */
  painted: Float32Array
}

/** Loads a sprite set into one texture. Resolves once all are drawn. */
export async function loadParticleAtlas(set: SpriteSet = 'classic'): Promise<ParticleAtlas> {
  const list = SETS[set]
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS.columns * ATLAS.cell
  canvas.height = ATLAS.rows * ATLAS.cell
  const context = canvas.getContext('2d')!
  await Promise.all(list.map((cell, index) => new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      // Fitted into the cell without stretching: the painted sprites are not square.
      const fit = ATLAS.cell / Math.max(image.width, image.height), w = image.width * fit, h = image.height * fit
      const x = (index % ATLAS.columns) * ATLAS.cell + (ATLAS.cell - w) / 2, y = Math.floor(index / ATLAS.columns) * ATLAS.cell + (ATLAS.cell - h) / 2
      context.drawImage(image, x, y, w, h)
      resolve()
    }
    image.onerror = () => reject(new Error(`Particle sprite ${cell.file} did not load`))
    image.src = cell.file
  })))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = NoColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  const cells = Array.from({ length: ROLES }, (_, role) => list.flatMap((cell, index) => cell.role === role ? [index] : []))
  const paintedCells = new Float32Array(ATLAS.columns * ATLAS.rows * 4)
  list.forEach((cell, index) => { if (cell.reference) paintedCells.set([...cell.reference, 1], index * 4) })
  return { texture, cells, painted: paintedCells }
}
