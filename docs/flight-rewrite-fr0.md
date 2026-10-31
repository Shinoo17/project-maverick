# Flight Rewrite — FR0 Report

> วันที่ 1 พ.ย. 2026 · branch `feat/flight-rewrite` · commit ตามที่ owner สั่ง
> แผน: [flight-rewrite-plan.md](flight-rewrite-plan.md) §3.2, §5, §7 (FR0) · Requirements: [project-maverick-flight-control-psm-drift-rework-spec.md](project-maverick-flight-control-psm-drift-rework-spec.md)

## 1. สรุป

FR0 ทำครบสามอย่างตามแผน โดย core เก่ายังเป็นตัวบินอยู่

1. **`FlightReadout`**: ทุกส่วนนอก flight core อ่านค่าการบินผ่าน `readFlight(state, pose?)` ชุดเดียว ได้แก่ HUD, telemetry, กล้อง, rig, exhaust, vapor, เสียง, practice, bot, input และ seeker มิสไซล์ ไม่มีส่วนไหนอ่าน `maneuver` / `stall` / `intent` / `thrustVectoring` / `flightForces` / `limiterOpen` / `enginePower` ตรงๆ อีก ยกเว้นรายการใน §4 ซึ่งมี test คุมไว้
2. **Dispatch toggle**: เพิ่ม `SessionConfig.flightCore: 'legacy' | 'new'` แล้ว `GameRuntime` จะ step ผ่าน core ที่เลือก ใน Flight Lab มี select ให้เลือก ตอนนี้ `'new'` ยังเลือกไม่ได้ ถ้าขอ `'new'` ระบบจะ error ชัดเจนว่า "not built yet (FR1)" ไม่ fallback เงียบๆ
3. **`CAMERA_TRACE`**: บันทึกกล้องทุก frame (look, up, boom, FOV, α/β/incidence, rates และ blend weights) เปิดปิดและ export เป็น JSON ได้จาก Flight Lab

ผลลัพธ์: test เดิมผ่านครบ 877/877 รวม test ใหม่ 11 ตัวเป็น 888/888 ค่าที่ consumer ทุกตัวออกเทียบกับก่อนแก้แล้วเท่ากันเป๊ะ ยกเว้นจุดเดียวที่ตั้งใจเปลี่ยน **เกมเหมือนเดิม ยกเว้นจังหวะที่ธง HI-G บน HUD ขึ้น ซึ่งเลื่อนไป 1 substep (§5)** owner ต้องรับข้อนี้ก่อน

## 2. สิ่งที่สร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| [src/game/flight/readout.ts](../src/game/flight/readout.ts) | interface `FlightReadout` + `readFlight(state, pose?)` (dispatch ตาม core ของ aircraft) |
| [src/game/flight/legacyReadout.ts](../src/game/flight/legacyReadout.ts) | readout ของ core เก่า: ส่งค่าที่ core เก็บไว้ผ่านตรงๆ ส่วนค่า air สังเกตที่ pose เหมือนที่ consumer ทำเดิม (ลบที่ FR7) |
| [src/game/flight/core.ts](../src/game/flight/core.ts) | `FlightCoreId`, `FlightCore { step, readout }`, registry (`legacy` = `stepFlight` + `legacyReadout`, `new` = ยังไม่มี), `getFlightCore`, `flightCoreOf` |
| [src/render/cameraTrace.ts](../src/render/cameraTrace.ts) | `CameraTrace` (ring buffer 17,280 frame ≈ 2 นาทีที่ 144 FPS) + `CameraTraceFrame` |
| [src/features/flight/LegacyFlightLab.tsx](../src/features/flight/LegacyFlightLab.tsx) | ตาราง debug ของ core เก่า แยกออกมาจาก `PlaygroundHud` โดยไม่แก้เนื้อหา (ลบที่ FR7) |
| [tests/flightReadout.test.ts](../tests/flightReadout.test.ts) | test ใหม่ 11 ตัว: readout, dispatch, trace และ seam guard |

### 2.1 `FlightReadout`

ค่ามีสองกลุ่ม:

