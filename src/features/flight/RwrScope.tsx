import { memo, useEffect, useRef, type RefObject } from 'react'
import type { RwrDisplay } from '../../render/rwrFrame'
import { createRwrPainter } from './rwrPainter'

/** Called from the render loop every frame: the warning picture (null once the player is down) and simulation seconds. */
export type RwrDriver = (display: RwrDisplay | null, seconds: number) => void

const MAX_PIXEL_RATIO = 2
/** The RWR scope above the radar scope (rwrPainter.ts). Drawn by the render loop, not by React. */
export const RwrScope = memo(function RwrScope({ driver }: { driver: RefObject<RwrDriver | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const painter = createRwrPainter(element)
    let last: Parameters<RwrDriver> = [null, 0]
    const observer = new ResizeObserver(([entry]) => { painter.resize(entry.contentRect.width, Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO)); painter.draw(...last) })
    observer.observe(element)
    driver.current = (display, seconds) => { last = [display, seconds]; painter.draw(display, seconds) }
    return () => { observer.disconnect(); driver.current = null }
  }, [driver])
  return <canvas ref={canvas} className="rwr-scope" aria-hidden="true" />
})
