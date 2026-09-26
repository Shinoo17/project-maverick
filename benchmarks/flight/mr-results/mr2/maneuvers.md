# Maneuvers — mr2-servo-1 (maneuvers-mr2-notvc)

Source commit c5b1c44c728b5994914ded6a7ed0c2b77f5965ba plus working tree. Report only. Speeds are arcade km/h, times seconds, rates °/s unless named. See benchmarks/flight/maneuvers.ts for each recipe.

## roll

| aircraft | speedKph | peakRateDegS | time90 | time180 | time360 | travel3sDeg | atPeakAeroBudget | atPeakAero | atPeakUnmet | atPeakServoDamping | targetRate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f22 | 250 | 63.3 | 1.717 | — | — | 170 | 3.06 | 0.15 | 0 | 0 | 2.1 |
| f22 | 450 | 109.9 | 1.017 | 1.833 | — | 308 | 9 | 0.13 | 0 | 0 | 2.1 |
| f22 | 700 | 116.4 | 0.967 | 1.742 | — | 327 | 21.78 | 0.34 | 0 | 0 | 2.1 |
| f22 | 1000 | 97.2 | 1.108 | 2.042 | — | 274 | 44.45 | 0.57 | 0 | 0 | 2.1 |
| su57 | 250 | 63.5 | 1.717 | — | — | 170 | 3.06 | 0.13 | 0 | 0 | 2.1 |
| su57 | 450 | 109.9 | 1.017 | 1.833 | — | 308 | 9 | 0.13 | 0 | 0 | 2.1 |
| su57 | 700 | 116.4 | 0.967 | 1.742 | — | 327 | 21.78 | 0.34 | 0 | 0 | 2.1 |
| su57 | 1000 | 97.2 | 1.108 | 2.042 | — | 274 | 44.45 | 0.57 | 0 | 0 | 2.1 |
| f22-notvc | 250 | 63.3 | 1.717 | — | — | 170 | 3.07 | 0.15 | 0 | 0 | 2.1 |
| f22-notvc | 450 | 109.9 | 1.017 | 1.833 | — | 308 | 9 | 0.13 | 0 | 0 | 2.1 |
| f22-notvc | 700 | 116.4 | 0.967 | 1.742 | — | 327 | 21.78 | 0.34 | 0 | 0 | 2.1 |
| f22-notvc | 1000 | 97.2 | 1.108 | 2.042 | — | 274 | 44.45 | 0.57 | 0 | 0 | 2.1 |

## smoothness

| aircraft | axis | speedKph | peakRateDegS | latency63 | overshootPct | reversal63 | reversalRequestStep | zeroCrossRequestStep | peakJerk |
|---|---|---|---|---|---|---|---|---|---|
| f22 | pitch | 450 | 50.8 | 0.217 | 1.9 | 0.333 | 1.1 | 0.08 | 141 |
| f22 | pitch | 700 | 52.9 | 0.2 | 0 | 0.25 | 2.08 | 0.06 | 325 |
| f22 | roll | 450 | 109.8 | 0.2 | 0 | 0.283 | 5.61 | 0.34 | 594 |
| f22 | roll | 700 | 116.3 | 0.2 | 0 | 0.258 | 9.45 | 0.41 | 1422 |
| f22 | yaw | 450 | 21.3 | 0.208 | 0 | 0.283 | 0.55 | 0.01 | 65 |
| f22 | yaw | 700 | 23.1 | 0.192 | 0 | 0.25 | 0.92 | 0 | 177 |
| su57 | pitch | 450 | 50.7 | 0.217 | 1.9 | 0.342 | 1.1 | 0.1 | 141 |
| su57 | pitch | 700 | 52.9 | 0.2 | 0 | 0.25 | 2.07 | 0.06 | 327 |
| su57 | roll | 450 | 109.8 | 0.2 | 0 | 0.283 | 5.61 | 0.34 | 594 |
| su57 | roll | 700 | 116.3 | 0.2 | 0 | 0.258 | 9.45 | 0.41 | 1423 |
| su57 | yaw | 450 | 25.4 | 0.217 | 0 | 0.3 | 0.62 | 0 | 75 |
| su57 | yaw | 700 | 26.4 | 0.192 | 0 | 0.25 | 1.06 | 0 | 204 |
| f22-notvc | pitch | 450 | 45.3 | 0.192 | 4.1 | 0.317 | 1.13 | 0.06 | 132 |
| f22-notvc | pitch | 700 | 52.9 | 0.2 | 0 | 0.25 | 2.06 | 0.05 | 325 |
| f22-notvc | roll | 450 | 109.8 | 0.2 | 0 | 0.283 | 5.61 | 0.34 | 594 |
| f22-notvc | roll | 700 | 116.3 | 0.2 | 0 | 0.258 | 9.44 | 0.41 | 1420 |
| f22-notvc | yaw | 450 | 21.3 | 0.208 | 0 | 0.283 | 0.55 | 0.01 | 65 |
| f22-notvc | yaw | 700 | 23.1 | 0.192 | 0 | 0.25 | 0.92 | 0 | 177 |

