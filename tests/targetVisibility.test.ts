import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { createAircraft } from '../benchmarks/flight/harness'
import { FlightCamera } from '../src/render/FlightCamera'
import { defaultCameraSettings } from '../src/game/camera/cameraSettings'
import { distanceScale, visibility, zoomShare } from '../src/render/targetVisibility'

describe('target visibility aids', () => {
  it('draws aircraft true size up close and larger with distance, without a jump', () => {
    expect(distanceScale(0)).toBe(1)
    expect(distanceScale(visibility.near)).toBe(1)
    expect(distanceScale(visibility.far)).toBe(visibility.maxScale)
    expect(distanceScale(5000)).toBe(visibility.maxScale)
    let last = 1
    for (let metres = 0; metres <= 1500; metres += 10) {
      const scale = distanceScale(metres)
      expect(scale).toBeGreaterThanOrEqual(last)
      expect(scale - last).toBeLessThan(0.05)
      last = scale
    }
  })
  it('zooms fully on a centred target and not at all on one far off the view axis', () => {
    expect(zoomShare(0)).toBe(1)
    expect(zoomShare(visibility.fullDeg)).toBe(1)
    expect(zoomShare(14)).toBeGreaterThan(0)
    expect(zoomShare(14)).toBeLessThan(1)
    expect(zoomShare(visibility.noneDeg)).toBe(0)
    expect(zoomShare(90)).toBe(0)
  })
  it('narrows the camera FOV by the zoom share, but never under reduced motion', () => {
    const state = createAircraft('f22')
    const fovWith = (gunZoom: number, reducedMotion = false) => {
      const camera = new PerspectiveCamera(69), rig = new FlightCamera()
      rig.snapFov = true; rig.gunZoom = gunZoom
      rig.update(camera, state, defaultCameraSettings, 1 / 60, reducedMotion)
      return camera.fov
    }
    expect(fovWith(1)).toBeCloseTo(fovWith(0) * (1 - visibility.zoom), 6)
    expect(fovWith(1, true)).toBe(fovWith(0, true))
  })
})
