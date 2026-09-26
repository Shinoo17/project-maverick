# Maneuvers — mr2-servo-1 (maneuvers-mr2-rc4)

Source commit c5b1c44c728b5994914ded6a7ed0c2b77f5965ba plus working tree. Report only. Speeds are arcade km/h, times seconds, rates °/s unless named. See benchmarks/flight/maneuvers.ts for each recipe.

## roll

| aircraft | speedKph | peakRateDegS | time90 | time180 | time360 | travel3sDeg | atPeakAeroBudget | atPeakAero | atPeakUnmet | atPeakServoDamping | targetRate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f22 | 250 | 34.9 | 2.933 | — | — | 93 | 3.05 | 3.05 | 2.46 | -2.98 | 2.1 |
| f22 | 450 | 104.5 | 1.058 | 1.917 | — | 293 | 8.97 | 8.97 | 0.45 | -8.93 | 2.1 |
| f22 | 700 | 116.4 | 0.967 | 1.742 | — | 327 | 21.78 | 10.28 | 0 | -9.95 | 2.1 |
| f22 | 1000 | 97.2 | 1.108 | 2.042 | — | 274 | 44.45 | 8.89 | 0 | -8.31 | 2.1 |
| su57 | 250 | 35 | 2.925 | — | — | 93 | 3.05 | 3.05 | 2.47 | -2.99 | 2.1 |
| su57 | 450 | 104.7 | 1.058 | 1.917 | — | 294 | 9.01 | 9.01 | 0.45 | -8.95 | 2.1 |
| su57 | 700 | 116.4 | 0.967 | 1.742 | — | 327 | 21.78 | 10.28 | 0 | -9.95 | 2.1 |
| su57 | 1000 | 97.2 | 1.108 | 2.042 | — | 274 | 44.45 | 8.89 | 0 | -8.31 | 2.1 |
| f22-notvc | 250 | 34.7 | 2.95 | — | — | 92 | 3.06 | 3.06 | 2.49 | -2.97 | 2.1 |
| f22-notvc | 450 | 103.9 | 1.067 | 1.933 | — | 292 | 9 | 9 | 0.52 | -8.88 | 2.1 |
| f22-notvc | 700 | 116.4 | 0.967 | 1.742 | — | 327 | 21.78 | 10.28 | 0 | -9.95 | 2.1 |
| f22-notvc | 1000 | 97.2 | 1.108 | 2.042 | — | 274 | 44.45 | 8.89 | 0 | -8.31 | 2.1 |

## smoothness

| aircraft | axis | speedKph | peakRateDegS | latency63 | overshootPct | reversal63 | reversalRequestStep | zeroCrossRequestStep | peakJerk |
|---|---|---|---|---|---|---|---|---|---|
| f22 | pitch | 450 | 50.4 | 0.217 | 1.4 | 0.442 | 1.03 | 0 | 136 |
| f22 | pitch | 700 | 52.9 | 0.2 | 0 | 0.25 | 2.08 | 0.04 | 325 |
| f22 | roll | 450 | 104.5 | 0.2 | 0 | 0.292 | 5.44 | 0.41 | 570 |
| f22 | roll | 700 | 116.3 | 0.2 | 0 | 0.258 | 9.45 | 0 | 1422 |
| f22 | yaw | 450 | 21.3 | 0.208 | 0 | 0.283 | 0.55 | 0.01 | 65 |
| f22 | yaw | 700 | 23.1 | 0.192 | 0 | 0.25 | 0.92 | 0 | 177 |
| su57 | pitch | 450 | 50.4 | 0.217 | 1.9 | 0.458 | 1.03 | 0.07 | 136 |
| su57 | pitch | 700 | 52.9 | 0.2 | 0 | 0.25 | 2.07 | 0.05 | 327 |
| su57 | roll | 450 | 104.5 | 0.2 | 0 | 0.283 | 5.45 | 0.38 | 571 |
| su57 | roll | 700 | 116.3 | 0.2 | 0 | 0.258 | 9.45 | 0 | 1423 |
| su57 | yaw | 450 | 25.4 | 0.217 | 0 | 0.3 | 0.62 | 0 | 75 |
| su57 | yaw | 700 | 26.4 | 0.192 | 0 | 0.25 | 1.06 | 0 | 204 |
| f22-notvc | pitch | 450 | 45.3 | 0.192 | 4.1 | 0.317 | 1.13 | 0.06 | 132 |
| f22-notvc | pitch | 700 | 52.9 | 0.2 | 0 | 0.25 | 2.06 | 0.05 | 325 |
| f22-notvc | roll | 450 | 103.8 | 0.2 | 0 | 0.283 | 5.49 | 0.33 | 569 |
| f22-notvc | roll | 700 | 116.3 | 0.2 | 0 | 0.258 | 9.44 | 0 | 1420 |
| f22-notvc | yaw | 450 | 21.3 | 0.208 | 0 | 0.283 | 0.55 | 0.01 | 65 |
| f22-notvc | yaw | 700 | 23.1 | 0.192 | 0 | 0.25 | 0.92 | 0 | 177 |