- **Step values** คือค่าที่ flight step ล่าสุดใช้หรือจบลงด้วย pose ไม่มีผลกับกลุ่มนี้ ได้แก่ `noseVelocityDeg`, `g`, `pathRateDeg`, `power`, `burner { active, status, reserve, seconds }`, `airbrake`, `psmAuthority`, `nozzle` (`null` ถ้าไม่มี TVC), `postStall`, `gAllowance`
- **Air values** คือค่าที่สังเกตที่ `pose` ถ้าไม่ส่ง pose จะใช้ pose ของ state เอง ได้แก่ `airspeed`, `hudSpeed`, `alphaDeg`, `betaDeg`, `incidenceDeg`, `angleConfidence`, `highAoa`, `regime`, `alphaLimitDeg`, `alphaBandDeg { normal, critical, max }`

ที่ต้องแยกสองกลุ่มเพราะ render loop ส่ง pose ที่ interpolate ระหว่าง tick เดิมกล้องกับ HUD glass ก็อ่าน airflow ที่ pose นี้ แต่ตัวเลข α บน HUD, rig, เสียง, bot และ practice อ่าน `maneuver.alpha` ที่เก็บไว้ตอนจบ step ถ้ารวมเป็นค่าเดียว frame ที่อยู่ระหว่าง tick จะเปลี่ยนไปเงียบๆ ใน core เก่า state ที่ step แล้วจะได้ `incidenceDeg === noseVelocityDeg` เสมอ (มี test ยืนยัน) ส่วน core ใหม่ใช้สูตรเดียวกันได้

ชื่อ field ใช้ตาม plan §3.2 ตามด้วยค่าที่ HUD เคยดึงจาก envelope/intent (`regime`, `highAoa`, `gAllowance`, `alphaLimitDeg`, `alphaBandDeg`) สำหรับ core เก่า `psmAuthority` = `limiterOpen` และ `postStall` = `stall.severity`

### 2.2 Dispatch

- `SessionConfig.flightCore` เป็น optional ถ้าไม่ระบุ = `'legacy'` `GameRuntime` เก็บค่าไว้ใน config เฉพาะตอนเป็นค่าอื่นที่ไม่ใช่ legacy ทำให้ replay และ snapshot ของ legacy เหมือนก่อน FR0 ทุก byte (มี test ยืนยัน)
- `AircraftState.flightCore?` ใส่เฉพาะ aircraft ที่ core ไม่ใช่ legacy ถ้าไม่มี = legacy `readFlight` ใช้ field นี้เลือก readout
- ไม่ได้ bump `flightProfileVersion` และ `commandSchemaVersion` เพราะ plan ให้ bump ตอนสลับ core
- `validateSession` ตอนนี้ปฏิเสธค่าที่ไม่รู้จัก และปฏิเสธ `'new'` จนกว่า FR1 จะลงทะเบียน core ใหม่ใน `core.ts`

## 3. ตารางการย้าย consumer

