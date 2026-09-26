# Phase 8 — mr2-servo-1

Report only. Speed columns are arcade km/h; speedLow/High are the change from pedal start until 360° (or the whole window).

## B11 pedal turn (Space + full yaw, 8 s)

| aircraft | flow | startKph | travel6sDeg | travel8sDeg | time360 | kphAt360 | speedLowKph | speedHighKph | endKph | nosePitchEndDeg | altitudeLossM | peakControlPowerPct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f22 | level | 150 | 140 | 202 | — | — | -17 | 63 | 213 | -11 | 188 | 42 |
| f22 | vertical | 150 | 84 | 133 | — | — | -77 | 13 | 163 | -43 | -54 | 42 |
| su57 | level | 150 | 392 | 555 | 5.62 | 161 | -17 | 12 | 172 | -39 | 169 | 42 |
| su57 | vertical | 150 | 385 | 550 | 5.7 | 17 | -134 | 0 | 84 | -52 | -12 | 42 |
| f22-notvc | level | 150 | 140 | 202 | — | — | -17 | 63 | 213 | -11 | 188 | 42 |
| f22-notvc | vertical | 150 | 84 | 133 | — | — | -77 | 13 | 163 | -43 | -54 | 42 |

## B22 personality traits

| aircraft | cobraTimeTo90 | cobraSpeedLoss | kulbitTime360 | timeToAlphaNormal | release45Incidence15 |
|---|---|---|---|---|---|
| f22 | 1.233 | 83 | 3.733 | 0.808 | 8.9 |
| su57 | 1.267 | 92 | 3.867 | 0.842 | 9.4 |
| f22-notvc | — | 1 | — | 0.817 | 8.9 |

## Checks

| id | value | status |
|---|---|---|
| B11.pedal.su57Time360 | 5.62 | ok |
| B11.pedal.f22ToSu57Travel6s | 0.357 | ok |
| B11.pedal.su57LevelSpeedBand | 17 | ok |
| B22.yaw: Su-57 > F-22 (pedal travel) | — | ok |
| B22.pitch: F-22 ≤ Su-57 (Kulbit 360° time) | — | ok |
| B22.recovery: F-22 ≤ Su-57 (release45 time to alphaNormal) | — | ok |
| B22.stability: F-22 ≤ Su-57 (incidence 1.5 s after release45) | — | ok |

## Yaw control-power weight sweep

| aircraft | yawWeight | levelTime360 | levelKphAt360 | levelEndKph | verticalTravel8s | verticalLow | verticalHigh |
|---|---|---|---|---|---|---|---|
| f22 | 1 | — | — | 444 | 217 | -24 | 136 |
| f22 | 0.8 | — | — | 311 | 194 | -34 | 50 |
| f22 | 0.6 | — | — | 213 | 133 | -77 | 13 |
| f22 | 0.4 | — | — | 192 | 86 | -128 | 0 |
| su57 | 1 | 5.32 | 212 | 285 | 582 | -150 | 0 |
| su57 | 0.8 | 5.42 | 187 | 201 | 571 | -150 | 0 |
| su57 | 0.6 | 5.62 | 161 | 172 | 550 | -134 | 0 |
| su57 | 0.4 | 6.03 | 132 | 135 | 507 | -143 | 0 |
