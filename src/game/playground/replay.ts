import { GameRuntime } from '../runtime/GameRuntime'
export type FlightReplay = ReturnType<GameRuntime['exportReplay']>
// Developer entry point: run a saved normalized command track without a renderer.
// The shipped Playground records one player aircraft, capped at 60 sim seconds.
export function runFlightReplay(replay: FlightReplay) {
  if (replay.schemaVersion !== 1 || replay.profileVersion !== 'p2-manual-2' || replay.hz !== 60
    || replay.config.mode !== 'playground' || replay.config.aircraftIds.length !== 1
    || replay.durationTicks !== replay.commands.length || replay.commands.length > 3600) throw new Error('Unsupported flight replay')
  const runtime = new GameRuntime(replay.config)
  try {
    runtime.reset(replay.preset); runtime.start()
    for (const command of replay.commands) runtime.advance(1 / 60, () => command)
    return runtime.snapshot()
  } finally { runtime.dispose() }
}