| ไฟล์ | อ่านเดิม | อ่านตอนนี้ |
|---|---|---|
| `features/flight/FlightInstruments.tsx` (`glassState`) | `maneuver.alpha/g/burner/airbrake`, `enginePower`, `observeAirflow` + `interpretEnvelope` + `envelopeLabel` ที่ pose, `getFlightProfile` (aero, burnerSeconds) | `readFlight(state, { orientation, velocity })` |
| `features/flight/FlightInstruments.tsx` (`FlightSystemStatus`) | `enginePower`, `maneuver.airbrake` | `readFlight(state)` |
| `features/flight/telemetry.ts` (`flightWarning`, `burnerStatus`) | airflow + envelope + label, `maneuver.burner*` | `readFlight` (`regime`, `airspeed`, `highAoa`, `postStall`, `burner.status`) |
| `features/flight/PlaygroundHud.tsx` | label จาก envelope, `maneuver.alpha` และตาราง lab ทั้งตาราง | `readFlight` (`regime`, `noseVelocityDeg`) ส่วนตาราง lab ย้ายไป `LegacyFlightLab` (§4) |
| `features/flight/WeaponPanel.tsx` | `maneuver.g` | `readFlight(state).g` |
| `game/playground/practice.ts` | `flightForces.envelope.gAllowance`, `maneuver.pathRate`, `maneuver.alpha` | `readFlight` (`gAllowance`, `pathRateDeg`, `noseVelocityDeg`) |
| `game/bot/botPilot.ts` | `maneuver.alpha` (alpha guard) | `readFlight(self).noseVelocityDeg` |
| `game/input/mouseAim.ts` (`instructorShare`) | `observeAirflow` | `readFlight` (`incidenceDeg`, `angleConfidence`) |
| `render/FlightScene.tsx` (`input.highAoa`) | `interpretEnvelope(observeAirflow(...)).highAoa` | `readFlight(live).highAoa` |
| `render/FlightCamera.ts` | `observeAirflow` + `getFlightProfile`, `maneuver.burnerActive` | `readFlight(pose)` (`incidenceDeg`, `angleConfidence`, `airspeed`, `burner.active`) |
| `game/camera/cameraRoll.ts` (`psmShareOf`, `driftShareOf`) | `observeAirflow` + `getFlightProfile` | `readFlight` |
| `render/aircraft/flightRig.ts` (F-22) | `enginePower`, `thrustVectoring[side]` | `flight.power`, `flight.nozzle` (รับ readout เป็น argument ได้ default = `readFlight(state)`) |
| `render/aircraft/su57Rig.ts` | `maneuver.alpha/burnerActive`, `enginePower`, `thrustVectoring[side]` | `flight.noseVelocityDeg/burner.active/power/nozzle` (รับ readout เป็น argument ได้) |
| `render/exhaust/profile.ts` (`flightExhaustConditions`) | `enginePower`, `maneuver.burnerActive`, `thrustVectoring` + profile | `flight.power/burner.active/nozzle` (รับ readout เป็น argument ได้) |
| `render/vapor/conditions.ts` | `observeAirflow`, `maneuver.g` | `readFlight` (`airspeed`, `alphaDeg`, `betaDeg`, `g`) |
| `render/audio/flightSound.ts` | `maneuver.burnerActive/g/alpha`, `enginePower` (ทั้งเครื่องเราและลำอื่น) | `readFlight` |
| `game/combat/missiles.ts` (`aircraftHeat`) | `enginePower` | `readFlight(entity).power` |
| `render/HangarFlightView.tsx` | เขียน `enginePower` และ `maneuver.burnerActive` ลง state เพื่อให้ rig อ่าน | ไม่เขียนลง state แล้ว ส่ง fixture readout (`{ ...readFlight(state), power, burner }`) ให้ rig และ exhaust แทน |
| `render/exhaust/preview.ts` | เขียน `enginePower`, `maneuver.burnerActive`, `maneuver.alpha` ลง state | ส่ง fixture readout แทน (`power`, `burner`, `noseVelocityDeg`) |

## 4. ข้อยกเว้นที่ยังอ่านของ core เก่า (ตั้งใจ ระบุชื่อ)

Test `FlightReadout seam` ใน [tests/flightReadout.test.ts](../tests/flightReadout.test.ts) จะ fail ถ้าไฟล์ใน `src/` นอก `game/flight/` อ่าน field ของ core เก่า ยกเว้นรายการนี้:

| ไฟล์ | เหตุผล | จัดการเมื่อไร |
|---|---|---|
| `features/flight/LegacyFlightLab.tsx` | ตาราง debug ~40 แถวของ core เก่า (budget, allocation, TVC, natural aero ฯลฯ) เป็น overlay ของ core นั้นโดยตรง ถ้ายัดเข้า readout จะทำให้ seam สกปรก ตอนนี้แสดงเฉพาะเมื่อ core = legacy | FR1 ทำ overlay ของ core ใหม่ ส่วน FR7 ลบไฟล์นี้ |
| `features/flight/hudPreview.tsx` | หน้า preview HUD เขียน fixture ลง `maneuver` / `stall` / `thrustVectoring` แล้วให้ legacy readout อ่าน | FR7 (เปลี่ยนเป็น fixture readout) |
| `game/runtime/GameRuntime.ts`, `game/state/WorldState.ts` | เป็นที่สร้างและนิยาม state | FR7 |

รายการต่อไปนี้ test ไม่ได้จับ เพราะอ่าน **ข้อมูลเครื่องบิน (profile)** ไม่ใช่ state ของ core:

- `game/input/mouseAim.ts`: `pullCeiling` ใช้ `observeAirflow` + `profile.aero/flight` (turnAcceleration, referenceSpeedMps ฯลฯ) ซึ่งเป็นโมเดลของ core เก่า FR3 จะเขียน instructor ใหม่ทั้งตัว
- `render/aircraft/flightRig.ts`, `su57Rig.ts`, `render/exhaust/preview.ts`, `HangarFlightView.tsx`: ใช้ `profile.flight.pitchRate/rollRate/yawRate` normalize rates และ `profile.thrustVectoring.cantDeg/maxAngle` ส่วน hangar/exhaust preview ยังขยับหัวฉีดด้วย `stepThrustVectoring` + `tvcTargets` (mixer สำหรับ preview ของ core เก่า) จะชี้ไปที่ profile ใหม่เมื่อ FR1 มี `maxRate` ต่อแกน
- `features/hangar/performance.ts`, `features/studio/FlightProfilePanel.tsx`, `content/validate.ts`: แสดงหรือตรวจค่าใน profile จะเปลี่ยนตาม schema profile ใหม่ (FR1/FR6)

