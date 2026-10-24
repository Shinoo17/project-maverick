import { memo, useEffect, useRef, type RefObject } from 'react'
import type { RadarPicture } from '../../render/radarFrame'
import { createRadarPainter } from './radarPainter'

/** Called from the render loop every frame: the picture (null once the player is down) and simulation seconds. */
export type RadarDriver = (picture: RadarPicture | null, seconds: number) => void

const MAX_PIXEL_RATIO = 2
/** The radar scope at the bottom left (radarPainter.ts). Drawn by the render loop, not by React. */
export const RadarScope = memo(function RadarScope({ driver }: { driver: RefObject<RadarDriver | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const painter = createRadarPainter(element)
    let last: Parameters<RadarDriver> = [null, 0]
    const observer = new ResizeObserver(([entry]) => { painter.resize(entry.contentRect.width, Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO)); painter.draw(...last) })
    observer.observe(element)
    driver.current = (picture, seconds) => { last = [picture, seconds]; painter.draw(picture, seconds) }
    return () => { observer.disconnect(); driver.current = null }
  }, [driver])
  return <canvas ref={canvas} className="radar-scope" aria-hidden="true" />
})
