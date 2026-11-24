import { describe, expect, it } from 'vitest'
import { CAMERA } from '../src/game/control/config'
import { flyLoop, hands } from './cameraLoop'

const row = (label: string, mode: string, name: string, r: ReturnType<typeof flyLoop>) =>
  `${label.padEnd(6)} ${mode.padEnd(8)} ${name.padEnd(5)} rate ${r.lookRate.toFixed(0).padStart(4)} rms ${r.lookRms.toFixed(1).padStart(5)} accel ${r.lookAccel.toFixed(0).padStart(6)} roll ${r.rollRate.toFixed(0).padStart(4)} tail ${r.tail.toFixed(2)} rev ${r.reversals} retDrift ${r.reticleDrift.toFixed(2)} retMax ${r.reticleMax.toFixed(2)} jetV ${r.jetSpeed.toFixed(2)} jetX ${r.jetMaxX.toFixed(2)} lag ${r.lag.toFixed(1)}`

describe('camera in the loop', () => {
  // Before the camera plan (CAMERA.motion.enabled false), Aim lock: a flick turned the picture at
  // 113°/s and 1 586°/s² and moved the jet at 0.50 half-screens/s. The first build of the plan
  // cut the turn but moved the jet at 1.39: dizzier than before.
  it('turns the picture gently and keeps the jet steady on screen in Aim and Horizon lock', () => {
    for (const mode of ['aim', 'horizon'] as const) for (const [name, h] of Object.entries(hands)) {
      const r = flyLoop(mode, h.hand, h.seconds, h.handEnd)
      const where = `${mode} ${name}`
      expect(r.jetSpeed, where).toBeLessThan(0.35)
      expect(r.jetMaxX, where).toBeLessThan(0.1)
      expect(r.lookRate, where).toBeLessThan(mode === 'aim' ? 45 : 60)
      expect(r.lookAccel, where).toBeLessThan(450)
      expect(r.rollRate, where).toBeLessThan(46)
      expect(r.reticleMax, where).toBeLessThan(0.9)
    }
  })

  it('barely turns the picture for small aiming corrections in Aim lock', () => {
    const r = flyLoop('aim', hands.track.hand, hands.track.seconds, hands.track.handEnd)
    expect(r.lookRms).toBeLessThan(4)
    expect(r.reticleDrift).toBeLessThan(0.2)
  })

  // CAM_VARIANTS='{"old":{"top":{"enabled":false}},"now":{}}' CAM_MODES=aim,horizon,aircraft prints a comparison.
  it.skipIf(!process.env.CAM_VARIANTS)('reports variants', () => {
    const rows: string[] = []
    const M = CAMERA.motion as any, base = JSON.parse(JSON.stringify(M))
    const set = (o: any) => { Object.assign(M, JSON.parse(JSON.stringify(base))); for (const mode of ['aim', 'horizon', 'aircraft']) Object.assign(M[mode], o.all ?? {}, o[mode] ?? {}); Object.assign(M.composer, o.composer ?? {}); if (o.top) Object.assign(M, o.top) }
    for (const [label, o] of Object.entries(JSON.parse(process.env.CAM_VARIANTS ?? '{}') as Record<string, any>)) {
      set(o)
      for (const mode of (process.env.CAM_MODES ?? 'aim').split(',') as any[]) for (const [name, h] of Object.entries(hands)) rows.push(row(label, mode, name, flyLoop(mode, h.hand, h.seconds, h.handEnd)))
    }
    set({})
    console.log(rows.join('\n'))
  })
})
