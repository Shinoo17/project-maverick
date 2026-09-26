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
  /** Fraction of forward airbrake acceleration applied to body crossflow. */
  airbrakeCrossflow: number
  /** Explicit maneuver request, fraction of dry thrust; no drag compensation. */
  controlPower: number
  /** 0..1 per stick axis, weighted by each axis's share of the stick input
   * (PilotIntent.axisShare). Scales controlPower; still pilot intent only. */
  controlPowerAxisWeight: AeroAxes
  /** Speed-squared drag coefficient; drag * speed² gives deceleration. */
  drag: number
  /** Pitch/yaw rate-squared drag coefficient. */
  turnDrag: number

  // Normal-flight angular rates (rad/s) and response rates (1/s).
  pitchRate: number
  yawRate: number
  rollRate: number
  /** Minimum full-stick rate request at low speed (rad/s). This grants no authority
   * and is independent of the arcade floor's acceleration and maxRate budgets. */
  minRateTarget: AeroAxes
  rateResponse: number
  /** 0..1 per axis. How much of the rate the pilot is commanding (between zero and the
   * target) the servo leaves undamped. 0 damps it all, so steady rate falls to
   * authority / rateResponse when the drive is budget-limited. Grants no authority. */
  commandedRateHold: AeroAxes
  /** Arcade km/h band: full hold at or below `full`, none at or above `zero`. */
  commandedRateHoldSpeedKph: { full: number; zero: number }
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
  /** Flow-only translational model, not a measured aerodynamic law (1/s). */
  physicalPathResponse: number
  physicalPathAcceleration: number
  /** Declared cap on the arcade contribution (m/s²). */
  pathAssistAcceleration: number
  pathAssistResponse: number
  /** Feed-forward alignment gain (dimensionless). */
  turnAnticipation: number
  /** Gravity used for climb/descent energy cost (m/s²). */
  gravity: number
}

export interface AeroAxes { pitch: number; yaw: number; roll: number }
/** Strictly increasing incidence (degrees), nonnegative stiffness at q=1 (rad/s²). */
export type RestoringCurve = { incidenceDeg: number; stiffness: number }[]
/** Strictly increasing incidence (degrees) spanning 0..180; effectiveness in 0..1. */
export type EffectivenessCurve = { incidenceDeg: number; effectiveness: number }[]

/** Flow reference, legacy surface speed curve and independent incidence envelope. */
export interface AeroProfile {
  /** Surface angular acceleration in fully attached flow at q=1 (rad/s²). */
  controlAcceleration: AeroAxes
  /** Control-surface effectiveness versus unsigned incidence, as an explicit
   * aerodynamic model. Never derived from the separation band in StallProfile and
   * never from EnvelopeFactors: authority stays a function of measured flow.
   */
  controlEffectiveness: { pitch: EffectivenessCurve; yaw: EffectivenessCurve; roll: EffectivenessCurve }
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
  /** Nose-down bias in reverse flow; see docs/reverse-flow-departure.md.
   * stiffness is rad/s² at q = 1; minPressure is a dimensionless q floor.
   */
  departure: { stiffness: number; minPressure: number }
  /** Rate damping coefficients (1/s at q=1), interpolated by the larger of the
   * separation memory and the measured loss of attached flow (1 − effectiveness). */
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
  separationAttachedSpeedKph: number
  /** Full-separation absolute pitch-plane alpha (degrees), independent of sideslip. */
  criticalAoaDeg: number
  /** Attached-flow edge of the continuous pitch-alpha band; below criticalAoaDeg. */
  separationAttachedAoaDeg: number
  /** Path-grip fraction at full separation (0–1). Angular aero authority is budgeted separately. */
  controlAuthority: number
  /** Multiplier on base drag at full stall (>= 1). Alpha/beta drag stays separate. */
  dragMultiplier: number
  /** Exponential separation/reattachment time constants (seconds), not deadlines. */
  separationEntrySeconds: number
  separationRecoverySeconds: number
}

export interface ManeuverProfile {
  /** Separated-flow alignment response (1/s), independent of normal flight. */
  pathResponse: number
  /** Dimensionless grip endpoints: high incidence and reattachment. */
  activeGrip: number
  recoveryGrip: number
  /** Recovery lateral acceleration budget (m/s²). */
  recoveryAcceleration: number
  /** High-incidence separated-flow lateral budget (m/s²). */
  lateralAcceleration: number

  // Automatic hard-turn rate/drag multipliers (EnvelopeFactors.hardTurnBlend)
  // and afterburner time budgets (s).
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

/** Permission tuning only; q uses (airspeed / referenceSpeedMps)². */
export interface BreakoutProfile {
  handoffSeconds: number
  qLow: number
  qHigh: number
  baseWeight: number
  brakeWeight: number
  decelerationWeight: number
  powerWeight: number
  comboWeight: number
  sustainWeight: number
  /** Exponential response rates (1/s). */
  openRate: number
  closeRate: number
  brakeBoost: number
  powerBoost: number
  /** Maximum multiplier of the normal turn acceleration budget. */
  hardTurnG: number
}

/** Knife-edge pull turns horizontally; cap incidence so it drifts instead of cobras. */
export interface BankedDriftProfile {
  /** Absolute bank angle band (degrees) that fades the cap in. */
  bankStartDeg: number
  bankFullDeg: number
  /** Displayed ARCADE km/h band that fades the cap in, below the S floor. */
  speedStartKph: number
  speedFullKph: number
  maxAlphaDeg: number
  /** Share of path assist kept at full drift (0–1): 0 slides like PSM, 1 carves. */
  pathGrip: number
}

/** Neutral-stick assistance after release. Never acts while the pilot commands a rate. */
export interface RecoveryProfile {
  /** Seconds of neutral stick before assistance starts; at least breakout.handoffSeconds. */
  delaySeconds: number
  /** Seconds from start to full assistance (smoothstep). */
  rampSeconds: number
  /** Dissipative rate-servo response toward the recovery target (1/s). */
  response: number
  /** Nose-to-airflow target rate at 90° incidence (rad/s); the drive is budgeted. */
  noseRate: number
}

export interface AircraftFlightProfile {
  breakout: BreakoutProfile
  bankedDrift: BankedDriftProfile
  recovery: RecoveryProfile
  arcadeControlFloor: { acceleration: AeroAxes; maxRate: AeroAxes }
  engine: EngineProfile
  aero: AeroProfile
  flight: FlightProfile
  stall: StallProfile
  maneuver: ManeuverProfile
  /** null disables the physical TVC solver; it does not disable PSM. */
  thrustVectoring: ThrustVectoringProfile | null
}
