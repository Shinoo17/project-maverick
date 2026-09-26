# Phase 3 — mr2-servo-1

Tuning measurements are informational. See phase3.json for capacities, allocation shares, work/cap diagnostics and full regression deltas.

| Aircraft | Gain | Pedal peak yaw °/s | Pull rotation at 3s / 8s | Time 180° / 360° | Handoff dip rad/s | Brake/burner speed loss m/s |
|---|---:|---:|---:|---:|---:|---:|
| f22 | 2 | 13.113 | 288.324 / 720.818 | 1.8583333333333334 / 3.7333333333333334 | 0 | -2.828 |
| su57 | 2 | 78.652 | 277.105 / 688.387 | 1.8916666666666666 / 3.8666666666666667 | 0 | -1.267 |
| f22-notvc | 0 | 13.113 | 124.377 / 288.141 | 4.75 / — | — | -0.167 |

B11 peak-yaw ratio F-22/Su-57 = 0.1667 (Phase 8 owner target ≤0.6; B11 travel/time in phase8.md).
B19 no-TVC rotation at 3 s target <180°; B18 is report-only.

## Moderate-q handoff

| Aircraft | Onset s | Pre-onset q | Pre-onset aero rad/s² | Dip rad/s |
|---|---:|---:|---:|---:|
| f22 | — | — | — | — |
| su57 | — | — | — | — |
| f22-notvc | — | — | — | — |

## Gain calibration

| Aircraft | Gain | Cobra peak ° | Cobra time 90° | Cobra heading ° (target ≤20) | Kulbit time 360° | Pitch rate at 0.2 s |
|---|---:|---:|---:|---:|---:|---:|
| f22 | 1 | 86.921 | — | 141.443 | 5.9 | 0.7699 |
| f22 | 1.5 | 90.424 | 1.3583333333333334 | 88.375 | 4.616666666666666 | 0.8083 |
| f22 | 2 (selected) | 91.008 | 1.2333333333333334 | 83.584 | 3.7333333333333334 | 0.8467 |
| f22 | 2.5 | 91.894 | 1.1833333333333333 | 82.620 | 3.216666666666667 | 0.8837 |
| f22 | 3 | 92.469 | 1.15 | 81.370 | 2.875 | 0.9095 |
| su57 | 1 | 86.145 | — | 147.992 | 5.6 | 0.7533 |
| su57 | 1.5 | 90.127 | 1.425 | 97.619 | 4.641666666666667 | 0.7834 |
| su57 | 2 (selected) | 90.663 | 1.2666666666666666 | 90.089 | 3.8666666666666667 | 0.8136 |
| su57 | 2.5 | 91.385 | 1.2083333333333333 | 88.086 | 3.408333333333333 | 0.8437 |
| su57 | 3 | 91.789 | 1.1666666666666667 | 85.905 | 3.0416666666666665 | 0.8738 |

## Phase 2 regression