## cobraEntry

| aircraft | speedKph | shift | time30 | time60 | time90 | peakIncidence | peakPitchRate | speedLoss |
|---|---|---|---|---|---|---|---|---|
| f22 | 450 | false | 0.567 | 0.792 | 1.15 | 102.2 | 2.65 | 240 |
| f22 | 450 | true | 0.508 | 0.758 | 1.225 | 107.8 | 2.634 | 219 |
| su57 | 450 | false | 0.575 | 0.8 | 1.15 | 99.7 | 2.687 | 256 |
| su57 | 450 | true | 0.517 | 0.767 | 1.258 | 101.6 | 2.678 | 219 |
| f22-notvc | 450 | false | 1.192 | — | — | 49.1 | 0.675 | 69 |
| f22-notvc | 450 | true | 1.033 | — | — | 53.3 | 1.009 | 1 |
| f22 | 350 | false | 0.617 | 0.842 | 1.183 | 99.6 | 2.609 | 172 |
| f22 | 550 | false | 0.558 | 0.8 | 1.217 | 104.9 | 2.469 | 297 |

## cobraExit

| aircraft | speedKph | mode | pushAt | peakIncidence | toEntryAttitude10 | toAttitude5 | incidenceBelow15 | maxPathAngle | altitudeGainAtLevel | kphAtLevel | attitudeAt5s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f22 | 450 | push | 1.042 | 87.5 | 1.675 | 1.758 | 1.175 | 45 | 60 | 280 | -4.1 |
| f22 | 450 | release | 1.042 | 141.3 | 6.167 | 6.275 | — | 23.4 | 11 | 83 | 62.8 |
| su57 | 450 | push | 1.05 | 87.8 | 1.817 | 1.9 | 1.258 | 47.9 | 66 | 275 | -6.9 |
| su57 | 450 | release | 1.05 | 152.5 | 5.717 | 5.8 | — | 24 | 15 | 68 | 49.5 |
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
| f22 | 450 | false | 0.867 | 108 | — | 147 | — | 90.3 |
| f22 | 450 | true | 0.867 | 96 | — | 137 | — | 90.9 |
| su57 | 450 | false | 0.875 | 76 | — | 121 | — | 92.2 |
| su57 | 450 | true | 0.875 | 79 | — | 117 | — | 91.4 |
| f22-notvc | 450 | false | — | 360 | — | — | 567 | 48.2 |
| f22-notvc | 450 | true | — | 360 | — | — | 567 | 48.2 |

## loops

