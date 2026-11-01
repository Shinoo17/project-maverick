# Flight Rewrite — FR1 Report

> วันที่ 1 พ.ย. 2026 · branch `feat/flight-rewrite` · commit `5513937` ตามที่ owner สั่ง
> แผน: [flight-rewrite-plan.md](flight-rewrite-plan.md) §3.1, §3.3, §3.4, §3.6, §3.8, §4.2, §4.5, §6 · Requirements: [project-maverick-flight-control-psm-drift-rework-spec.md](project-maverick-flight-control-psm-drift-rework-spec.md)
> ต่อจาก: [flight-rewrite-fr0.md](flight-rewrite-fr0.md)

## 1. สรุป

FR1 สร้าง core ใหม่ใน `src/game/flightCore/` และลงทะเบียนเป็น `flightCore: 'new'` แล้ว เลือกได้ใน Flight Lab โดย core เก่ายังเป็นค่า default และกล้องยังเป็นตัวเดิม (อ่านค่าผ่าน `FlightReadout`)

- **Rotation:** สั่งเป็น rate ต่อแกน มี FBW (α limit + G limit) แบบต่อเนื่อง, weathervane, τ และ maxAccel ส่วนโครง FD7 (แกน roll ค่อยๆ ย้ายไปรอบ velocity vector ตาม α) ใส่ไว้แล้ว
- **Translation:** ใช้แรงจริง คือ thrust, lift, drag, side force และ gravity ไม่มีการก๊อปทิศจมูกใส่ velocity และไม่มี lateral damping แยก
- **Speed:** Hybrid ทางกลาง พร้อม ratchet และ anti-windup
- **Command:** `PilotCommand.psm` (schema 3) ใน FR1 α limit ยังปิดเสมอ (`psmAuthority = 0`)
- **ปุ่ม:** Space = PSM, X = airbrake, ←/→ = coordinated turn (bindings version 2 พร้อม migration), shaping ของปุ่ม digital
- **Dev:** overlay ของ core ใหม่ และ tuning panel ที่แก้ค่าสด

ผลการพิสูจน์:

- test **925/925 ผ่าน** (ก่อน FR1 มี 888 ตัว และ FR1 เพิ่ม 37 ตัว) และ `tsc -b` ผ่าน
- golden ของ core เก่าผ่านทั้งหมด เพราะไม่ได้แก้ `stepFlight`
- FC-01, FC-10 และ FC-16 ผ่านเป็น test อัตโนมัติ
- บินจริงใน Chrome ด้วย keyboard บน `'new'` ได้ ไม่มี console error (§7.3)

**Stop point:** owner บินด้วย keyboard บน `flightCore='new'` วิธีเปิดอยู่ใน §9

## 2. ไฟล์

### 2.1 ไฟล์ใหม่

| ไฟล์ | หน้าที่ |
|---|---|
| [src/game/flightCore/profile.ts](../src/game/flightCore/profile.ts) | `CoreProfile` (ความสามารถของเครื่อง) แยกจาก `CoreAssist` (assist), ค่า F-22 / Su-57, `CoreTuning` (patch จาก Flight Lab), `validateCoreProfile` |
| [src/game/flightCore/aero.ts](../src/game/flightCore/aero.ts) | `observeAir` (α, β, incidence, confidence), `aeroScale`, `liftCoefficient` ทั้งวงกลม, `liftSlope`, `flowAxes` |
| [src/game/flightCore/rotation.ts](../src/game/flightCore/rotation.ts) | rate command ต่อแกน + FBW pitch band + weathervane |
| [src/game/flightCore/speed.ts](../src/game/flightCore/speed.ts) | airbrake, burner reserve, throttle/speed hold, engine spool |
| [src/game/flightCore/step.ts](../src/game/flightCore/step.ts) | `stepCoreFlight` (ลำดับการคำนวณใน 1 step), `createCoreFlight` (trim engine ที่ความเร็วเกิด) |
| [src/game/flightCore/readout.ts](../src/game/flightCore/readout.ts) | `coreReadout` เติม `FlightReadout` ครบทุก field |
| [src/game/flightCore/state.ts](../src/game/flightCore/state.ts) | `CoreFlightState` (`AircraftState.coreFlight`) + diagnostics ต่อ step |
| [src/features/flight/CoreFlightLab.tsx](../src/features/flight/CoreFlightLab.tsx) | overlay (`CoreFlightLab`) + tuning panel (`CoreTuningPanel`) |
| [src/features/flight/coreTuning.ts](../src/features/flight/coreTuning.ts) | ส่ง tuning ให้ runtime และ keyboard, validate ก่อน commit |
| [benchmarks/flight/coreFeel.ts](../benchmarks/flight/coreFeel.ts), [coreFeel.report.ts](../benchmarks/flight/coreFeel.report.ts) | ตัววัดตัวเลขใน §8 (report only, เขียนเฉพาะ `benchmarks/flight/out/core-feel-fr1.*` ซึ่ง gitignore) |
| [tests/flightCore.test.ts](../tests/flightCore.test.ts) | hard invariants, readout, FC-01, FC-10, FC-16 (สคริปต์ + keyboard), replay/tuning (28 ตัว) |
| [tests/flightCoreInput.test.ts](../tests/flightCoreInput.test.ts) | bindings v2 + migration, shaping, ปุ่มตรงข้าม, PSM, coordinated turn (9 ตัว) |

