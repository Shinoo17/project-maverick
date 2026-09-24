import { expect, it } from 'vitest'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { FlightInput } from '../src/game/input/FlightInput'
import { screenFrame } from '../src/game/input/mouseStick'
import { observeAirflow } from '../src/game/flight/airflow'
import { interpretEnvelope } from '../src/game/flight/envelope'
import { getFlightProfile } from '../src/game/flight/profile'

it('the flow-blended positional mouse produces identical commands and flight at 30/60/144 FPS', () => {
  const run = (fps: number) => {
    const runtime = new GameRuntime({ mode: 'playground', aircraftIds: ['f22'] })
    runtime.reset('recovery'); runtime.start()
    const input = new FlightInput(); input.engage(); input.move(0, -input.gate.radius)
    input.press('Space'); input.press('ShiftLeft')
    let peakBlend = 0
    for (let frame = 0; frame < 4 * fps; frame++) runtime.advance(1 / fps, (tick, id) => {
      const state = runtime.snapshot().aircraft[0], profile = getFlightProfile(state.aircraftId)
      input.highAoa = interpretEnvelope(state, observeAirflow(state, profile), profile).highAoa
      peakBlend = Math.max(peakBlend, input.highAoa)
      input.screen = screenFrame(state, 'horizon')
      return input.command(tick, id, 'mouse')
    })
    const result = { snapshot: runtime.snapshot(), replay: runtime.exportReplay(), peakBlend }
    runtime.dispose()
    return result
  }
  const at60 = run(60)
  expect(at60.peakBlend).toBeGreaterThan(0)
  expect(run(30)).toEqual(at60)
  expect(run(144)).toEqual(at60)
})
