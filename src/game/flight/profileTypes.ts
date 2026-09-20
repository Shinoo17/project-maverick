/** Serializable arcade tuning, not measured aircraft specifications. */
export interface FlightProfile {
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
  afterburnerAcceleration: number
  airbrakeDeceleration: number
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
  /** Attached-flight neutral roll damping (1/s); fades with high incidence/separation. */
  neutralRollResponse: number

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

export interface AeroAxes { pitch: number; yaw: number; roll: number }
/** Strictly increasing incidence (degrees), nonnegative stiffness at q=1 (rad/s²). */
export type RestoringCurve = { incidenceDeg: number; stiffness: number }[]

/** Flow reference, legacy surface speed curve and independent incidence envelope. */
export interface AeroProfile {
  /** Surface angular acceleration at q=1, before separation loss (rad/s²). */
  controlAcceleration: AeroAxes
  /** Minimum denominator for transverse engine-force path rotation (m/s). */
  pathRateFloorMps: number
  referenceSpeedMps: number
  highSpeedMps: number
  /** Unsigned nose/velocity incidence thresholds (degrees), including sideslip.
   * Independent of the separation band in StallProfile; tune per aircraft by playtest.
   */
  maxControllableAlphaDeg: number
  alphaNormalDeg: number
  alphaCriticalDeg: number
  restoring: { pitch: RestoringCurve; yaw: RestoringCurve }
  /** Rate damping coefficients (1/s at q=1), interpolated by separation. */
  damping: { attached: AeroAxes; separated: AeroAxes }
  /** Speed-squared drag coefficients (1/m); never included in governor trim. */
  alphaDrag: number
  betaDrag: number
  /** Residual axial drag in reverse flow, as a fraction of alphaDrag. */
  reverseDrag: number
}

/** Session overrides deliberately support only speed limits for now. */
export type FlightSpeedOverride = Partial<Pick<FlightProfile, 'topSpeedKph' | 'afterburnerTopSpeedKph'>>

/** Continuous arcade separation; independent of PSM capability and physical TVC. */
export interface StallProfile {
  /** Displayed ARCADE km/h, using the same scale as topSpeedKph. */
  stallSpeedKph: number
  /** Upper edge of the continuous low-speed separation band. */
  recoverySpeedKph: number
  /** Full-separation absolute pitch-plane alpha (degrees), independent of sideslip. */
  criticalAoaDeg: number
  /** Attached-flow edge of the continuous pitch-alpha band; below criticalAoaDeg. */
  recoveryAoaDeg: number
  /** Legacy path-grip fraction at full stall (0–1). Angular aero authority is budgeted separately. */
  controlAuthority: number
  /** Multiplier on base drag at full stall (>= 1). Alpha/beta drag stays separate. */
  dragMultiplier: number
  /** Exponential separation/reattachment time constants (seconds), not deadlines. */
  entrySeconds: number
  recoverySeconds: number
}

export interface ManeuverProfile {
  /** Explicit PSM capability. High-G and afterburner remain independent. */
  psmEnabled: boolean
  // PSM entry envelope: speed in m/s, altitude in metres.
  entryMin: number
  entryMax: number
  minAltitude: number

  /** Leave PSM above this speed (m/s); must exceed entryMax for hysteresis. */
  exitSpeed: number
  /** Seconds for 99% of the legacy path-grip blend. Not angular authority or a duration limit. */
  blendSeconds: number
  /** PSM airflow alignment response (1/s), independent of normal flight. */
  pathResponse: number
  /** Dimensionless airflow grip during PSM and recovery. */
  activeGrip: number
  recoveryGrip: number
  /** Recovery lateral acceleration budget (m/s²). */
  recoveryAcceleration: number
  /** Legacy active-PSM lateral budget (m/s²). */
  lateralAcceleration: number
  /** Keep the original 0.3 radians exactly; 17° was a rounded design label. */
  recoveryIncidenceRad: number
  recoverySpeedMps: number
  /** High-G speed band and edge transition width, all in simulation m/s. */
  highGMinSpeedMps: number
  highGMaxSpeedMps: number
  highGSpeedFadeMps: number

  // High-G rate/drag multipliers and afterburner time budgets (s).
  highGRate: number
  highGDrag: number
  burnerSeconds: number
  burnerRecharge: number
}

/** Twin-engine TVC, with optional mirrored, canted deflection planes. */
export interface ThrustVectoringProfile {
  /** Nozzle travel limit and differential roll allocation (degrees). */
  maxAngle: number
  rollGain: number
  /** Differential yaw allocation (degrees); zero for pitch-only nozzles. */
  yawGain: number
  /** Outward cant of each nozzle's deflection plane (degrees); zero = vertical. */
  cantDeg: number
  /** Actuator travel speed (degrees/s). */
  actuatorRate: number
  /** Scalar arcade moment gain, preserving geometry ratios. */
  gain: number
  /** Actuator response rate (1/s). */
  actuatorResponse: number

  // Metres in the displayed aircraft's centered +X-forward frame.
  pivotX: number
  height: number
  /** Distance from centerline to each engine, not total engine separation. */
  spacing: number
  lipArm: number
  /** Arcade mass-normalized inertia, I/m (m²). */
  inertia: { roll: number; yaw: number; pitch: number }
}

export interface EngineProfile { spoolUpResponse: number; spoolDownResponse: number }

export interface AircraftFlightProfile {
  arcadeControlFloor: { acceleration: AeroAxes; maxRate: AeroAxes }
  engine: EngineProfile
  aero: AeroProfile
  flight: FlightProfile
  stall: StallProfile
  maneuver: ManeuverProfile
  /** null disables the physical TVC solver; it does not disable PSM. */
  thrustVectoring: ThrustVectoringProfile | null
}