| Aircraft | Metric | Phase 2 | Phase 3 | Delta |
|---|---|---:|---:|---:|
| f22 | B13.hardTurn900.peakLimiter | — | 0.0528 | — |
| f22 | B13.hardTurn900.peakGAllowance | — | 1.1735 | — |
| f22 | B13.hardTurn900.peakAoa | 3.6559 | 3.8490 | 0.1932 |
| f22 | B13.hardTurn900.meanG | 10.6431 | 12.4320 | 1.7889 |
| f22 | B13.hardTurn900.speedLoss | 127.6770 | 140.3705 | 12.6935 |
| f22 | baseline.fullStick500.peakAoa | 4.1073 | 7.5823 | 3.4750 |
| f22 | B12.fullStick500.peakIncidence | — | 7.5823 | — |
| f22 | B12.fullStick500.limiterOpen | — | 0.1299 | — |
| f22 | B1.cobra.peakAoa | 95.5278 | 91.0082 | -4.5196 |
| f22 | B2.cobra.timeTo90 | 1.1833 | 1.2333 | 0.0500 |
| f22 | B3.cobra.speedLoss | 75.4887 | 83.1647 | 7.6760 |
| f22 | B4.cobra.headingChange | 30.6550 | 83.5839 | 52.9289 |
| f22 | B5.kulbit.time360 | 3.1500 | 3.7333 | 0.5833 |
| f22 | B15.reversal.headingChange | 18.5395 | 131.4470 | 112.9076 |
| f22 | B15.reversal.altitudeLoss | 229.0172 | 382.9447 | 153.9275 |
| f22 | B10.tailSlide.flipTime | — | 2.8667 | — |
| f22 | baseline.pedal.yawRate | 83.1732 | 39.5361 | -43.6371 |
| f22 | B8.recovery.naturalDuringDelay | 15.6917 | 7.6444 | -8.0473 |
| f22 | B6.recovery.assistFull | — | 0.5417 | — |
| f22 | B7.recovery.backToNormal | — | — | — |
| f22 | B9.natural.release45.incidence0s | 45.0000 | 45.0000 | 0.0000 |
| f22 | B9.natural.release45.incidence0.2s | 29.3083 | 37.3556 | 8.0473 |
| f22 | B9.natural.release45.incidence0.5s | 13.3858 | 31.8623 | 18.4765 |
| f22 | B9.natural.release45.incidence1s | 3.2651 | 14.6208 | 11.3557 |
| f22 | B9.natural.release45.incidence1.5s | 1.0221 | 8.8746 | 7.8525 |
| f22 | B9.natural.release45.maxAttitudeStep | 0.0405 | 0.3467 | 0.3062 |
| f22 | B9.natural.release45.maxRate | 4.8620 | 41.6003 | 36.7383 |
| f22 | B20.sideslip60.speedLoss1s | 32.5388 | 32.2973 | -0.2415 |
| su57 | B13.hardTurn900.peakLimiter | — | 0.0545 | — |
| su57 | B13.hardTurn900.peakGAllowance | — | 1.1735 | — |
| su57 | B13.hardTurn900.peakAoa | 3.6482 | 3.8508 | 0.2025 |
| su57 | B13.hardTurn900.meanG | 10.6568 | 12.4243 | 1.7675 |
| su57 | B13.hardTurn900.speedLoss | 129.2578 | 142.1724 | 12.9146 |
| su57 | baseline.fullStick500.peakAoa | 4.0784 | 7.6852 | 3.6068 |
| su57 | B12.fullStick500.peakIncidence | — | 7.6852 | — |
| su57 | B12.fullStick500.limiterOpen | — | 0.1299 | — |
| su57 | B1.cobra.peakAoa | 95.8936 | 90.6634 | -5.2302 |
| su57 | B2.cobra.timeTo90 | 1.1667 | 1.2667 | 0.1000 |
| su57 | B3.cobra.speedLoss | 93.7295 | 91.5019 | -2.2276 |
| su57 | B4.cobra.headingChange | 30.1084 | 90.0890 | 59.9805 |
| su57 | B5.kulbit.time360 | 3.0167 | 3.8667 | 0.8500 |
| su57 | B15.reversal.headingChange | 19.7500 | 139.3765 | 119.6265 |
| su57 | B15.reversal.altitudeLoss | 247.0783 | 294.1638 | 47.0855 |
| su57 | B10.tailSlide.flipTime | — | 2.8750 | — |
| su57 | baseline.pedal.yawRate | 100.5160 | 50.4179 | -50.0981 |
| su57 | B8.recovery.naturalDuringDelay | 15.5401 | 7.4641 | -8.0760 |
| su57 | B6.recovery.assistFull | — | 0.5417 | — |
| su57 | B7.recovery.backToNormal | — | — | — |
| su57 | B9.natural.release45.incidence0s | 45.0000 | 45.0000 | 0.0000 |
| su57 | B9.natural.release45.incidence0.2s | 29.4599 | 37.5359 | 8.0760 |
| su57 | B9.natural.release45.incidence0.5s | 13.6387 | 32.6901 | 19.0514 |
| su57 | B9.natural.release45.incidence1s | 3.3477 | 15.2189 | 11.8712 |
| su57 | B9.natural.release45.incidence1.5s | 1.0630 | 9.3749 | 8.3119 |
| su57 | B9.natural.release45.maxAttitudeStep | 0.0301 | 0.3581 | 0.3279 |
| su57 | B9.natural.release45.maxRate | 3.6165 | 42.9677 | 39.3512 |
| su57 | B20.sideslip60.speedLoss1s | 34.9855 | 34.7135 | -0.2720 |
