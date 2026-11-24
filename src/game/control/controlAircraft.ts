import { Quaternion, Vector3 } from 'three'
import type { AircraftState } from '../state/WorldState'
import { coreProfileOf, type CoreProfile } from '../flightCore/profile'
import { availableRates } from '../flightCore/rotation'
import { GRAVITY } from '../flightCore/aero'
import { arcadeControlLimits } from '../arcadeCore/step'
import { EXAMPLE_BODY, toExampleFrame } from '../arcadeCore/frame'

/*
The aircraft as the ported controls see it (example/flight-control's FlightModel surface), read
from this project's AircraftState and flight-core profile.

Frames. The example's body axes are forward +Z, up +Y, left +X; this project's are forward +X,
up +Y, right +Z. The same airframe in the example's frame is this project's orientation turned a
quarter turn about body Y (`EXAMPLE_BODY`), so the ported AimController and chase camera run
unchanged on `quaternion`. World axes are the same in both (Y up), so world vectors (the aim, the
flight path, camera poses) pass through untouched.

Rates. The example keeps them as x = pitch (nose up +), y = yaw (nose right +), z = roll
(right +); this project's `rates` use the same senses, so they are only re-labelled.

Limits. On the arcade core (example/flight-control's physics) they are its FlightModel's own
`rateLimits` / `effectiveness` / `gLimitRate`, exactly what the example's aim controller read. On
the other cores `rateLimits` is the new core's `availableRates` (flightCore/rotation.ts) with
pitch capped by the G limit, so whatever that physics is retuned to, the aim controller divides
by the rate full stick really gives.
*/
export interface ControlAircraft {
  /** Orientation in the example's body frame (forward +Z, up +Y, left +X). */
  readonly quaternion: Quaternion
  /** Body rates (rad/s): x = pitch, y = yaw, z = roll. */
  readonly rates: Vector3
  readonly speed: number
  forward(out?: Vector3): Vector3
  /** Body rates full stick commands now, in the layout of `rates`. Pitch includes the G limit. */
  rateLimits(out?: Vector3): Vector3
  /** Pitch rate full stick gives from control authority alone (rad/s), before the G limit. */
  authorityRate(): number
  /** Pitch rate at which lift reaches the G limit at this speed (rad/s). */
  gLimitRate(): number
}

export { EXAMPLE_BODY, toExampleFrame }
const FWD = new Vector3(0, 0, 1)

export class StateAircraft implements ControlAircraft {
  readonly quaternion = new Quaternion()
  readonly rates = new Vector3()
  speed = 0
  private profile: CoreProfile | null = null
  private psmAuthority = 0
  // The arcade core's limits as of the last read, or null on another core.
  private arcade: { limits: Vector3; authorityRate: number; gLimitRate: number } | null = null

  /** Re-reads the pose. `profile` is the tuned core profile when the Flight Lab has one. */
  read(state: AircraftState, profile?: CoreProfile) {
    toExampleFrame(state.orientation, this.quaternion)
    this.rates.set(state.rates.pitch, state.rates.yaw, state.rates.roll)
    this.speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
    if (state.flightCore === 'arcade') {
      const limits = this.arcade?.limits ?? new Vector3()
      this.arcade = { limits, ...arcadeControlLimits(state, limits) }
      this.profile = null
      return this
    }
    this.arcade = null
    this.profile = profile ?? coreProfileOf(state.aircraftId)
    this.psmAuthority = state.coreFlight?.psmAuthority ?? 0
    return this
  }

  forward(out = new Vector3()) { return out.copy(FWD).applyQuaternion(this.quaternion) }

  rateLimits(out = new Vector3()) {
    if (this.arcade) return out.copy(this.arcade.limits)
    if (!this.profile) return out.set(0, 0, 0)
    const { available } = availableRates(this.speed, this.psmAuthority, this.profile)
    return out.set(Math.min(available.pitch, this.gLimitRate()), available.yaw, available.roll)
  }

  authorityRate() {
    if (this.arcade) return this.arcade.authorityRate
    return this.profile ? availableRates(this.speed, this.psmAuthority, this.profile).available.pitch : 0
  }

  gLimitRate() {
    if (this.arcade) return this.arcade.gLimitRate
    if (!this.profile) return 0
    return this.speed > 1 ? this.profile.gLimit * GRAVITY / this.speed : Infinity
  }
}