## cobraEntry

| aircraft | speedKph | shift | time30 | time60 | time90 | peakIncidence | peakPitchRate | speedLoss |
|---|---|---|---|---|---|---|---|---|
| f22 | 450 | false | 0.742 | 1.225 | 2.083 | 97.3 | 1.245 | 120 |
| f22 | 450 | true | 0.608 | 0.925 | 1.375 | 116.2 | 1.972 | 187 |
| su57 | 450 | false | 0.775 | 1.292 | 2.233 | 94.1 | 1.196 | 133 |
| su57 | 450 | true | 0.642 | 0.983 | 1.458 | 110.1 | 1.916 | 186 |
| f22-notvc | 450 | false | 1.192 | — | — | 49.1 | 0.675 | 69 |
| f22-notvc | 450 | true | 1.033 | — | — | 53.3 | 1.009 | 1 |
| f22 | 350 | false | 0.817 | 1.358 | 2.317 | 93.1 | 1.016 | 46 |
| f22 | 550 | false | 0.692 | 1.108 | 1.875 | 101.3 | 1.488 | 200 |

## cobraExit

| aircraft | speedKph | mode | pushAt | peakIncidence | toEntryAttitude10 | toAttitude5 | incidenceBelow15 | maxPathAngle | altitudeGainAtLevel | kphAtLevel | attitudeAt5s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f22 | 450 | push | 1.883 | 86.2 | 3.217 | 3.55 | 1.442 | 54.4 | 143 | 301 | 3.7 |
| f22 | 450 | release | 1.883 | 115.3 | 6.775 | 6.925 | — | 23.3 | 15 | 112 | 61.2 |
| su57 | 450 | push | 1.992 | 85.8 | 4.475 | 4.917 | 1.542 | 60.9 | 185 | 283 | 4.3 |
| su57 | 450 | release | 1.992 | 136.2 | 6.975 | 7.1 | — | 26.8 | 27 | 94 | 82.2 |
| f22-notvc | 450 | push | — | — | — | — | — | — | — | — | — |
| f22-notvc | 450 | release | — | — | — | — | — | — | — | — | — |

## pedal

| aircraft | time360 | travel8sDeg | endKph |
|---|---|---|---|
| f22 | — | 202 | 213 |
| su57 | 5.62 | 555 | 172 |
| f22-notvc | — | 202 | 213 |

## herbst

| aircraft | speedKph | withYaw | time70 | maxHeadingDeg | time170 | altitudeRange | kphAt170 | peakIncidence |
|---|---|---|---|---|---|---|---|---|
| f22 | 450 | false | 1.45 | 129 | — | 186 | — | 84.5 |
| f22 | 450 | true | 1.45 | 130 | — | 167 | — | 84.6 |
| su57 | 450 | false | 1.533 | 102 | — | 147 | — | 106.6 |
| su57 | 450 | true | 1.533 | 106 | — | 170 | — | 83.6 |
| f22-notvc | 450 | false | — | 360 | — | — | 567 | 48.2 |
| f22-notvc | 450 | true | — | 360 | — | — | 567 | 48.2 |

## loops

| aircraft | kind | speedKph | time360 | heightGain | endAltitudeChange | endKph | peakIncidence |
|---|---|---|---|---|---|---|---|
| f22 | plain | 700 | 6.967 | 264 | -7 | 745 | 4.2 |
| f22 | powered | 350 | 8.717 | 321 | -543 | 1126 | 5.3 |
| su57 | plain | 700 | 6.95 | 263 | -6 | 740 | 4.2 |
| su57 | powered | 350 | 8.683 | 317 | -545 | 1127 | 5.1 |
| f22-notvc | plain | 700 | 6.967 | 264 | -7 | 745 | 4.2 |
| f22-notvc | powered | 350 | 8.942 | 358 | -480 | 1105 | 4.2 |

## powerLoops

