/*
The particle sprite atlas: eight sprites from Kenney's Particle Pack (CC0, public/assets/vfx/
kenney-particle, License.txt there), drawn at load into one 4 × 2 canvas so every particle of a
layer is one draw call. Each sprite is a grey shape with alpha; particles tint it.

The sprites are data, not colour: the texture has no colour space, so nothing converts them.
*/
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace } from 'three'

const FOLDER = `${import.meta.env.BASE_URL}assets/vfx/kenney-particle/png_transparent/`
/** Sprites in atlas order: index = row × 4 + column, rows from the top. */
const SPRITES = ['smoke_04', 'smoke_07', 'fire_01', 'scorch_02', 'star_06', 'trace_01', 'circle_05', 'circle_02'] as const
export const ATLAS = { columns: 4, rows: 2, cell: 256 } as const

/** Atlas cells by use. */
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

/** Loads the sprites into one texture. Resolves once all are drawn. */
export async function loadParticleAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS.columns * ATLAS.cell
  canvas.height = ATLAS.rows * ATLAS.cell
  const context = canvas.getContext('2d')!
  await Promise.all(SPRITES.map((name, index) => new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const x = (index % ATLAS.columns) * ATLAS.cell, y = Math.floor(index / ATLAS.columns) * ATLAS.cell
      context.drawImage(image, x, y, ATLAS.cell, ATLAS.cell)
      resolve()
    }
    image.onerror = () => reject(new Error(`Particle sprite ${name} did not load`))
    image.src = `${FOLDER}${name}.png`
  })))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = NoColorSpace
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  return texture
}