### 2.2 ไฟล์ที่แก้

| ไฟล์ | เปลี่ยน |
|---|---|
| `game/flight/core.ts` | ลงทะเบียน `new: { step: stepCoreFlight, readout: coreReadout }`, `step(..., tuning?)` (legacy ไม่สนใจ tuning) |
| `game/runtime/commands.ts` | `psm: boolean`, `commandSchemaVersion = 3` |
| `game/runtime/GameRuntime.ts` | `safe.psm = command.psm === true`; สร้าง `coreFlight` ตอนเกิดเครื่องบน core ใหม่; `tuneCore()` / `tuning`; replay export `coreTuning` และ `coreTunedTick` |
| `game/playground/replay.ts` | ใช้ `coreTuning` ของ replay และปฏิเสธ replay ที่จูนกลางเที่ยว |
| `game/state/WorldState.ts` | `coreFlight?: CoreFlightState` |
| `content/validate.ts` | `'new'` ผ่านแล้ว; validate core profile ของทุกลำเมื่อ `flightCore === 'new'` |
| `game/input/keyBindings.ts` | action ใหม่ `psm`, `turnLeft`, `turnRight`; default ใหม่; `bindingsVersion: 2`, `psm: PressMode`, `migrateBindingsV1` |
| `game/input/FlightInput.ts` | `core` (profile ของ core ใหม่ หรือ null), `flyKeys` (shaping + coordinated turn), `turnAssist`, `lastCommand`, `c.psm` (hold/toggle); push capture ปิดบน core ใหม่; ปุ่ม ←/→ นับเป็น key-held ของ mouse aim |
| `render/FlightScene.tsx`, `features/flight/{FlightPage,PlaygroundHud,session}.tsx/ts`, `flight.css` | ต่อ tuning, overlay และ panel |
| `features/settings/rows.ts`, `locales/{en,th}.ts` | ตัวเลือก hold/toggle ของ PSM, ชื่อ action ใหม่, ข้อความ overlay/panel |

ไม่ได้แก้ core เก่า (`src/game/flight/stepFlight.ts` และอื่นๆ) และไม่ได้แก้กล้อง

## 3. Core ใหม่

### 3.1 ลำดับใน 1 step (`stepCoreFlight`, FLIGHT_STEP = 1/120 s)

1. สังเกตอากาศที่ pose ต้น step (α, β, incidence, confidence)
2. airbrake + burner (`stepDevices`)
3. แรงอากาศพลศาสตร์ที่ pose ต้น step: lift, side, drag
4. throttle/engine (`stepThrottle`) จากแรงที่ต้องหักล้างตามทิศบิน แล้วได้ thrust
5. rotation (`stepRotation`) โดยป้อน path rate จริงของ step นี้ให้ FBW
6. หมุน orientation ตาม rates
7. translation: ส่วนของแรงที่**ตั้งฉาก**กับทิศบินจะหมุน velocity โดยคงขนาด ส่วนที่**ขนาน**กับทิศบินจะบวกเข้า speed แล้วจึงบวก gravity
8. บันทึกค่าสังเกตตอนจบ step (nose–velocity, G, path rate) + diagnostics แล้วตรวจชนพื้น/ขอบแผนที่ (กฎเดียวกับ core เก่า)

ขั้น 7 ทำให้ lift ไม่ทำงาน (work = 0) ไม่ว่าเลี้ยวแรงแค่ไหน พลังงานจึงเปลี่ยนได้จาก thrust, drag และ gravity เท่านั้น ถ้าใช้ Euler ธรรมดา |v| จะโตเองทีละนิดทุก step (≈0.6%/s ที่ 9G)

### 3.2 Rotation (§3.3)

ทุกแกนใช้กฎเดียวกันทุก step:

```text
target = pilot (input × available rate, ถูกจำกัดใน FBW band) + weathervane
rate  += (target − rate)·(1 − e^(−dt/τ)),  |Δrate| ≤ maxAccel·dt
```