## 5. จุดที่ต่างจากเดิม (มีจุดเดียว)

ธง **HI-G** บน HUD glass เดิมคำนวณจาก `interpretEnvelope` ที่ pose ที่วาด ตอนนี้ใช้ `gAllowance` ที่ flight step ล่าสุดใช้จริง ซึ่งเป็นค่าเดียวกับที่ practice ใช้นับ lesson high-G อยู่แล้ว ผลวัดจาก baseline (§6.2) ต่างกัน 3 แถวจาก 16,200 แถวของ track (แถวละ 1 ใน track `pedal` ของแต่ละลำ) คือจังหวะที่ธงเริ่มขึ้นช้าหรือเร็วไป 1 substep (1/120 s) ทั้ง 3 แถวต่างเฉพาะ `glassTick` (HUD ที่ pose ของ tick) ส่วน `glass` ที่ pose interpolate ซึ่งเป็นภาพที่เกมวาดจริงระหว่าง tick เท่ากันทุกแถว

ทำแบบนี้เพราะต้องเลือกระหว่างให้ HUD กับ practice ใช้ค่าเดียวกัน หรือให้ readout มี `gAllowance` สองตัว เลือกค่าที่ step ใช้จริง เพราะเป็นความหมายเดียวกับที่ core ใหม่จะมี (G limit ที่บังคับใช้อยู่) และไม่แตะผลของ simulation

**ทางเลือกถ้า owner ต้องการให้เหมือนเดิมทุก byte:** ให้ readout มีค่าที่สังเกตที่ pose (ให้ HUD ใช้) แยกจากค่าที่ step ใช้ (ให้ practice ใช้) แก้ไม่กี่บรรทัด แต่ readout จะมี G allowance สองตัว

## 6. การพิสูจน์

### 6.1 Test และ typecheck

| | ก่อน FR0 | หลัง FR0 |
|---|---|---|
| `npx vitest run` | 74 ไฟล์, 877/877 ผ่าน | 75 ไฟล์, 888/888 ผ่าน (เดิม 877 + ใหม่ 11) |
| Golden tracks (Phase 0, 30/60/144 FPS) | ผ่าน | ผ่าน (`stepFlight` ไม่ได้แก้) |
| `npx tsc -b` | error 1 จุด: `benchmarks/flight/noseFlick.report.ts:17` (`highG` ไม่มีใน `PilotCommand`) | error เดิมจุดเดียวกัน ไม่มี error ใหม่ |
| `npx vite build` (output ไป scratchpad) | — | build ผ่าน |

Error ของ tsc มีอยู่ก่อน FR0 และอยู่ในไฟล์ owner (FD6) **owner สั่งให้ปิดไว้ก่อน (1 พ.ย.)**: owner comment test ในไฟล์ออกเอง และ FR0 เอาไฟล์ออกจาก `tsconfig.json` (`exclude`) กับ `vitest.bench.config.ts` ตอนนี้ `tsc -b` ผ่านแล้ว จะเปิดกลับเมื่อ port เป็น benchmark ของ core ใหม่ใน FR6

ไม่ได้รัน `npm run flight:bench` เพราะ report เขียนไฟล์ทับใน `benchmarks/flight/` ซึ่งมีไฟล์ owner ที่ยังไม่ commit (เช่น `mr-results/mr2/phase4.md`) และ `stepFlight` ไม่ได้ถูกแก้อยู่แล้ว

### 6.2 Baseline ของ consumer (นอก repo)

ก่อนแก้โค้ดได้อัด output ของ consumer ทุกตัวไว้ แล้วเทียบแบบ exact หลังแก้ script อยู่ใน scratchpad ของ session ไม่ได้ commit

- Track (5,400 แถวต่อลำ รวม 16,200 แถว): `cobra`, `hardTurn900`, `tailSlide`, `pedal`, `kulbit`, `reversal180`, `sideslip60` × `f22`, `su57`, `f22-notvc` ทุก substep
- ที่อัดต่อ step: `glassState` ทั้งที่ pose interpolate (α = 0.5) และที่ pose ของ tick, `flightWarning`, `burnerStatus`, `flightVaporConditions`, `flightExhaustConditions`, `su57ControlTargets`, `psmShareOf` และ `driftShareOf` (pose interpolate), `instructorShare`, `highAoa` ของ input, `stepPractice` และกล้อง `FlightCamera` ครบ 3 สไตล์ (position, quaternion, FOV, driftLag)
- Runtime: `GameRuntime` + combat bot 1,800 tick ต่อลำ เก็บ snapshot ทั้ง world ทุก 30 tick (รวม 120 แถว: bot, missile, practice)

