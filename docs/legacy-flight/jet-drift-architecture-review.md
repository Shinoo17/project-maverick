# Jet Drift / Implicit PSM — Architecture Review

> 21 ก.ย. 2026 · อ้างอิง code ที่ commit `999dc9c` (Phase 4 เสร็จ) · **วิเคราะห์อย่างเดียว ยังไม่แก้ code**
> ต่อยอดจาก [psm-architecture-review.md](psm-architecture-review.md) (Rev. 2 baseline) และ [psm-implementation-plan.md](psm-implementation-plan.md) (Rev. 3 final baseline)
> ตัวเลขทุกตัวในเอกสารนี้มาจากการอ่าน code จริงหรือจากการรัน harness จริง ไม่ใช่การประมาณ

---

## สรุปผู้บริหาร

**คำตอบข้อ 10 คือ B — เก็บรากฐานไว้ทั้งหมด แล้วผ่าตัดจุดเดียว**

สถาปัตยกรรมปัจจุบันเป็น continuous อยู่แล้วเกือบทั้งระบบ และ **ไม่มีที่ใดใน code ที่ตรวจจับหรือเข้ารหัสท่า Cobra / Kulbit / J-turn / Tailslide เลย** — สิ่งที่ใกล้เคียงที่สุดคือ phase machine ใน [maneuvers.ts](../src/game/flight/maneuvers.ts) ซึ่งเป็น legacy ที่แผน Rev. 3 กำหนดให้ลบใน Phase 6 อยู่แล้ว ดังนั้นเป้าหมาย "Physics + Player Input → Emergent Maneuver" ไม่ได้ขัดกับ code ปัจจุบัน แต่เป็นทิศทางเดียวกับที่ระบบเดินมาแล้ว 4 phase

ปัญหาที่แท้จริงมีข้อเดียว และวัดเป็นตัวเลขได้:

> **การจับคู่ velocity เข้ากับหัวเครื่อง ถูกควบคุมด้วย `stall.severity` (separation memory) ไม่ใช่ด้วยมุมการไหลที่วัดได้จริง**
> ผลคือเกิดวงจรอุดตัน: ต้องมี separation ก่อน velocity ถึงจะยอมหลุดจากหัว แต่ separation เกิดจาก pitch-alpha เกิน 20° ซึ่งเกิดไม่ได้เพราะ velocity ยังถูกดึงเข้าหาหัวอยู่

### ตัวเลขฐานที่วัดได้ (harness `runTrack`, setup แบบ `fullStick500`, pitch = 1 ค้าง, ไม่กดอะไรอื่น)

| ความเร็วเข้า (arcade km/h) | F-22 incidence คงตัว | limiterOpen สูงสุด | separation |
|---|---|---|---|
| 900 | **3.8°** (นิ่งตั้งแต่ 1.25 s) | 0.00 | 0.00 |
| 650 | 4.0–4.5° | 0.13 | 0.00 |
| 500 | 4.2° ที่ 1 s | 0.20 | 0.00 จนถึง 3.5 s |
| 400 | 9.1° ที่ 2 s | 0.20 | เริ่มขึ้นหลังความเร็วตกใต้ 340 |