- **available rate:** = `maxRate` เมื่อเร็วกว่า `controlSpeedKph` ถ้าช้ากว่านั้นจะลดตาม q (ใน FR1 = 300 km/h, F-22 roll 180°/s → ที่ 216 km/h เหลือ 100°/s) โดย `psmRate × psmAuthority` เป็นพื้น (เริ่มใช้ FR4)
- **FBW pitch band:** ต่อเนื่อง ไม่มี mode
  - คือ pitch rate ที่พา α ไปถึง "เครื่องหมาย" ที่ใกล้กว่าภายใน 2τ ระหว่าง α limit (`aoaLimitDeg`) กับ α ที่ lift ถึง G limit (linearize ด้วย lift slope)
  - เหนือ corner speed เครื่องหมาย G จะใกล้กว่า ส่วนต่ำกว่า corner speed α limit จะใกล้กว่า **corner speed จึงเกิดเองจุดที่สองเส้นมาบรรจบกัน**
  - band รวม path rate จริงไว้ด้วย α จึงหยุดตรงเครื่องหมาย และ band ติดลบได้: ที่ความเร็วต่ำ gravity ดัด path ลงใต้จมูก ถ้าดึงค้างไว้ FBW จะเปลี่ยนเป็นกดเพื่อคุม α ไว้ที่ limit
  - band **จำกัดเฉพาะคำสั่งของ pilot** เมื่อปล่อย stick แล้ว FBW จะไม่หมุนเครื่องเอง
- **Weathervane:** ∝ q·sin(มุม) โดย q ถูกจำกัดไว้ที่ 2 เท่าของ q ที่ corner speed เพื่อให้แกน yaw ยังมี damping ที่ top speed
  - pitch weathervane ทำงานเฉพาะเมื่อ α เกิน α limit (smoothstep จาก `aoaLimitDeg` ถึง `alphaCritDeg`) ถ้าทำงานตลอด บินตรงแล้วปล่อยมือจมูกจะค่อยๆ ทิ่มลง เพราะบินระดับต้องมี α บวก ต่ำกว่า limit การปล่อยมือจึงคงท่า และ path วิ่งมาหาจมูกเอง (lift > 1g ดัด path ขึ้น, < 1g ปล่อยให้ตก) จึงได้บินตรงที่ α trim
  - yaw weathervane ทำงานทุก β
- **FD7:** `rollAxisWeight × smoothstep(incidence, 15°, 30°)` ใน FR1 α ถูกจำกัดที่ 24° จึงมีผลบางส่วนที่ α สูงของการบินปกติ (ใกล้ stability-axis roll) ส่วน PSM จริงอยู่ใน FR4

### 3.3 Translation (§3.4)

```text
a = thrust·x̂ + lift (⊥ ทิศบิน, k·V²·CL(α), cap ที่ +gLimit / −gLimitNeg G)
  + drag (k·V²·(cd0 + inducedK·CL² + cdHigh·(sin²α + sin²β) + airbrake·airbrakeCd + S·brakeCd))
  + side (−k·V²·cyBeta·sin β) + gravity
```

- `k` (aero scale) คำนวณจาก `cornerSpeedKph`: เป็นค่าที่ทำให้ CLmax × q = G limit ที่ corner speed จึงจูน corner speed ได้ตรงๆ
- `CL(α)`: ช่วง attached เป็น cubic ที่ slope = `clAlpha` ที่ 0 และขึ้นถึง `clMax` พอดีที่ `alphaCritDeg` (slope = 0 ตรงนั้น) หลังจากนั้น blend ภายใน 15° ไปเป็น flat plate `clPost·sin 2α` ซึ่งเป็น 0 ที่ 90° และกลับทิศเมื่อลมเข้าทางหาง
- side force จาก β เป็นตัวเดียวที่ดัด path เข้าหาจมูกที่หันออก (spec §7.5)
- drift และ drift boost (thrust ตามจมูกที่เบี่ยง) จึงเกิดเองจากโมเดลนี้ (จูนใน FR6)

### 3.4 Speed — Hybrid ทางกลาง (§3.6)

| สถานะ | throttle | held speed |
|---|---|---|
| W | 1 (dry เต็ม) | = ความเร็วปัจจุบัน |
| Shift (burner) | 1 + burner | = ความเร็วปัจจุบัน |
| S | 0 + เบรกอ่อน (`brakeCd`) | = ความเร็วปัจจุบัน |
| X (ไม่กด W) | 0 (หยุด hold) | = ความเร็วปัจจุบัน |
| W+S | ยกเลิกกัน (input ส่ง 0) → hold | — |
| ปล่อยหมด | hold: feed-forward ของ drag + gravity ตามทิศบิน + PI, สูงสุด dry | คงไว้ |
| G > `ratchetG` (3) หรือกด Space | hold | ลดตามความเร็วจริง (ratchet) |

Anti-windup: integral สะสมเฉพาะตอน throttle ยังไม่ชนเพดาน หรือ error พา throttle ออกจากเพดาน และ clamp ไว้ที่ ±0.3 ส่วน engine ไล่ตาม throttle ด้วย `spool` (3/s)

Space ทำ ratchet ด้วยตั้งแต่ FR1 (spec §6.3 "Space: suspend cruise hold") แต่ยังไม่เปิดอะไรในด้าน physics

### 3.5 Readout

ทุก field ของ `FlightReadout` มีค่า ค่าที่ยังไม่ใช่ของจริง (ระบุไว้ในโค้ดด้วย):