| aircraft | kind | speedKph | time360 | heightGain | endAltitudeChange | endKph | peakIncidence |
|---|---|---|---|---|---|---|---|
| f22 | plain | 700 | 6.967 | 264 | -7 | 745 | 4.2 |
| f22 | powered | 350 | 8.725 | 323 | -539 | 1126 | 5.2 |
| su57 | plain | 700 | 6.95 | 263 | -6 | 740 | 4.2 |
| su57 | powered | 350 | 8.692 | 319 | -542 | 1126 | 5.1 |
| f22-notvc | plain | 700 | 6.967 | 264 | -7 | 745 | 4.2 |
| f22-notvc | powered | 350 | 8.942 | 358 | -480 | 1105 | 4.2 |

## powerLoops

| aircraft | speedKph | flow | time270 | widthM | peakIncidence | maxNoseMinusPath | minKph | heightM |
|---|---|---|---|---|---|---|---|---|
| f22 | 400 | none | 6.95 | 216 | 17.6 | 17.6 | 327 | 134 |
| f22 | 400 | W | 5.4 | 218 | 6.9 | 6.9 | 394 | 114 |
| f22 | 400 | Shift | 5.8 | 402 | 5.2 | 5.2 | 399 | 114 |
| f22 | 400 | Shift+Space | 4.11 | 92 | 105.9 | 105.9 | 237 | 103 |
| f22 | 450 | none | 5.73 | 185 | 10.3 | 10.3 | 387 | 121 |
| f22 | 450 | W | 5.35 | 236 | 4.6 | 4.6 | 444 | 117 |
| f22 | 450 | Shift | 5.93 | 432 | 4.3 | 4.3 | 449 | 121 |
| f22 | 450 | Shift+Space | 4.1 | 102 | 105.2 | 105.2 | 232 | 116 |
| su57 | 400 | none | 7.09 | 222 | 17.5 | 17.5 | 325 | 136 |
| su57 | 400 | W | 5.4 | 213 | 6.9 | 6.9 | 394 | 114 |
| su57 | 400 | Shift | 5.78 | 398 | 5.1 | 5.1 | 399 | 114 |
| su57 | 400 | Shift+Space | 4.28 | 91 | 101 | 101 | 255 | 102 |
| su57 | 450 | none | 5.73 | 185 | 10.4 | 10.4 | 386 | 122 |
| su57 | 450 | W | 5.33 | 231 | 4.7 | 4.7 | 444 | 116 |
| su57 | 450 | Shift | 5.92 | 429 | 4.4 | 4.4 | 449 | 121 |
| su57 | 450 | Shift+Space | 4.27 | 100 | 100.3 | 100.3 | 251 | 113 |
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
| f22 | probe 500 attitude 88, release | 10.417 | 2 | 24.6 | 2.93 | 0 | true |
| f22 | recipe 450 Space + pull to 90°, release | 3.792 | 49 | 62.8 | 3.38 | 0 | true |
| su57 | probe 500 attitude 88, release | 10.4 | 2 | 24.6 | 2.92 | 0 | true |
| su57 | recipe 450 Space + pull to 90°, release | 3.6 | 44 | 60.5 | 3.04 | 0 | true |
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
| f22 | 350 | 3.917 | 106.3 |
| su57 | 350 | 4.058 | 100 |
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
| B26.roll.peakRate.450 | f22 | 109.9 | 220 … 240 | ⚠ out |
| B26.roll.time90.450 | f22 | 1.017 | −∞ … 0.6 | ⚠ out |
| B26.roll.peakRate.700 | f22 | 116.4 | 220 … 240 | ⚠ out |
| B26.roll.time90.700 | f22 | 0.967 | −∞ … 0.6 | ⚠ out |
| B2.cobra.timeTo90NoShift | f22 | 1.15 | −∞ … 1 | ⚠ out |
| B1.cobra.peakAoa (Space + Shift) | f22 | 107.8 | 90 … 120 | ok |
| B27.cobraExit.toEntryAttitude10 | f22 | 1.675 | −∞ … 1.2 | ⚠ out |
| B27.cobraExit.maxPathAngle | f22 | 45 | −∞ … 20 | ⚠ out |
| B27.cobraExit.altitudeGainAtLevel | f22 | 60 | −∞ … 60 | ok |
| B28.herbst.time170 (roll) | f22 | — | −∞ … 4 | ⚠ out |
| B28.herbst.altitudeRange | f22 | 147 | −∞ … 200 | ok |
| B29.powerLoop.width (450 none) | f22 | 185 | −∞ … 160 | ⚠ out |
| B29.powerLoop.time270 | f22 | 5.73 | −∞ … 5 | ⚠ out |
| B29.powerLoop.peakIncidence | f22 | 10.3 | −∞ … 30 | ok |
| B29.powerLoop.noseMinusPath | f22 | 10.3 | −∞ … 30 | ok |
| B29.powerLoop.minKph | f22 | 387 | 150 … ∞ | ok |
| B30.bell.minKph | f22 | 49 | −∞ … 30 | ⚠ out |
| B30.bell.backSlideM | f22 | 62.8 | 0 … ∞ | ok |
| B30.bell.noseDropAfterApex | f22 | 3.38 | −∞ … 3 | ⚠ out |
| B31.immelmann.halfLoop | f22 | 3.833 | −∞ … 4 | ok |
| B31.immelmann.rollOut | f22 | 1.708 | −∞ … 1 | ⚠ out |
| B31.immelmann.topKph | f22 | 681 | 300 … ∞ | ok |
| B5.kulbit350.time360 | f22 | 3.917 | 3 … 4.5 | ok |
| B26.roll.peakRate.450 | su57 | 109.9 | 220 … 240 | ⚠ out |
| B26.roll.time90.450 | su57 | 1.017 | −∞ … 0.6 | ⚠ out |
| B26.roll.peakRate.700 | su57 | 116.4 | 220 … 240 | ⚠ out |
| B26.roll.time90.700 | su57 | 0.967 | −∞ … 0.6 | ⚠ out |
| B2.cobra.timeTo90NoShift | su57 | 1.15 | −∞ … 1 | ⚠ out |
| B1.cobra.peakAoa (Space + Shift) | su57 | 101.6 | 90 … 120 | ok |
| B27.cobraExit.toEntryAttitude10 | su57 | 1.817 | −∞ … 1.2 | ⚠ out |
| B27.cobraExit.maxPathAngle | su57 | 47.9 | −∞ … 20 | ⚠ out |
| B27.cobraExit.altitudeGainAtLevel | su57 | 66 | −∞ … 60 | ⚠ out |
| B28.herbst.time170 (roll) | su57 | — | −∞ … 4 | ⚠ out |
| B28.herbst.altitudeRange | su57 | 121 | −∞ … 200 | ok |
| B29.powerLoop.width (450 none) | su57 | 185 | −∞ … 160 | ⚠ out |
| B29.powerLoop.time270 | su57 | 5.73 | −∞ … 5 | ⚠ out |
| B29.powerLoop.peakIncidence | su57 | 10.4 | −∞ … 30 | ok |
| B29.powerLoop.noseMinusPath | su57 | 10.4 | −∞ … 30 | ok |
| B29.powerLoop.minKph | su57 | 386 | 150 … ∞ | ok |
| B30.bell.minKph | su57 | 44 | −∞ … 30 | ⚠ out |
| B30.bell.backSlideM | su57 | 60.5 | 0 … ∞ | ok |
| B30.bell.noseDropAfterApex | su57 | 3.04 | −∞ … 3 | ⚠ out |
| B31.immelmann.halfLoop | su57 | 3.833 | −∞ … 4 | ok |
| B31.immelmann.rollOut | su57 | 1.708 | −∞ … 1 | ⚠ out |
| B31.immelmann.topKph | su57 | 679 | 300 … ∞ | ok |
| B5.kulbit350.time360 | su57 | 4.058 | 3 … 4.5 | ok |
| B11.pedal.su57Time360 | su57 | 5.62 | −∞ … 8 | ok |
| B11.pedal.f22ToSu57Travel8s | f22 | 0.364 | −∞ … 0.6 | ok |
