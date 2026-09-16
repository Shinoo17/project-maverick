import type { AircraftDefinition } from '../../content/schemas'
import { getFlightProfile } from '../../game/flight/profile'
import { arcadeSpeed } from '../../game/flight/speed'
import { useTexts } from '../../locales'

export function FlightProfilePanel({ aircraft }: { aircraft: AircraftDefinition }) {
  const { flight, maneuver } = getFlightProfile(aircraft.id)
  const text = useTexts()
  const rows = [
    [text.profileSpeed, `${Math.round(arcadeSpeed(flight.minPoweredMps))}–${Math.round(flight.topSpeedKph)} ${text.arcadeUnit}`],
    [text.profileAcceleration, `${flight.acceleration.toFixed(1)} m/s²`],
    [text.profileYaw, `${Math.round(flight.yawRate * 180 / Math.PI)} °/s`],
    [text.profilePsm, maneuver.psmEnabled ? `${Math.round(maneuver.yawRate * 180 / Math.PI)} °/s` : text.profileUnsupported],
    [text.profileRecovery, `${maneuver.recoveryAcceleration.toFixed(1)} m/s²`],
    [text.profilePsmControl, maneuver.psmEnabled ? text.profileHoldC : text.profileUnsupported],
  ]
  return <section id="hangar-panel-flight" aria-labelledby="hangar-tab-flight" className="hangar-section hangar-content" role="tabpanel">
    <h2>{text.gameProfile}</h2>
    <p className="hangar-content-note">{text.profileExperimental}</p>
    <dl className="profile-readings">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>
}
