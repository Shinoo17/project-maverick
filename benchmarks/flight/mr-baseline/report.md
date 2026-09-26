# Flight tuning report — p8-pedal-turn-1

Feel targets are informational; unreached thresholds are null (—). Samples use 120 Hz simulation time.
Phase 2 acceptance is PENDING owner playtest/B9 targets. Legacy rates/labels are not Phase 3 authority. See ../README.md for metric windows.

## f22

| Benchmark / metric | Value | Target | Status |
|---|---:|---|---|
| B13.hardTurn900.peakLimiter | 0.053 fraction | — | report |
| B13.hardTurn900.peakGAllowance | 1.174 multiplier | — | report |
| B13.hardTurn900.peakAoa | 3.849 deg | — | report |
| B13.hardTurn900.meanG | 12.432 G | — | report |
| B13.hardTurn900.speedLoss | 140.370 arcade km/h | — | report |
| baseline.fullStick500.peakAoa | 7.905 deg | — | report |
| B12.fullStick500.peakIncidence | 7.905 deg | −∞ … 25 | ok |
| B12.fullStick500.limiterOpen | 0.130 fraction | −∞ … 0.35 | ok |
| B1.cobra.peakAoa | 92.301 deg | 75 … 95 | ok |
| B2.cobra.timeTo90 | 1.333 s | 0.7 … 1.2 | ⚠ out |
| B3.cobra.speedLoss | 42.073 arcade km/h | — | report |
| B4.cobra.headingChange | 73.032 deg | −∞ … 20 | ⚠ out |
| B5.kulbit.time360 | 3.950 s | 3 … 4.5 | ok |
| B15.reversal.headingChange | 119.236 deg at 10 s / stop | — | report |
| B15.reversal.altitudeLoss | 454.811 m | — | report |
| B10.tailSlide.flipTime | 2.867 s after apex | −∞ … 4 | ok |
| baseline.pedal.yawRate | 39.536 deg/s at 2 s | — | report |
| B8.recovery.naturalDuringDelay | 7.644 deg reduction / 0.2 s without assist | > 0 … ∞ | ok |
| B6.recovery.assistFull | 0.542 s after release | 0.5 … 1.5 | ok |
| B7.recovery.backToNormal | — s after release | — | report |
| B9.natural.release45.incidence0s | 45.000 deg | — | pending playtest |
| B9.natural.release45.incidence0.2s | 37.356 deg | — | pending playtest |
| B9.natural.release45.incidence0.5s | 31.862 deg | — | pending playtest |
| B9.natural.release45.incidence1s | 14.621 deg | — | pending playtest |
| B9.natural.release45.incidence1.5s | 8.875 deg | — | pending playtest |
| B9.natural.release45.maxAttitudeStep | 0.347 deg/substep | — | pending playtest |
| B9.natural.release45.maxRate | 41.600 deg/s | — | pending playtest |
| B20.sideslip60.speedLoss1s | 32.297 arcade km/h | > 3.111747605072548 … ∞ | ok |
| B14.psmIntent.timeTo70 | 1.050 s | −∞ … 1.2 | ok |
| psmIntent.timeToLimiter90 | 0.217 s | — | report |
| psmIntent.peakIncidence | 116.155 deg | — | report |
| psmIntent.peakLimiter | 1.000 fraction | — | report |

## su57

| Benchmark / metric | Value | Target | Status |
|---|---:|---|---|
| B13.hardTurn900.peakLimiter | 0.055 fraction | — | report |
| B13.hardTurn900.peakGAllowance | 1.174 multiplier | — | report |
| B13.hardTurn900.peakAoa | 3.851 deg | — | report |
| B13.hardTurn900.meanG | 12.424 G | — | report |
| B13.hardTurn900.speedLoss | 142.172 arcade km/h | — | report |
| baseline.fullStick500.peakAoa | 7.840 deg | — | report |
| B12.fullStick500.peakIncidence | 7.840 deg | −∞ … 25 | ok |
| B12.fullStick500.limiterOpen | 0.130 fraction | −∞ … 0.35 | ok |
| B1.cobra.peakAoa | 92.001 deg | 75 … 95 | ok |
| B2.cobra.timeTo90 | 1.417 s | 0.7 … 1.2 | ⚠ out |
| B3.cobra.speedLoss | 51.819 arcade km/h | — | report |
| B4.cobra.headingChange | 81.725 deg | −∞ … 20 | ⚠ out |
| B5.kulbit.time360 | 4.167 s | 3 … 4.5 | ok |
| B15.reversal.headingChange | 125.722 deg at 10 s / stop | — | report |
| B15.reversal.altitudeLoss | 392.180 m | — | report |
| B10.tailSlide.flipTime | 2.875 s after apex | −∞ … 4 | ok |
| baseline.pedal.yawRate | 50.418 deg/s at 2 s | — | report |
| B8.recovery.naturalDuringDelay | 7.464 deg reduction / 0.2 s without assist | > 0 … ∞ | ok |
| B6.recovery.assistFull | 0.542 s after release | 0.5 … 1.5 | ok |
| B7.recovery.backToNormal | — s after release | — | report |
| B9.natural.release45.incidence0s | 45.000 deg | — | pending playtest |
| B9.natural.release45.incidence0.2s | 37.536 deg | — | pending playtest |
| B9.natural.release45.incidence0.5s | 32.690 deg | — | pending playtest |
| B9.natural.release45.incidence1s | 15.219 deg | — | pending playtest |
| B9.natural.release45.incidence1.5s | 9.375 deg | — | pending playtest |
| B9.natural.release45.maxAttitudeStep | 0.358 deg/substep | — | pending playtest |
| B9.natural.release45.maxRate | 42.968 deg/s | — | pending playtest |
| B20.sideslip60.speedLoss1s | 34.714 arcade km/h | > 3.111747605072548 … ∞ | ok |
| B14.psmIntent.timeTo70 | 1.117 s | −∞ … 1.2 | ok |
| psmIntent.timeToLimiter90 | 0.217 s | — | report |
| psmIntent.peakIncidence | 110.139 deg | — | report |
| psmIntent.peakLimiter | 1.000 fraction | — | report |

## Full-travel geometry capacity

| Aircraft | Thrust m/s² | Pitch rad/s² | Yaw rad/s² | Roll rad/s² |
|---|---:|---:|---:|---:|
| f22 | 3.5 | 0.39296 | 0.00000 | 0.13002 |
| f22 | 27.5 | 3.08752 | 0.00000 | 1.02160 |
| f22 | 65 | 7.29777 | 0.00000 | 2.41469 |
| su57 | 3.5 | 0.34293 | 0.19468 | 0.18490 |
| su57 | 27.5 | 2.69443 | 1.52963 | 1.45276 |
| su57 | 65 | 6.36866 | 3.61550 | 3.43380 |
