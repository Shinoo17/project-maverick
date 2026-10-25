import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { GameRuntime } from '../src/game/runtime/GameRuntime'
import { simulationSpeed } from '../src/game/flight/speedLimits'
import { dewPoint, flatRangeAtmosphere, sampleAir, speedOfSound, type VaporAtmosphere } from '../src/render/vapor/atmosphere'
import { flightVaporConditions, vaporConditions } from '../src/render/vapor/conditions'
import { vaporRigs, vortexAirflow, vortexProfile } from '../src/render/vapor/profile'
import { CONE_EVENT, ConeTrigger, coneCooling, liftIncidence, vaporTargets, vortexIncidence } from '../src/render/vapor/vaporModel'
import { createAircraft } from '../benchmarks/flight/harness'
import { neutralCommand } from '../src/game/runtime/commands'
import { FLIGHT_STEP } from '../src/game/runtime/clock'
import { stepFlight } from '../src/game/flight/stepFlight'

const SPAWN = 400
const sea = flatRangeAtmosphere
const desert: VaporAtmosphere = { temperatureC: 38, humidity: .15 }
/** Speeds are HUD (arcade) km/h, as the player reads them. */
const flight = (kph: number, aoa: number, g: number, altitude = SPAWN, atmosphere = sea) =>
  vaporConditions({ speed: simulationSpeed(kph), aoa, g, sideslip: 0 }, altitude, atmosphere)
const targets = (c: ReturnType<typeof flight>, id: keyof typeof vaporRigs = 'f22') => vaporTargets(c, vaporRigs[id], c)
const effects = ['lex', 'fog', 'tip', 'cone'] as const

describe('vapor atmosphere', () => {
  it('computes Magnus dew point, the ISA lapse and the speed of sound', () => {
    expect(dewPoint(30, .8)).toBeCloseTo(26.17, 1)
    expect(30 - dewPoint(30, .8)).toBeCloseTo(3.83, 1)
    expect(dewPoint(20, 1)).toBeCloseTo(20, 6)
    expect(sampleAir({ temperatureC: 15, humidity: .5 }, 1000).temperatureC).toBeCloseTo(8.5, 6)
    expect(speedOfSound(15)).toBeCloseTo(340.3, 0)
  })
  it('keeps low-level humid air unsaturated and dries out with height', () => {
    const low = sampleAir(sea, SPAWN), high = sampleAir(sea, 10000)
    expect(low.depression).toBeGreaterThan(2.5)
    expect(low.depression).toBeLessThan(5)
    for (let altitude = 0; altitude <= 12000; altitude += 250) expect(sampleAir(sea, altitude).depression).toBeGreaterThan(2.5)
    expect(high.depression).toBeGreaterThan(low.depression)
    expect(high.water).toBeLessThan(low.water)
    expect(sampleAir(desert, SPAWN).depression).toBeGreaterThan(25)
  })
  it('reads Mach from the HUD speed scale, so afterburner top speed is just supersonic', () => {
    expect(flight(1080, 2, 1).mach).toBeCloseTo(.87, 1)
    expect(flight(1400, 2, 1).mach).toBeGreaterThan(1.08)
    expect(flight(1400, 2, 1).mach).toBeLessThan(1.2)
  })
})

