# Phase 4 — mr2-servo-1

All feel targets are report-only. Automatic entry uses Airbrake (Space) + Shift + pull.
B17 (C vs automatic) retired in Phase 6 with the C key. phase4.json keeps partial and full-stick entry diagnostics with unsaturated-step counts.
B16 sweeps q in eight seconds with a 20%-of-band (0.26-q) 0.5 Hz ripple. A separate no-ripple control checks the intended reversal; missing reversals are invalid, never zero chatter.

| Aircraft | Scenario | Metric | Value | Status |
|---|---|---|---:|---|
| f22 | cobra | B1.cobra.peakAoa | 91.0082 deg | ok |
| f22 | cobra | B2.cobra.timeTo90 | 1.2333 s | ⚠ out |
| f22 | cobra | B3.cobra.speedLoss | 83.1647 arcade km/h | report |
| f22 | cobra | B4.cobra.headingChange | 83.5839 deg | ⚠ out |
| f22 | kulbit | B5.kulbit.time360 | 3.7333 s | ok |
| f22 | reversal180 | B15.reversal.headingChange | 131.4470 deg at 10 s / stop | report |
| f22 | reversal180 | B15.reversal.altitudeLoss | 382.9447 m | report |
| f22 | pedal | baseline.pedal.yawRate | 39.5361 deg/s at 2 s | report |
| f22 | psmIntent450 | B14.psmIntent.timeTo70 | 0.8583 s | ok |
| f22 | psmIntent450 | psmIntent.timeToLimiter90 | 0.2167 s | report |
| f22 | psmIntent450 | psmIntent.peakIncidence | 107.8106 deg | report |
| f22 | psmIntent450 | psmIntent.peakLimiter | 1.0000 fraction | report |
| f22 | fullStick500 | baseline.fullStick500.peakAoa | 7.5823 deg | report |
| f22 | fullStick500 | B12.fullStick500.peakIncidence | 7.5823 deg | ok |
| f22 | fullStick500 | B12.fullStick500.limiterOpen | 0.1299 fraction | ok |
| f22 | hardTurn900 | B13.hardTurn900.peakLimiter | 0.0528 fraction | report |
| f22 | hardTurn900 | B13.hardTurn900.peakGAllowance | 1.1735 multiplier | report |
| f22 | hardTurn900 | B13.hardTurn900.peakAoa | 3.8490 deg | report |
| f22 | hardTurn900 | B13.hardTurn900.meanG | 12.4320 G | report |
| f22 | hardTurn900 | B13.hardTurn900.speedLoss | 140.3705 arcade km/h | report |
| f22 | comparison | breakout.maxSpeedLimiter90 | 726.0254 arcade km/h / fixed attached flow, Airbrake + Shift + full pull for 8 s | report |
| f22 | comparison | B16.limiter.chatterCount | 4.0000 unintended reversals / 8 s | ⚠ out |
| f22 | comparison | B18.auto.handoffRateDip | 0.0000 rad/s | report |
| f22 | comparison | B19.auto.maxRotation3s | 276.5258 deg | report |
| su57 | cobra | B1.cobra.peakAoa | 90.6634 deg | ok |
| su57 | cobra | B2.cobra.timeTo90 | 1.2667 s | ⚠ out |
| su57 | cobra | B3.cobra.speedLoss | 91.5019 arcade km/h | report |
| su57 | cobra | B4.cobra.headingChange | 90.0890 deg | ⚠ out |
| su57 | kulbit | B5.kulbit.time360 | 3.8667 s | ok |
| su57 | reversal180 | B15.reversal.headingChange | 139.3765 deg at 10 s / stop | report |
| su57 | reversal180 | B15.reversal.altitudeLoss | 294.1638 m | report |
| su57 | pedal | baseline.pedal.yawRate | 50.4179 deg/s at 2 s | report |
| su57 | psmIntent450 | B14.psmIntent.timeTo70 | 0.8583 s | ok |
| su57 | psmIntent450 | psmIntent.timeToLimiter90 | 0.2167 s | report |
| su57 | psmIntent450 | psmIntent.peakIncidence | 101.5944 deg | report |
| su57 | psmIntent450 | psmIntent.peakLimiter | 1.0000 fraction | report |
| su57 | fullStick500 | baseline.fullStick500.peakAoa | 7.6852 deg | report |
| su57 | fullStick500 | B12.fullStick500.peakIncidence | 7.6852 deg | ok |
| su57 | fullStick500 | B12.fullStick500.limiterOpen | 0.1299 fraction | ok |
| su57 | hardTurn900 | B13.hardTurn900.peakLimiter | 0.0545 fraction | report |
| su57 | hardTurn900 | B13.hardTurn900.peakGAllowance | 1.1735 multiplier | report |
| su57 | hardTurn900 | B13.hardTurn900.peakAoa | 3.8508 deg | report |
| su57 | hardTurn900 | B13.hardTurn900.meanG | 12.4243 G | report |
| su57 | hardTurn900 | B13.hardTurn900.speedLoss | 142.1724 arcade km/h | report |
| su57 | comparison | breakout.maxSpeedLimiter90 | 726.0254 arcade km/h / fixed attached flow, Airbrake + Shift + full pull for 8 s | report |
| su57 | comparison | B16.limiter.chatterCount | 4.0000 unintended reversals / 8 s | ⚠ out |
| su57 | comparison | B18.auto.handoffRateDip | 0.0000 rad/s | report |
| su57 | comparison | B19.auto.maxRotation3s | 265.7166 deg | report |
| f22-notvc | cobra | B1.cobra.peakAoa | 53.9394 deg | ⚠ out |
| f22-notvc | cobra | B2.cobra.timeTo90 | — s | ⚠ out |
| f22-notvc | cobra | B3.cobra.speedLoss | 0.9316 arcade km/h | report |
| f22-notvc | cobra | B4.cobra.headingChange | 67.4956 deg | ⚠ out |
| f22-notvc | kulbit | B5.kulbit.time360 | — s | ⚠ out |
| f22-notvc | reversal180 | B15.reversal.headingChange | 169.8491 deg at 10 s / stop | report |
| f22-notvc | reversal180 | B15.reversal.altitudeLoss | 0.0000 m | report |
| f22-notvc | pedal | baseline.pedal.yawRate | 39.5361 deg/s at 2 s | report |
| f22-notvc | psmIntent450 | B14.psmIntent.timeTo70 | — s | ⚠ out |
| f22-notvc | psmIntent450 | psmIntent.timeToLimiter90 | 0.2167 s | report |
| f22-notvc | psmIntent450 | psmIntent.peakIncidence | 55.0320 deg | report |
| f22-notvc | psmIntent450 | psmIntent.peakLimiter | 1.0000 fraction | report |
| f22-notvc | fullStick500 | baseline.fullStick500.peakAoa | 6.2473 deg | report |
| f22-notvc | fullStick500 | B12.fullStick500.peakIncidence | 6.2473 deg | ok |
| f22-notvc | fullStick500 | B12.fullStick500.limiterOpen | 0.1299 fraction | ok |
| f22-notvc | hardTurn900 | B13.hardTurn900.peakLimiter | 0.0528 fraction | report |
| f22-notvc | hardTurn900 | B13.hardTurn900.peakGAllowance | 1.1735 multiplier | report |
| f22-notvc | hardTurn900 | B13.hardTurn900.peakAoa | 3.8490 deg | report |
| f22-notvc | hardTurn900 | B13.hardTurn900.meanG | 12.4320 G | report |
| f22-notvc | hardTurn900 | B13.hardTurn900.speedLoss | 140.3705 arcade km/h | report |
| f22-notvc | comparison | breakout.maxSpeedLimiter90 | 726.0254 arcade km/h / fixed attached flow, Airbrake + Shift + full pull for 8 s | report |
| f22-notvc | comparison | B16.limiter.chatterCount | 4.0000 unintended reversals / 8 s | ⚠ out |
| f22-notvc | comparison | B18.auto.handoffRateDip | — rad/s | report |
| f22-notvc | comparison | B19.auto.maxRotation3s | 121.4504 deg | ok |

Existing B1–B5/B10/B11/B13/B15/B18/B19/B20 and B23–B25 remain in report.md, phase3.md and crossflow.md, all generated with the current physics version.
The manual High-G fixture retired in Phase 6 with the Space High-G command; its last values are in docs/psm-phase6-implementation.md.
