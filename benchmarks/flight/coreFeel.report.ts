import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cornerSpeed, pullResponse, rollResponse, speedEnvelope, sustainedTurn, yawResponse } from './coreFeel'
import { coreProfileOf } from '../../src/game/flightCore/profile'

// FR1 feel numbers (docs/flight-rewrite-fr1.md). Writes only benchmarks/flight/out/core-feel-fr1.{json,md}.
it('reports the rewrite core feel numbers (report only)', () => {
  const ids = ['f22', 'su57']
  const speeds = [60, 80, 100, 120, 140, 160, 180, 200, 220]
  const result = Object.fromEntries(ids.map(id => [id, {
    profile: coreProfileOf(id),
    roll: [40, 50, 60, 100, 130, 180].map(v => rollResponse(id, v)),
    yaw: [60, 100, 130, 180].map(v => yawResponse(id, v)),
    pull: speeds.map(v => pullResponse(id, v)),
    sustainedDry: speeds.map(v => sustainedTurn(id, v, false)),
    sustainedBurner: speeds.map(v => sustainedTurn(id, v, true)),
    envelope: speedEnvelope(id),
    corner: cornerSpeed(id),
  }]))
  const lines: string[] = ['# Rewrite core feel numbers (FR1)', '']
  for (const id of ids) {
    const r = result[id]
    lines.push(`## ${id}`, '', '| m/s | HUD km/h | roll peak °/s | to 90% s | stop <5% s |', '|---:|---:|---:|---:|---:|')
    for (const row of r.roll) lines.push(`| ${row.speed} | ${row.hud} | ${row.peak} | ${row.rise} | ${row.stop} |`)
    lines.push('', '| m/s | HUD km/h | yaw peak °/s | steady β° (full rudder) |', '|---:|---:|---:|---:|')
    for (const row of r.yaw) lines.push(`| ${row.speed} | ${row.hud} | ${row.peak} | ${row.beta} |`)
    lines.push('', '| m/s | HUD km/h | pitch rate °/s | inst. turn °/s | G | α° | limit | sustained dry °/s (G) | sustained AB °/s (G) | speed lost in 3 s pull |', '|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|')
    r.pull.forEach((row, i) => lines.push(`| ${row.speed} | ${row.hud} | ${row.pitchRate} | ${row.turnRate} | ${row.g} | ${row.alpha} | ${row.limit} | ${r.sustainedDry[i].turnRate} (${r.sustainedDry[i].g}) | ${r.sustainedBurner[i].turnRate} (${r.sustainedBurner[i].g}) | ${row.bleed3s} |`))
    const e = r.envelope
    lines.push('', `Corner speed (measured): ${r.corner.speed} m/s = ${r.corner.hud} km/h, ${r.corner.turnRate} °/s. Design corner: ${e.cornerDesign.hud} km/h.`,
      `1 g at the alpha limit: ${e.stallAtAlphaLimit.hud} km/h. Top speed dry ${e.topDry.hud} km/h, burner ${e.topBurner.hud} km/h.`, '')
  }
  mkdirSync('benchmarks/flight/out', { recursive: true })
  writeFileSync('benchmarks/flight/out/core-feel-fr1.json', JSON.stringify(result, null, 2))
  writeFileSync('benchmarks/flight/out/core-feel-fr1.md', lines.join('\n'))
  console.log(lines.join('\n'))
}, 120000)