**ที่ความเร็วเข้า 400 arcade km/h ขึ้นไป การดึงคันบังคับสุดแรงเกิดอย่างเดียวไม่เคยสร้าง incidence ถึง 10° เลย** ในขณะที่ประตู breakout เริ่มที่ `alphaNormalDeg` = 20° ([defaults.ts:20](../src/content/flight-profiles/defaults.ts#L20)) แปลว่าเส้นทาง "ดึงอย่างเดียวแล้วหัวหลุดจาก velocity" ไม่มีอยู่จริงเหนือ 400 km/h (ใต้ 350 km/h เป็นคนละกลไก: `lowSpeed` ใน [stall.ts:25](../src/game/flight/stall.ts#L25) สร้าง separation ให้เองโดยไม่ต้องพึ่งมุม — Su-57 ที่ 300 km/h ดึงอย่างเดียวถึง 69° ได้ แต่นั่นคือการตกไม่ใช่การ drift)

เมื่อเพิ่ม X + Shift (brake + burner):

| | F-22 500 km/h | Su-57 400 km/h |
|---|---|---|
| `limiterOpen` ถึง 1.0 | 0.75 s | 0.75 s |
| incidence ผ่าน 20° | 1.75 s | 1.4 s |
| incidence สูงสุด | 70.7° ที่ 4 s | 63° ที่ 3.25 s |
| ความเร็วที่เหลือตอนนั้น | 251 km/h (เสียไป 50%) | 203 km/h (เสียไป 49%) |

และการทดสอบ drift จริง (ดึง + X + Shift 1.5 s แล้วเปลี่ยนเป็น yaw ค้าง + Shift):

| | beta สูงสุด | ช่วงที่ beta > 20° |
|---|---|---|
| F-22 (400 เข้า) | **−4.3°** | ไม่มี |
| Su-57 (400 เข้า) | **41.4°** | ประมาณ 1.7 s (3.0–4.7 s) |
| F-22 / Su-57 (500 เข้า) | −2.0° / −2.6° | ไม่มี |

สรุปสภาพปัจจุบัน: **มีเครื่องเดียวที่ drift ได้จริงคือ Su-57 ที่ความเร็วเข้าต่ำกว่าราว 400 km/h ได้ประมาณ 1.7 วินาที และต้องแลกด้วยพลังงานครึ่งหนึ่ง** F-22 ทำ post-stall ในระนาบ pitch ได้ (incidence ถึง 91°) แต่ไถลข้างไม่ได้เลยเพราะ `yawGain: 0` ([f22.ts:7](../src/content/flight-profiles/f22.ts#L7))

ข้อดีที่พบโดยไม่คาดคิด: **"afterburner ดึงตัวออกจาก drift" ทำงานอยู่แล้ว** — ในการวัด F-22 ที่ 500 พอปล่อย airbrake แล้วคา Shift ไว้ incidence ยุบจาก 18° เหลือ 2° ภายใน 1 วินาที และความเร็วไต่กลับขึ้นไป 1308 km/h ใน 6 วินาที นี่คือ slingshot recovery ที่ข้อเสนอต้องการ และเกิดขึ้นเองจาก physics ที่มีอยู่แล้ว ไม่ต้องเขียนเพิ่ม (แต่ตอนนี้ *แรงเกินไป* — ดูความเสี่ยง R7)

---

## 1. สถาปัตยกรรมปัจจุบันทำงานอย่างไร

### 1.1 ลำดับต่อ substep (120 Hz)

ทุกอย่างอยู่ใน [stepFlight.ts:22-138](../src/game/flight/stepFlight.ts#L22-L138) เรียงตามนี้

```
observeAirflow(state, profile)                  airflow.ts:38     วัดล้วน: airspeed, alphaDeg, betaDeg, incidenceDeg, q, confidence
  ↓
stepStall()                                     stall.ts:30       severity memory (entry 0.4 s / recovery 1.2 s)
stepManeuvers()                                 maneuvers.ts:26   legacy phase + highG + airbrake smoothing + burner
measureControlDemand()                          controller.ts:15  speedAuthority, normalLimit, lift, surfaceControl, saturationRatio
readIntent()                                    intent.ts:17      D, S, T, B, Pi จาก PilotCommand ล้วน
stepEnvelope()                                  envelope.ts:51    E, H, permission → limiterOpen → alphaLimitDeg, gAllowance
  ↓
aeroFlowEffectiveness()                         aerodynamics.ts:37   จาก incidenceDeg + confidence ล้วน
naturalAerodynamics()                           aerodynamics.ts:64   restoring, damping, alphaDrag, betaDrag
stepSpeed()                                     speed.ts:17          governor → spool → actualThrust, braking
computeBudget()                                 authority.ts:19      physicalAero = q · confidence · effectiveness · controlAcceleration
requestControl()                                controller.ts:35     target rate → request + servoDamping
allocate()                                      allocation.ts:18     request ∩ budget → aero / tvc / floor / unmet
solveTvcAngles() → stepThrustVectoring()        thrustVectoring.ts:144, 22
  ↓
rates += (controller + actualTvc + restoring + damping) · dt      stepFlight.ts:66
orientation = orientation ⊗ Δq(rates · dt)                        stepFlight.ts:87-92
  ↓
path / lateral / normalLateral / anticipation                     stepFlight.ts:93-114     ← จุดที่ velocity ถูกผูกกับหัว
drag scalar + engineForce                                         stepFlight.ts:115-120
integrateTranslation()                          engineForces.ts:18  path rotation + energy guard + gravity
  ↓
telemetry: m.alpha / m.pathRate / m.g                             stepFlight.ts:129-131
```

### 1.2 ชั้นที่แยกกันชัดเจนแล้ว (ตาม §0 ของแผน Rev. 3)

- `AirflowState` = สังเกตล้วน ไม่มี gameplay ([airflow.ts:8-22](../src/game/flight/airflow.ts#L8-L22))
- `PilotIntent` = input ผู้เล่นล้วน ห้ามอ่าน capability ([intent.ts:17](../src/game/flight/intent.ts#L17))
- `AuthorityBudget` = ความสามารถล้วน ห้ามอ่าน command ([authority.ts:19](../src/game/flight/authority.ts#L19))
- `EnvelopeFactors` = permission ล้วน ค่าจริงถูก clamp ด้วย budget เสมอ ([envelope.ts:7-18](../src/game/flight/envelope.ts#L7-L18))
- `envelopeLabel()` และ `stall.cause` เป็น observer อย่างเดียว ไม่ย้อนกลับเข้า solver ([envelope.ts:65](../src/game/flight/envelope.ts#L65), [stall.ts:38](../src/game/flight/stall.ts#L38))

นี่คือโครงที่ข้อเสนอ Jet Drift ต้องการพอดี ไม่ต้องสร้างใหม่

### 1.3 จุดที่ velocity ถูกจับคู่กับหัวเครื่อง (หัวใจของเรื่องนี้)

[stepFlight.ts:96-114](../src/game/flight/stepFlight.ts#L96-L114)

```ts
const alignment = forward.dot(path)
const lateral = forward.clone().addScaledVector(path, -alignment)   // ทิศตั้งฉาก path ชี้ไปทางหัว
...
const normalLateral = lateral.clone()
normalLateral.setLength(speed * p.pathResponse * forward.angleTo(path))          // servo ตามมุมผิดพลาด
const anticipation = forward.clone().sub(previousForward)
  .multiplyScalar(speed * p.turnAnticipation / dt)                               // feed-forward ตามการหมุนหัว
normalLateral.add(anticipation).clampLength(0, normalLimit).multiplyScalar(surfaceControl)
lateral.multiplyScalar(speed * maneuverProfile.pathResponse * authority * pathGrip * lift)
lateral.lerp(normalLateral, grip)                                                // grip = 1 - separation
```

มีแรงดึง velocity เข้าหาหัวอยู่ 4 ตัว — **สามตัวแรกอยู่ในบล็อกนี้ ตัวที่สี่อยู่คนละไฟล์และไม่ผ่าน gate ใดเลย**:

| ตัว | ค่า | ผลเชิงอัตรา |
|---|---|---|
| `flight.pathResponse` | 4 ([defaults.ts:36](../src/content/flight-profiles/defaults.ts#L36)) | path หมุนเข้าหาหัวที่ 4 × มุมผิดพลาด (τ = 0.25 s) |
| `flight.turnAnticipation` | 0.65 ([defaults.ts:37](../src/content/flight-profiles/defaults.ts#L37)) | 65% ของการหมุนหัวถูกโอนให้ velocity ทันทีในทุก substep |
| `maneuver.pathResponse × activeGrip` | 1.5 × 0.08 = 0.12 ([defaults.ts:60-61](../src/content/flight-profiles/defaults.ts#L60-L61)) | สาขา separated — นี่คือ "drift" ที่ตั้งใจให้มี |
| **แรงขับหมุน path** | `engineForce` ([engineForces.ts:41](../src/game/flight/engineForces.ts#L41)) | `atan(|F⊥|·dt / max(speed, 40))` — **ไม่ผ่าน `grip`, `separation` หรือ `surfaceControl`** |

**ทั้งสามตัวถูกผสมด้วยน้ำหนักเดียวกันคือ `grip = 1 − separation`** ([stepFlight.ts:81](../src/game/flight/stepFlight.ts#L81)) และ `surfaceControl` ซึ่งก็มาจาก `separation` เช่นกัน ([controller.ts:20](../src/game/flight/controller.ts#L20)) ดังนั้นตราบใดที่ `stall.severity` ยังเป็น 0 แรงดึงเต็ม 4 + 0.65 ทำงานเต็มที่ และ `pathGrip` 0.08 ไม่มีน้ำหนักเลย

ตัวที่สี่สำคัญเป็นพิเศษ: [engineForces.ts:41](../src/game/flight/engineForces.ts#L41) ส่ง `engineForce.clone().add(lateral)` เข้า `controlledPathStep` ซึ่งหมุน `path` เข้าหาเวกเตอร์รวมนั้น `engineForce` คือทิศแรงขับในพิกัดโลก (ตามหัวเครื่องบวกมุม nozzle) จึงเป็นการจัด velocity เข้าหาหัวอีกทางหนึ่งที่ไม่มี gate ใดควบคุม และที่ `speed < pathRateFloorMps` (40 m/s) ตัวหารถูกตรึง ทำให้อัตราการหมุนไม่ลดตามความเร็วอีก

`separation` มาจาก [stall.ts:24-28](../src/game/flight/stall.ts#L24-L28) เท่านั้น คือ
`max(lowSpeed จาก arcade km/h 300–350, alpha จาก |alphaDeg| 20–30°)`
ซึ่งเป็น **pitch-plane alpha** ไม่ใช่ incidence รวม sideslip

---

## 2. ความเข้ากันได้ของสถาปัตยกรรม

| ระบบ | ไฟล์ | สถานะ | เหตุผล |
|---|---|---|---|
| Airflow / AoA / beta / q | `airflow.ts` | **KEEP** | pure observation ครบทุกค่าที่ drift ต้องใช้ รวม `incidenceDeg` 0–180 และ `confidence` |
| Aero flow effectiveness | `aerodynamics.ts:37` | **KEEP** | AD16 ทำเสร็จแล้ว: authority มาจาก flow ล้วน ไม่มี separation memory ปน |
| Natural restoring / damping | `aerodynamics.ts:64` | **KEEP + TUNE** | โครง curve ต่อ incidence ถูกต้อง; ค่า yaw stiffness กับ separated damping คือปุ่มคุมว่า drift อยู่ได้นานแค่ไหน (Phase 8) |
| Stall / separation memory | `stall.ts` | **KEEP + TUNE** | ตัว memory ดีอยู่แล้ว แต่ **ห้ามใช้เป็นสวิตช์ของ path coupling อีกต่อไป** (ดู §3 B1) |
| Control authority / budget | `authority.ts`, `allocation.ts` | **KEEP** | แยก aero / tvc / floor ต่อ tick แล้ว invariant ตรวจได้ ไม่ต้องแตะ |
| Controller | `controller.ts` | **KEEP + TUNE** | `ratePermission` ต่อเนื่องตาม `alphaLimitDeg` แล้ว; ปุ่มที่เหลือคือ `yawRate` 0.42 ซึ่งเตี้ยไปสำหรับ drift |
| Envelope / breakout | `envelope.ts` | **KEEP + TUNE** | สูตรถูกและต่อเนื่อง; ช่วง q ที่ให้อยู่แล้ว (E = 1 ใต้ 344 km/h, E = 0 เหนือ 652 km/h) ตรงกับตารางเป้าหมายของข้อเสนอเกือบพอดี |
| TVC | `thrustVectoring.ts` | **KEEP** | capacity = geometry × travel × actual thrust; ไม่มี phase term แล้ว ตรงกับที่ข้อเสนอขอทุกข้อ |
| Engine / burner | `engine.ts`, `speed.ts` | **KEEP + TUNE** | spool + reserve ถูกต้อง; `afterburnerAcceleration` 38 แรงเกินจน drift จบเองเมื่อคา Shift (R7) |
| **Path coupling** | `stepFlight.ts:96-114` | **REFACTOR** | จุดเดียวที่ต้องผ่าตัด: เปลี่ยนสัญญาณคุมจาก `separation` เป็นการไหลที่วัดได้ |
| Legacy phase machine | `maneuvers.ts` | **REMOVE** (Phase 6 ตามแผนเดิม) | `phase`, `blend`, `completed`, `peakAlpha`, `psmArm`, `highG` |
| Camera | `FlightCamera.ts` | **REFACTOR** (Phase 7 ตามแผนเดิม) | `cinematic * 0.88` เล็งตาม velocity จนเครื่องไถลออกนอกเฟรม |
| Vapor / FX | `vapor/conditions.ts` | **KEEP + TUNE** | `attached` ดับไอน้ำที่ incidence 55–115° พอดีกับจังหวะที่ควรสวยที่สุด และ `sideslip` ที่คำนวณไว้แล้วไม่มีใครใช้ |
| Crossflow normal force | — | **MISSING** | `alphaDrag` / `betaDrag` เข้า scalar `drag` ตาม path ([stepFlight.ts:117](../src/game/flight/stepFlight.ts#L117)) เครื่องที่ตะแคงจึงเสียแค่ความเร็ว ไม่เกิดแรงตั้งฉาก → drift วิ่งตรงและจม ไม่โค้ง |
| Thrust path rotation | `engineForces.ts:41` | **REFACTOR ถ้าจำเป็น** | หมุน velocity เข้าหาหัวโดยไม่ผ่าน gate ใด (B3); ตัดสินหลังวัดผล JD core |
| Recovery assist | `recovery.ts` | **MISSING** (Phase 5 ตามแผนเดิม) | ยังไม่มีไฟล์ |

---

## 3. อะไรขวาง Jet Drift อยู่ เรียงตามความสำคัญ

### B1 — สัญญาณที่คุม path coupling ผิดตัว (โครงสร้าง · สำคัญที่สุด)

`grip = 1 − separation` ([stepFlight.ts:81](../src/game/flight/stepFlight.ts#L81)) และ `surfaceControl` ([controller.ts:20](../src/game/flight/controller.ts#L20)) ผูกกับ `stall.severity` ซึ่งเป็น memory ที่เกิดจาก pitch-alpha > 20° หรือความเร็วต่ำกว่า 350 arcade km/h เท่านั้น

ผลคือ **`limiterOpen` — ค่าที่ผู้เล่นสั่งได้จริงผ่าน breakout — ไม่มีผลต่อการยอมให้ velocity ตามหลังหัวเลยแม้แต่น้อย** ระบบอนุญาตให้ "บินมุมสูง" แต่ไม่ได้อนุญาตให้ "velocity หลุดจากหัว" ด้วยสัญญาณเดียวกัน ทั้งที่มันคือเรื่องเดียวกันในสายตาผู้เล่น

### B2 — วงจรอุดตัน: ดึงเท่าไรก็ไม่ถึงประตู (โครงสร้าง · วัดแล้ว)

เพราะ B1 แรงดึง 4 + 0.65 ทำงานเต็มที่ตลอดในสภาพ attached ผลวัดจริงคือ incidence คงตัวที่ **3.8° ที่ 900 km/h** และ **9.1° ที่ 400 km/h** ขณะที่ประตู separation อยู่ที่ pitch-alpha 20°

ดังนั้นช่วง "Jet Drift sweet spot 300–500 km/h" ที่ข้อเสนอต้องการ **ไม่มีทางเข้าถึงได้ด้วยคันบังคับอย่างเดียว** ต้องใช้ X + Shift ช่วยเปิด limiter แล้วรอให้พลังงานตกลงไปใต้ 350 km/h ให้ `lowSpeed` สร้าง separation แทน — นั่นคือ 2 วินาทีของการทิ้งพลังงาน ไม่ใช่การ drift

### B3 — แรงขับหมุน velocity โดยไม่ผ่าน gate ใดเลย (โครงสร้าง · วัดแล้ว)

[engineForces.ts:41](../src/game/flight/engineForces.ts#L41) หมุน `path` เข้าหา `engineForce + lateral` โดย `engineForce` ไม่เคยถูกคูณด้วย `grip`, `separation` หรือ `surfaceControl` ดังนั้นการลด path coupling ตาม §5.2 จะทำให้สามตัวแรกจางลง แต่ตัวนี้ยังทำงานเต็มที่ และที่ `speed < 40` m/s ตัวหารถูกตรึงไว้ อัตราการหมุนจึงไม่ลดลงอีกในช่วงที่ drift อาศัยอยู่พอดี

วัดได้ชัดเจนมาก — ชุด drift เดียวกันบน Su-57 400 km/h ต่างกันแค่คา Shift หรือไม่:

| | beta สูงสุด | yaw rate สูงสุด | สภาพที่ 6 s |
|---|---|---|---|
| คา Shift | **41.4°** | 40 °/s | ความเร็วกลับขึ้น 577 km/h |
| ไม่คา Shift | **−7.5°** | 13 °/s | 70 km/h เชิดหัวจมลง |

แปลว่า **drift ที่เกิดได้จริงทุกวันนี้เป็น drift ที่ขับด้วยแรงขับ ไม่ใช่ด้วยโมเมนตัม** ทั้งจาก TVC capacity ที่แปรตาม actual thrust และจากการหมุน path ตัวนี้ นี่คือทั้งจุดแข็ง (slingshot recovery ทำงานเอง) และจุดอ่อน (ไม่มี burner = ไม่มี drift) ในกลไกเดียวกัน

### B4 — F-22 ไถลข้างไม่ได้เลย (tuning ต่อลำ · วัดแล้ว)

`yawGain: 0` + `cantDeg: 0` ([f22.ts:7-8](../src/content/flight-profiles/f22.ts#L7-L8)) ทำให้ `commanded yaw = 0` โดยชัดเจนใน [thrustVectoring.ts:136](../src/game/flight/thrustVectoring.ts#L136) เหลือแต่ aero yaw ซึ่งที่ incidence 60° มี effectiveness 0.5 และที่ 90° เหลือ 0.15 ([defaults.ts:15](../src/content/flight-profiles/defaults.ts#L15))

วัดได้: F-22 beta สูงสุด **4.3°** เทียบกับ Su-57 **41.4°** ในสถานการณ์เดียวกัน นี่เป็นความจงใจเชิง personality (I9 บังคับว่า F-22 yaw capacity ต้องเป็นศูนย์) แต่แปลว่า **Jet Drift ที่ไถลข้างเป็นความสามารถเฉพาะ Su-57** จนกว่าจะมีการตัดสินใจของเจ้าของ

### B5 — กล้องผลักเครื่องออกนอกเฟรม (presentation · ผลทางสายตาสูงสุด)

[FlightCamera.ts:26](../src/render/FlightCamera.ts#L26) `forward.lerp(path, this.cinematic * 0.88)` — กล้องเล็งตาม **velocity vector** ขณะที่ลำตัวหันออกจาก velocity จังหวะที่ decouple มากที่สุดคือจังหวะที่ subject ไถลไปขอบจอ ไม่ใช่แค่ "มองไม่เห็นมุม" แผน Phase 7 กำหนด cap 0.35–0.5 ไว้แล้ว

### B6 — พลังงานปิดประตูด้วยตัวเอง (tuning)

`E = 1 − smoothstep(q, 0.5, 1.8)` ([envelope.ts:32](../src/game/flight/envelope.ts#L32)) ขณะที่ `afterburnerAcceleration` = 38 m/s² ([defaults.ts:27](../src/content/flight-profiles/defaults.ts#L27)) วัดได้: F-22 ที่ปล่อย airbrake แล้วคา Shift ไว้ ความเร็วไต่จาก 424 ไป 1308 km/h ใน 4.5 วินาที → q พุ่ง → E → 0 → limiter ปิด → drift จบเอง

ข้อเสนอต้องการให้ Shift เป็นตัว *ออก* จาก drift ซึ่งตรงกับพฤติกรรมนี้พอดี แต่ตอนนี้แรงจนไม่มีทางถือ drift ไว้พร้อมกับใช้ burner ประคอง

### B7 — ไม่มีแรงตั้งฉากจาก crossflow (MISSING · ความเสี่ยงสูงสุดถ้าจะเพิ่ม)

[stepFlight.ts:117](../src/game/flight/stepFlight.ts#L117) รวม `alphaDrag + betaDrag` เข้าไปใน scalar `drag` ซึ่ง `integrateTranslation` ใช้ลดขนาดความเร็วตาม path เท่านั้น ([engineForces.ts:22-25](../src/game/flight/engineForces.ts#L22-L25)) เครื่องที่ตะแคง 60° จึงเสียความเร็วแต่ไม่ได้แรงด้านข้าง

ผลทางภาพ: drift ปัจจุบันคือ "ลอยตรงแล้วช้าลง" ไม่ใช่ "ไถลโค้ง" ตามที่วิดีโออ้างอิงแสดง

### B8 — Input ไม่มี yaw ต่อเนื่อง (ergonomics)

[FlightInput.ts:35](../src/game/input/FlightInput.ts#L35) yaw มาจาก Q/E แบบ digital ±1 เท่านั้น mouse ให้แค่ pitch/roll ([FlightInput.ts:36-39](../src/game/input/FlightInput.ts#L36-L39)) และ `yawRate` = 0.42 rad/s เทียบกับ `pitchRate` 0.95 ผู้เล่นเมาส์จึงเข้า drift ด้านข้างไม่ได้เลยโดยไม่ย้ายมือไปคีย์บอร์ด

### B9 — Vapor ดับตอนไคลแมกซ์ (presentation)

[conditions.ts:38](../src/render/vapor/conditions.ts#L38) `attached = 1 − smoothstep(incidence, 55, 115)` และ `lift = smoothstep(incidence, 4, 28)` ([conditions.ts:36](../src/render/vapor/conditions.ts#L36)) → ไอน้ำแรงสุดตอนเลี้ยวธรรมดา และหายไปก่อนถึง post-stall ที่ลึก นอกจากนี้ `flightVaporConditions` คืน `sideslip` มาแล้ว ([conditions.ts:25](../src/render/vapor/conditions.ts#L25)) แต่ `vaporActivation` ไม่ได้ใช้ — ตัวไถลข้างซึ่งคือ "drift" จริงๆ ขับ FX เป็นศูนย์

### B10 — Clamp ที่ซ่อนอยู่ (ตรวจแล้ว ไม่ใช่ตัวขวาง แต่ต้องรู้)

| Clamp | ที่อยู่ | ผลต่อ drift |
|---|---|---|
| `normalLimit` = turnAcceleration × speedAuthority × gAllowance | [controller.ts:18](../src/game/flight/controller.ts#L18), [controller.ts:40](../src/game/flight/controller.ts#L40) | จำกัดแรงจัด path ที่ความเร็วสูง ช่วยให้เกิด nose-slide เล็กน้อยเหนือ 650 km/h |
| `pathRateFloorMps` = 40 | [engineForces.ts:9](../src/game/flight/engineForces.ts#L9) | กันการหมุน velocity ทันทีตอนเกือบหยุด — ต้องคงไว้ |
| energy guard `allowedSpeed` | [engineForces.ts:46-53](../src/game/flight/engineForces.ts#L46-L53) | กัน drift สร้างพลังงานฟรี — ต้องคงไว้ |
| `minPoweredMps` = 65 | [speed.ts:33](../src/game/flight/speed.ts#L33) | S ชะลอได้ถึง 351 arcade km/h เท่านั้น; X ไม่มีพื้นนี้ |
| terrain kill ที่ `y <= 3` | [stepFlight.ts:135](../src/game/flight/stepFlight.ts#L135) | drift ที่ระดับต่ำจบด้วยการตาย ไม่ใช่การกระแทก |

---

## 4. State ที่เข้ารหัสท่าเฉพาะ

**ไม่มี code ที่ตรวจจับ Cobra / Kulbit / J-turn / Tailslide ตามชื่อเลย** สิ่งที่มีคือ

| สิ่งที่มี | ที่อยู่ | ควรเป็นอะไร |
|---|---|---|
| `m.phase` (`normal`/`armed`/`active`/`recovery`) | [maneuvers.ts:34-49](../src/game/flight/maneuvers.ts#L34-L49) | **ลบ** (Phase 6) — ตอนนี้เหลือผลต่อ physics แค่ `m.rotation` telemetry ([stepFlight.ts:86](../src/game/flight/stepFlight.ts#L86)) และ fallback ของกล้อง ([FlightCamera.ts:18](../src/render/FlightCamera.ts#L18)) |
| `command.psmArm` (ปุ่ม C) | [FlightInput.ts:44](../src/game/input/FlightInput.ts#L44) → [stepFlight.ts:34](../src/game/flight/stepFlight.ts#L34) | **ลบ** — เหลือหน้าที่เดียวคือ debug เปิด `limiterOpen = 1` ทันที |
| `command.highG` (Space) | [envelope.ts:40](../src/game/flight/envelope.ts#L40) | **ลบ** — รวมเข้า `gAllowance` path เดียวกันแล้ว |
| `m.blend`, `m.completed`, `m.peakAlpha`, `m.stable` | [maneuvers.ts:20-23](../src/game/flight/maneuvers.ts#L20-L23) | **ลบ** — ไม่มีใครอ่านใน physics แล้ว |
| `entryMin` / `entryMax` / `minAltitude` / `exitSpeed` | [f22.ts:65-67](../src/content/flight-profiles/f22.ts#L65-L67) | **ลบ** — นี่คือ "phase gate" แบบที่ข้อเสนอห้าม |
| `envelopeLabel()` | [envelope.ts:65](../src/game/flight/envelope.ts#L65) | **คงไว้เป็น derived label** — ถูกต้องแล้ว ไม่มี state, ไม่มี hysteresis, ไม่ย้อนเข้า solver |
| `stall.cause` | [stall.ts:38](../src/game/flight/stall.ts#L38) | **คงไว้เป็น derived label** — มี comment บังคับไว้แล้วว่าห้ามป้อนกลับ |
| `maneuverDetector.ts` | ยังไม่มี (Phase 9) | **สร้างเป็น pure observer** — ชื่อท่าอธิบายสิ่งที่เกิดขึ้นแล้ว ไม่ได้สั่งให้เกิด |

ข้อนี้คือข่าวดีที่สุดของรีวิว: เป้าหมาย "maneuver names describe what happened" บรรลุไปแล้วในทาง physics ตั้งแต่ Phase 3–4 เหลือแค่กวาดซากตาม Phase 6

---

## 5. การเปลี่ยนที่น้อยที่สุดที่ให้ Jet Drift ได้จริง

### 5.1 สิ่งที่ไม่ต้องแตะเลย

`airflow.ts`, `authority.ts`, `allocation.ts`, `thrustVectoring.ts`, `engine.ts`, `intent.ts` — หกไฟล์นี้ให้สิ่งที่ Jet Drift ต้องการครบแล้ว

`engineForces.ts` แตะเฉพาะกรณีที่ผลวัดหลัง JD core บอกว่าจำเป็น (B3) — การอินทิเกรตพลังงานและ energy guard ในไฟล์นั้นห้ามแตะไม่ว่ากรณีใด

### 5.2 การผ่าตัดจุดเดียว (JD core)

**เปลี่ยนสัญญาณที่คุมการผสม path coupling จาก `separation` memory เป็นการไหลที่วัดได้**

ที่ [stepFlight.ts:80-81](../src/game/flight/stepFlight.ts#L80-L81) ตอนนี้คือ

```ts
const separation = envelope.separation
const grip = 1 - separation
```

แนวที่เสนอ (โครงสร้าง ไม่ใช่ค่าสุดท้าย):

```ts
// path coupling = ความสามารถของการไหลที่ยังเกาะอยู่ในการบังคับ velocity
// ใช้ curve ต่อ incidence เหมือน controlEffectiveness — ไม่ใช่ memory, ไม่ใช่ threshold
const attachment = Math.min(1 - separation, pathCouplingAt(aero.pathCoupling, airflowStart.incidenceDeg))
const grip = attachment
```

คุณสมบัติที่ได้ทันที:

1. ต่อเนื่องโดยกำเนิด — `incidenceDeg` มาจาก velocity/orientation ที่อินทิเกรตแล้ว จึงกระโดดภายใน substep ไม่ได้ (เหตุผลเดียวกับ I7 ใน [aerodynamics.ts:34-35](../src/game/flight/aerodynamics.ts#L34-L35))
2. ไม่ต้องรอ memory 0.4 s — decouple เริ่มทันทีที่มุมเปิด
3. ตัด B2 ออกทั้งหมด: การดึงเริ่มสร้าง incidence → coupling ลด → incidence โตต่อได้ → ถึง 20° แล้ว separation ค่อยเข้ามาเสริม แทนที่จะเป็นเงื่อนไขนำ
4. ไม่ได้เพิ่ม authority ใดๆ — เป็นการ *ลด* แรงจัด velocity ตามการไหล ซึ่งอยู่ฝั่ง physics ไม่ใช่ assist จึงไม่ชน §0 ("Recovery Assist ≠ Natural Aerodynamic Stability")
5. ไม่ต้องเพิ่ม state ใหม่แม้แต่ตัวเดียว — ใช้ `airflowStart.incidenceDeg` ที่มีอยู่

**state/ตัวแปรใหม่ที่จำเป็นจริง: หนึ่งอย่าง** คือ curve `aero.pathCoupling` ใน `profileTypes.ts` (รูปแบบเดียวกับ `controlEffectiveness`) ค่าเริ่มต้นควรเป็น 1.0 ถึงราว 15° แล้วลดลงหา 0.1–0.2 ที่ 45–60° เพื่อให้ช่วง 300–500 km/h เป็น sweet spot ตามตารางเป้าหมาย

ทางเลือกที่ถูกกว่าถ้าไม่อยากเพิ่ม field: ใช้ `aeroFlowEffectiveness` ที่คำนวณอยู่แล้วทุก substep ([stepFlight.ts:38](../src/game/flight/stepFlight.ts#L38)) เป็นตัวคูณ — แต่ผูก 2 ความหมายเข้าด้วยกัน (แรงจัด velocity กับ effectiveness ของพื้นผิวบังคับ) ทำให้ปรับแยกไม่ได้ใน Phase 8 **แนะนำ curve แยก**

### 5.3 สิ่งที่ต้องปรับค่า (ไม่ใช่โครงสร้าง)

| ปุ่ม | ปัจจุบัน | ทิศทาง | เหตุผล |
|---|---|---|---|
| `flight.turnAnticipation` | 0.65 | ลด หรือคูณด้วย `attachment` | feed-forward นี้ไม่มีเหตุผลทาง aero รองรับ มันคือ `velocityDirection ← aircraftForward` ตรงๆ |
| `flight.pathResponse` | 4 | คงไว้ | นี่คือ servo ตามมุมผิดพลาด มีเหตุผลรองรับ ("การไหลที่เกาะดัด velocity เข้าหาหัว") และเป็นตัวที่ทำให้การบินปกติคม |
| `aero.betaDrag` | 0.003 / 0.0032 | อาจลดเล็กน้อย | ตอนนี้กินพลังงาน 3.7 m/s² ที่ 70 m/s, beta 30° ทำให้ drift สั้น |
| `flight.yawRate` | 0.42 / 0.48 | เพิ่มเฉพาะเมื่อ limiter เปิด | drift ด้านข้างต้องการอัตรา yaw ที่รู้สึกได้ |
| `maneuver.activeGrip` | 0.08 | คงไว้ | เมื่อ B1 แก้แล้ว ค่านี้จะได้ทำงานจริงเป็นครั้งแรก — ประเมินใหม่หลังจากนั้น |

### 5.4 สิ่งที่ต้อง refactor เชิงโครงสร้าง (นอกจาก JD core)

- `FlightCamera.ts` — Phase 7 ตามแผนเดิม (cap 0.35–0.5, offset lag, FOV ตาม decouple)
- `maneuvers.ts` + `PilotCommand` — Phase 6 ตามแผนเดิม
- `vaporActivation` — ยืดแบนด์ `attached` และรับ `sideslip` เข้าสมการ

### 5.5 สิ่งที่ *ไม่* ควรทำในเส้นทางน้อยที่สุด

- **ห้ามเพิ่มแรงตั้งฉากจาก crossflow (B7) ในรอบแรก** — เป็นเทอม physics ใหม่ตัวเดียวในข้อเสนอทั้งหมด และเป็นตัวที่เสี่ยงที่สุด (flat spin, พลังงานฟรี, oscillation) เก็บไว้หลัง JD core พิสูจน์ตัวเองแล้ว
- **ห้ามเพิ่ม `assist.velocityRollAssist`** — AD5 อนุญาตไว้เป็นของต่อลำภายหลัง 0–0.3 ถ้าจำเป็น ไม่ใช่ของ foundation และไม่มี field นี้ใน `profileTypes.ts` ตอนนี้
- **ห้ามปรับ `arcadeControlFloor`** — แผน Phase 4 ระบุชัดว่าต้องมีการตัดสินใจของเจ้าของก่อน

---

## 6. Control model — ผู้เล่นสร้างแต่ละท่าอย่างไรโดยไม่มีปุ่มท่า

ปุ่มที่มี: pitch, yaw, roll, W/S, X (airbrake), Shift (burner) — **เพียงพอ** ถ้า JD core ผ่าตัดแล้ว เพราะไวยากรณ์ของ drift คือ "พลังงาน + มุม + ทิศ" ซึ่งสามปุ่มหลัง (S/X/Shift) คุมพลังงาน และสามแกนแรกคุมมุมกับทิศ

| ท่า | ลำดับปุ่ม | กลไกที่ทำให้เกิด |
|---|---|---|
| Nose slide | X + ดึง pitch เต็ม | `brakeIntent` เปิด `limiterOpen` → `alphaLimitDeg` ขยาย → incidence โต → `attachment` ลด → velocity ตามหลัง |
| Cobra | X + ดึงเต็ม แล้วปล่อยกลับกลาง | ขาขึ้นเหมือน nose slide; ขากลับคือ `restoring.pitch` ตาม curve ([f22.ts:30](../src/content/flight-profiles/f22.ts#L30)) ที่ไม่ถูกคูณด้วย separation โดยเจตนา |
| Jet drift ด้านข้าง | X + ดึง แล้วสลับเป็น yaw ค้าง | ต้องมี yaw authority ที่ incidence สูง = TVC (Su-57) หรือ aero yaw ที่ยังเหลือ (F-22 ได้แค่ 30–55°) |
| J-turn / reversal | X + ดึง + roll ให้ระนาบ แล้ว yaw ตาม | roll ยังทำงานที่ `limiterOpen` สูงเพราะ `roll` ใช้ `speedAuthority + (1 − speedAuthority)·limiterOpen` ([controller.ts:46](../src/game/flight/controller.ts#L46)) |
| Deep post-stall rotation | X + ทั้งสามแกนพร้อมกัน | `allocate()` จัดสรรต่อแกนจาก budget จริง ไม่มี "โหมด" |
| Tailslide | ไต่ชัน ปล่อยคันบังคับ ไม่กด Shift | `integrateTranslation` รองรับการข้ามศูนย์ตามแกนยาวไว้แล้วโดยเจตนา ([engineForces.ts:32-36](../src/game/flight/engineForces.ts#L32-L36)) |
| ออกจาก drift | ปล่อยคันบังคับ + Shift | วัดแล้วว่าทำงาน: incidence 18° → 2° ใน 1 วินาที |

สิ่งที่ยังขาดเชิง ergonomics คือ yaw ต่อเนื่อง (B8) ทางเลือกที่ไม่เพิ่มปุ่ม: ผสมแกนข้างของเมาส์จาก roll ไปเป็น yaw ตาม `highAoa` ซึ่ง `FlightInput` รับ `highAoa` อยู่แล้ว ([FlightInput.ts:10](../src/game/input/FlightInput.ts#L10)) — **เป็นการตัดสินใจเรื่อง feel ต้องให้เจ้าของชี้ขาด ไม่ใช่ข้อเสนอ**

---

## 7. Arcade กับ physics — ตรงไหนควรจงใจง่าย

| เรื่อง | ทำให้ง่ายอย่างไร | เพราะอะไร |
|---|---|---|
| Crossflow | ไม่มีแรงตั้งฉาก มีแต่ drag ตาม path | กันพฤติกรรมที่อธิบายไม่ได้ในสายตาผู้เล่น; ต้นทุนคือ drift ไม่โค้ง (B7) |
| Inertia | ค่าเดียวต่อแกน ไม่มี cross-coupling (`inertia` ใน TVC profile) | กัน inertia coupling ที่ผู้เล่น arcade อ่านไม่ออก |
| Effectiveness | curve เดียวใช้ทั้ง 3 แกนและทุกลำ ([defaults.ts:13-16](../src/content/flight-profiles/defaults.ts#L13-L16)) | จงใจ ระบุไว้ใน comment ว่าการแยกต่อแกนคือ Phase 8 |
| Restoring | ไม่คูณด้วย separation ([aerodynamics.ts:52-59](../src/game/flight/aerodynamics.ts#L52-L59)) | ให้เครื่องกลับหัวเองได้เสมอ = อ่านง่าย กู้คืนได้ ป้องกัน flat spin ถาวร |
| Throttle | W/S เป็น acceleration request ไม่ใช่ตำแหน่งคันเร่ง | ลด input ที่ต้องจำ |
| Gravity | `gravityBlend` ปิดแรงโน้มถ่วงตามแรงยก ([stepFlight.ts:123](../src/game/flight/stepFlight.ts#L123)) | กันเครื่องร่วงตอนเลี้ยวปกติ |
| Energy | guard เชิงงาน ไม่ใช่ clamp ความเร็ว ([engineForces.ts:37-53](../src/game/flight/engineForces.ts#L37-L53)) | กัน drift สร้างพลังงานฟรีโดยไม่ทำให้รู้สึกเหมือนชนกำแพง |

จุดที่ควร **ต้านแรงกดดันให้สมจริงขึ้น**: อย่าเพิ่ม inertia coupling, อย่าเพิ่ม departure แบบสุ่ม, อย่าทำให้ restoring หายตอน separation

---

## 8. กล้อง

โครงปัจจุบัน ([FlightCamera.ts:15-62](../src/render/FlightCamera.ts#L15-L62)): `decoupling = smoothstep(incidenceDeg, 20, 60) × confidence` → `cinematic` (smooth 4/s) → ใช้ 3 ที่ คือ ทิศเล็ง (`× 0.88`), ระยะถอย (`back = 26 + … + cinematic·6`) และจุดเล็ง (`50 − cinematic·12`)

คำตอบ: **ใช่ กล้องปัจจุบันซ่อน drift และแย่กว่านั้นคือผลักเครื่องออกนอกเฟรม** เพราะเล็งตาม velocity 88% ส่วนผสมที่ควรเป็นคือ

```
cameraForward = slerp(aircraftForward, velocityDirection, share)   share ≤ 0.35–0.5
```

บวก offset ด้านข้างตาม `decoupling` เพื่อให้เห็นลำตัวด้านข้าง และ FOV กว้างขึ้นตาม decouple ตามที่ Phase 7 ระบุไว้แล้ว

ข้อสังเกต: กล้องยังมี fallback `maneuver.phase === 'active'` ([FlightCamera.ts:18](../src/render/FlightCamera.ts#L18)) ซึ่งต้องออกพร้อม Phase 6

---

## 9. ความเสี่ยง

### ความเสี่ยงเชิง physics (แก้ด้วยการออกแบบ ไม่ใช่ตัวเลข)

| # | ความเสี่ยง | เหตุ | การป้องกันที่มีอยู่แล้ว |
|---|---|---|---|
| R1 | Flat spin ไม่สิ้นสุด | ลด path coupling แล้ว yaw ค้าง | `restoring.yaw` ไม่ถูกคูณด้วย separation; `damping.separated.yaw` 0.55/0.4; ต้องมี invariant ใหม่ว่า neutral stick ต้องลดขนาดของ rates เสมอ |
| R2 | พลังงานฟรี | velocity ไม่ตามหัวแล้วแต่ thrust ยังดันเต็ม | energy guard [engineForces.ts:46-53](../src/game/flight/engineForces.ts#L46-L53) ครอบอยู่แล้ว ต้องคง I ที่ตรวจข้อนี้ |
| R3 | Oscillation ที่ขอบ curve | `pathCoupling` ชันเกินใกล้ 20° | curve ต่อเนื่องเชิงเส้นต่อช่วง + สัญญาณมาจากค่าอินทิเกรต ไม่กระโดดใน substep |
| R4 | Determinism พัง | เปลี่ยน physics | `flightProfileVersion` ต้อง bump และ golden ทั้งหมดต้องบันทึกใหม่ |
| R5 | TVC แรงเกิน | ลด coupling แล้ว TVC ที่เหลือเท่าเดิมดูแรงขึ้น | capacity ผูกกับ actual thrust อยู่แล้ว; burner หมดใน 6 s |
| R6 | ถอยหลัง / ความเร็วเป็นศูนย์กลางอากาศ | วัดแล้ว: Su-57 ที่ 300 + X + Shift ถึง 0 km/h ใน 3.75 s | มี `pathRateFloorMps` และ `confidence` คุมอยู่ แต่ควรมี benchmark ใหม่จับข้อนี้ |

### ความเสี่ยงเชิง tuning (แก้ด้วยตัวเลข)

| # | ความเสี่ยง | สังเกตจาก |
|---|---|---|
| R7 | burner ดึงออกจาก drift แรงเกิน | วัดแล้ว 424 → 1308 km/h ใน 4.5 s |
| R8 | drift กินพลังงานเกินจนใช้ในการต่อสู้ไม่ได้ | วัดแล้ว เสียความเร็วครึ่งหนึ่งใน 2.5 s |
| R9 | การบินปกติเบาลงโดยไม่ตั้งใจ | `pathResponse` / `turnAnticipation` เป็นตัวที่ทำให้การเลี้ยวคม ถ้าลดเกินจะรู้สึกลื่น — benchmark `hardTurn900` / `fullStick500` คุมอยู่ |
| R10 | Exploit ใน dogfight | หันหัวยิงได้โดยไม่เสียความเร็ว — ต้องดูจาก R8 ว่าค่าเสียพลังงานยังสูงพอ |
| R11 | ผู้เล่นเมารถจากกล้อง | Phase 7 ต้องรักษา `reducedMotion` path ที่มีอยู่ |
| R12 | Personality สองลำกลืนกัน | ตอนนี้ต่างกันมาก (beta 4.3° กับ 41.4°) ระวังไม่ให้ JD core ลบความต่างนี้ |

---

## 10. ข้อเสนอแนะและลำดับงาน

### คำตอบ: **B — เก็บรากฐาน ผ่าตัดเฉพาะส่วน path coupling**

เหตุผลจาก code ไม่ใช่จากคำอธิบาย:

1. ทุก contract ที่ข้อเสนอต้องการ (`separation`, `stability`, `controlAuthority`, `tvcAuthority`) มีอยู่แล้วและเป็น continuous — ขาดแค่ `driftAuthority` ซึ่งคือ `1 − attachment` ที่ §5.2 เสนอ
2. ไม่มี maneuver detection ใน physics เลย จึงไม่มีอะไรต้องรื้อ
3. ตัวขวางอันดับ 1 และ 2 อยู่ใน **19 บรรทัด** ของ `stepFlight.ts` (96–114)
4. ตัวขวางที่เหลือเป็น presentation หรือ tuning ต่อลำ ซึ่งแผน Rev. 3 กำหนดไว้ใน Phase 6/7/8/9 อยู่แล้ว

### ลำดับงานที่เสนอ — ใช้เลข phase เดิมของแผน Rev. 3 ไม่สร้าง track ขนาน

เหตุผลที่ไม่ตั้งชื่อ JD-0..JD-7: แผน Rev. 3 ได้รับอนุมัติแล้ว และ §0 / AD15 เขียนอิงเลข phase ชุดนั้น การตั้งเลขใหม่จะทำให้ invariant กับ benchmark อ้างถึงกันไม่ได้

| ลำดับ | งาน | ตรงกับแผนเดิม | physics เปลี่ยน | ไฟล์ |
|---|---|---|---|---|
| 1 | **ยก Phase 7 (กล้อง) ขึ้นมาทำก่อน** | Phase 7 | ไม่ | `FlightCamera.ts` |
| 2 | Benchmark ใหม่สำหรับ drift | ขยาย §5.2 | ไม่ | `benchmarks/flight/*` |
| 3 | **JD core: path coupling จาก flow** | Phase 4.5 (ใหม่) | ใช่ | `stepFlight.ts`, `profileTypes.ts`, profiles |
| 4 | Recovery assist | Phase 5 (เดิม) | ใช่ | `recovery.ts` |
| 5 | ลบ legacy gates | Phase 6 (เดิม) | ใช่ | `maneuvers.ts`, `commands.ts`, … |
| 6 | Tuning ต่อลำ | Phase 8 (เดิม) | tuning | profiles |
| 7 | FX / vapor / detector | Phase 9 (เดิม) | ไม่ | `vapor/conditions.ts`, `maneuverDetector.ts` |
| 8 | (เลือกได้) crossflow normal force | หลัง Phase 8 | ใช่ | `aerodynamics.ts`, `stepFlight.ts` |

**เหตุผลที่กล้องขึ้นก่อน:** เป็น presentation ล้วน ไม่ bump `flightProfileVersion` ไม่ทำ golden พัง และให้ผลทางสายตาต่อหน่วยความเสี่ยงสูงที่สุดในทั้งรายการ — drift ที่มีอยู่แล้วบน Su-57 (beta 41°) มองไม่เห็นด้วยกล้องปัจจุบัน

### รายละเอียดต่อขั้น

**ขั้น 1 — กล้อง (Phase 7)**
- เป้าหมาย: เห็น nose/velocity ที่แยกกันจริง
- ไฟล์: [FlightCamera.ts](../src/render/FlightCamera.ts)
- เปลี่ยน: cap velocity-look share 0.35–0.5, offset ด้านข้างตาม decouple, FOV ตาม decouple, ลบ fallback `maneuver.phase`
- Test: `tests/airflowCamera.test.ts` ขยาย — ที่ incidence 60° มุมระหว่าง cameraForward กับ aircraftForward ต้องไม่เกินเพดาน
- ความเสี่ยง: R11 เท่านั้น

**ขั้น 2 — Benchmark สำหรับ drift**
- เป้าหมาย: มีตัวเลขก่อนแตะ physics
- ไฟล์: `benchmarks/flight/harness.ts` (scenario `drift400`, `drift500`), `metrics.ts`, `targets.ts`
- Metric ใหม่: peak beta, ระยะเวลาที่ incidence > 30°, ความเร็วที่เสียต่อหนึ่งวินาทีของ drift, ความสูงที่เสีย, เวลาที่ velocity heading เปลี่ยน 90°
- **ต้องบันทึก baseline ของวันนี้ก่อน** เพื่อให้เทียบก่อน/หลังได้จริง

**ขั้น 3 — JD core (Phase 4.5)**
- เป้าหมาย: velocity ยอมตามหลังหัวตามมุมการไหลจริง ไม่ต้องรอ stall memory
- ไฟล์: [stepFlight.ts:80-114](../src/game/flight/stepFlight.ts#L80-L114), `profileTypes.ts` (curve `aero.pathCoupling`), `validateProfile.ts`, `content/flight-profiles/*`
- พฤติกรรมที่คาดหวัง: incidence คงตัวที่ 900 km/h ยังต้องอยู่ราว 4° (การบินปกติไม่เปลี่ยน) แต่ที่ 400–500 km/h พร้อม X ต้องเข้าแบนด์ drift ได้ภายใน 1 วินาที แทน 2 วินาที และไถลได้โดยไม่ต้องรอความเร็วตกใต้ 350 — **แต่ต้องวัดยืนยันว่า JD core อย่างเดียวพอ** เพราะ B3 (แรงขับหมุน path) ไม่ถูกลดโดย JD core ถ้าผลวัดพบว่าระยะเวลา drift ยังสั้นและยังพึ่ง Shift ต้อง gate เทอมนั้นด้วยในรอบเดียวกัน
- Test / telemetry: invariant ใหม่ว่า neutral stick ต้องทำให้ `|rates|` ลดลงเสมอ (R1); invariant พลังงาน (R2) ที่มีอยู่ต้องยังผ่าน; ต่อ substep `attachment` ต้องต่อเนื่อง
- **ผลข้างเคียงบังคับ:** ต้อง bump `flightProfileVersion` ([profile.ts:7](../src/game/flight/profile.ts#L7)) → `tests/invariants/goldenTracks.test.ts` จะ fail โดยเจตนา ต้องบันทึก golden ใหม่ทั้งชุด **และต้องอธิบายส่วนต่างเชิงพฤติกรรมก่อน ไม่ใช่ปรับ golden เพื่อกลบ** ตามที่แผน Phase 2 กำหนดไว้แล้ว
- ความเสี่ยง: R1, R3, R9

**ขั้น 4–8** ใช้ scope เดิมของแผน Rev. 3 โดยไม่เปลี่ยน ยกเว้น Phase 9 เพิ่มงาน vapor 2 อย่าง (ยืดแบนด์ `attached`, รับ `sideslip`) และเพิ่มขั้น 8 เป็นทางเลือก

---

## การตัดสินใจที่ต้องให้เจ้าของชี้ขาด

ข้อเสนอฉบับนี้ชนกับข้อจำกัดที่อนุมัติไว้แล้ว 4 จุด ทั้งสี่จุดต้องเป็นการตัดสินใจของเจ้าของ ไม่ใช่การตีความของผู้เขียนรีวิว

1. **`qLow` / `qHigh` ต่อลำ** — ตารางความเร็วเป้าหมายในข้อเสนอ (650 / 500–650 / 300–500 / 180–300) ใกล้เคียงกับค่าปัจจุบันมาก (E = 1 ใต้ 344, E = 0 เหนือ 652) การปรับให้ตรงเป๊ะคือ Phase 8 tuning ต่อลำ ไม่ใช่ส่วนหนึ่งของ JD core
2. **`arcadeControlFloor`** — แผน Phase 4 ระบุว่า "ห้ามปรับ floor เพื่อคืนหน้าต่างเดิมโดยไม่มีการตัดสินใจของเจ้าของ" JD core ไม่แตะ floor แต่การลด coupling จะทำให้พฤติกรรมใกล้ความเร็วต่ำเด่นขึ้น
3. **F-22 `yawGain: 0`** — ถ้าต้องการให้ F-22 drift ด้านข้างได้ ต้องแก้ personality และ invariant I9 ที่บังคับว่า yaw capacity ต้องเป็นศูนย์ ถ้าไม่แก้ ต้องยอมรับว่า Jet Drift ด้านข้างเป็นของ Su-57
4. **Mouse X → yaw ตาม `highAoa`** — แก้ B8 ได้โดยไม่เพิ่มปุ่ม และไม่ชน §0 เพราะ `FlightInput` รับ `highAoa` อยู่แล้ว แต่เปลี่ยนความหมายของแกนกลางการบิน

---

## ภาคผนวก — วิธีการวัด

ตัวเลขทั้งหมดในเอกสารนี้มาจากการรัน `runTrack` ของ [benchmarks/flight/harness.ts](../benchmarks/flight/harness.ts) ด้วย setup แบบ `fullStick500` (ระดับความสูง 2000 m, `enginePower` ตั้ง trim ให้ตรงความเร็วเริ่มต้น) ที่ความเร็วเริ่มต้น 900 / 650 / 500 / 400 / 300 arcade km/h สองชุดคำสั่ง:

1. `{ pitch: 1 }` ค้าง 4 วินาที
2. `{ pitch: 1, airbrake: true, afterburner: true }` ค้าง 4 วินาที
3. ชุด drift: `{ pitch: 1, airbrake: true, afterburner: true }` 1.5 วินาที แล้ว `{ pitch: 0.35, yaw: 1, afterburner: true }` ต่ออีก 4.5 วินาที

สคริปต์วัดเป็นไฟล์ชั่วคราวนอก repo และไม่ได้ commit — เมื่อทำขั้น 2 ของลำดับงาน ควรย้ายเข้าเป็น scenario ถาวรเพื่อให้ตัวเลขชุดนี้เป็น baseline ที่เทียบได้