- `psmAuthority = 0`, `alphaLimitDeg = aoaLimitDeg`, `gAllowance = 1`
- `nozzle` เป็นค่าตกแต่งจาก pitch/roll rate (±20°, ฟิสิกส์ TVC มาใน FR4); `f22-notvc` ได้ `null`
- `regime` มีแค่ NORMAL / HIGH_AOA / POST_STALL (ยังไม่มี RECOVERING / DEPARTED)
- `alphaBandDeg = { normal: aoaLimitDeg, critical: alphaCritDeg, max: 90 }`
- `g` = แรงที่ไม่ใช่ gravity ฉายบนแกน up ของลำ / g ดังนั้น**ติดลบได้**ตอนกด (core เก่าคิดด้วยสูตร sqrt จึงเป็นบวกเสมอ)
- readout ใช้ profile ฐาน (ไม่รวม tuning) ถ้าจูน `aoaLimitDeg` ป้าย `highAoa` บน HUD จะคิดจากค่าฐาน

## 4. Profile (placeholder ทั้งหมด, §3.8)

| ค่า | F-22 | Su-57 | หน่วย |
|---|---|---|---|
| maxRate p / r / y | 60 / 180 / 22 | 58 / 170 / 26 | °/s |
| tau p / r / y | 0.12 / 0.10 / 0.15 | เท่ากัน | s |
| maxAccel p / r / y | 420 / 1500 / 200 | เท่ากัน | °/s² |
| controlSpeedKph | 300 | 300 | HUD km/h |
| gLimit / gLimitNeg | 9 / 3 | 9 / 3 | G |
| aoaLimitDeg | 24 | 24 | ° |
| weathervane | 2 | 2 | 1/s |
| rollAxisWeight (FD7) | 0.6 | 1 | — |
| cornerSpeedKph | 500 | 480 | HUD km/h |
| clAlpha / alphaCritDeg / clMax / clPost | 3.6 / 30 / 1.6 / 1.0 | เท่ากัน | — |
| cd0 / inducedK / cdHigh / cyBeta | 0.058 / 0.15 / 0.6 / 1.2 | … / 1.1 | — |
| airbrakeCd / brakeCd | 0.25 / 0.05 | เท่ากัน | — |
| thrustDry / thrustBurner | 15 / 26 | เท่ากัน | m/s² |
| spool / burnerSeconds / burnerRecharge | 3 / 6 / 12 | เท่ากัน | 1/s, s, s |
| psmRate p / r / y (FR4) | 120 / 120 / 40 | 120 / 120 / 80 | °/s |
| psmAuthority(speed) (FR4) | spec §8.2 | spec §8.2 | — |

Assist (ทุกลำ): `holdGain` 0.06, `holdIntegral` 0.02, `ratchetG` 3, `digitalRise` 0.15 s, `digitalRelease` 0.12 s, `turnBankDeg` 60, `turnBankSeconds` 0.3, `turnHoldSeconds` 2

- top speed dry/burner (1080 / 1424 km/h ของ F-22) ตั้งให้ใกล้ core เก่า (1080 / 1400)
- `inducedK` ปรับจาก 0.10 เป็น 0.15 ระหว่างวัด เพราะที่ 0.10 dry thrust ยังเลี้ยวค้างได้ ~8.5 G แทบไม่เสียความเร็ว (energy loss ตอนเลี้ยวไม่เกิด)
- `f22-notvc` ใช้ค่า F-22 แต่ `tvc: false` ส่วน drone (Su-57) ใช้ profile Su-57

## 5. Controls (§4.2, §4.5)

### 5.1 Bindings version 2

Default ใหม่:

- Space = PSM (เลือก hold หรือ toggle ใน Settings › Keyboard)
- X = airbrake
- ← / → = coordinated turn
- A / D = roll (ไม่มีปุ่มสำรองแล้ว)

Migration (`migrateBindingsV1`) ทำครั้งเดียวกับ save ที่ไม่มี `bindingsVersion` และทำ**ก่อน** `parseBindings` จะ dedupe ช่องหนึ่งจะถูกย้ายเฉพาะเมื่อยังเป็นค่า default ของ v1:

- airbrake `Space` → `KeyX` ถ้าใน save ไม่มีใครใช้ X อยู่ (ถ้ามีคนใช้ ช่องนี้จะว่าง)
- ปุ่มสำรอง roll `ArrowLeft` / `ArrowRight` → ว่าง
- `psm`, `turnLeft` และ `turnRight` เป็น action ใหม่ จึงได้ default ของตัวเองถ้าปุ่มนั้นยังว่าง ถ้าผู้เล่นเอาปุ่มนั้นไปใช้อย่างอื่นแล้ว action ใหม่จะเริ่มแบบไม่มีปุ่ม (ไม่แย่งปุ่ม)

Version เก็บอยู่ใน `KeyboardSettings.bindingsVersion` ไม่ได้แตะ `Settings.version` (ถ้า `Settings.version` ไม่ใช่ 1 จะล้าง save ทั้งหมด) การแก้ settings ทุกครั้งส่ง version 2 กลับมา จึงไม่ migrate ซ้ำ มี test ยืนยันว่าผู้เล่นที่ตั้ง Space เป็น airbrake ใน v2 จะไม่ถูกย้ายกลับ

