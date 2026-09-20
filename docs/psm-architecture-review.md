# PSM / High-AoA / Thrust Vectoring — Architecture Review

> **Rev. 2 baseline อยู่ที่ [psm-implementation-plan.md](psm-implementation-plan.md) — ส่วน C/D/E/F/H ด้านล่างถูกแทนที่แล้ว**
> สถานะ: วิเคราะห์ก่อน implement · 17 ก.ย. 2026 · อ้างอิง code ที่ commit `2341da8`
> ทุกข้อในเอกสารนี้อ้างจาก code จริง ไม่ใช่จาก docs เดิม (`docs/game-design/04-maneuvers.md` ล้าสมัยแล้ว — ยังพูดถึง budget 3 s / cooldown / timeout ที่ code ไม่มีแล้ว)

## สรุปสั้น

**เครื่องมือ continuous ส่วนใหญ่มีอยู่แล้ว แต่ทุกตัวถูกผูกกับปุ่มเดียว**

`m.blend`, `m.controlAuthority = thrust / fullControlThrust`, `grip = 1 - m.blend`, `stall.severity`, `tvcAuthority(airspeed, aoa, phase)` เป็นค่า continuous ทั้งหมด แต่ทั้งหมดถูก key ด้วย `m.phase` ซึ่งมาจาก **C ค้าง** ([FlightInput.ts:44](../src/game/input/FlightInput.ts#L44) → [maneuvers.ts:33-42](../src/game/flight/maneuvers.ts#L33-L42)) — นี่คือ "กดปุ่มเข้า PSM Mode" ที่ design ใหม่ห้าม และเป็นปัญหาเชิงโครงสร้างหลักเพียงข้อเดียว

ปัญหาเชิง physics ที่ใหญ่รองลงมา: **ไม่มี aerodynamic restoring moment** (weathervane) เลย velocity ถูกดึงเข้าหาหัว แต่หัวไม่เคยถูกดึงเข้าหา velocity → Cobra ที่ "ดึงแล้วปล่อยหัวตกกลับเอง", Falling Leaf, Tail Slide ที่หัวสะบัดลง ไม่สามารถเกิดขึ้นเองได้

ดังนั้นงานนี้คือ **ผ่าตัด** ไม่ใช่ rewrite: re-key ค่า continuous เดิมจาก phase → AoA/airspeed/thrust/demand, เพิ่ม aero moment + recovery assist ที่ชัดเจน, แล้วเอา C / High-G key ออก

---

## A. Current System (จาก code จริง)

### A1. Pipeline ต่อ tick

`GameRuntime.advance` ([GameRuntime.ts](../src/game/runtime/GameRuntime.ts)) → world tick 60 Hz, flight 2 substep (120 Hz) → `stepFlight` ([stepFlight.ts](../src/game/flight/stepFlight.ts)) ทำตามลำดับ:

1. `stepStall` — วัด signed pitch-plane AoA, คำนวณ `severity` 0..1
2. `surfaceControl = 1 - severity·(1 - controlAuthority)` ([stepFlight.ts:19](../src/game/flight/stepFlight.ts#L19)) → full stall เหลือ 25%
3. `stepManeuvers` — PSM phase machine, High-G blend, airbrake smoothing, burner budget
4. `stepSpeed` — คำนวณ thrust (ดู A3)
5. `stepThrustVectoring` — actuator angle ของ nozzle
6. Rate controller → integrate orientation
7. Path model → velocity, drag, gravity, position, terrain/boundary

Replay/determinism: `flightProfileVersion = 'p3-powered-psm-1'` ([profile.ts:7](../src/game/flight/profile.ts#L7)); tests ยืนยันผลเท่ากันที่ 30/60/144 FPS

### A2. Input ([FlightInput.ts](../src/game/input/FlightInput.ts), [mouseStick.ts](../src/game/input/mouseStick.ts))

**ปุ่มจริงใน code ไม่ตรงกับที่ prompt ระบุ:**

| ปุ่ม | Code จริง | Prompt ระบุ |
|---|---|---|
| W / S | `speedAdjust` ±1 = **acceleration request** ปล่อยแล้ว autothrottle ถือความเร็วปัจจุบัน (ไม่มี target speed เก็บไว้) | target speed |
| X | Airbrake (`c.airbrake`) | — |
| Space | **High-G** modifier | Air Brake |
| Shift | Afterburner | Afterburner |
| C | **PSM arm** (hold) | — |
| Q / E | Yaw digital ±1; ไม่กดใช้ `roll × 0.12` | — |
| A / D, Arrows | Roll / Pitch digital | — |

**Mouse ไม่ใช่ "desired flight direction"** — เป็น **positional virtual stick**: ตำแหน่ง pointer ใน gate = stick deflection → **body rate command** (pitch/roll) ผ่าน deadzone 0.08 + curve² ไม่มี instructor/mouse-aim; mouse ไม่สั่ง yaw

`screenFrame` ([mouseStick.ts](../src/game/input/mouseStick.ts)) หมุน stick vector ตาม bank เมื่อ camera เป็น horizon mode (อ่านจาก attitude ไม่ใช่ camera — เจตนาเพื่อกัน feedback loop) แต่เมื่อกด C หรืออยู่ใน PSM จะสลับเป็น `LEVEL_FRAME` (body axes) ทันที ([FlightInput.ts:37](../src/game/input/FlightInput.ts#L37))

ไม่มี auto-level ใดๆ — ข้อนี้ดีอยู่แล้ว

### A3. Speed / Thrust / Afterburner ([speed.ts](../src/game/flight/speed.ts))

- `thrust = trim + acceleration` โดย `trim = drag·v²` ([speed.ts:33](../src/game/flight/speed.ts#L33)) — thrust คือ "แรงที่ต้องใช้เพื่อถือความเร็ว" ไม่ใช่ตำแหน่ง throttle และไม่มี engine spool state
- W เพิ่ม `acceleration` (24 m/s²), Shift เพิ่ม `AFTERBURNER_ACCELERATION = 38` (hardcode, [speed.ts:9](../src/game/flight/speed.ts#L9))
- Burner: reserve 6 s, recharge 12 s, lock จนถึง 25%
- Airbrake: `airbrake × 30` m/s² (hardcode, [speed.ts:45](../src/game/flight/speed.ts#L45)) ไม่ตัด thrust

**ผลที่ซ่อนอยู่:** ที่ 100 m/s ถ้าไม่กด W/Shift → `thrust ≈ 0.00035·100² = 3.5` → `controlAuthority = 3.5/24 ≈ 15%` → PSM แทบไม่หมุน ผู้เล่นต้องรู้ว่า **W คือ "PSM power"** (หรือ Shift) — afterburner → TVC authority link มีอยู่แล้ว แต่เป็นทางอ้อมและไม่มีใครบอกผู้เล่น

### A4. Normal flight rate controller ([stepFlight.ts:26-56](../src/game/flight/stepFlight.ts#L26-L56))

- `authority = clamp(v/90, .12, 1)·clamp(160/v, .6, 1)` — corner-speed curve hardcode ไม่ใช่ profile
- Target rate = `command × profileRate × authority × surfaceControl × highG`
- **Turn budget limiter** ([stepFlight.ts:33-35](../src/game/flight/stepFlight.ts#L33-L35)): nose rate ถูก clamp ไม่ให้เกินที่ path ตามทัน → ทำหน้าที่เป็น **G/AoA limiter โดยนัย** แบบ hard `min(1, …)`
- Response: `rateResponse 5`, `counterResponse 12`, `neutralResponse 9` (หยุดหมุนเร็วเมื่อปล่อย stick)

### A5. Path (velocity) model ([stepFlight.ts:79-118](../src/game/flight/stepFlight.ts#L79-L118))

ไม่ใช่ force/lift integrator — เป็น **scalar speed + direction**:

- `lateral` = force ตั้งฉากกับ path ที่ดึง velocity เข้าหา nose (`speed·pathResponse·angle` + anticipation) clamp ด้วย `turnAcceleration`
- `velocity.setLength(poweredSpeed)` ([stepFlight.ts:111](../src/game/flight/stepFlight.ts#L111)): lateral force หมุน velocity ได้ แต่ **ไม่เพิ่ม/ลดพลังงาน**; ความเร็วเปลี่ยนจาก component ตามแนว path เท่านั้น (thrust·cos α − drag − brake − gravity)
- `lateral` คือ **knob เดียว** ที่ควบคุม momentum decoupling — ไม่มี mass/inertia/lift model ให้หา

ผลเชิงตัวเลข: normal flight AoA steady-state ≈ `ω / pathResponse` → ที่ pitch rate สูงสุด ~0.64 rad/s (60 m/s) ได้ AoA ≈ 9° เท่านั้น → **ถ้าไม่กด C หัวแทบแยกจาก velocity ไม่ได้เลย**

### A6. PSM ([maneuvers.ts](../src/game/flight/maneuvers.ts))

Phase machine `normal → armed → active → recovery → normal`:

- **Armed**: C ค้าง + `psmEnabled` + alt ≥150 m + **speed 65–115 m/s** ([maneuvers.ts:31](../src/game/flight/maneuvers.ts#L31))
- **Active**: armed + `|pitch,yaw,roll| > 0.35`
- **Recovery**: ปล่อย C หรือ speed > `exitSpeed 135`
- **Normal**: alpha < 0.3 rad (~17°) และ speed > 60 ต่อเนื่อง 0.3 s และ blend = 0 (hardcode)

ขณะ active/recovery:
- Rate target blend ไปหา `command × maneuver.{pitch 2.6, yaw 1.6, roll 2.1} rad/s` ด้วย `poweredBlend = blend × thrust/24` ([stepFlight.ts:38-42](../src/game/flight/stepFlight.ts#L38-L42)) — rate envelope แบบ authored, **ไม่ได้มาจาก TVC geometry** (F-22 `yawGain: 0` แต่ PSM yaw ยังได้ 1.6 rad/s)
- Path grip: `activeGrip 0.08` / `recoveryGrip 2.5`, lateral cap `55` / `recoveryAcceleration 70` ([stepFlight.ts:94-97](../src/game/flight/stepFlight.ts#L94-L97)) — **decoupling มีอยู่จริงแล้ว** แค่ key ด้วย phase
- Drag: `psmDrag ∝ v²·(sin²α + reverse·0.4)·0.0025`, `turnLoss × 0.55` (PSM หมุนถูกกว่าเลี้ยวปกติ — แปลก) ([stepFlight.ts:98-99](../src/game/flight/stepFlight.ts#L98-L99))
- Gravity support หายครึ่งหนึ่ง (`0.5·(1-grip)`), stall หายเต็ม ([stepFlight.ts:116](../src/game/flight/stepFlight.ts#L116))
- F-22 `neutralDampingDuringPsm: true` → ปล่อย stick หยุดหมุนทันที; Su-57 `false`
- Recovery ไม่ damp rate เพิ่ม ไม่หมุนหัวคืน — แค่เพิ่ม grip ของ path

### A7. Stall ([stall.ts](../src/game/flight/stall.ts))

- `cause` = speed < 300 arcade km/h (~55.6 m/s) **หรือ** |AoA| > **30°** ([stall.ts:33-36](../src/game/flight/stall.ts#L33-L36)) — AoA อย่างเดียวก็ stall ได้แม้ความเร็วสูง
- ไม่รู้จัก aircraft capability (TVC หรือไม่ก็ 30° เหมือนกัน)
- Sideslip ไม่นับ → pedal turn 90° β ไม่ stall และแทบไม่มี drag นอก PSM

### A8. Thrust Vectoring ([thrustVectoring.ts](../src/game/flight/thrustVectoring.ts))

- Geometry จริง: twin nozzle, cant, pivot, inertia, `thrustForces` คำนวณ r×F — **ดีมาก ควร reuse**
- `tvcAuthority` = `.08 + .92·max(slow, highAlpha, maneuver)` โดย `maneuver = phase === 'active' ? 1 : 'recovery' ? .55 : 0` ([thrustVectoring.ts:15-16](../src/game/flight/thrustVectoring.ts#L15-L16)) — **phase leak ตัวเดียวในสูตรที่เหลือ continuous**
- Double-count guard ([stepFlight.ts:57-70](../src/game/flight/stepFlight.ts#L57-L70)): ลบ torque ของ *requested* angle × allocation แล้วบวก torque ของ *actual* angle → ใน flight ที่ allocation ≈ 1 ผลสุทธิ ≈ **actuator lag เท่านั้น** อำนาจจริงมาจาก rate envelope ใน A6 → TVC ตอนนี้มีผลต่อ "ความรู้สึก lag/overshoot" + ภาพ nozzle/exhaust มากกว่าเป็นตัวกำหนด capability

### A9. High-G ([maneuvers.ts:60-62](../src/game/flight/maneuvers.ts#L60-L62))

Space + demand > 0.35 ในช่วง 75–190 m/s (hardcode) → rate ×`highGRate 1.4`, lateral ×1.6, drag ×2; ปิดระหว่าง PSM — เป็น **envelope ที่สาม** ที่มีช่วงความเร็วของตัวเอง

### A10. Camera ([FlightCamera.ts](../src/render/FlightCamera.ts))

- Chase camera: offset smoothing 10/s, rotation slerp 8/s, up transport ผ่าน vertical + smoothing 3/s, horizon/aircraft roll mode
- **มี PSM behavior อยู่แล้ว**: `cinematic` → `forward.lerp(path, cinematic × 0.88)`, ถอยหลัง +6, สูง +3.5 ([FlightCamera.ts:14-42](../src/render/FlightCamera.ts#L14-L42)) — แสดง nose-vs-momentum ได้จริง แต่ **key ด้วย phase** และ 0.88 หันไปทาง velocity มากเกิน → เสียแนวปืน/เป้า
- FOV: speed + burner เท่านั้น; ไม่มี shake

### A11. Effects / HUD / Audio

- **Vapor** ([vapor/conditions.ts](../src/render/vapor/conditions.ts)): จาก AoA/g/speed/humidity — state-driven แล้ว ✔
- **Exhaust** ([exhaust/profile.ts](../src/render/exhaust/profile.ts)): nozzle angle จาก simulation ✔
- **Rigs** ([flightRig.ts](../src/render/aircraft/flightRig.ts), [su57Rig.ts](../src/render/aircraft/su57Rig.ts)): surfaces จาก `rates / normal rate` (อิ่มตัวใน PSM), nozzles จาก sim ✔
- **HUD**: flag `PSM`/`HI-G`/`BRAKE` ([hudPainter.ts:406](../src/features/flight/hudPainter.ts#L406)), PSM speed-band bracket, nose pipper; `velocity` ถูกส่งเข้า painter แต่ **ไม่มี flight-path (velocity vector) marker**
- `flightWarning` ปิด stall warning เมื่อ `phase === 'active'` ([telemetry.ts:13](../src/features/flight/telemetry.ts#L13))
- **Audio: ไม่มีระบบเสียงใน `src` เลย**; buffet/shake: ไม่มี

### A12. Aircraft

มี flight profile แค่ 2 ลำ: `raptor-energy` (F-22), `felon-agility` (Su-57) — ค่าเกือบเหมือนกัน ต่างแค่ PSM yaw 1.6/1.85, TVC cant/yawGain, neutral damping; Su-35/F-35/F-14/F-16/F/A-18 ยังไม่มี model/rig/profile

---

## B. Problems / Limitations

เรียงตามผลกระทบต่อ design

| # | ปัญหา | ที่มา | ผลต่อ design |
|---|---|---|---|
| B1 | **PSM เป็น mode ที่เปิดด้วยปุ่ม** | `psmArm` → phase ([maneuvers.ts:33-42](../src/game/flight/maneuvers.ts#L33-L42)); post-stall rates เป็น `null` นอก phase ([maneuvers.ts:78](../src/game/flight/maneuvers.ts#L78)) | ขัดข้อ 1–2 โดยตรง |
| B2 | **High AoA ถูกลงโทษ ไม่ได้ถูกบิน** | AoA > 30° → stall แม้ความเร็วสูง → `surfaceControl` → 25% ([stall.ts:33](../src/game/flight/stall.ts#L33)) | ไม่มีโซน HIGH_AOA ระหว่าง normal กับ PSM; เครื่อง TVC เสีย control เท่าเครื่องไม่มี TVC |
| B3 | **ไม่มี aero restoring moment / damping ตาม q** | ไม่มี term ใดหมุน nose เข้าหา velocity | Cobra ต้อง "กดหัวลงเอง", Falling Leaf / Tail Slide flip ไม่เกิด, recovery ต้องพึ่ง path grip อย่างเดียว |
| B4 | **Entry window ปิดกั้นท่า** | 65–115 m/s, force exit >135 m/s, alt ≥150 | Cobra จาก cruise ทำไม่ได้โดยโครงสร้าง; ขอบ band เป็นเส้นแข็ง |
| B5 | **Implicit AoA limiter แข็งและไม่มีทาง breakout** | turn budget `min(1, budget/requested)` ([stepFlight.ts:33-35](../src/game/flight/stepFlight.ts#L33-L35)) + `pathResponse 4` | Normal AoA สูงสุด ~9°; ไม่มีวิธี "ดึงทะลุ limiter" |
| B6 | **3 envelope ซ้อนกัน** | normal / High-G (75–190) / PSM (65–115) ต่างมี speed window ของตัวเอง | ปุ่มเกิน, transition ซ้อน, tuning ยาก |
| B7 | **Capability ไม่ได้มาจาก TVC** | PSM rate envelope authored; TVC net ≈ lag ([stepFlight.ts:57-70](../src/game/flight/stepFlight.ts#L57-L70)); `psmEnabled: boolean` | F-22 yaw PSM เท่า Su-57 เกือบหมด; F/A-18 ("aero high-AoA ดี แต่ไม่มี TVC") แสดงด้วย boolean ไม่ได้ |
| B8 | **TVC authority มี phase leak** | [thrustVectoring.ts:15](../src/game/flight/thrustVectoring.ts#L15) | ลบ term นี้ = TVC authority emergent จาก speed+AoA ทันที |
| B9 | **Afterburner → TVC เป็นทางอ้อมและซ่อน** | `controlAuthority = thrust/24`, thrust = trim+accel | C + mouse เฉยๆ ได้ ~15% authority; W เป็น "PSM power" ที่ไม่มีใครรู้ |
| B10 | **Yaw authority/resolution ต่ำ** | normal yaw 0.42 rad/s; Q/E digital ±1 ทันที; mouse ไม่มี yaw | Pedal turn / Falling Leaf คุมละเอียดไม่ได้ |
| B11 | **Roll เป็น body-axis เสมอ** | `angular = (roll, -yaw, pitch)` body | ที่ AoA 40–70° body roll ดูเหมือน spin แปลกๆ; Herbst ที่สวยต้อง roll รอบ velocity vector |
| B12 | **Mouse frame สลับแบบกระโดด** | `has('KeyC') \|\| psmControl ? LEVEL_FRAME : screen` ([FlightInput.ts:37](../src/game/input/FlightInput.ts#L37)) | กด C ขณะ bank ใน horizon mode → คำสั่ง stick หมุนทันที; `screenFrame` มี `blend` อยู่แล้วแต่ไม่ใช้ |
| B13 | **Recovery assist อ่อนและผูก phase** | recovery = grip 2.5 เท่านั้น; ไม่ damp rate, ไม่ align nose; จบด้วย threshold hardcode | ไม่ตรงข้อ 6; ไม่มี anti-spin |
| B14 | **Energy cost ไม่สม่ำเสมอ** | `psmDrag` มีเฉพาะ `assisted`; `turnLoss × 0.55` ใน PSM; β ไม่มี drag | High AoA นอก PSM แทบไม่เสียพลังงาน; PSM หมุนถูกกว่าเลี้ยวปกติ |
| B15 | **Energy guard กัน path-to-nose ไม่ให้เสียพลังงาน** | lateral force ไม่เปลี่ยน speed ([stepFlight.ts:109-111](../src/game/flight/stepFlight.ts#L109-L111)) | ถ้าเพิ่ม recovery แบบ "velocity → nose" ตรงๆ จะกลายเป็น **free instant reversal** (Cobra 180° แล้วปล่อย = velocity หันตามฟรี) ต้องมีค่าใช้จ่าย |
| B16 | **Hardcoded constants** | corner curve 90/160, TVC 55/145/8/57, lateral 55, psmDrag 0.0025, burner 38, brake 30, High-G 75–190, recovery 17°/60 m/s | Aircraft personality ถูกล็อก |
| B17 | **Camera ผูก phase + หันตาม velocity 88%** | [FlightCamera.ts:14-16](../src/render/FlightCamera.ts#L14-L16) | เปิด/ปิดตามปุ่ม C; ตอน nose-pointing มองไม่เห็นว่าหัวชี้เป้า |
| B18 | **Feedback ขาด** | ไม่มี audio, buffet, shake, velocity vector marker; stall warning ปิดตาม phase | ผู้เล่นอ่าน state ไม่ออก |
| B19 | **Docs ไม่ตรง code** | `02-controls.md` ตารางยังเป็น Z=PSM; `04-maneuvers.md` มี budget/cooldown | ต้อง update พร้อมกัน |

**ที่ดีอยู่แล้ว ไม่ใช่ปัญหา:** ไม่มี auto-level; ไม่มี maneuver animation; TVC geometry/actuator/exhaust/rig ผูกกับ sim; vapor เป็น state-driven; replay determinism; `screenFrame` อ่าน attitude ไม่ใช่ camera (กัน feedback loop); airbrake ไม่ตัด thrust

---

## C. What Should Change

### C1. หลักการ

**Continuous envelope + single rate controller + aero moments + explicit recovery layer**; phase-like labels ใช้เฉพาะ HUD/camera/FX/detection

### C2. ระบบที่ควร **แก้**

| ระบบ | เปลี่ยนอะไร |
|---|---|
| `stepFlight.ts` | แยกเป็น pipeline (C3); ลบ `m.phase` ออกจากทุกสูตร physics; `grip` → มาจาก lift curve ตาม incidence; rate blend → มาจาก envelope factors |
| `thrustVectoring.ts` | ลบ `maneuver` term; เพิ่ม `tvcMomentCapacity(profile, thrust)` คำนวณ max angular accel ต่อแกนจาก `thrustForces` ที่ full deflection → capability มาจาก geometry (F-22 yaw TVC = 0 เอง) |
| `speed.ts` | เพิ่ม `engine.spool` state (0..1 dry, burner flag) ที่มี spool-up/down; thrust สำหรับ TVC ใช้ spool ไม่ใช่ trim ชั่วขณะ; ย้าย 38/30 เข้า profile |
| `stall.ts` | เปลี่ยนจาก gate เป็น **airflow separation** ต่อเนื่องตาม incidence vs `alphaCriticalDeg` ต่อลำ; speed stall กลายเป็นผลของ q ต่ำ ไม่ใช่ threshold แยก; คง `angleOfAttack` ไว้ (ดีอยู่แล้ว) |
| `FlightInput.ts` | ลบ C/High-G; Space = airbrake; frame blend ต่อเนื่อง; Q/E ramp |
| `FlightCamera.ts` | `cinematic` → driven by decoupling angle; ลด velocity-look share; lag/roll damping ตาม regime |
| `profileTypes.ts` + profiles | schema ใหม่ (G) |
| `telemetry.ts`, `hudPainter.ts`, `PlaygroundHud.tsx`, locales | ใช้ regime label; ลบ PSM speed band; เพิ่ม velocity vector marker |

### C3. ระบบที่ควร **แยก / เพิ่ม**

```
src/game/flight/
  envelope.ts      (ใหม่)  state + profile → EnvelopeFactors (pure, ไม่มี side effect)
  engine.ts        (แยกจาก speed.ts) autothrottle + spool + burner budget
  controller.ts    (แยกจาก stepFlight) stick → desired body rates, limiter, allocation aero/TVC
  aerodynamics.ts  (ใหม่)  restoring moment, damping, lift curve (path force), AoA/β drag
  recovery.ts      (ใหม่)  input-activity → recovery weight → damping / nose↔path blend
  thrustVectoring.ts (คง)  actuator + geometry; รับ requested angles จาก controller
  stepFlight.ts    (บางลง) ลำดับการเรียก + integrator + energy guard + terrain
  feedback.ts      (ใหม่)  state → FlightFeedback สำหรับ camera/FX/audio/HUD (pure)
  maneuverDetector.ts (ภายหลัง) observer อ่านย้อนหลัง ไม่เขียน physics
src/audio/         (ใหม่)  engine/wind/buffet จาก FlightFeedback
```

### C4. ระบบที่ควร **ลบ / ลดความสำคัญ**

- `PilotCommand.psmArm`, `PilotCommand.highG` (replay format change → bump version)
- `ManeuverState.phase/armed/timer/rotation/stable/entrySpeed/exitSpeed/blocked` → เหลือเป็น telemetry label ที่ derive ได้
- `ManeuverProfile.entryMin/entryMax/exitSpeed/minAltitude/psmEnabled/activeGrip/recoveryGrip`
- `highG` envelope แยก → รวมเข้า limiter breakout (E)
- `neutralDampingDuringPsm` → แทนด้วย `aero.damping` + `recovery` params
- `turnLoss × 0.55` ใน PSM
- `m.completed` (peakAlpha ≥ 70) → ย้ายไป detector
- `FlightInput.psmControl` + การ set ใน [FlightScene.tsx:69](../src/render/FlightScene.tsx#L69)

**คงไว้:** mouse positional stick, `screenFrame` หลักการอ่าน attitude, `angleOfAttack`, TVC geometry/actuators/rigs/exhaust, burner budget (เป็น cost ของ PSM), scalar-speed energy guard (แต่เพิ่มค่าใช้จ่ายของ path rotation ที่ q ต่ำ), fixed-step + `1 - exp(-k·dt)` ทุก blend

---

## D. Proposed Flight Regimes — Continuous, ไม่ใช่ State Machine

### D1. ทำไม continuous

1. Code มี blend ต่อเนื่องอยู่แล้ว (blend, grip, severity, tvcAuthority) — ปัญหาคือ key ไม่ใช่ตัวแปร
2. State machine ต้องมี threshold + hysteresis + timer → เกิด "เส้น" ที่ผู้เล่นรู้สึกได้ (B4, B12) และ edge case (recovery→active)
3. Maneuver แบบ improvise (Herbst ที่ยังไม่ถึง post-stall, Kulbit ที่ recover กลางทาง) อยู่ "ระหว่าง" state
4. Determinism ง่ายกว่า: pure function ของ state + profile

### D2. EnvelopeFactors (คำนวณทุก substep)

```ts
interface EnvelopeFactors {
  q: number            // (speed / aero.referenceSpeedMps)², clamp 0..1.5 — aero authority
  alpha: number        // signed pitch-plane AoA (deg) จาก angleOfAttack()
  beta: number         // sideslip (deg)
  incidence: number    // มุมรวม nose↔velocity (deg)
  separation: number   // 0..1 smoothstep(alphaCritical, alphaCritical+width, incidence), time-smoothed
  highAoa: number      // 0..1 smoothstep(normalAlphaLimit, alphaCritical, incidence)
  limiterOpen: number  // 0..1 ดู D3
  alphaLimit: number   // lerp(normalAlphaLimit, maxControllableAlpha, limiterOpen)
  aeroAvail: Axes      // q · aero.authority[axis] · lerp(1, postStallAeroFraction, separation)
  tvcAvail: Axes       // spool · tvcMomentCapacity[axis] · (1 + burner·tvc.burnerGain)
  assist: number       // 1 - max(highAoa·fcs.highAoaAssistFade, separation)
  recovery: number     // จาก recovery.ts
}
```

### D3. Limiter breakout (แทนปุ่ม C และ High-G)

- `demand = |stick pitch/yaw|`
- ถ้า `demand > fcs.breakoutThreshold` (~0.85) → `limiterOpen` เพิ่มด้วยอัตรา `1 / fcs.breakoutSeconds` (~0.15–0.3 s)
- Shift (burner) ขณะ `q` ต่ำ → เพิ่มอัตรา breakout (`fcs.burnerBreakoutGain`)
- Airbrake → ลด q เร็ว → เข้า regime ง่ายขึ้นทางอ้อม (ไม่มี special case)
- Demand ต่ำกว่า threshold → ปิดเร็ว (`fcs.limiterCloseSeconds`)
- **ผลลัพธ์ขึ้นกับ q**: q สูง → breakout = High-G (G มากขึ้น drag มาก, AoA ยังจำกัดโดย structural G); q ต่ำ → breakout = high AoA → post-stall ถ้า capability พอ
- F-16: `maxControllableAlpha` ≈ normal limit → breakout แทบไม่ให้อะไร (ไม่ต้องมี flag)

### D4. Regime labels (presentation only, มี hysteresis)

| Label | เงื่อนไข (ตัวอย่าง) | ผู้ใช้ |
|---|---|---|
| `NORMAL` | highAoa < 0.2 | — |
| `HIGH_AOA` | highAoa ≥ 0.2, separation < 0.5 | HUD tone, vapor, buffet เบา |
| `POST_STALL` | separation ≥ 0.5 | HUD `PSM`, camera, audio |
| `RECOVERING` | recovery > 0.3 และ (highAoa หรือ separation) > 0 | HUD hint |
| `DEPARTED` | separation สูง + yaw rate > threshold + recovery ทำไม่ทัน | warning |

**ห้าม physics อ่าน label** — อ่าน factors เท่านั้น

### D5. Maneuver ที่ควรเกิดเอง (ใช้เป็น acceptance test)

| ท่า | กลไกที่ทำให้เกิด |
|---|---|
| Cobra | ดึงสุด (breakout) → TVC+aero หมุนหัว → ปล่อย stick → restoring moment + recovery damping หัวตกกลับ; velocity ยังไปข้างหน้า (lift ต่ำที่ separation) |
| Kulbit | ดึงค้าง → TVC capacity > restoring moment ที่ q ต่ำ → หมุนเกิน 180°; เครื่องไม่มี TVC ทำไม่ได้เพราะ `aeroAvail ∝ q` |
| Herbst / J-Turn | high AoA + roll → roll axis blend ไปทาง velocity vector → หัวกวาดรอบ momentum |
| Pedal turn | post-stall + yaw (TVC yaw capacity หรือ aero yaw ที่ q ต่ำ) |
| Falling Leaf | separation + yaw damping ต่ำ + gravity + สลับ yaw |
| Tail Slide | ขึ้นตรง → speed → 0 → gravity กลับทิศ velocity (มีอยู่แล้ว) → restoring moment ที่ incidence ≈180° เป็น unstable → หัวสะบัดลง |

---

## E. Input Mapping

**เป้าหมาย: ลดปุ่ม flight จาก 5 modifier (W/S/X/Space/Shift/C) เหลือ 4 (W/S/Space/Shift)**

| Input | ปัจจุบัน | เสนอ | เหตุผล |
|---|---|---|---|
| Mouse | positional stick → pitch/roll rate | **คงเดิม** เป็น rate stick; frame blend ต่อเนื่องจาก `screenFrame.blend × (1 - highAoa)`; stick เต็ม = limiter breakout | Rate stick ทำให้ "ดึงค้าง = Kulbit / ดึงแล้วปล่อย = Cobra" เกิดเองได้ (ดู decision 1) |
| Mouse X ที่ high AoA | body roll | roll axis = `slerp(bodyX, velocityDir, fcs.velocityRollBlend(highAoa))`; post-stall ค่อยกลับ body บางส่วนตาม profile | Herbst สวย, ไม่ spin มั่ว |
| A / D | digital roll | คง + ramp เล็กน้อย | — |
| Q / E | digital yaw ทันที | **ramp** ~0.15–0.25 s ถึงเต็ม; normal ใช้ coordination; post-stall เป็น yaw rate command | Pedal turn/Falling Leaf คุมได้ |
| W | acceleration request | คง; ใน post-stall ผลจริงคือ spool ขึ้น → TVC authority | ไม่ต้องสอนปุ่มใหม่ |
| S | deceleration request | คง; spool ลด → TVC authority ลด (skill tension: ใช้ Space แทนถ้าต้องการชะลอแต่รักษา TVC) | Skill expression ที่เข้าใจได้ |
| Space | **High-G** | **Airbrake** (ตาม design) | High-G ถูกรวมเข้า breakout |
| X | Airbrake | ว่าง (สำรอง flare/อื่นๆ) | — |
| Shift | Afterburner (speed + ทางอ้อม authority) | **Contextual**: q สูง = accel; q ต่ำ/high AoA = spool max ทันที + `tvc.burnerGain` + breakout เร็วขึ้น; post-stall = attitude authority + recovery thrust; ใช้ burner reserve เดิมเป็น cost | ข้อ 3 ของ design; link มีอยู่แล้ว แค่ทำให้ชัด |
| C | PSM arm | **ลบ** (อาจเก็บเป็น debug "limiter off" ใน Playground) | ข้อ 1 |

Beginner path: Space + Shift + ดึง mouse สุด → เกิด post-stall สวยๆ ได้ทันที
Intermediate: รู้ว่าไม่ต้อง Space ถ้าช้าพอ, รู้จังหวะปล่อย stick
Advanced: Q/E + roll ที่ high AoA, คุม spool ด้วย W/S, ทำ reversal/gun solution

---

## F. Responsibilities (กัน controller สู้กันเอง)

(เขียนในรูป moment เพื่อความชัด — การ implement แนะนำให้แปลงเป็น bias ของ rate target ดู Decision 5)

**กฎหลัก: มีผู้สร้าง angular acceleration แค่ 3 แหล่ง — Controller (ผ่าน moment ที่ allocate), Aerodynamics (restoring + damping), Recovery (damping + nose-to-path) — รวมกันครั้งเดียวต่อ step แล้ว clamp ด้วย `aeroAvail + tvcAvail`**

| Layer | ทำ | ไม่ทำ |
|---|---|---|
| **Player Input** (`FlightInput`) | อ่านปุ่ม/stick → normalized `PilotCommand`; frame correction; key ramp | ไม่รู้ regime, ไม่แก้ physics |
| **Envelope** (`envelope.ts`) | คำนวณ factors D2 จาก state + profile | ไม่เขียน state นอกจาก smoothed `separation`/`limiterOpen` |
| **Flight Controller** (`controller.ts`) | stick → desired body rate; G/AoA limiter (soft, เปิดด้วย breakout); turn coordination × `assist`; roll axis blend; **allocate** moment: aero ก่อน (∝ q) แล้ว TVC ส่วนที่เหลือ → requested nozzle angles | ไม่ดึงหัวกลับเอง, ไม่ใส่ damping ตอน stick นิ่ง (เป็นหน้าที่ Aero/Recovery) |
| **TVC** (`thrustVectoring.ts`) | actuator travel ของ requested angles; thrust direction force; ค่า capacity จาก geometry | ไม่ตัดสินว่าจะ vector เมื่อไร (controller สั่ง) |
| **Aerodynamics** (`aerodynamics.ts`) | restoring moment `-stability·q·sin(α/β)`; damping `-damping·q·rate`; lift curve → path force; AoA/β drag | ไม่ขึ้นกับ input |
| **Stability Assist** (ใน controller, × `assist`) | rate hold, coordination, sideslip ลดใน normal | fade ออกตาม highAoa/separation |
| **Recovery Assist** (`recovery.ts`) | ทำงานเมื่อ input activity ต่ำ **และ** อยู่นอก normal envelope: damping เพิ่ม, nose→path torque (สูงเมื่อ q ต่ำ), path→nose force (สูงเมื่อ q สูง, จำกัดด้วย lift + thrust, **คิด drag**), anti-spin | ไม่ทำงานขณะผู้เล่นยังสั่ง; ไม่ snap; ไม่ทำให้ reversal ฟรี |
| **Integrator** (`stepFlight.ts`) | รวม moment/force, orientation, velocity, energy guard, gravity support ∝ lift | ไม่มีสูตร tuning |
| **Camera** (`FlightCamera.ts`) | อ่าน `FlightFeedback` แสดง drift/rotation | **ห้ามป้อนกลับ input** (คงหลัก `screenFrame` อ่าน attitude) |

### Recovery assist รายละเอียด

- `activity` = smoothed max(|pitch|,|yaw|,|roll|) — attack เร็ว, release `recovery.delaySeconds` (~0.15–0.25 s) เพื่อให้ restoring moment ธรรมชาติทำงานก่อน (Cobra ยังดูเป็น physics)
- `recovery = (1 - activity) · max(highAoa, separation)`
- Nose↔path split ตาม q: q ต่ำ → หัวหมุนเข้าหา velocity มากกว่า (ความเร็วน้อยหมุน velocity ไม่ได้); q สูง → velocity หมุนเข้าหาหัว
- Path rotation ที่ q ต่ำคิด drag เพิ่ม (แก้ B15) — acceptance: Cobra-180 แล้วปล่อยต้องไม่ได้ความเร็ว > ก่อนปล่อย และ path turn rate ≤ `recovery.maxPathRate`
- ใช้ time constant `k = 3 / recovery.seconds` → ~95% ใน `seconds` (target 0.5–1.5 s ตามลำ)
- Anti-spin: yaw/roll rate > threshold ขณะ recovery → damping × `departureResistance`

---

## G. Aircraft Configuration

### G1. Schema ที่เสนอ

```ts
interface AircraftFlightProfile {
  flight: FlightProfile            // คงส่วน speed/energy/normal rates เดิม (reuse)
  engine: {
    spoolUpSeconds: number; spoolDownSeconds: number
    burnerAcceleration: number     // เดิม hardcode 38
    burnerSeconds: number; burnerRecharge: number   // ย้ายจาก maneuver
    airbrakeDeceleration: number   // เดิม hardcode 30
    postStallSpoolPenalty: number  // 0..1 ลด accel ชั่วคราวหลัง separation
  }
  aero: {
    referenceSpeedMps: number      // q = 1
    cornerSpeedMps: number         // แทน 90/160 hardcode
    normalAlphaLimitDeg: number    // FCS limit ปกติ
    alphaCriticalDeg: number       // เริ่ม separation (แทน stall.criticalAoaDeg)
    separationWidthDeg: number
    maxControllableAlphaDeg: number
    postStallLiftFraction: number
    postStallAeroFraction: number  // aero control ที่เหลือหลัง separation
    authority: Axes                // rad/s² ที่ q = 1
    stability: { pitch: number; yaw: number }
    damping: Axes
    alphaDrag: number; sideslipDrag: number
    stallSpeedKph: number          // คงไว้สำหรับ HUD/low-q warning
  }
  fcs: {
    breakoutThreshold: number; breakoutSeconds: number; limiterCloseSeconds: number
    burnerBreakoutGain: number
    highAoaAssistFade: number
    velocityRollBlend: number      // 0 = body roll, 1 = velocity-vector roll ที่ high AoA
    postStallRates: Axes           // เพดาน rate command (ไม่ใช่ authority)
    coordination: number
  }
  thrustVectoring: ThrustVectoringProfile | null   // คงเดิม + burnerGain
  recovery: {
    delaySeconds: number; seconds: number
    damping: number; noseToPath: number; pathToNose: number
    maxPathRate: number; departureResistance: number
  }
}
```

ย้าย: `stall.*` → `aero`; `maneuver.highG*` → ลบ (breakout ใช้ `flight.turnAcceleration` × `fcs`); `maneuver.burner*` → `engine`; ลบ `psmEnabled`

### G2. Personality (ทิศทางเชิงเปรียบเทียบ ยังไม่ใช่ตัวเลข)

ค่าอ้างอิงปัจจุบันเพื่อ calibrate: PSM pitch 2.6 rad/s (~149°/s), yaw 1.6–1.85, roll 2.1; TVC maxAngle 20 (F-22) / 18 (Su-57)

| | F-22 | Su-57 | Su-35 | F-35 | F-14 | F-16 | F/A-18 |
|---|---|---|---|---|---|---|---|
| TVC | 2D pitch (yawGain 0) | 3D canted | 3D canted | ไม่มี | ไม่มี | ไม่มี | ไม่มี |
| maxControllableAlpha | สูงมาก | สูงมาก | สูงมาก | กลาง-สูง | กลาง | ต่ำ (≈ normal limit) | สูง (aero) |
| Pitch post-stall | สูงมาก | สูง | สูงมาก | กลาง | ต่ำ | ต่ำมาก | กลาง-สูง |
| Yaw post-stall | กลาง (aero เท่านั้น) | สูงมาก | สูง | ต่ำ | ต่ำ | ต่ำมาก | สูงที่ q ต่ำ (rudder) |
| velocityRollBlend | สูง (FCS แม่นยำ) | กลาง (อิสระ) | กลาง | สูง | ต่ำ | สูง | สูง |
| Pitch stability (restoring) | กลาง | ต่ำ (หมุนต่อได้ง่าย) | ต่ำ-กลาง | สูง | สูง | สูงมาก | กลาง |
| Recovery seconds | สั้น (~0.6) | กลาง (~1.0) | กลาง-ยาว | สั้น | ยาว | สั้น (ไม่ค่อยได้ใช้) | กลาง |
| departureResistance | สูง | กลาง | กลาง | สูง | ต่ำ (adverse yaw) | สูง | สูง |
| alphaDrag / energy loss | กลาง | กลาง | สูง | กลาง | สูง | ต่ำ | สูง |
| Engine/accel | สูง | สูง | กลาง | กลาง | กลาง | สูง (energy fighter) | ต่ำ-กลาง |

F-14 อาจต้อง param เพิ่มภายหลัง (`adverseYawAtHighAoa`) — ทำเมื่อมี model จริง

---

## H. Implementation Plan

ข้อบังคับทุก phase:
- Bump `flightProfileVersion` ([profile.ts:7](../src/game/flight/profile.ts#L7)) — `tests/flightHandling.test.ts` ตรวจว่า replay เก่าถูกปฏิเสธ
- ทุก blend ใช้ `1 - Math.exp(-k·dt)`; ต้องผ่าน determinism 30/60/144 FPS
- Tests ที่กระทบ: `poweredPsm`, `maneuvers`, `thrustVectoring`, `stall`, `flightHandling`, `profiles`, `flightProfileConfig`, `hud`

### Phase 0 — Instrument (เล็ก)
- เพิ่ม debug overlay: incidence, α, β, q, spool, TVC capacity, factors (ใน `PlaygroundHud.tsx`)
- Scripted command tracks สำหรับ Cobra/180°/tail slide ที่ใช้เทียบก่อน-หลัง (ใช้ replay export เดิม)
- **ไฟล์:** `src/features/flight/PlaygroundHud.tsx`, `tests/` (golden traces)

### Phase 1 — Foundation (ไม่เปลี่ยน feel มาก)
1. ลบ phase term ใน `tvcAuthority` ([thrustVectoring.ts:15](../src/game/flight/thrustVectoring.ts#L15)) — anchor ที่พิสูจน์แนวทาง
2. สร้าง `envelope.ts` (factors D2) ขณะยังคง `phase` อยู่ แต่ให้ `grip`, `gravityBlend`, camera `cinematic` อ่าน factors แทน phase ได้
3. แยก `engine.ts` จาก `speed.ts` + spool state ใน `AircraftState`; ย้าย hardcode (38, 30, corner 90/160, lateral 55, psmDrag 0.0025, High-G 75–190, recovery 17°/60) เข้า profile
4. Mouse frame blend ต่อเนื่องแทน `LEVEL_FRAME` switch
- **ไฟล์:** `thrustVectoring.ts`, `stepFlight.ts`, `speed.ts` → `engine.ts`, `envelope.ts`, `profileTypes.ts`, `validateProfile.ts`, `content/flight-profiles/*`, `WorldState.ts`, `GameRuntime.ts`, `FlightInput.ts`, `FlightScene.tsx`, `game/playground/replay.ts` (ตรวจ `profileVersion`)
- **ผู้ใช้ schema ที่จะ compile พังเมื่อเปลี่ยน G1:** `features/hangar/FlightProfilePanel.tsx`, `features/flight/FlightInstruments.tsx`, `features/flight/PlaygroundHud.tsx`, `features/flight/FlightPage.tsx`, `features/flight/hudPainter.ts`, `render/vapor/preview.ts`, `content/schemas.ts`, `game/playground/practice.ts`, locales

### Phase 2 — High-AoA + TVC allocation
1. `aerodynamics.ts`: restoring moment, q-damping, AoA/β drag (แก้ B3, B14)
   - **ต้องแก้ neutral-stick path พร้อมกัน**: ตอนนี้ stick กลาง = rate target 0 ด้วย `neutralResponse 9` ([stepFlight.ts:46](../src/game/flight/stepFlight.ts#L46)) ที่ 120 Hz ดึง rate เข้า 0 ราว 7% ต่อ substep → restoring moment `a` เหลือ terminal rate แค่ ≈ `a/9` (หัวค้างที่ α 40° แทบไม่ตก) controller ต้องการ "rate → 0" แต่ aero ต้องการ "α → 0" = สองชั้นสู้กัน ดังนั้นใน Phase 2 ให้ neutral damping จางลงตาม `highAoa/separation` และย้าย damping ไปที่ `aero.damping` + `recovery` (ลบ `neutralDampingDuringPsm` ใน phase นี้ ไม่ใช่ Phase 3)
2. `controller.ts`: soft AoA limiter + breakout (D3); allocate aero → TVC; requested nozzle angles มาจาก allocation → รวม double-count guard ([stepFlight.ts:57-70](../src/game/flight/stepFlight.ts#L57-L70)) ให้เป็นจุดเดียว (ส่วนนี้ load-bearing และมี test — ทำพร้อม test ใหม่)
3. `tvcMomentCapacity` จาก `thrustForces`
4. Stall → separation (แก้ B2)
5. Velocity-vector roll blend
6. Shift contextual (`burnerGain`, breakout gain)
- **ไฟล์:** `aerodynamics.ts`, `controller.ts`, `thrustVectoring.ts`, `stall.ts`, `stepFlight.ts`, profiles, tests

### Phase 3 — Post-stall freedom (ลบปุ่ม)
1. Lift curve หลัง separation → path force (แทน activeGrip/recoveryGrip)
2. Gravity support ∝ lift (แทน `0.5·(1-grip)`)
3. ลบ `psmArm`, `highG` จาก `PilotCommand` (replay format change); ลบ phase machine / entry band
4. Input: Space = airbrake, ลบ C, Q/E ramp
5. ตรวจ tail slide / reverse flow ใน energy guard
- **ไฟล์:** `commands.ts`, `FlightInput.ts`, `maneuvers.ts` (ลดเหลือ burner/airbrake หรือย้ายไป engine), `stepFlight.ts`, `practice.ts`, `tests/maneuvers.test.ts`, `tests/poweredPsm.test.ts`, locales, `docs/game-design/02-controls.md`

### Phase 4 — Recovery assist
1. `recovery.ts` (F) + anti-spin
2. Acceptance tests: Cobra ปล่อย stick → incidence < `normalAlphaLimit` ภายใน `recovery.seconds × 1.5`; ไม่มี free reversal (speed/heading check); ไม่มี spin ค้าง; ผู้เล่นที่ยังสั่งอยู่ไม่ถูกแย่ง
- **ไฟล์:** `recovery.ts`, `stepFlight.ts`, profiles, tests ใหม่ `tests/recovery.test.ts`

### Phase 5 — Camera / FX / Audio / HUD
1. `feedback.ts`: `{ regime, incidence, decouple, buffet, separation, spool, tvcDeflection, recovery }`
2. Camera: `cinematic` → `decouple`; velocity-look share ~0.35–0.5 (จาก 0.88) ให้แนวปืนยังอยู่ในจอ; offset lag เพิ่มตาม decouple เพื่อให้เห็นเครื่องหมุนในเฟรม; up smoothing ช้าลงตอน rate สูง (กันเวียนหัวใน Kulbit); FOV +3–5 ตาม decouple; buffet shake (0 เมื่อ reducedMotion)
3. HUD: velocity vector marker (สำคัญมากสำหรับ PSM), regime tone, stall/departure warning ตาม label ไม่ใช่ phase; ลบ PSM speed band
4. Vapor/vortex: เพิ่ม `separation`/β เข้า conditions
5. Audio (ใหม่): engine spool/burner, wind ∝ q, buffet rumble ∝ separation, nozzle actuator whine เบาๆ
- **ไฟล์:** `FlightCamera.ts`, `FlightEffects.tsx`, `vapor/conditions.ts`, `hudPainter.ts`, `FlightInstruments.tsx`, `PlaygroundHud.tsx`, `telemetry.ts`, `src/audio/*`, locales

### Phase 6 — Aircraft tuning
1. F-22 vs Su-57 ให้ต่างชัดตาม G2
2. เพิ่ม profile ลำอื่นเมื่อมี model/rig (`content/aircraft/index.ts` ต้องมี `modelFile` + `presentationId` rig)
3. Playtest matrix: beginner combo, reversal จาก 400/600/900 arcade km/h, gun solution time
- **ไฟล์:** `content/flight-profiles/*`, `docs/flight-profiles.md`

### Phase 7 (ภายหลัง) — Maneuver detection
`maneuverDetector.ts` อ่าน history (incidence peak, pitch rotation, velocity heading change, recovery) → label COBRA/KULBIT/… สำหรับ UI/score/tutorial เท่านั้น

---

## Decisions ที่ต้องให้เจ้าของเกมตัดสิน

1. **Mouse model** — design ระบุ "cursor = desired direction ให้ nose chase" และใน post-stall "mouse = desired nose orientation" แต่ code เป็น **rate stick** (ตำแหน่ง = อัตราหมุน) แนะนำ: **คง rate stick** เหตุผลชี้ขาด: **position target ที่มีขอบเขตแทนการหมุนต่อเนื่องเกิน 180–360° ไม่ได้ → Kulbit เป็นไปไม่ได้โดยโครงสร้าง** และ Cobra ("ดึงแล้วปล่อย") ต้องการ stick ที่กลับศูนย์ได้ ถ้าต้องการ nose-chases-cursor ให้ทำเป็น preset แยกสำหรับ normal flight ภายหลัง
5. **Rate-based vs moment-based controller** — code ปัจจุบันเป็น rate-target (`rates += (target - rates)·response`) ส่วน F เขียนแบบ moment-sum แนะนำ: **คง rate-based** แล้วให้ aero/recovery ทำงานเป็น bias ของ rate target และ response rate (reuse response/counter/neutral + determinism tests ได้เกือบหมด) เปลี่ยนเป็น moment-based เฉพาะถ้า playtest พบว่า Cobra recovery / Falling Leaf รู้สึก "หนืด" — เพราะนั่นคือการ rewrite flight core
2. **High-G** — แนะนำรวมเข้า limiter breakout (stick เต็ม) เพื่อคืน Space ให้ airbrake
3. **Airbrake key** — Space (ตาม design) แทน X
4. **ลำดับ** — Phase 1–2 ยังคง C ไว้ได้ระหว่าง tuning; ลบใน Phase 3 เมื่อ breakout พิสูจน์แล้ว
