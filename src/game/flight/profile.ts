// Shared experimental F-22 baseline; airframe-specific balancing belongs to P3.
export const flightProfileVersion = 'p2-grip-3'
export const flightProfile = {
  minPoweredMps: 65, maxPoweredMps: 200,
  acceleration: 24, deceleration: 24, driveResponse: 8, releaseResponse: 6,
  maxThrust: 50, drag: 0.00035, turnDrag: 3,
  pitchRate: 0.95, yawRate: 0.42, rollRate: 2.1, rateResponse: 5,
  // Reversing a roll is not starting one: the hand has already crossed the whole gate, so the
  // airframe follows rather than coasting on. Roll axis only, and only against the rate.
  rollReversalResponse: 18,
  // Normal flight: lateral acceleration in m/s², alignment response in 1/s.
  // Reserve some path authority to close slip while the pilot keeps pulling.
  turnAcceleration: 145, turnRateReserve: 0.9,
  pathResponse: 4, turnAnticipation: 0.65,
  counterResponse: 12, neutralResponse: 9,
  gravity: 9.81,
} as const