หน้า Key bindings แสดง action ใหม่สามตัวไว้ท้ายรายการ (ลำดับของ `flightActions` ต้องต่อท้ายเพื่อให้ save เดิมชนะ)

### 5.2 Keyboard บน core ใหม่ (`FlightInput.flyKeys`)

ทำงานเฉพาะเมื่อ `input.core` ถูกตั้งค่า ซึ่ง FlightScene ตั้งให้เมื่อ `flightCore === 'new'` บน core เก่าทุกปุ่มอ่านแบบเดิมทุกประการ (←/→ ยัง roll เหมือนเดิม และ test เก่าผ่าน)

- **Shaping:** ↑↓, A/D, Q/E และ ←/→ ใช้ rise 0.15 s / release 0.12 s, step ครั้งเดียวต่อ command tick คำสั่งที่บันทึกจึงเป็นค่าหลัง shaping และ replay/FPS ยังตรงทุก byte
- **ปุ่มตรงข้ามกดพร้อมกัน = 0:** ↑+↓, A+D, Q+E, W+S, ←+→ (มี test)
- **ปุ่มที่กดอยู่ยึดแกนของตัวเอง:** A/D ยึด roll จาก coordinated turn, ↑/↓ ยึด pitch
- **Coordinated turn:**
  - roll เข้า bank เป้าหมาย (ปุ่มที่ shape แล้ว × 60°) โดยปิด error ภายใน `turnBankSeconds`
  - pitch = g·sinφ·tanφ/V (pitch rate ของเลี้ยวระดับที่ bank จริง) + แก้ flight path angle เข้าหาศูนย์ภายใน `turnHoldSeconds`
  - เมื่อปล่อยปุ่มจะเข้าสถานะ `levelling` จนปีกระดับ (< 2°) หรือกด A/D นี่คือ latch ตัวเดียว และแสดงบน overlay
  - จมูกใกล้แนวดิ่ง bank ไม่มีความหมาย turn จึง fade ออก และใส่ pitch เฉพาะตอนลำตั้งขึ้นพอให้ "ดึง" แปลว่าขึ้น
- Push capture (`pushCapture.ts`) ปิดบน core ใหม่ตามแผน §8

### 5.3 Mouse modes บน core ใหม่ (ชั่วคราว)

Mouse Aim, Cursor, Joystick และ Relative ยังเขียน `PilotCommand` เหมือนเดิม core ใหม่ตีความเป็น rate request จึงบินได้แต่ไม่ได้จูน instructor ยังใช้โมเดลของ core เก่า (`pullCeiling` ฯลฯ) ระหว่าง `levelling` ของ ←/→ ถ้า instructor ของ Mouse Aim ก็บินอยู่ ทั้งสองจะรวมกันด้วย `strongest` ทั้งหมดนี้ FR3/FR5 จะเขียนใหม่

## 6. Dev tools

**Overlay** (Flight Lab › แสดงข้อมูลการบินละเอียด เมื่อ core = ใหม่) มีครบตาม spec §10.2:

- airspeed (m/s + HUD), velocity vector, body forward, AoA / β / nose–path
- command ที่ส่งจริง, rates, rate targets
- controller limits ต่อแกน (`alpha` / `g` / `rate` / `none` + lift cap), FBW pitch band, control share / roll-axis share
- G (limit), แรง lift / drag / side / thrust
- PSM intent / authority, camera blend (psm/drift share ของกล้องเดิม), drift
- throttle / power / AB, airbrake
- speed hold (mode, ratchet, held speed, integral), coordinated turn

**Tuning panel** (Flight Lab ในเมนูหยุด เมื่อ core = ใหม่):

- แก้ทุกค่าตัวเลขของ profile ของลำที่บินอยู่ และ assist ทุกตัว ช่องที่ต่างจากค่าฐานมีกรอบสีฟ้า
- ค่ามีผลทันทีเมื่อบินต่อ ไม่ reset การบิน
- validate ก่อนรับ ถ้าค่าใช้ไม่ได้ (เช่น `aoaLimitDeg ≥ alphaCritDeg` หรือ assist ≤ 0) จะขึ้น error และไม่เปลี่ยนอะไร
- มีปุ่ม "ล้างค่าที่จูน" และ "คัดลอก tuning JSON"
- ไม่แตะ object profile ใน content: tuning เป็น patch ที่ runtime ส่งให้ core ทุก step (มี test)

**Replay กับ tuning:**

- replay export `coreTuning` ไว้ด้วย ดังนั้นเที่ยวบินที่จูนก่อนเริ่มจะ replay ได้ตรงทุก byte
- ถ้าจูน**กลางเที่ยว** replay จะมี `coreTunedTick` และ `runFlightReplay` จะปฏิเสธ (patch เดียวแทนการเปลี่ยนกลางทางไม่ได้)

## 7. การพิสูจน์

### 7.1 Hard invariants (แผน §6, `tests/flightCore.test.ts`, CI fail)