| aircraft | speedKph | flow | time270 | widthM | peakIncidence | maxNoseMinusPath | minKph | heightM |
|---|---|---|---|---|---|---|---|---|
| f22 | 400 | none | 7.42 | 237 | 17 | 17 | 325 | 146 |
| f22 | 400 | W | 5.39 | 216 | 7.1 | 7.1 | 394 | 115 |
| f22 | 400 | Shift | 5.78 | 400 | 5.4 | 5.4 | 399 | 114 |
| f22 | 400 | Shift+Space | 4.42 | 103 | 103.5 | 103.5 | 231 | 148 |
| f22 | 450 | none | 5.93 | 199 | 9.6 | 9.6 | 386 | 126 |
| f22 | 450 | W | 5.33 | 234 | 4.8 | 4.8 | 444 | 117 |
| f22 | 450 | Shift | 5.92 | 431 | 4.3 | 4.3 | 449 | 120 |
| f22 | 450 | Shift+Space | 4.36 | 109 | 105.6 | 105.6 | 227 | 157 |
| su57 | 400 | none | 7.57 | 243 | 16.7 | 16.7 | 323 | 148 |
| su57 | 400 | W | 5.39 | 211 | 7.1 | 7.1 | 394 | 115 |
| su57 | 400 | Shift | 5.77 | 395 | 5.3 | 5.3 | 399 | 114 |
| su57 | 400 | Shift+Space | 4.64 | 108 | 99 | 99 | 248 | 148 |
| su57 | 450 | none | 6 | 202 | 9.3 | 9.3 | 385 | 127 |
| su57 | 450 | W | 5.33 | 229 | 4.9 | 4.9 | 444 | 116 |
| su57 | 450 | Shift | 5.9 | 428 | 4.4 | 4.4 | 449 | 120 |
| su57 | 450 | Shift+Space | 4.56 | 113 | 99.4 | 99.4 | 246 | 156 |
| f22-notvc | 400 | none | 8.52 | 287 | 12.7 | 12.7 | 323 | 167 |
| f22-notvc | 400 | W | 5.66 | 238 | 4.9 | 4.9 | 394 | 132 |
| f22-notvc | 400 | Shift | 6.1 | 426 | 4.3 | 4.3 | 399 | 131 |
| f22-notvc | 400 | Shift+Space | — | 389 | 65.2 | 65.2 | 391 | 242 |
| f22-notvc | 450 | none | 6.58 | 234 | 7.3 | 7.3 | 387 | 140 |
| f22-notvc | 450 | W | 5.46 | 244 | 4.1 | 4.1 | 444 | 126 |
| f22-notvc | 450 | Shift | 6.06 | 441 | 4.3 | 4.3 | 449 | 129 |
| f22-notvc | 450 | Shift+Space | — | 388 | 65.6 | 65.6 | 419 | 240 |

## bell

| aircraft | flow | apexTime | minKph | backSlideM | noseDropAfterApex | peakRollYawDegS | alive |
|---|---|---|---|---|---|---|---|
| f22 | probe 500 attitude 88, release | 10.425 | 2 | 24.5 | 2.92 | 0 | true |
| f22 | recipe 450 Space + pull to 90°, release | 4.542 | 102 | 28.9 | 2.99 | 0 | true |
| su57 | probe 500 attitude 88, release | 10.4 | 2 | 24.4 | 2.92 | 0 | true |
| su57 | recipe 450 Space + pull to 90°, release | 4.8 | 81 | 49.3 | 4.58 | 0 | true |
| f22-notvc | probe 500 attitude 88, release | 10.433 | 2 | 24.9 | 2.96 | 0 | true |
| f22-notvc | recipe 450 Space + pull to 90°, release | 5.642 | 86 | 0 | 0.98 | 0 | true |

## immelmann

| aircraft | speedKph | halfLoop | rollOut | topKph | heightGain |
|---|---|---|---|---|---|
| f22 | 800 | 3.833 | 1.708 | 681 | 313 |
| su57 | 800 | 3.833 | 1.708 | 679 | 312 |
| f22-notvc | 800 | 3.833 | 1.708 | 681 | 313 |

## kulbit

| aircraft | speedKph | time360 | peakIncidence |
|---|---|---|---|
| f22 | 350 | 4.3 | 112 |
| su57 | 350 | 4.558 | 105.7 |
| f22-notvc | 350 | — | 53.9 |

## mouse

| bankDeg | mode | pitch | roll |
|---|---|---|---|
| 0 | horizon | 0.71 | 0.71 |
| 0 | aircraft | 0.71 | 0.71 |
| 0 | body | 0.71 | 0.71 |
| 45 | horizon | 0 | 1 |
| 45 | aircraft | 0.71 | 0.71 |
| 45 | body | 0.71 | 0.71 |
| 90 | horizon | -0.71 | 0.91 |
| 90 | aircraft | 0.71 | 0.71 |
| 90 | body | 0.71 | 0.71 |
| 135 | horizon | -1 | 0.71 |
| 135 | aircraft | 0.71 | 0.71 |
| 135 | body | 0.71 | 0.71 |
| 180 | horizon | -0.71 | -0.91 |
| 180 | aircraft | 0.71 | 0.71 |
| 180 | body | 0.71 | 0.71 |

## checks