ผล: เท่ากันทุกค่า ยกเว้น `glassTick.highG` 3 แถวตาม §5

### 6.3 Smoke test ในเกม (Chrome, dev server)

- หน้า Flight โหลดได้ ไม่มี console error ทั้งตอนโหลดและระหว่างบิน
- Flight Lab: select `flightCore` แสดง Legacy (เลือกอยู่) และ "ใหม่ (ตั้งแต่ FR1)" (disabled) ตาราง lab ของ legacy แสดง 42 แถวเหมือนเดิม
- Preview: `exhaust-preview.html?scenario=cobra&aircraft=su57` ทำงาน (burner ติด, หัวฉีด L/R 18° ตาม fixture), `hud-preview.html?psm&stall` แสดง advisory stall ตาม fixture, Studio › การบิน (HangarFlightView) โหลดได้ ทั้งหมดไม่มี console error
- เปิด CAMERA_TRACE แล้วบิน ~10 s: export ได้ 1,042 frame (`version: 1`) ค่าใน frame ถูกต้อง (style `balanced`, FOV 58.6, airspeed 130 m/s)

## 7. วิธีใช้

**สลับ flight core:** หน้า Flight → เมนู → ส่วนควบคุม → Flight Lab → "Flight core (เริ่มการบินใหม่)" ตอนเปลี่ยนจะ reset การบินเหมือนตอนเปลี่ยนเครื่องทดสอบ ค่านี้อยู่ใน session ไม่เซฟลง settings ในโค้ดให้ใช้ `new GameRuntime({ ..., flightCore: 'legacy' | 'new' })`

**CAMERA_TRACE:** Flight Lab → ติ๊ก "บันทึก camera trace (CAMERA_TRACE)" (ทุกครั้งที่ติ๊กจะเริ่มบันทึกใหม่จากศูนย์) → บิน → "ส่งออก camera trace JSON" จะได้ไฟล์ `maverick-camera-trace.json` แบบ `{ version, frames: CameraTraceFrame[] }` เก็บ 2 นาทีล่าสุด ถ้าใช้แบบ headless (benchmark/test) ให้ตั้ง `rig.trace = new CameraTrace()` แล้วอ่าน `trace.frames` การบันทึกเป็นแบบอ่านอย่างเดียว test ยืนยันแล้วว่ากล้องได้ภาพเท่ากันทุก frame ทั้งตอนเปิดและปิด trace ครบ 3 สไตล์

## 8. ข้อควรรู้สำหรับ FR1

- core ใหม่ต้องลงทะเบียนใน `core.ts` (`new: { step, readout }`) แล้ว `validateSession`, select ใน Flight Lab และ dispatch จะใช้ได้ทันที state ของ core ใหม่จะมี `flightCore: 'new'`
- readout ของ core ใหม่ต้องเติมทุก field ใน `FlightReadout` ถ้าไม่มีค่าที่ตรงกัน ให้ระบุไว้ใน readout ของ core นั้น ไม่ต้องแก้ consumer
- `PilotCommand.psm`, การ bump `commandSchemaVersion` และ `flightProfileVersion` ทำใน FR1 หรือ FR7 ตามแผน FR0 ยังไม่แตะ
- ต้องทำ overlay และ tuning panel ของ core ใหม่ใน FR1 แทน `LegacyFlightLab`

## 9. สถานะ git

แบ่งเป็นสอง commit: commit แรกคือเอกสารแผน + การย้ายเอกสารเก่าเข้า `docs/legacy-flight/` (งานเตรียมก่อน FR0 ที่ค้างไว้) commit ที่สองคือ FR0 ไม่รวม `.claude/` ไฟล์ที่ FR0 แก้หรือเพิ่มคือรายการใน §2 และ §3 รวมกับ `content/schemas.ts`, `content/validate.ts`, `features/flight/FlightPage.tsx`, `features/flight/session.ts`, `game/runtime/GameRuntime.ts`, `game/state/WorldState.ts` และ `locales/{en,th}.ts`