| Invariant | วิธีตรวจ |
|---|---|
| Determinism | รัน runtime (Su-57 + combat bot, สคริปต์คันโยกสุ่มแบบ seed) สองครั้ง snapshot ต้องเท่ากันทุก field |
| No NaN | 7 สถานการณ์: คันโยกสุ่ม F-22/Su-57 40 s, ไต่ดิ่งปล่อยมือจน tail slide, ไต่ดิ่งดึงค้างผ่านความเร็วศูนย์, เริ่มจากหยุดนิ่ง, จมูกชี้ลงที่หยุดนิ่ง, บินถอยหลัง ทุก field ของ state และ readout ต้อง finite ทุก step |
| Energy sanity | (ก) thrust ≈ 0 + คันโยกสุ่ม 40 s แล้วพลังงานต้องไม่เพิ่มเลยสัก step (≤ 1e-9) (ข) profile ปกติ แล้ว ΔE ต่อ step ≤ thrust·V·dt + 1e-6 |
| ปล่อยมือ rate → 0 | F-22 และ Su-57 ที่ 130 m/s: หลังหมุนเต็ม 1 s แล้วปล่อย pitch และ roll ต้อง < 10% ของ max ใน 3τ และ < 2% ใน 4τ |
| FPS independence (FC-16) | ด้านล่าง |
| Profile validation | `aoaLimitDeg` ต้องน้อยกว่า `alphaCritDeg`; burner ≥ dry |

เรื่อง 3τ: e^−3 = 5% พอดี แต่ `maxAccel` ทำให้ช่วงแรกช้าลงเล็กน้อย จึงวัดได้ 5.06% ที่ 3τ ตัวเลขจริงคือ roll หยุด (< 5%) ใน 0.308 s = 3.08τ

### 7.2 Acceptance

| ID | Test | ผล |
|---|---|---|
| FC-01 | ดึง ↑ ค้าง 15 s จากทุก spawn preset (free 130, cobra 105, highG 155, recovery 45 m/s) ทั้งกดและไม่กด Space: เครื่องยังบินอยู่ตลอด 15 s, incidence สูงสุด (confidence > 0.5) ถึง α limit (> 21°) แต่ < αcrit, `postStall` = 0, `psmAuthority` = 0 | ผ่าน 8/8 |
| FC-10 | S + X 5 s จาก 140 m/s: throttle = 0 ทุก step และความเร็วไม่เพิ่มเลย จากนั้นปล่อย 10 s: held speed = ความเร็วตอนปล่อย ไม่เร่งกลับ (ไม่เกิน +3 m/s) และอยู่ใน ±1.5 m/s ตอนจบ | ผ่าน |
| FC-16 | (ก) runtime (Su-57 + bot, สคริปต์ตาม tick) ที่ 30, 60, 144 FPS ถึง tick 600 (ข) keyboard ผ่าน `FlightInput` (→ + W แล้ว ↑ + A แล้วปล่อย: shaping, coordinated turn และ levelling) โดย refresh pose ทุก tick แบบเดียวกับ FlightScene: snapshot เท่ากันทุก byte | ผ่าน |

### 7.3 ในเกม (Chrome, dev server ใหม่, preset Keyboard, core ใหม่)

- เลือก core ใหม่ใน Flight Lab ได้ เริ่มบินได้ และ overlay กับ tuning panel (42 ช่อง) แสดงผล
- กด → ค้าง: bank ~60°, G 1.86, held speed 702 km/h, overlay แสดง `turning` ปล่อยแล้วเป็น `levelling` และกลายเป็น `off` ภายใน ~2.5 s
- Space + ↑: α 16°, G 8.5 ติด limit `g`, PSM intent `ON` / authority 0%, speed hold `ratchet`
- S + X: throttle 0%, airbrake 100%, mode `decelerate`
- ไม่มี console error

**หมายเหตุ:** dev server ที่รันอยู่แล้วบน `localhost:5173` ค้างอยู่ที่ "Preparing training range…" ทั้ง core เก่าและใหม่ แต่ server ใหม่จาก working tree เดียวกัน (พร้อม settings blob เดียวกับของ 5173 รวม `mode: cursor` และ bindings v1) โหลดใน 2 s ปกติ จึงน่าจะเป็นสถานะ HMR ค้างของ server ตัวนั้น **ให้ restart `npm run dev` ก่อนลองบิน** (ไม่ได้ปิด server ของ owner เอง)

## 8. ตัวเลขที่วัดได้ (report only, `benchmarks/flight/coreFeel.ts`)

วิธีวัด:

- roll เริ่มจากปีกระดับ, pull เริ่มจาก bank 90° เพื่อไม่ให้ gravity เข้า pitch plane
- instantaneous turn = path rate สูงสุดในวินาทีแรกของการดึงเต็ม
- sustained turn คิดจากสมดุล thrust = drag ของ profile (เลี้ยวระดับ)
- corner speed = argmax ของ instantaneous turn บน grid 5 m/s

ความเร็วทั้งหมดแสดงเป็น HUD km/h (= m/s × 5.4) รันซ้ำได้ด้วย `npx vitest run --config vitest.bench.config.ts benchmarks/flight/coreFeel.report.ts` (ไม่ต้องรัน `flight:bench` ทั้งชุด)