| id | aircraft | value | target | status |
|---|---|---|---|---|
| B26.roll.peakRate.450 | f22 | 104.5 | 220 … 240 | ⚠ out |
| B26.roll.time90.450 | f22 | 1.058 | −∞ … 0.6 | ⚠ out |
| B26.roll.peakRate.700 | f22 | 116.4 | 220 … 240 | ⚠ out |
| B26.roll.time90.700 | f22 | 0.967 | −∞ … 0.6 | ⚠ out |
| B2.cobra.timeTo90NoShift | f22 | 2.083 | −∞ … 1 | ⚠ out |
| B1.cobra.peakAoa (Space + Shift) | f22 | 116.2 | 90 … 120 | ok |
| B27.cobraExit.toEntryAttitude10 | f22 | 3.217 | −∞ … 1.2 | ⚠ out |
| B27.cobraExit.maxPathAngle | f22 | 54.4 | −∞ … 20 | ⚠ out |
| B27.cobraExit.altitudeGainAtLevel | f22 | 143 | −∞ … 60 | ⚠ out |
| B28.herbst.time170 (roll) | f22 | — | −∞ … 4 | ⚠ out |
| B28.herbst.altitudeRange | f22 | 186 | −∞ … 200 | ok |
| B29.powerLoop.width (450 none) | f22 | 199 | −∞ … 160 | ⚠ out |
| B29.powerLoop.time270 | f22 | 5.93 | −∞ … 5 | ⚠ out |
| B29.powerLoop.peakIncidence | f22 | 9.6 | −∞ … 30 | ok |
| B29.powerLoop.noseMinusPath | f22 | 9.6 | −∞ … 30 | ok |
| B29.powerLoop.minKph | f22 | 386 | 150 … ∞ | ok |
| B30.bell.minKph | f22 | 102 | −∞ … 30 | ⚠ out |
| B30.bell.backSlideM | f22 | 28.9 | 0 … ∞ | ok |
| B30.bell.noseDropAfterApex | f22 | 2.99 | −∞ … 3 | ok |
| B31.immelmann.halfLoop | f22 | 3.833 | −∞ … 4 | ok |
| B31.immelmann.rollOut | f22 | 1.708 | −∞ … 1 | ⚠ out |
| B31.immelmann.topKph | f22 | 681 | 300 … ∞ | ok |
| B5.kulbit350.time360 | f22 | 4.3 | 3 … 4.5 | ok |
| B26.roll.peakRate.450 | su57 | 104.7 | 220 … 240 | ⚠ out |
| B26.roll.time90.450 | su57 | 1.058 | −∞ … 0.6 | ⚠ out |
| B26.roll.peakRate.700 | su57 | 116.4 | 220 … 240 | ⚠ out |
| B26.roll.time90.700 | su57 | 0.967 | −∞ … 0.6 | ⚠ out |
| B2.cobra.timeTo90NoShift | su57 | 2.233 | −∞ … 1 | ⚠ out |
| B1.cobra.peakAoa (Space + Shift) | su57 | 110.1 | 90 … 120 | ok |
| B27.cobraExit.toEntryAttitude10 | su57 | 4.475 | −∞ … 1.2 | ⚠ out |
| B27.cobraExit.maxPathAngle | su57 | 60.9 | −∞ … 20 | ⚠ out |
| B27.cobraExit.altitudeGainAtLevel | su57 | 185 | −∞ … 60 | ⚠ out |
| B28.herbst.time170 (roll) | su57 | — | −∞ … 4 | ⚠ out |
| B28.herbst.altitudeRange | su57 | 147 | −∞ … 200 | ok |
| B29.powerLoop.width (450 none) | su57 | 202 | −∞ … 160 | ⚠ out |
| B29.powerLoop.time270 | su57 | 6 | −∞ … 5 | ⚠ out |
| B29.powerLoop.peakIncidence | su57 | 9.3 | −∞ … 30 | ok |
| B29.powerLoop.noseMinusPath | su57 | 9.3 | −∞ … 30 | ok |
| B29.powerLoop.minKph | su57 | 385 | 150 … ∞ | ok |
| B30.bell.minKph | su57 | 81 | −∞ … 30 | ⚠ out |
| B30.bell.backSlideM | su57 | 49.3 | 0 … ∞ | ok |
| B30.bell.noseDropAfterApex | su57 | 4.58 | −∞ … 3 | ⚠ out |
| B31.immelmann.halfLoop | su57 | 3.833 | −∞ … 4 | ok |
| B31.immelmann.rollOut | su57 | 1.708 | −∞ … 1 | ⚠ out |
| B31.immelmann.topKph | su57 | 679 | 300 … ∞ | ok |
| B5.kulbit350.time360 | su57 | 4.558 | 3 … 4.5 | ⚠ out |
| B11.pedal.su57Time360 | su57 | 5.62 | −∞ … 8 | ok |
| B11.pedal.f22ToSu57Travel8s | f22 | 0.364 | −∞ … 0.6 | ok |