describe('vapor model', () => {
  it('stays clear in 1 G cruise at every subsonic speed: speed alone never makes vapor', () => {
    for (const id of ['f22', 'su57'] as const) for (let kph = 300; kph <= 1080; kph += 60) {
      const t = targets(flight(kph, 3, 1), id)
      for (const effect of effects) expect(t[effect], `${id} ${kph} km/h ${effect}`).toBe(0)
    }
  })
  it('grows with G and AoA, not with airspeed', () => {
    const base = targets(flight(700, 14, 3))
    expect(targets(flight(700, 14, 5)).lex).toBeGreaterThan(base.lex)
    expect(targets(flight(700, 20, 3)).lex).toBeGreaterThan(base.lex)
    expect(targets(flight(700, 14, 5)).fog).toBeGreaterThan(base.fog)
    expect(targets(flight(700, 14, 5)).tip).toBeGreaterThan(base.tip)
    expect(targets(flight(900, 14, 3)).lex).toBeCloseTo(base.lex, 6)
    // The vortex needs incidence: a moderate pull at speed fogs the wing but sheds no LEX vortex.
    expect(targets(flight(1000, 2, 4)).lex).toBe(0)
    expect(targets(flight(1000, 2, 4)).fog).toBeGreaterThan(0)
  })
  it('reads the AoA that lift implies, since the arcade model pulls 12 G at about 4°', () => {
    expect(liftIncidence(flight(700, 4, 6), vaporRigs.f22)).toBeGreaterThan(10)
    expect(liftIncidence(flight(700, 4, 6), vaporRigs.f22)).toBeLessThan(16)
    expect(vortexIncidence(flight(330, 62, 2.5), vaporRigs.f22)).toBe(62)
    for (const id of ['f22', 'su57'] as const) {
      const pull = createAircraft(id), level = createAircraft(id)
      pull.position.y = level.position.y = SPAWN
      pull.velocity = { x: 160, y: 0, z: 0 }; level.velocity = { x: 70, y: 0, z: 0 }
      let peak = 0
      for (let i = 0; i < 2 / FLIGHT_STEP; i++) {
        stepFlight(pull, { ...neutralCommand(0, pull.id), pitch: 1 }, FLIGHT_STEP)
        stepFlight(level, neutralCommand(0, level.id), FLIGHT_STEP)
        const c = flightVaporConditions(pull)
        peak = Math.max(peak, vaporTargets(c, vaporRigs[id], c).lex)
        const l = flightVaporConditions(level), clear = vaporTargets(l, vaporRigs[id], l)
        for (const effect of effects) expect(clear[effect], `${id} level ${effect}`).toBe(0)
      }
      expect(flightVaporConditions(pull).aoa, id).toBeLessThan(8)
      expect(peak, id).toBeGreaterThan(.3)
    }
  })
  it('shows LEX vortex, wing fog and tip trails in a 6 G sustained turn over humid ground', () => {
    for (const id of ['f22', 'su57'] as const) {
      const t = targets(flight(700, 14, 6), id)
      expect(t.lex, id).toBeGreaterThan(.3)
      expect(t.fog, id).toBeGreaterThan(.5)
      expect(t.tip, id).toBeGreaterThan(.3)
      expect(t.burst, id).toBeGreaterThan(1)
    }
  })
  it('bursts the vortex at the apex past 40° AoA, and clears in reversed or still air', () => {
    const cobra = targets(flight(330, 62, 2.5))
    expect(cobra.burst).toBe(0)
    expect(cobra.lex).toBeGreaterThan(.3)
    expect(targets(flight(700, 30, 4)).burst).toBeGreaterThan(0)
    expect(targets(flight(700, 30, 4)).burst).toBeLessThan(1)
    for (const c of [flight(0, 40, 9), flight(700, 160, 9)]) for (const effect of effects) expect(targets(c)[effect]).toBe(0)
  })
  it('makes a vapor cone only in the transonic band, with the shock moving aft', () => {
    expect(targets(flight(1080, 2, 1)).cone).toBe(0)
    const machKph = (mach: number) => mach * speedOfSound(sampleAir(sea, 100).temperatureC) * 3.6
    const transonic = targets(flight(machKph(.95), 2, 1, 100))
    expect(flight(machKph(.95), 2, 1, 100).mach).toBeCloseTo(.95, 6)
    expect(transonic.cone).toBeGreaterThan(.5)
    expect(targets(flight(machKph(1.15), 2, 1, 100)).cone).toBe(0)
    expect(targets(flight(1250, 2, 1)).shock).toBeGreaterThan(targets(flight(1150, 2, 1)).shock)
    expect(coneCooling(.95, 25)).toBeGreaterThan(coneCooling(.85, 25))
  })
  it('fires the cone once when accelerating through the band, not again while holding speed', () => {
    const trigger = new ConeTrigger(), step = 1 / 60
    const run = (mach: number, g: number, seconds: number) => {
      let shots = 0, previous = 0, peak = 0
      for (let t = 0; t < seconds; t += step) {
        const value = trigger.update(mach, g, step)
        if (value > .5 && previous <= .5) shots++
        previous = value; peak = Math.max(peak, value)
      }
      return { shots, peak, last: previous }
    }
    expect(run(.85, 1, 1).shots).toBe(0)
    const crossing = run(.95, 1, 1)
    expect(crossing.shots).toBe(1)
    expect(crossing.peak).toBeGreaterThan(.9)
    expect(crossing.last).toBe(0) // gone within CONE_EVENT.seconds
    expect(run(.95, 1, 10).shots).toBe(0) // holding speed
    expect(run(.90, 1, 2).shots).toBe(0) // dipping, but not below the re-arm Mach
    expect(run(.95, 1, 2).shots).toBe(0)
    run(.86, 1, 2) // slows below re-arm
    expect(run(.95, 1, 2).shots).toBe(1)
  })
  it('fires the cone once on a hard pull near the speed of sound, re-armed by easing off', () => {
    const trigger = new ConeTrigger(), step = 1 / 60
    let shots = 0, previous = 0
    const fly = (mach: number, g: number, seconds: number) => {
      for (let t = 0; t < seconds; t += step) {
        const value = trigger.update(mach, g, step)
        if (value > .5 && previous <= .5) shots++
        previous = value
      }
    }
    fly(.87, 1, 2); expect(shots).toBe(0)
    fly(.87, 7, 3); expect(shots).toBe(1) // a held pull fires once
    fly(.87, 1, .5); fly(.87, 7, .1); expect(shots).toBe(2)
    fly(.87, 1, .2); fly(.87, 7, 1); expect(shots).toBe(2) // a re-pull inside the cooldown
    fly(.6, 1, 2); fly(.6, 9, 1); expect(shots).toBe(2) // too slow
    expect(CONE_EVENT.cooldown).toBeLessThan(2)
    // Pulling raises the local Mach, so a pull at cruise top speed makes a visible cone.
    expect(targets(flight(1080, 4, 7)).cone).toBeGreaterThan(.3)
    expect(targets(flight(1080, 2, 1)).cone).toBe(0)
  })
  it('suppresses aerodynamic vapor at 10 km and in desert air', () => {
    for (const c of [flight(700, 14, 6, 10000), flight(700, 14, 6, SPAWN, desert)]) {
      const t = targets(c)
      // Thin air at 10 km needs ~25° of incidence for 6 G, so the LEX may show faintly; no more.
      for (const effect of ['lex', 'fog', 'tip'] as const) expect(t[effect], effect).toBeLessThan(effect === 'lex' ? .1 : .05)
    }
    expect(targets(flight(700, 14, 9, SPAWN, desert)).fog).toBeLessThan(.05)
  })
})

