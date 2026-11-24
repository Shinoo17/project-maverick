import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { MouseAim } from '../src/game/control/MouseAim'
import { leveled, levelOffset, viewLean } from '../src/game/control/levelView'

/*
The hand steers along the horizon (src/game/control/levelView.ts): Horizon lock and Aim lock lean
the view with the bank, and that lean is taken out of the axes the mouse turns the aim about.
*/
const DEG = Math.PI / 180
/** A view looking along +X, `pitch` degrees up, rolled `roll` degrees clockwise as the pilot sees it. */
function view(roll: number, pitch = 0) {
  const camera = new PerspectiveCamera(62, 16 / 9, 0.5, 14000)
  camera.lookAt(new Vector3(Math.cos(pitch * DEG), Math.sin(pitch * DEG), 0))
  camera.rotateZ(-roll * DEG)
  camera.updateMatrixWorld()
  return camera
}

describe('level view', () => {
  it('a hand moving right turns the aim along the horizon however the view leans with the bank', () => {
    for (const roll of [-22, 0, 14, 35]) {
      const aim = new MouseAim()
      aim.level = true
      aim.dir.set(1, 0, 0)
      aim.rotate(300, 0, view(roll))
      // 21° to the right, and no higher or lower.
      expect(Math.abs(aim.dir.y)).toBeLessThan(1e-6)
      expect(Math.atan2(aim.dir.z, aim.dir.x) / DEG).toBeCloseTo(21, 3)
    }
  })

  it('and a hand moving up turns it straight up', () => {
    const aim = new MouseAim()
    aim.level = true
    aim.dir.set(1, 0, 0)
    aim.rotate(0, -200, view(22))
    expect(Math.abs(aim.dir.z)).toBeLessThan(1e-6)
    expect(Math.asin(aim.dir.y) / DEG).toBeCloseTo(14, 3)
  })

  it('without it (Aircraft lock) the view\'s own axes stand, as in the example', () => {
    const aim = new MouseAim()
    aim.dir.set(1, 0, 0)
    aim.rotate(300, 0, view(22))
    // Right on the leaning picture is right and down in the world.
    expect(Math.asin(aim.dir.y) / DEG).toBeLessThan(-7)
  })

  it('takes out only a lean: a view on its side or its back, or near the vertical, keeps its own axes', () => {
    expect(viewLean(view(22)) / DEG).toBeCloseTo(22, 3)
    expect(viewLean(view(-35)) / DEG).toBeCloseTo(-35, 3)
    expect(viewLean(view(90))).toBe(0)
    expect(viewLean(view(180))).toBe(0)
    expect(viewLean(view(22, 85))).toBe(0)
    const right = new Vector3(), up = new Vector3()
    leveled(view(180), right, up)
    // On its back, right on the picture is left in the world.
    expect(right.z).toBeCloseTo(-1, 6)
  })

  it('screen steering: an offset straight to the side of the reticle on a leaning picture is read along the horizon', () => {
    const camera = view(22), about = { px: 0, py: 4 }, out = { px: 0, py: 0 }
    levelOffset(camera, 200, 4, about, out)
    // The same distance from the reticle, turned back by the lean: up the picture's right-hand side, where the horizon is.
    expect(Math.hypot(out.px - about.px, out.py - about.py)).toBeCloseTo(200, 6)
    const through = new Vector3(out.px / 640, -out.py / 360, 0.5).unproject(camera).sub(camera.position).normalize()
    const centre = new Vector3(about.px / 640, -about.py / 360, 0.5).unproject(camera).sub(camera.position).normalize()
    expect(Math.abs(through.y - centre.y)).toBeLessThan(0.01)
    // On the reticle the two are the same place.
    expect(levelOffset(camera, about.px, about.py, about, out)).toEqual(about)
  })
})
