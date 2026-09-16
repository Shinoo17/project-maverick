/** Serializable arcade tuning, not measured aircraft specifications. */
export interface FlightProfile {
  /** Keep neutral-stick rate damping active during PSM. */
  neutralDampingDuringPsm: boolean

  /** Lower limit for S deceleration (m/s), not a stall speed. */
  minPoweredMps: number
  /** Level-flight powered limits in displayed ARCADE km/h. Converted internally. */
  topSpeedKph: number
  afterburnerTopSpeedKph: number
  // Acceleration/braking (simulation m/s²).
  acceleration: number
  deceleration: number
  /** Speed-input response rates (1/s). */
  driveResponse: number
  releaseResponse: number
  /** Dry thrust budget (m/s²); raised automatically for higher configured speeds. */
  maxThrust: number
  /** Speed-squared drag coefficient; drag * speed² gives deceleration. */
  drag: number
  /** Pitch/yaw rate-squared drag coefficient. */
  turnDrag: number

  // Normal-flight angular rates (rad/s) and response rates (1/s).
  pitchRate: number
  yawRate: number
  rollRate: number
  rateResponse: number
  /** Response when reversing an existing roll, not starting one (1/s). */
  rollReversalResponse: number
  counterResponse: number
  neutralResponse: number

  /** Normal-flight lateral acceleration budget (m/s²). */
  turnAcceleration: number
  /** Fraction of the turn budget used for nose rotation (0–1). */
  turnRateReserve: number
  /** Velocity-to-nose alignment response (1/s). */
  pathResponse: number
  /** Feed-forward alignment gain (dimensionless). */
  turnAnticipation: number
  /** Gravity used for climb/descent energy cost (m/s²). */
  gravity: number
}

/** Session overrides deliberately support only speed limits for now. */
export type FlightSpeedOverride = Partial<Pick<FlightProfile, 'topSpeedKph' | 'afterburnerTopSpeedKph'>>

export interface ManeuverProfile {
  /** Explicit PSM capability. High-G and afterburner remain independent. */
  psmEnabled: boolean
  // PSM entry envelope: speed in m/s, altitude in metres.
  entryMin: number
  entryMax: number
  minAltitude: number

  // PSM angular rates (rad/s), rotation budget (rad), and time budgets (s).
  pitchRate: number
  yawRate: number
  rollRate: number
  maxRotation: number
  activeSeconds: number
  cooldown: number

  /** PSM airflow alignment response (1/s), independent of normal flight. */
  pathResponse: number
  /** Dimensionless airflow grip during PSM and recovery. */
  activeGrip: number
  recoveryGrip: number
  /** Recovery lateral acceleration budget (m/s²). */
  recoveryAcceleration: number

  // High-G rate/drag multipliers and afterburner time budgets (s).
  highGRate: number
  highGDrag: number
  burnerSeconds: number
  burnerRecharge: number
}

/** Twin-engine, pitch-vectoring solver configuration. */
export interface ThrustVectoringProfile {
  /** Nozzle travel limit and differential roll allocation (degrees). */
  maxAngle: number
  rollGain: number
  /** Actuator travel speed (degrees/s). */
  actuatorRate: number
  /** Actuator and authority response rates (1/s). */
  actuatorResponse: number
  authorityResponse: number

  // Metres in the displayed aircraft's centered +X-forward frame.
  pivotX: number
  height: number
  /** Distance from centerline to each engine, not total engine separation. */
  spacing: number
  lipArm: number
  /** Arcade mass-normalized inertia, I/m (m²). */
  inertia: { roll: number; yaw: number; pitch: number }
}

export interface AircraftFlightProfile {
  flight: FlightProfile
  maneuver: ManeuverProfile
  /** null disables the physical TVC solver; it does not disable PSM. */
  thrustVectoring: ThrustVectoringProfile | null
}
