import { useCallback, useEffect, useRef, useState } from 'react'

export type FlightAction = 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'yawLeft' | 'yawRight' | 'accelerate' | 'decelerate' | 'burner'
export interface HangarFlightState { pitch: number; roll: number; yaw: number; throttle: number; afterburner: boolean; resetId: number }
const bindings: Record<string, FlightAction> = {
  ArrowUp: 'pitchUp', ArrowDown: 'pitchDown', ArrowLeft: 'rollLeft', ArrowRight: 'rollRight',
  KeyA: 'rollLeft', KeyD: 'rollRight', KeyQ: 'yawLeft', KeyE: 'yawRight',
  KeyW: 'accelerate', KeyS: 'decelerate', ShiftLeft: 'burner', ShiftRight: 'burner',
}
export function flightAxes(actions: Iterable<FlightAction>) {
  const held = new Set(actions)
  return { pitch: Number(held.has('pitchUp')) - Number(held.has('pitchDown')),
    roll: Number(held.has('rollRight')) - Number(held.has('rollLeft')),
    yaw: Number(held.has('yawRight')) - Number(held.has('yawLeft')), afterburner: held.has('burner') }
}
export function useHangarFlight(active: boolean, aircraftId: string) {
  const [state, setState] = useState<HangarFlightState>({ pitch: 0, roll: 0, yaw: 0, throttle: .35, afterburner: false, resetId: 0 })
  const held = useRef(new Map<string, FlightAction>())
  const input = useCallback((action: FlightAction, pressed: boolean, source: string) => {
    if (pressed) held.current.set(source, action)
    else held.current.delete(source)
    setState(value => ({ ...value, ...flightAxes(held.current.values()) }))
  }, [])
  const release = useCallback(() => {
    held.current.clear()
    setState(value => ({ ...value, ...flightAxes([]) }))
  }, [])
  const level = useCallback(() => {
    held.current.clear()
    setState(value => ({ ...value, ...flightAxes([]), resetId: value.resetId + 1 }))
  }, [])
  const throttle = useCallback((value: number) => setState(state => ({ ...state, throttle: Math.max(0, Math.min(1, value)) })), [])
  useEffect(() => { level(); throttle(.35) }, [aircraftId, level, throttle])
  useEffect(() => {
    release()
    if (!active) return
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"], [role="tablist"], [role="dialog"], dialog')) return
      const action = bindings[event.code]
      if (!action) return
      event.preventDefault()
      if (!event.repeat) input(action, true, event.code)
    }
    const up = (event: KeyboardEvent) => {
      const action = bindings[event.code]
      if (action && held.current.has(event.code)) { event.preventDefault(); input(action, false, event.code) }
    }
    const visibility = () => { if (document.hidden) release() }
    let frame = 0, previous = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .05); previous = now
      const actions = new Set(held.current.values())
      const direction = Number(actions.has('accelerate')) - Number(actions.has('decelerate'))
      if (direction) setState(value => ({ ...value, throttle: Math.max(0, Math.min(1, value.throttle + direction * dt * .3)) }))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    addEventListener('keydown', down); addEventListener('keyup', up); addEventListener('blur', release)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      cancelAnimationFrame(frame); release()
      removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [active, input, release])
  return { state, input, level, throttle }
}
export type HangarFlightControls = ReturnType<typeof useHangarFlight>
