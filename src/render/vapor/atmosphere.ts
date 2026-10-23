import { MathUtils } from 'three'

/*
Air around the aircraft, for vapor only (docs/vapor-overhaul-plan.md §3.1). Plain
numbers, no flight effect. Doc 22's Environment will supply these per map and
weather; until then every flight uses the flat-range values below.

Humidity is relative humidity on a 0–1 scale, the unit Environment.humidity uses.
*/
export interface VaporAtmosphere {
  /** Air temperature at sea level, °C. */
  temperatureC: number
  /** Relative humidity at sea level, 0–1. */
  humidity: number
}

/** Warm, humid low-level air: D ≈ 3.3 K, so a 1 G cruise stays clear. */
export const flatRangeAtmosphere: Readonly<VaporAtmosphere> = { temperatureC: 26, humidity: .82 }

/** Air at one altitude, as the vapor model reads it. */
export interface AirSample {
  temperatureC: number
  dewPointC: number
  /** Dew-point depression T − Td, K. The cooling vapor needs before it appears. */
  depression: number
  /** Water available to condense, 0–1. Cold or dry air makes thinner vapor. */
  water: number
}

const MAGNUS_A = 17.62, MAGNUS_B = 243.12
/** Saturation vapour pressure over water, hPa (Magnus). */
export const saturationPressure = (temperatureC: number) => 6.112 * Math.exp(MAGNUS_A * temperatureC / (MAGNUS_B + temperatureC))

export function dewPoint(temperatureC: number, humidity: number) {
  const gamma = Math.log(MathUtils.clamp(humidity, .01, 1)) + MAGNUS_A * temperatureC / (MAGNUS_B + temperatureC)
  return MAGNUS_B * gamma / (MAGNUS_A - gamma)
}

/** ISA lapse rate, 6.5 K per km. */
export const airTemperature = (atmosphere: VaporAtmosphere, altitude: number) =>
  atmosphere.temperatureC - 6.5 * Math.max(0, altitude) / 1000

/*
Relative humidity falls with height. The plan's Td(h) = Td0 − 2·h_km (with the
6.5 K/km lapse) would saturate the air a few hundred metres up, so the flat
range would be inside a cloud at its 400 m spawn. Halving RH between the
boundary layer and 7 km keeps D steady low down and grows it with height.
*/
export const relativeHumidity = (atmosphere: VaporAtmosphere, altitude: number) =>
  MathUtils.clamp(atmosphere.humidity, 0, 1) * (1 - .5 * MathUtils.smoothstep(altitude, 300, 7000))

export function sampleAir(atmosphere: VaporAtmosphere, altitude: number): AirSample {
  const temperatureC = airTemperature(atmosphere, altitude)
  const dewPointC = Math.min(temperatureC, dewPoint(temperatureC, relativeHumidity(atmosphere, altitude)))
  return {
    temperatureC, dewPointC,
    depression: temperatureC - dewPointC,
    // The plan's floor of 0.15 left visible vapor at 10 km (ratio ≈ 0.003). The square
    // root keeps cold humid air (a snow map, ratio ≈ 0.08) readable instead.
    water: Math.min(1, Math.sqrt(saturationPressure(dewPointC) / saturationPressure(25))),
  }
}

/** ISA troposphere air density, kg/m³. */
export const airDensity = (altitude: number) => 1.225 * Math.pow(Math.max(0, 1 - 2.2558e-5 * Math.max(0, altitude)), 4.2559)

/** Speed of sound in dry air, m/s. */
export const speedOfSound = (temperatureC: number) => 20.05 * Math.sqrt(Math.max(1, temperatureC + 273.15))

/** Mach for a speed in m/s at an altitude. The HUD readout and the vapor model share it. */
export const machNumber = (speed: number, altitude: number, atmosphere: VaporAtmosphere = flatRangeAtmosphere) =>
  speed / speedOfSound(airTemperature(atmosphere, altitude))
