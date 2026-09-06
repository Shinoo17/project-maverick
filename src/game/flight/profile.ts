// Shared experimental F-22 baseline; airframe-specific balancing belongs to P3.
export const flightProfile = {
  minTargetMps: 65, maxTargetMps: 200, speedAdjustMps2: 30,
  acceleration: 24, spoolRate: 1.5, drag: 0.00035, turnDrag: 3,
  pitchRate: 0.95, yawRate: 0.42, rollRate: 2.1, rateResponse: 5,
  pathResponse: 1.5, gravity: 9.81,
} as const