describe('condensation flight coupling', () => {
  const conditions = (speed = 180, aoa = 21, g = 6.8, humidity = .82) =>
    vaporConditions({ speed, aoa, g, sideslip: 0 }, SPAWN, { temperatureC: 26, humidity })
  it('keeps a thin core while load, incidence and moisture increase its length', () => {
    const low = vortexProfile(conditions(180, 6, 2))
    for (const c of [conditions(180, 28, 2), conditions(180, 6, 8)]) {
      const high = vortexProfile(c)
      expect(high.length).toBeGreaterThan(low.length)
      expect(high.radius).toBeGreaterThan(low.radius)
      expect(high.radius).toBeLessThan(.12)
      expect(high.turbulence).toBeGreaterThan(low.turbulence)
    }
    expect(vortexProfile(conditions(180, 20, 6, .8)).length).toBeGreaterThan(vortexProfile(conditions(180, 20, 6, .3)).length)
  })
  it('aligns the straight core with downstream air including signed AoA and sideslip', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    for (const velocity of [new Vector3(150, -35, 40), new Vector3(150, 35, -40), new Vector3(0, -100, 0)]) {
      state.velocity = velocity
      const flow = vortexAirflow(flightVaporConditions(state), new Vector3())
      expect(flow.distanceTo(velocity.clone().normalize().negate())).toBeLessThan(1e-8)
    }
  })
  it('uses signed local incidence and remains invariant when the entire flight is rotated', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    state.velocity = { x: 150, y: -50, z: 15 }
    const original = flightVaporConditions(state)
    expect(original.aoa).toBeCloseTo(18.43495, 4)
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 2.1)
    state.orientation = q; state.velocity = new Vector3().copy(state.velocity).applyQuaternion(q)
    const rotated = flightVaporConditions(state)
    expect(rotated.speed).toBeCloseTo(original.speed, 8)
    expect(rotated.aoa).toBeCloseTo(original.aoa, 8)
    expect(rotated.sideslip).toBeCloseTo(original.sideslip, 8)
    expect(rotated.mach).toBeCloseTo(original.mach, 8)
  })
  it('does not mistake sideslip for AoA or mutate simulation telemetry', () => {
    const state = new GameRuntime({ mode: 'playground', mapId: 'flat-range', aircraftIds: ['f22'] }).snapshot().aircraft[0]
    state.velocity = { x: 150, y: 0, z: 80 }; state.maneuver.alpha = 28
    const before = structuredClone(state), sample = flightVaporConditions(state)
    expect(sample.aoa).toBeCloseTo(0)
    expect(sample.sideslip).toBeGreaterThan(.4)
    expect(state).toEqual(before)
    state.velocity.y = 50
    expect(flightVaporConditions(state).aoa).toBeLessThan(0)
  })
})