### 8.1 Roll / yaw

| HUD km/h | F-22 roll °/s | Su-57 roll °/s | ถึง 90% | ปล่อยแล้ว < 5% |
|---:|---:|---:|---:|---:|
| 216 | 100 | 94 | 0.31 s | 0.30 s |
| 270 | 149 | 140 | 0.25 s | 0.30 s |
| 324–972 | **180** | **170** | 0.23 s | 0.31 s |

| HUD km/h | F-22 yaw °/s (β คงที่, rudder เต็ม) | Su-57 |
|---:|---:|---:|
| 324 | 18 (−15.7°) | 21 (−17.8°) |
| 540 | 15 (−7.0°) | 18 (−7.8°) |
| 702 | 14 (−4.4°) | 16 (−5.1°) |
| 972 | 14 (−4.0°) | 16 (−4.8°) |

### 8.2 Pitch rate และ turn rate vs speed (F-22; Su-57 ต่างไม่เกิน ~1–3°/s)

| HUD km/h | pitch rate °/s | inst. turn °/s | G | α° | limit | sustained dry °/s (G) | sustained AB °/s (G) | ความเร็วที่เสียใน 3 s ที่ดึงเต็ม |
|---:|---:|---:|---:|---:|---|---:|---:|---:|
| 324 | 58.7 | 36.3 | 3.5 | 24.0 | alpha | 31.7 (3.5) | 31.7 (3.5) | 2.1 m/s |
| 432 | 59.7 | 45.6 | 5.9 | 23.5 | alpha | 36.9 (5.3) | 43.5 (6.3) | 7.9 m/s |
| **540** | 60.0 | **51.1** | 8.4 | 21.2 | none | 35.2 (6.3) | 49.4 (8.8) | 21.5 m/s |
| 648 | 47.9 | 43.6 | 8.9 | 14.2 | g | 32.6 (7.0) | 41.9 (9) | 18.7 m/s |
| 756 | 38.1 | 36.7 | 8.9 | 10.1 | g | 29.1 (7.3) | 35.9 (9) | 9.9 m/s |
| 864 | 32.6 | 31.6 | 8.8 | 7.7 | g | 24.4 (7.0) | 31.4 (9) | 7.6 m/s |
| 972 | 28.6 | 27.7 | 8.7 | 6.1 | g | 17.6 (5.7) | 27.9 (9) | 8.3 m/s |
| 1080 | 25.5 | 24.7 | 8.7 | 4.9 | g | — | 25.1 (9) | 11.1 m/s |
| 1188 | 23.2 | 22.3 | 8.6 | 4.2 | g | — | 22.9 (9) | 16.6 m/s |

### 8.3 Corner speed และ envelope

| | F-22 | Su-57 |
|---|---|---|
| Corner speed (วัด) | **540 km/h** (100 m/s), 51.1°/s | **540 km/h**, 51.3°/s |
| Corner speed (ออกแบบ, `cornerSpeedKph`) | 500 | 480 |
| 1 g ที่ α limit (ช้าสุดที่บินระดับได้) | 172 km/h | 166 km/h |
| Top speed dry / burner (1 g) | 1080 / 1424 km/h | 1037 / 1367 km/h |

Corner ที่วัดได้สูงกว่าค่าออกแบบ เพราะ α limit (24°) ต่ำกว่า αcrit (30°) ทำให้ lift ที่ใช้ได้จริงเป็น CL(24°) ≈ 0.93·CLmax และเพราะ grid หยาบ 5 m/s ถ้าต้องการให้ตรงกับค่าออกแบบ ให้ลด `cornerSpeedKph` ลง ~4%

### 8.4 ข้อสังเกตสำหรับ playtest (ยังไม่จูน ให้ owner ตัดสิน)

- **Turn rate สูง:** 51°/s ที่ corner, 37°/s ที่ 756 km/h เพราะความเร็วในเกมเป็น m/s จริงที่ต่ำ (HUD ×1.5) และ 9 G ที่ 100 m/s ก็คือ 51°/s ตามฟิสิกส์ ถ้าหนักมือเกินไป ให้ลด `gLimit` หรือ `maxRate.pitch` หรือเพิ่ม `cornerSpeedKph`
- **Roll เท่ากันทุกความเร็วในช่วงรบ** (180°/s) ตามแผน §3.3 และลดลงเฉพาะเมื่อช้ากว่า 300 km/h
- **Yaw อ่อน** (Q/E ได้ 14–18°/s และ β 4–8° ที่ความเร็วรบ) เพราะ yaw weathervane แข็ง ส่วน pedal turn เป็นงานของ PSM (FR4)
- **ทุกครั้งที่เลี้ยวแรงความเร็วจะหายจริง** และ ratchet ไม่เติมคืน: ดึงเต็ม 3 s ที่ 540 km/h เสีย 21 m/s (≈115 km/h) ถ้ารู้สึกว่าเสียพลังงานเร็วไป ให้ลด `inducedK` หรือ `cdHigh`
- **ปล่อยมือ = คงท่า:** หลังเกิด จมูกจะคงที่ และ path ลดลงหา α trim (~1.4°) ภายในประมาณ 1 s (ความสูงหายไปราว 5 m)

