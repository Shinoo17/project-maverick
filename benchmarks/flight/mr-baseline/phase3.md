# Phase 3 — p8-pedal-turn-1

Tuning measurements are informational. See phase3.json for capacities, allocation shares, work/cap diagnostics and full regression deltas.

| Aircraft | Gain | Pedal peak yaw °/s | Pull rotation at 3s / 8s | Time 180° / 360° | Handoff dip rad/s | Brake/burner speed loss m/s |
|---|---:|---:|---:|---:|---:|---:|
| f22 | 2 | 13.113 | 268.466 / 693.378 | 2.058333333333333 / 3.9416666666666664 | 0 | -3.252 |
| su57 | 2 | 78.652 | 256.869 / 645.228 | 2.1166666666666667 / 4.158333333333333 | 0 | -1.665 |
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
| f22 | 1 | 87.721 | — | 103.907 | 7.241666666666666 | 0.5849 |
| f22 | 1.5 | 90.831 | 1.6333333333333333 | 78.986 | 5.058333333333334 | 0.6172 |
| f22 | 2 (selected) | 92.301 | 1.3333333333333333 | 73.032 | 3.9499999999999997 | 0.6495 |
| f22 | 2.5 | 94.315 | 1.175 | 72.017 | 3.283333333333333 | 0.6818 |
| f22 | 3 | 95.158 | 1.1166666666666667 | 72.543 | 2.9 | 0.7099 |
| su57 | 1 | 86.547 | — | 111.939 | 6.866666666666666 | 0.5710 |
| su57 | 1.5 | 90.526 | 1.7166666666666666 | 88.364 | 5.191666666666666 | 0.5963 |
| su57 | 2 (selected) | 92.001 | 1.4166666666666667 | 81.725 | 4.166666666666667 | 0.6217 |
| su57 | 2.5 | 93.747 | 1.25 | 80.204 | 3.5083333333333333 | 0.6470 |
| su57 | 3 | 95.097 | 1.15 | 79.672 | 3.058333333333333 | 0.6724 |

## Phase 2 regression

| Aircraft | Metric | Phase 2 | Phase 3 | Delta |
|---|---|---:|---:|---:|
| f22 | B13.hardTurn900.peakLimiter | — | 0.0528 | — |
| f22 | B13.hardTurn900.peakGAllowance | — | 1.1735 | — |
| f22 | B13.hardTurn900.peakAoa | 3.6559 | 3.8490 | 0.1932 |
| f22 | B13.hardTurn900.meanG | 10.6431 | 12.4320 | 1.7889 |
| f22 | B13.hardTurn900.speedLoss | 127.6770 | 140.3705 | 12.6935 |
| f22 | baseline.fullStick500.peakAoa | 4.1073 | 7.9049 | 3.7976 |
| f22 | B12.fullStick500.peakIncidence | — | 7.9049 | — |
| f22 | B12.fullStick500.limiterOpen | — | 0.1299 | — |
| f22 | B1.cobra.peakAoa | 95.5278 | 92.3014 | -3.2264 |
| f22 | B2.cobra.timeTo90 | 1.1833 | 1.3333 | 0.1500 |
| f22 | B3.cobra.speedLoss | 75.4887 | 42.0731 | -33.4156 |
| f22 | B4.cobra.headingChange | 30.6550 | 73.0319 | 42.3769 |
| f22 | B5.kulbit.time360 | 3.1500 | 3.9500 | 0.8000 |
| f22 | B15.reversal.headingChange | 18.5395 | 119.2362 | 100.6967 |
| f22 | B15.reversal.altitudeLoss | 229.0172 | 454.8109 | 225.7937 |
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
| su57 | baseline.fullStick500.peakAoa | 4.0784 | 7.8402 | 3.7618 |
| su57 | B12.fullStick500.peakIncidence | — | 7.8402 | — |
| su57 | B12.fullStick500.limiterOpen | — | 0.1299 | — |
| su57 | B1.cobra.peakAoa | 95.8936 | 92.0005 | -3.8931 |
| su57 | B2.cobra.timeTo90 | 1.1667 | 1.4167 | 0.2500 |
| su57 | B3.cobra.speedLoss | 93.7295 | 51.8191 | -41.9104 |
| su57 | B4.cobra.headingChange | 30.1084 | 81.7246 | 51.6162 |
| su57 | B5.kulbit.time360 | 3.0167 | 4.1667 | 1.1500 |
| su57 | B15.reversal.headingChange | 19.7500 | 125.7218 | 105.9717 |
| su57 | B15.reversal.altitudeLoss | 247.0783 | 392.1804 | 145.1022 |
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