## 9. วิธีลอง (stop point)

1. Restart dev server (`npm run dev`)
2. Settings › Keyboard › preset **Keyboard** (หรือ Mouse ก็ได้ แต่ mouse ยังไม่ได้จูน)
3. หน้า Flight → เมนู → ส่วนควบคุม → **Flight Lab** → "Flight core" = **ใหม่ (rewrite, FR1)** (เริ่มการบินใหม่) แล้วติ๊ก "แสดงข้อมูลการบินละเอียด" เพื่อเปิด overlay
4. ปุ่ม: ↑↓ pitch, A/D roll, Q/E yaw, ←/→ coordinated turn, W/S speed, Shift AB, X airbrake, Space PSM (ใน FR1 แค่ ratchet speed hold ยังไม่เปิด α)
5. จูน: เปิดเมนู (Esc) → Flight Lab → แผง "จูน core ใหม่" → แก้ค่าแล้วกด Enter → บินต่อ จากนั้นใช้ "คัดลอก tuning JSON" เพื่อส่งค่าที่ชอบกลับมา

## 10. Test ที่ตั้งใจแก้ (ไม่มีการคลาย legacy flight)

ทั้งหมดเป็นการเปลี่ยนปุ่มหรือ contract ตามแผน ไม่ได้เปลี่ยน physics ของ core เก่า

| Test | ทำไม |
|---|---|
| `flightReadout.test.ts` › "refuses the new core until it is built" | เปลี่ยนเป็น "flies the new core once registered, and refuses any unknown core" (ยังตรวจ core ที่ไม่รู้จัก) |
| `invariants/phase6.test.ts` › I21 | key ของ command ตอนนี้มี `psm` และ `commandSchemaVersion` = 3 (`psmArm` / `highG` ยังต้องไม่มี) |
| `maneuvers.test.ts` › "maps Space to the airbrake…" | เปลี่ยนเป็น X = airbrake, Space = `psm: true`, C ยังไม่มีปุ่ม |
| `invariants/phase4.test.ts` › "Space is Airbrake…" | X + Space + Shift = airbrake + psm + afterburner ส่วนที่ตรวจ positional blend ไม่เปลี่ยน |
| `settings.test.ts` (3 ตัว) | default ของ airbrake เป็น X; rollLeft ไม่มีปุ่มสำรองแล้ว (`[null, 'KeyA']` แทน `['ArrowLeft', 'KeyA']`) |
| `flight.test.ts` (3 ตัวใน mouse flight), `automaticMouse.test.ts`, `mouseAim.test.ts` (Cobra / Kulbit / bled Cobra) | test ของ core เก่าที่**กดเบรก**ด้วย `'Space'` ตอนนี้กด `'KeyX'` ความหมายและค่าที่ตรวจเหมือนเดิม |

## 11. ยังไม่ทำ / เลื่อน (ระบุชื่อ)

- **FR4:** PSM authority, α limit เปิดตาม Space, psmRate, nozzle จริง, regime RECOVERING / DEPARTED
- **FR2 / FR3 / FR5:** กล้องใหม่, Mouse Aim ใหม่ และ bot ที่ใช้ instructor ใหม่ (ตอนนี้ bot บิน core ใหม่ผ่าน instructor เก่า บินได้แต่ไม่ได้จูน), Joystick
- **Rigs:** `flightRig.ts` / `su57Rig.ts` ยัง normalize rates ด้วย `profile.flight.*Rate` ของ core เก่า (ข้อค้างจาก FR0 §4) core ใหม่หมุนเร็วกว่าค่านั้น (roll 180 เทียบกับ 120°/s, pitch 60 เทียบกับ 54°/s) control surface จึงขยับมากกว่าที่ควร (roll ~1.5 เท่า, pitch ~1.1 เท่า, ตกแต่งอย่างเดียว) เลื่อนไป FR2/FR6
- **Practice lessons** (high-G, brake ฯลฯ) อ่าน readout จึงทำงานบน core ใหม่ แต่เกณฑ์ยังเป็นของ core เก่า
- **`flightProfileVersion`** ยังไม่ bump ตามแผน (bump ตอน FR7) เพราะ replay ของ core ใหม่แยกได้จาก `config.flightCore` และ `coreTuning` อยู่แล้ว ส่วน `commandSchemaVersion` bump แล้ว (2 → 3) **replay เก่าทั้งหมดเล่นไม่ได้แล้ว** ตามแผน §3.1
- **Settings migration ของ mouse mode** (`'cursor'` → Mouse Aim ฯลฯ) อยู่ใน FR5

## 12. สถานะ git

Commit `5513937` ตามที่ owner สั่ง (1 พ.ย.) รวมทุกไฟล์ใน §2 ไม่รวม `.claude/`
