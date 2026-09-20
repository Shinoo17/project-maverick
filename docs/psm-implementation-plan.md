# PSM / High-AoA / TVC — Final Baseline (Rev. 3)

> 18 ก.ย. 2026 · **Final Baseline — อนุมัติแล้ว** (รวม amendments: floor `{acceleration, maxRate}`, `powerIntent` อ่าน input ผู้เล่นเท่านั้น, `w_combo·B·Pi`, B9 target จาก Phase 2 playtest) — Rev. 3 เพิ่ม: Arcade Control Floor แยกจาก Physical Aero (§3.2), `powerIntent` ≠ `poweredControlAvailable` (§2), allocation strategy รองรับ TVC participation (§3.3), Hard Invariants ≠ Tuning Benchmarks (§5)
> แทนที่ส่วน C (บางส่วน), D, E, F, H ของ [psm-architecture-review.md](psm-architecture-review.md)
> ส่วน A (Current System) และ B (Problems) ในเอกสารเดิมยังใช้อ้างอิงได้
> ตัวเลขทั้งหมดในเอกสารนี้เป็นค่าเริ่มต้นสำหรับ tuning ไม่ใช่ spec

---

## 0. Core Separation Rules (กฎหลัก ห้ามละเมิด)

```text
Arcade Control Floor  !=  Physical Aero Authority  !=  TVC Authority
Breakout Intent       !=  Aircraft Capability
Recovery Assist       !=  Natural Aerodynamic Stability
Engine Thrust         !=  Forward Acceleration
PSM                   !=  State  !=  Ability  !=  Animation
```

PSM = ผลลัพธ์ของ `Player Intent + Flight Condition + Available Aero Authority + Available TVC Authority + Energy State`

บังคับใช้ในโค้ดด้วย type boundary:
- `PilotIntent` ห้ามอ่าน profile capability, TVC geometry หรือ governor trim
- `AuthorityBudget` ห้ามอ่าน `PilotCommand`
- Envelope (breakout) ให้ **permission** เท่านั้น — ค่าที่ใช้จริงถูก clamp ด้วย `AuthorityBudget` เสมอ
- Allocation debug แยก 3 ส่วน (`aero` / `tvc` / `floor`) ทุก tick เพื่อให้ invariant ตรวจได้

---

## 1. Revised Architecture Decisions

| # | Decision | สถานะ |
|---|---|---|
| AD1 | Continuous envelope; label (NORMAL/HIGH_AOA/POST_STALL/RECOVERING/DEPARTED) ใช้เฉพาะ presentation/detector | คงเดิม |
| AD2 | Positional mouse rate-stick คงเดิม | คงเดิม |
| AD3 | Reuse TVC geometry/actuator, fixed-step 120 Hz, replay, rate controller (`rates += (target - rates)·response`) | คงเดิม |
| AD4 | **แยก `AirflowState` (สังเกต) ออกจาก `EnvelopeFactors` (ตีความ)** | ใหม่ |
| AD5 | **Pitch/yaw/roll = body axes ตลอด** ไม่ทำ velocity-vector roll ใน foundation; ถ้าจำเป็นภายหลังเป็น `assist.velocityRollAssist` 0–0.3 ต่อลำ | เปลี่ยน |
| AD6 | **Breakout = multi-factor intent** ไม่ใช่ stick > threshold (ดู §2) | เปลี่ยน |
| AD7 | **Restoring = per-aircraft curve ตาม incidence** ไม่ linear, ไม่ snap | เปลี่ยน |
| AD8 | **TVC = capability จริง**: capacity จาก geometry × max deflection × actual thrust; moment ที่ใช้จริงจาก actual deflection; ลบ generic PSM rate envelope | เปลี่ยน |
| AD9 | **Engine แบบง่าย**: `requestedPower → spool → actualPower → actualThrust` + burner reserve; ทุกระบบอ่าน actual thrust เดียว; autothrottle เป็นแค่ผู้ request | เปลี่ยน |
| AD10 | **Recovery แยกจาก natural aero**: aero ทำงานทันที, assist เข้าหลัง delay; `recovery.seconds` = เวลาที่ assistance กลับมาเต็ม ไม่ใช่เวลากลับ NORMAL | เปลี่ยน |
| AD11 | **`arcadeControlFloor` แยกจาก `physicalAeroAuthority`**: floor = gap-fill + rate ceiling เล็ก ไม่ใช่ TVC/powered/aero (§3.2); Stability assist ทำได้แค่ damping/smoothing/coordination | ใหม่ (Rev. 3) |
| AD13 | **`powerIntent` (ผู้เล่น) ≠ `poweredControlAvailable` (เครื่อง)**: intent ช่วยเปิด breakout permission, capability เท่านั้นที่ให้ authority | ใหม่ (Rev. 3) |
| AD14 | **Allocation strategy เป็น function แยก**: Phase 3 = aero-first (`tvcParticipation = 0`); รองรับ participation blending ภายหลังโดยไม่แก้ controller | ใหม่ (Rev. 3) |
| AD15 | **Tests แบ่ง Hard Invariants (CI fail) กับ Tuning Benchmarks (report + target range)** | ใหม่ (Rev. 3) |
| AD16 | **`AeroFlowEffectiveness` จาก `AirflowState` ล้วน** คุม physical aero authority + damping blend; separation memory ไม่แตะ angular authority อีกต่อไป | ใหม่ (20 ก.ย. 2026) |
| AD12 | Maneuver detection = observer pure function ภายหลัง | คงเดิม |

### Pipeline

```
AircraftState
  ↓ observeAirflow()              airflow.ts        (pure)
AirflowState
  ├─ stepStall()                  stall.ts          separation memory (ไม่ให้ angular authority)
  ├─ aeroFlowEffectiveness()      aerodynamics.ts   AirflowState → AeroFlowEffectiveness (pure)
  ├─ readIntent()                 intent.ts         PilotCommand → PilotIntent      (ไม่อ่าน capability)
  ├─ computeBudget()              authority.ts      flow + effectiveness + profile → AuthorityBudget (ไม่อ่าน command/separation)
  ↓ interpretEnvelope()           envelope.ts       (pure + smoothed memory: separation, limiterOpen)
EnvelopeFactors                                     permission เท่านั้น
  ↓ controller                    controller.ts     demand × permission → requested body-rate change
  ↓ allocate(strategy)            allocation.ts     request ∩ AuthorityBudget → { aero, tvc, floor }
  ↓ actuators                     thrustVectoring.ts (requested angles → actual angles)
  ↓ moments / forces              aerodynamics.ts + thrustForces() + recovery.ts
  ↓ integrate                     stepFlight.ts     orientation, velocity, energy guard, terrain
```

### Contracts

```ts
/** What the simulation observes. No tuning, no gameplay meaning. */
interface AirflowState {
  airspeed: number          // m/s
  alphaDeg: number          // signed pitch-plane incidence (same as angleOfAttack())
  betaDeg: number           // signed sideslip
  incidenceDeg: number      // nose↔velocity angle 0..180
  dynamicPressure: number   // dimensionless normalized q = (airspeed / profile.aero.referenceSpeedMps)², unclamped; NOT Pa or ½ρv²
  forwardFlow: number       // 0..1 body-x velocity share (cos incidence, ≥0)
  reverseFlow: number       // 0..1 (−cos incidence, ≥0)
  confidence: number        // 0..1 smoothstep(airspeed, 2, 10) — angles meaningless near zero speed
}

/** What the PLAYER wants. Player inputs only — never capability, never governor trim. */
interface PilotIntent {
  demand: number            // D
  saturation: number        // S
  sustained: number         // T
  brakeIntent: number       // B — airbrake held (smoothed)
  powerIntent: number       // Shift = 1; W = profile weight (e.g. 0.4); NOT requested engine power
}

/** What the AIRCRAFT can do right now. Never reads PilotCommand. */
interface AeroFlowEffectiveness { pitch: number; yaw: number; roll: number }   // 0..1 จาก AirflowState เท่านั้น

interface AuthorityBudget {
  physicalAero: Axes            // rad/s² — q · confidence · flow effectiveness · surface authority
  tvc: Axes                     // rad/s² — geometry × max deflection × ACTUAL thrust × gain (0 if thrustVectoring null)
  arcadeFloor: { acceleration: Axes; maxRate: Axes }   // §3.2 gap-fill only
  poweredControlAvailable: number  // 0..1 normalized TVC capacity — HUD/debug/benchmarks; 0 for non-TVC
}

/** What the GAME permits. Permission only; never authority. */
interface EnvelopeFactors {
  highAoa: number           // 0..1
  separation: number        // 0..1, time-smoothed
  intent: number            // 0..1 breakout intent (§2)
  limiterOpen: number       // 0..1, time-smoothed
  alphaLimitDeg: number     // ≤ profile capability maxControllableAlpha
  gAllowance: number        // hard-turn G ceiling multiplier (High-G merged)
  hardTurnBlend: number     // 0..1; rate/drag blend, independent of gAllowance mapping
  // Phase 5 will add stabilityAssist/recoveryAssist alongside real consumers and I15 coverage.
}

/** Per-tick debug record; every invariant about authority is checked against this. */
interface AllocationRecord { request: Axes; aero: Axes; tvc: Axes; floor: Axes; unmet: Axes }
```

`AirflowState` รวม 3 จุดที่ตอนนี้คำนวณซ้ำกัน: `stall.aoaDeg` ([stall.ts:29](../src/game/flight/stall.ts#L29)), `m.alpha` ท้าย step ([stepFlight.ts:119](../src/game/flight/stepFlight.ts#L119)), และ `flightVaporConditions` ([vapor/conditions.ts:24-25](../src/render/vapor/conditions.ts#L24-L25)) — physics อ่านค่าต้น step; telemetry เก็บค่าท้าย step แยกชื่อชัด

---

## 2. Revised Envelope / Breakout Logic

### 2.1 หลักการ

Stick เต็ม = **"ต้องการ authority เพิ่ม"** ระบบเลือกว่า authority มาจาก G, AoA, aero หรือ TVC ตาม flight condition

### 2.2 Inputs ของ intent

| สัญลักษณ์ | ความหมาย | ที่มา (reuse) |
|---|---|---|
| `D` | demand = `smoothstep(0.6, 1.0, |(pitch, yaw)|)` | `PilotCommand` |
| `S` | saturation = requested rate / rate ที่ทำได้ภายใน limit ปัจจุบัน → `smoothstep(1.0, 1.6, S)` | **ค่าเดิม** `requestedTurn / turnBudget` ([stepFlight.ts:32-34](../src/game/flight/stepFlight.ts#L32-L34)) |
| `E` | energy permission = `1 − smoothstep(q_low, q_high, q)` ต่อลำ (เช่น corner speed ↔ 70% corner) | AirflowState |
| `B` | air brake (smoothed) | `m.airbrake` เดิม |
| `B·Pi` | brake + power combination (คำนวณในสูตร ไม่ใส่ใน `powerIntent` เพื่อไม่นับซ้ำ) | intent |
| `Pi` | **`powerIntent`** = `max(Shift, W · w_W)` — **input ผู้เล่นเท่านั้น**; ไม่ใช้ requested engine power เพราะมี governor trim ปน ([speed.ts:33](../src/game/flight/speed.ts#L33)) | `PilotIntent` |
| `H` | already-high incidence = `smoothstep(alphaNormal, alphaCritical, incidence)` | AirflowState |
| `T` | sustained demand (leaky integrator ~0.4 s; P4-1 owner amendment) | ใหม่ (น้ำหนักต่ำ ดู §6 D4) |

**M4 owner decision (19 ก.ย. 2026):** `alphaNormal` / `alphaCritical` ใน §2 หมายถึง
`profile.aero.alphaNormalDeg` / `profile.aero.alphaCriticalDeg` ซึ่งเป็น threshold ของ
**unsigned incidence** (รวม sideslip) ไม่ใช่ signed pitch-plane alpha ของ stall.
กำหนด `0 ≤ alphaNormalDeg < alphaCriticalDeg ≤ 180`, ค่าต้อง finite และปรับแยกต่อลำจาก playtest.
ห้าม derive หรือ fallback จาก `stall.recoveryAoaDeg` / `stall.criticalAoaDeg`.
Phase 1 ใช้ 20° / 30° เป็นค่าเริ่มต้นชั่วคราวเพื่อคง highAoa observation เดิม ยังไม่ใช่ผล playtest.
`alphaLimitDeg` แบบ observe-only อ่าน `aero.alphaNormalDeg`; การเปิด limiter ตามสูตรด้านล่างยังรอ Phase 4.

**P4-2 owner decision (20 ก.ย. 2026):** คง combined unsigned-incidence restriction. `alphaLimitDeg` จำกัดมุม nose-to-velocity ไม่ใช่ limit แยกรายแกน; limiter permission กับ AD16 capability ตั้งใจให้ทำงานซ้อนกัน. Regression seed alpha +10° / beta −60°, limiter ปิด: pitch request แรกต้องเป็นศูนย์ แล้วกลับมาเป็นบวกภายใน 0.2 s สำหรับ partial/full demand ที่ระบุใน test. การถ่วง `outward` ตาม contribution จริงต่อ incidence rate แทนการอิ่มตัวที่ axis angle 5° เป็นงาน Phase 8; ห้ามแก้ tuning เพื่อชดเชยตอนนี้.

### 2.3 สูตร (โครง — ค่าน้ำหนักเป็น profile)

**P4-1 owner decision (20 ก.ย. 2026):** ให้ `S` คุม automatic G เท่านั้น; breakout ใช้ `D × permission` เพราะ saturation ตาม rate request ปัจจุบันกับ low-energy `E` ไม่มีช่วงซ้อนกันบริเวณความเร็วเข้า maneuver ใน attached flight. ยกเลิกตัวคูณ full-open rate ใน feedback; วัดด้วย limiter permission ปัจจุบันก่อน G allowance. `T` สะสม demand ด้วยน้ำหนักต่ำเดิม เพื่อไม่ให้ `S` กลับมาคุม breakout ทางอ้อม. AuthorityBudget / aero / TVC / floor ไม่เปลี่ยน.

```
demandGate = D                                       // P4-1: saturation คุม G เท่านั้น
permission = E · (w_base + w_brake·B + w_power·Pi + w_combo·B·Pi) + w_sustain·T·E
intent     = clamp(demandGate · permission, 0, 1)

// latch: ถ้า incidence สูงอยู่แล้วและผู้เล่นยังสั่ง ไม่ปิด limiter กลางท่า
target     = max(intent, H · D)
limiterOpen += (target − limiterOpen) · (1 − exp(−k · dt))
   k = target > limiterOpen ? openRate · (1 + boost_brake·B + boost_power·Pi) : closeRate

alphaLimitDeg = lerp(alphaNormal, maxControllableAlpha, limiterOpen)   // permission

// capability (แยกขาด): สิ่งที่เกิดจริง = allocate(request, AuthorityBudget)
// intent เปิด permission ได้เต็ม แต่ถ้า budget ไม่มี → incidence ไม่ถึง alphaLimit
gAllowance    = lerp(1, hardTurnG, D · S · (1 − E))  // ความเร็วสูง: authority ไปที่ G ไม่ใช่ AoA
```

ทุก blend ใช้รูป `1 − exp(−k·dt)` (determinism 30/60/144 FPS)

### 2.4 ผลที่คาดหวัง

| สถานการณ์ | E | B/Pi | ผล |
|---|---|---|---|
| เร็ว (≥ corner) + stick เต็ม | ≈0 | – | `limiterOpen` ≈ 0, `gAllowance` ขึ้น = hard turn / High-G, drag สูงจาก `turnDrag` เดิม |
| กลาง + stick เต็ม | กลาง | 0 | เปิดช้าและไม่เต็ม (`w_base` ต่ำ) → AoA สูงขึ้นปานกลาง, ยังไม่ post-stall ง่าย |
| ต่ำ + stick เต็ม | สูง | 0 | เปิดมากขึ้นแต่ยังช้า |
| ต่ำ/กลาง + Brake + Shift + pull | สูง | สูง | เปิดเร็ว (~0.15–0.25 s) เต็ม → PSM intent ชัดแบบ Battlefield |
| ปล่อย stick | – | – | `D → 0` → ปิดตาม `closeRate`; natural aero + recovery ทำต่อ |

Capability cap: `maxControllableAlpha` ต่อลำ — F-16 ≈ `alphaNormal` จึง breakout ได้แค่ G

**ตัวอย่างการแยก intent / capability**

| เครื่อง + Shift + brake + pull ที่ความเร็วต่ำ | `powerIntent` | `limiterOpen` | `poweredControlAvailable` | ผลจริง |
|---|---|---|---|---|
| Su-57 | 1 | → 1 เร็ว | สูง | TVC หมุนหัวผ่าน post-stall ได้ |
| F-22 | 1 | → 1 เร็ว | สูง (pitch), yaw = 0 | pitch post-stall ได้, yaw จาก aero/floor เท่านั้น |
| F/A-18 | 1 | → 1 เร็ว | **0** | permission เต็ม แต่ได้แค่ physical aero ที่ q ต่ำ + floor → nose-pointing จำกัด, ไม่มี Kulbit, เสียพลังงานตามจริง |
| F-16 | 1 | → 1 เร็ว | 0 | `maxControllableAlpha` ต่ำ → แทบไม่มี AoA เพิ่ม |

---

## 3. Revised Responsibilities

**กฎ:** แต่ละ layer ทำงานบนตัวแปรของตัวเองเท่านั้น และรวมกันที่จุดเดียวคือ rate update ใน `stepFlight` (ยังคง rate-based ตาม AD3)

| Layer | ทำ | ห้ามทำ |
|---|---|---|
| **Player Input** | stick/keys → `PilotCommand` | รู้ regime |
| **Airflow** | สังเกต §1 | tuning ใดๆ |
| **Envelope** | ตีความ, breakout, limits, assist weights | เขียน rates/velocity |
| **Controller** | demand × limits → requested Δrate ต่อแกน (body axes) | สร้าง authority เอง |
| **Authority budget** | `physicalAero`, `tvc` (actual thrust), `arcadeFloor`, `poweredControlAvailable` | อ่าน `PilotCommand` / intent / `EnvelopeFactors` / separation memory |
| **Aero flow effectiveness** | `AirflowState` + `aero.controlEffectiveness` → 0..1 ต่อแกน | อ่าน `highAoa`, separation memory, command หรือ capability |
| **Aerodynamics (natural)** | restoring curve, q-damping (blend ด้วย `max(separation, 1 − effectiveness)`), lift/path force ตาม separation, α/β drag | ขึ้นกับ input หรือเวลา; ให้ floor; คูณ restoring ด้วย separation |
| **Allocation** | request → `{aero, tvc, floor}` ตาม strategy (§3.3), แต่ละส่วน ≤ budget ของตัวเอง; บันทึก `AllocationRecord` | เพิ่มเกิน budget; ใช้ floor แทน TVC |
| **Arcade Control Floor** | gap-fill authority เล็กๆ เมื่อ aero + TVC ต่ำกว่า floor, จำกัดด้วย `maxRate` | เป็น TVC / powered / aero; ทำงานเมื่อ budget จริงพออยู่แล้ว |
| **TVC** | actuator travel; `thrustForces()` จาก **actual angle + actual thrust** → moment + vectored thrust | ตัดสินว่าจะ vector เมื่อไร |
| **Arcade / Stability Assist** | rate smoothing, coordination, sideslip hold, oscillation damping, × `stabilityAssist` (จางตาม highAoa/separation) | เพิ่ม \|rate\| ในทิศที่ผู้เล่นสั่งเกิน allocation |
| **Recovery Assist** | หลัง `recovery.delaySeconds`: extra damping, anti-spin, nose precision, path alignment **ภายใน authority จริง** (aero/TVC ที่เหลือ + lift ที่มีตาม q) | snap, ทำงานขณะผู้เล่นสั่ง, บังคับกลับ NORMAL ภายในเวลา |
| **Engine** | request → spool → actual thrust; burner reserve | รู้ว่า thrust จะไปทางไหน |
| **Speed governor** | request power จาก W/S + **base drag trim เท่านั้น** (เหมือน `trim = drag·v²` เดิม [speed.ts:33](../src/game/flight/speed.ts#L33)) | ชดเชย α-drag / brake / PSM drag (ไม่งั้นได้ TVC ฟรี) |
| **Camera/HUD/FX/Audio** | อ่าน `AirflowState` + `EnvelopeFactors` + engine | ป้อนกลับ input |

### 3.2 Arcade Control Floor (AD11)

```ts
arcadeControlFloor: {
  acceleration: Axes   // rad/s² — เล็ก, ≤ ~10–20% ของ post-stall TVC ของ Su-57
  maxRate: Axes        // rad/s — ceiling ของการหมุนที่ floor พาไปได้ (เช่น 0.15–0.35)
}
```

- **Gap-fill ไม่ใช่บวกเพิ่ม**: `floorAvail = max(0, floor.acceleration − physicalAero − tvc)` ต่อแกน → เครื่องที่มี aero/TVC พอแล้วได้ floor = 0
- **Rate ceiling**: floor share = 0 เมื่อ |rate| ในทิศ request ≥ `maxRate` — กัน acceleration เล็กๆ สะสมหลายวินาทีจนกลายเป็น Kulbit ช้าๆ (restoring ที่ separation ต่ำอาจไม่พอต้าน)
- ไม่ขึ้นกับ thrust, burner, `powerIntent`
- ของเดิมที่เทียบได้: `authority` clamp floor 0.12 ([stepFlight.ts:26](../src/game/flight/stepFlight.ts#L26)) × `pitchRate 0.95` ≈ 0.11 rad/s = rate ceiling อยู่แล้ว และ `stall.controlAuthority 0.25` — Phase 0 overlay แสดงส่วนนี้เป็น "legacy floor" = `max(0, 0.12 − raw)` แยกจาก raw
- Overlay แสดง **physical aero / TVC / floor แยกกันเสมอ** (จาก `AllocationRecord`)

### 3.3 Allocation strategy (AD14)

```ts
type AllocationStrategy = (request: Axes, budget: AuthorityBudget, participation: Axes) => AllocationRecord

// ลำดับเดียวสำหรับทุก strategy:
// 1. tvcLead  = min(budget.tvc, participation · |request|)          // Phase 3: participation = 0 → 0
// 2. aero     = min(budget.physicalAero, |request| − tvcLead)
// 3. tvcRest  = min(budget.tvc − tvcLead, |request| − tvcLead − aero)
// 4. floor    = min(floorAvail, |request| − aero − tvc, rate ceiling)
// 5. unmet    = |request| − aero − tvc − floor
```

- **Phase 3**: เรียกด้วย `participation = 0` → aero-first; **ไม่เพิ่ม profile field ของ participation** จนกว่า playtest ต้องการ
- **ภายหลัง** (ถ้าต้องการ): `participation = base + highAoa·hi + separation·ps` ต่อลำ — เปลี่ยนแค่ค่าที่ส่งเข้า function, controller/TVC/tests ไม่เปลี่ยน
- ทุกกรณี TVC ≤ geometry × max deflection × actual thrust × gain
- **Risk ที่คาดไว้สำหรับ aero-first** (ใส่เป็น benchmark ไม่ใช่เหตุให้ทำ blending ล่วงหน้า): nozzle เริ่มจาก 0 ตอน aero อิ่มตัว แต่ actuator ใช้เวลา ~0.44 s (F-22 20°/45°/s) และ ~0.5 s (Su-57 18°/36°/s) ถึงสุด → อาจเกิด "hitch" ช่วง handoff → วัดด้วย benchmark `handoffRateDip`

### Restoring curve (AD7)

```ts
aero.restoring: {
  pitch: Curve   // incidenceDeg → stiffness (rad/s² ที่ q = 1), piecewise-linear knots
  yaw:   Curve
}
aero.damping: { attached: Axes; separated: Axes }   // lerp ด้วย separation
```

- Moment = `−stiffness(incidence) · q · sin(alpha|beta)` → ศูนย์ที่ 0° และ 180° (180° เป็น unstable equilibrium ⇒ tail slide flip เกิดเอง)
- Stiffness curve ต่อลำ เช่น F-22 ลดลงน้อยใน high AoA (predictable), Su-57 ลดลงมาก (freestyle), Su-35 ลดลงมาก + `alphaDrag` สูง
- Validation: stiffness ≥ 0, knots เรียง incidence
- **Restoring ไม่คูณ separation โดยตั้งใจ** (owner decision 20 ก.ย. 2026): การเสีย static stability หลัง stall
  encode ด้วย stiffness curve ตาม incidence ตาม AD7 เท่านั้น การคูณ `(1 − separation)` เพิ่มจะ double-count
  และทำให้ natural recovery กับ tail-slide flip หายไปเมื่อ `separation → 1`
  separation ยังมีผลกับ control effectiveness, damping, lift/path force และ drag ได้ตามเดิม

### Aero flow effectiveness (AD16)

```ts
aero.controlEffectiveness: { pitch: Curve; yaw: Curve; roll: Curve }   // incidenceDeg → 0..1
```

- `physicalAero = q · confidence · effectiveness(incidence) · controlAcceleration` — **ไม่มี** พจน์ separation
- q รับผิดชอบการเสีย authority จากความเร็วต่ำเพียงผู้เดียว; `confidence` gate เฉพาะความหมายของมุมใกล้ศูนย์ความเร็ว
  (effectiveness จาง กลับไปหา attached ตาม confidence จึงไม่นับ confidence ซ้ำ)
- ใช้ unsigned incidence เป็นตัววัด crossflow ตัวเดียว: β = 90° ที่ α = 0 เสีย effectiveness เท่ากับ α = 90°
  การแยก α กับ β ต่อแกน (rudder broadside ≠ stabilator) เลื่อนไว้อย่างตั้งใจ ยังไม่ทำ
- Damping blend ใช้ `max(separation, 1 − effectiveness)` — crossflow จึง damp แบบ separated แม้ pitch-alpha band ปิดอยู่
- **ห้าม** ให้ `AuthorityBudget` อ่าน `EnvelopeFactors.highAoa`: `highAoa` เป็น gameplay interpretation
  ส่วน effectiveness เป็น physical observation
- Validation: knots เรียง incidence, span 0..180, effectiveness ∈ [0,1]

### Neutral stick (สำคัญ)

Neutral damping เดิม `neutralResponse 9` ([stepFlight.ts:46](../src/game/flight/stepFlight.ts#L46)) ดึง rate → 0 ~7%/substep ทำให้ restoring เหลือ ≈ 1/9 ต้องจาง `neutralResponse` ด้วย `(1 − highAoa)` แล้วให้ `aero.damping` + recovery รับหน้าที่แทน; ลบ `neutralDampingDuringPsm`

### TVC geometry ปัจจุบันให้ authority เท่าไร

คำนวณจาก `thrustForces()` ที่ full deflection (ต้องยืนยันใน Phase 0):

| Thrust (m/s²) | F-22 pitch / yaw / roll (rad/s²) | Su-57 pitch / yaw / roll |
|---|---|---|
| 3.5 (trim ที่ 100 m/s) | 0.19 / **0.00** / 0.07 | 0.17 / 0.10 / 0.09 |
| 27.5 (+W) | 1.46 / **0.00** / 0.51 | 1.30 / 0.77 / 0.73 |
| ~65 (+W +burner) | 3.45 / **0.00** / 1.21 | 3.08 / 1.81 / 1.72 |

- F-22 yaw TVC = 0 จาก geometry (cant 0, differential axial thrust หักล้างกัน) ✔ ตรง design
- เทียบของเดิม: PSM rate target 2.6 rad/s × response 5/s ≈ **13 rad/s²** เริ่มต้น → geometry จริงช้ากว่าราว 4 เท่า (Cobra 90° ≈ 0.95 s จาก rest ที่ burner, ยังไม่นับ restoring)
- จึงต้องมี `thrustVectoring.gain` **ค่าเดียวทุกแกน** (arcade scale) เพื่อรักษาสัดส่วนแกนตาม geometry แต่ปรับความเร็วท่าได้
- **ห้ามตั้ง gain จากอัตราส่วน 4×**: 13 rad/s² ของเดิมคือแรงดึงแบบ first-order เข้าหา rate ceiling (อิ่มตัว) ส่วน capacity คือ angular acceleration จริง — ถ้า match ช่วงแรกจะ overshoot การหมุนต่อเนื่อง ถ้า match เวลา Cobra จะหนืดใน 0.2 s แรก → calibrate `gain` กับ golden traces ของ Phase 0 (เวลา Cobra 90°, เวลา Kulbit 360°) ใน Phase 3

---

## 4. Revised Implementation Phases

ข้อบังคับทุก phase: fixed-step `1 − exp(−k·dt)`; determinism 30/60/144 FPS; phase ที่เปลี่ยน physics bump `flightProfileVersion` ([profile.ts:7](../src/game/flight/profile.ts#L7)); `replay.ts` ปฏิเสธ version เก่า

| Phase | ชื่อ | Physics เปลี่ยน? | C |
|---|---|---|---|
| 0 | Instrumentation + velocity marker | ไม่ | gameplay เดิม |
| 1 | Airflow / Envelope observation | ไม่ (refactor) | gameplay เดิม |
| 2 | Natural aerodynamics | ใช่ | gameplay เดิม |
| 3 | Engine + Aero/TVC allocation | ใช่ | **ให้แค่ limiter open (debug)** ไม่ให้ rate |
| 4 | Automatic breakout + minimal continuous recovery | ใช่ | debug comparison |
| 5 | Recovery assist | ใช่ | debug |
| 6 | Remove legacy gates / input | ใช่ (command format) | ลบ |
| 7 | Camera + HUD polish | ไม่ | – |
| 8 | Aircraft validation | tuning | – |
| 9 | FX / Audio / Maneuver detector | ไม่ | – |

> ต่างจากข้อเสนอ: Recovery ย้ายมาก่อนลบ gates, velocity marker + camera re-key ย้ายมา Phase 0–1, engine อยู่ Phase 3 — เหตุผลใน §6

### Phase 0 — Instrumentation (spec ละเอียด · พร้อม implement)

**ขอบเขต:** read-only ทั้งหมด — ห้ามแก้ `stepFlight.ts`, ห้าม bump `flightProfileVersion`; ถ้าต้องแตะ physics = หลุด Phase 0
Baseline ก่อนเริ่ม: `npm test` 18 files / 189 tests ผ่าน, `tsc -b` ผ่าน (18 ก.ย. 2026)

#### 0.1 Pure read-only helpers
- `thrustVectoring.ts` เพิ่ม `tvcCapacity(profile | null, thrust): { pitch, yaw, roll }` (rad/s²)
  - pitch = max |pitch| จาก nozzle ทั้งสองเต็ม ±; yaw/roll = max จาก travel สวนทาง ±
  - อ่านเฉพาะ geometry + thrust ห้ามอ่าน command หรือมุม nozzle ปัจจุบัน (§6 D5); ยังไม่มีใครใน flight step เรียก — Phase 3 ใช้ต่อ
- `src/game/flight/instrumentation.ts` (ใหม่) `flightInstrumentation(state)`:
  - `airspeed`, `alphaDeg` (= `angleOfAttack()`), `betaDeg`, `incidenceDeg`
  - `dynamicPressureProxy = (airspeed / 90)²` — 90 m/s คือตัวหารของ authority curve เดิม ([stepFlight.ts:26](../src/game/flight/stepFlight.ts#L26)) ย้ายเข้า profile ใน Phase 1
  - `actualThrust = enginePower × dryThrustLimit(flight, speedLimits)` — กู้ค่าได้ตรงเพราะ `enginePower = thrust / dryThrust` ([speed.ts:44](../src/game/flight/speed.ts#L44)) ไม่ต้องเพิ่ม state
  - `tvcCapacity` ที่ actual thrust
  - `legacy` block (ตั้งชื่อ legacy โดยเจตนา — **ไม่ใช่** physical aero / TVC / floor ของ Phase 3 ห้ามเทียบ screenshot ข้าม phase):
    - `aeroRate` = rate ต่อแกน × `min(v/90, 1)` × high-speed factor × `surfaceControl` × (1 − poweredBlend)
    - `floorRate` = rate ต่อแกน × `max(0, 0.12 − v/90)` × เหมือนกัน (ส่วนที่มีเพราะ floor 0.12 เท่านั้น)
    - `poweredRate` = maneuver rates × `blend × controlAuthority`
    - `surfaceControl`, `poweredBlend`, `separationProxy = stall.severity`, `limiterProxy = maneuver.blend`
    - ทั้งหมดเป็น full-stick rate ceiling **ก่อน** turn budget / High-G

#### 0.2 Debug overlay
- `PlaygroundHud.tsx` lab section เพิ่มแถว: α / β / incidence, q proxy, engine thrust, TVC capacity P/Y/R, **Legacy aero rate**, **Legacy floor rate**, **Legacy PSM rate** (°/s P/Y/R), legacy separation, legacy limiter
- Locale keys ต้องเพิ่มทั้ง `en.ts` และ `th.ts` — [flight.test.ts:168](../tests/flight.test.ts#L168) บังคับ key parity

#### 0.3 Velocity vector (flight-path) marker
- `hudPainter.ts` เพิ่ม `projectVelocityMarker(camera, position, velocity, width, height, inset)` (pure, export เพื่อ test)
  - จุด = `position + normalize(velocity) × 4000` ผ่าน projection เดียวกับ nose pipper
  - อยู่หน้ากล้องและใน inset → `onScreen`
  - นอกจอหรือหลังกล้อง → clamp ไปขอบ inset ตามทิศจากกลางจอ (หลังกล้องใช้ view-space x/−y) คืน `angle` สำหรับ chevron
  - speed < 1 m/s → ไม่แสดง
- วาด: วงกลม + ปีกแนวนอน + หางขึ้น (FPM มาตรฐาน) สีเดียวกับ pipper; นอกจอ = chevron ชี้ออกที่ขอบ
- ไม่ต้อง plumbing ใหม่: `GlassState.velocity` มีอยู่แล้ว ([hudPainter.ts:57](../src/features/flight/hudPainter.ts#L57))
- Test ใน `hud.test.ts` แบบเดียวกับ `projectRung`: ตรงหน้า → onScreen, หลังกล้อง → ขอบ, อยู่ใน bounds เสมอ

#### 0.4 Scenario harness (closed-loop, ใช้ร่วมกันระหว่าง benchmark และ invariant)
- `benchmarks/flight/harness.ts`: สร้างเครื่องจาก `GameRuntime` snapshot, ตั้ง initial state เอง, เรียก `stepFlight` ตรงที่ `FLIGHT_STEP` (120 Hz), controller ต่อ substep อ่าน state ได้ (closed-loop), บันทึก samples + commands
- Scenarios (F-22, Su-57; alt 2000 m ยกเว้น tail slide 2500 m):

| Scenario | Setup | Controller | ใช้กับ |
|---|---|---|---|
| `hardTurn900` | 900 arcade km/h | pitch 1, 3 s | B13 |
| `fullStick500` | 500 km/h | pitch 1, 3 s | B12 |
| `cobraC` | 450 km/h | C+pull+W จน incidence ≥ 90° (≤ 2.5 s) → C+push จน ≤ 25° (≤ 5 s) → ปล่อย + W ถึง 10 s | B1–B4, B7 |
| `kulbitC` | 450 km/h | C+pull+W+Shift 8 s | B5 |
| `reversal180C` | 450 km/h | C+pull+W จน nose หมุน 180° → ปล่อย + W ถึง 10 s | B15 |
| `tailSlide` | nose ขึ้น 90°, v = 60 m/s ขึ้น | neutral 10 s | B10 |
| `pedalC` | 450 km/h | C+yaw 1+W 3 s | B11 |
| `release45` | 70 m/s, nose เชิด 45° | neutral 2 s | B9 (report เท่านั้น) |
| `sideslip60` | 100 m/s, nose หัน 60° | neutral 1 s | B20 |

- Scenario ที่ใช้ C จะเขียนใหม่เป็นแบบไม่ใช้ C ใน Phase 4 (ชื่อเดิมไม่มี suffix `C`) — ตัวเดิมเก็บไว้เป็น legacy comparison (B17)

#### 0.5 Golden tracks (สำหรับ I4) — **บันทึกเป็น input + output ไม่ใช่ state dump อย่างเดียว**
- ไฟล์ `benchmarks/flight/golden/<scenario>.<aircraft>.json` (commit):
  - `recordedWithProfileVersion` (ข้อมูลเท่านั้น)
  - `initialState` (AircraftState เต็ม)
  - `commands`: open-loop command ที่ controller สร้างขึ้นจริง บีบแบบ run-length (ช่วงคำสั่งคงที่)
  - `samples`: state ทุก 0.25 s
- **Replay path ของตัวเอง** (`harness.replayGolden`) — ไม่ใช้ `runFlightReplay` เพราะมัน reject เมื่อ `profileVersion` ต่าง ([replay.ts:7](../src/game/playground/replay.ts#L7)) ซึ่งจะทำให้ golden ใช้ไม่ได้ทันทีที่ Phase 2 bump version
  - initial state deep-merge ลงบน aircraft ใหม่ (รองรับ field ที่ Phase 1+ เพิ่ม)
  - เปรียบเทียบ recorded numeric leaf ด้วย tolerance `1e-9 · max(1, |x|)`; Phase 1 review เพิ่ม strict equality สำหรับ recorded strings / booleans / null (รวม phase, cause, alive และ burner flags); ignore เฉพาะ field ใหม่
- Open-loop replay ทำให้ Phase 1 เทียบได้โดยไม่ขึ้นกับว่า controller closed-loop ข้าม threshold ต่างกันเพราะ float noise
- **ความเสี่ยงที่ต้องรู้:** scenario ที่หมุนหลายรอบ (Kulbit) อาจขยาย noise ระดับ 1e-16 เกิน 1e-9 ใน 8 s — ถ้าเกิดใน Phase 1 ให้ตัด comparison window หรือผ่อน tolerance **เฉพาะ track นั้น** พร้อมบันทึกเหตุผล ห้ามผ่อนทั้งชุด
- Test `tests/invariants/goldenTracks.test.ts`: replay ทุก golden ต้องตรง samples; ถ้า `flightProfileVersion` ≠ `recordedWithProfileVersion` → **fail พร้อมข้อความให้ regenerate หรือ retire โดยตั้งใจ** (ไม่ skip เงียบ) — Phase 2 ต้องตัดสินใจ retire I4 หรือบันทึกชุดใหม่ใน PR นั้น
- สร้าง/อัปเดต golden: `FLIGHT_GOLDEN=update npm run flight:bench`

#### 0.6 Benchmark runner
- `vitest.bench.config.ts` → `test.include: ['benchmarks/**/*.report.ts']`
  - default vitest include คือ `**/*.{test,spec}.*` จึงไม่ถูก `npm test` เก็บ
- `package.json`: `"flight:bench": "vitest run --config vitest.bench.config.ts"`
- `benchmarks/flight/flightBenchmarks.report.ts`: รันทุก scenario → คำนวณ metrics → เขียน `benchmarks/flight/out/report.json` + `report.md` (ตารางต่อลำ: benchmark ID / value / target / status ok | ⚠ out | report) — ไม่ assert ค่า feel
- `benchmarks/flight/targets.ts`: target range ต่อ benchmark ID (ค่าเริ่มต้นจาก §5.2; B9 = report เท่านั้น)
- `.gitignore`: `benchmarks/flight/out/`
- `tsconfig.json` include เพิ่ม `benchmarks` และ `vitest.bench.config.ts` (ตอนนี้มีแค่ `src`, `tests`, `vite.config.ts` → `tsc -b` จะไม่ตรวจ)
- Metrics ที่คำนวณจาก samples: peak incidence, time-to-threshold, nose rotation สะสม (ผลรวมมุมระหว่าง forward ต่อ substep), velocity heading change (มุม 3D เทียบ entry), speed loss (arcade km/h), altitude loss, mean G, yaw rate, legacy back-to-normal

#### 0.7 Invariant helpers + tests (บังคับตั้งแต่ Phase 0)
- `tests/invariants/helpers.ts`: `assertAircraftValid` (numeric leaf finite, |q| = 1 ± 1e-6), `assertActuatorStep`, seeded PRNG (mulberry32), `runAtFps`
- `tests/invariants/flight.invariants.test.ts`:
  - **I1**: ทุก scenario ทุก substep + fuzz (4 seeds × 2 ลำ, command สุ่มทุก 0.25 s รวม C/Shift/brake, speed เริ่ม 0 / ถอยหลัง / สุ่ม, 6 s, หยุดเมื่อ `alive = false`)
  - **I2**: runtime 30/60/144 FPS, open-loop pattern ที่มี C → snapshot `toEqual`
  - **I3**: replay reproduce; `profileVersion`/`schemaVersion` ผิด → throw
  - **I9**: F-22 yaw capacity ≤ 1e-6 × pitch ที่ thrust 1/10/50/80; Su-57 yaw > 0
  - **I11**: ทุก substep ของ scenario + fuzz: |angle| ≤ maxAngle + 1e-9, |Δangle| ≤ actuatorRate·dt + 1e-9
- `tests/flightInstrumentation.test.ts`: α/β/incidence กรณีรู้คำตอบ; `actualThrust` = thrust ที่ `stepSpeed` คืน; capacity ตรงตาราง §3 ±1% (A0.2 เดิม); legacy floor > 0 ที่ 45 m/s และ = 0 ที่ 150 m/s; powered = 0 นอก PSM
- ถ้า fuzz I1 เจอ NaN ใน physics เดิม → **รายงานเป็น bug แยก** ห้ามแก้ physics ใน Phase 0

#### 0.8 Done เมื่อ
- `npm test` ผ่าน (189 เดิม + invariants ใหม่), `tsc -b` ผ่าน
- `npm run flight:bench` สร้าง report + golden ได้, `flightProfileVersion` = `p3-powered-psm-1` เหมือนเดิม
- `git diff src/game/flight/stepFlight.ts` ว่าง

### Phase 1 — Airflow / Envelope observation
- `airflow.ts`: `observeAirflow(state, profile)`; `stall.ts` / `stepFlight` / vapor อ่านจากที่เดียว
- `envelope.ts`: compute `EnvelopeFactors` แบบ observe-only (ยังไม่มีใครใช้คุม physics ยกเว้นแทนค่าที่เท่ากันเดิม)
- ย้าย hardcoded constants เข้า profile ด้วยค่าเดิม (corner 90/160, lateral 55, psmDrag 0.0025, brake 30, burner 38, High-G 75–190, recovery 17°/60)
- Camera `cinematic` อ่าน `max(decouple(incidence), phase)` แทน phase อย่างเดียว ([FlightCamera.ts:13](../src/render/FlightCamera.ts#L13))
- **ไฟล์:** `airflow.ts`, `envelope.ts` (ใหม่), `stall.ts`, `stepFlight.ts`, `maneuvers.ts`, `speed.ts`, `profileTypes.ts`, `validateProfile.ts`, `content/flight-profiles/*`, `vapor/conditions.ts`, `FlightCamera.ts`, `FlightProfilePanel.tsx`

### Phase 2 — Natural aerodynamics
- Phase 1 review M4 resolved: `highAoa` uses unsigned incidence and independent `aero.alphaNormalDeg` / `aero.alphaCriticalDeg` (§2). Tune the provisional 20°/30° band per aircraft through Phase 2 playtest before treating it as settled handling tuning; stall retains its separate pitch-alpha thresholds.
- Phase 1 review follow-up: retire `AirflowState.legacy` when `maneuvers.ts` and `maneuver.alpha` move to canonical `incidenceDeg`; remove the 0.01 m/s PSM convention and 90°-at-rest telemetry quirk as an explicit, versioned Phase 2 behavior change. Compare/attribute those differences before deliberately retiring I4; do not update goldens to hide them.
- `aerodynamics.ts`: restoring curves, damping attached/separated, α-drag, β-drag
- `stall.ts` → continuous `separation` (hysteresis ผ่าน time smoothing ไม่ใช่ threshold คู่)
- Neutral damper จางตาม highAoa; ลบ `neutralDampingDuringPsm`
- `turnLoss × 0.55` ใน PSM ลบ; `psmDrag` แทนด้วย α-drag ที่ใช้ทุก regime
- **ไฟล์:** `aerodynamics.ts` (ใหม่), `stall.ts`, `stepFlight.ts`, `profileTypes.ts`, profiles, `tests/aerodynamics.test.ts`

### Phase 3 — Engine + Aero/TVC authority allocation
- `engine.ts` (แยกจาก `speed.ts`): governor request → spool → actual thrust; `enginePower` เดิม = actualPower (rig/exhaust ใช้ต่อได้)
- `intent.ts` (`PilotIntent`) + `authority.ts` (`AuthorityBudget` รวม `physicalAero`, `tvc`, `arcadeFloor`) — แยกไฟล์เพื่อบังคับ import boundary §0
- `allocation.ts`: `AllocationStrategy` ตาม §3.3 เรียกด้วย participation = 0 (aero-first) + `AllocationRecord`; requested nozzle angles มาจาก allocation; รวม double-count guard ([stepFlight.ts:57-70](../src/game/flight/stepFlight.ts#L57-L70)) เป็นจุดเดียว
- `tvcCapacity(profile, actualThrust)` จาก `thrustForces()` + `thrustVectoring.gain`
- ลบ `maneuver.pitchRate/yawRate/rollRate`, `fullControlThrust`, `controlAuthority` generic; C เหลือหน้าที่เปิด `limiterOpen = 1` (debug)
- ลบ phase term ใน `tvcAuthority` ([thrustVectoring.ts:15](../src/game/flight/thrustVectoring.ts#L15)) → แทนด้วย capacity
- **Path-rate cap สำหรับ thrust ตั้งฉาก**: การหมุน velocity จาก engine force ใช้ speed floor (`max(speed, aero.pathRateFloorMps)`) แทน `setLength` ล้วน — ปิดช่อง instant-turn (§6 D12)
- **Non-TVC validation profile**: `f22-notvc` (F-22 model/rig, `thrustVectoring: null`, aero เดิม) — Playground/test เท่านั้น
- **ไฟล์:** `engine.ts`, `allocation.ts` (ใหม่), `speed.ts`, `thrustVectoring.ts`, `maneuvers.ts`, `stepFlight.ts`, `WorldState.ts`, `GameRuntime.ts`, `content/aircraft/index.ts`, `content/flight-profiles/*`, `su57Rig.ts`/`flightRig.ts` (อ่าน actual power), tests

### Phase 4 — Automatic breakout + minimal continuous recovery
- **Assumption changed by AD16:** `arcadeControlFloor` is now a near-rest feature, not a low-speed one.
  With `physicalAero` no longer zeroed by the separation band, floor share is available only below
  the per-axis crossover where `q · controlAcceleration < floor.acceleration`: F-22 20.6 / 26.3 / 15.2 m/s
  and Su-57 20.6 / 24.6 / 15.2 m/s (pitch / yaw / roll). Automatic breakout at low speed must not assume
  floor authority between those speeds and the old 55.6 m/s band edge. Do not retune the floor to restore
  the old window without an explicit owner decision.
- **Hard ordering constraint (Phase 3 review):** port legacy path/gravity weights below **before** enabling automatic breakout. Add per-substep `limiterOpen` continuity tests with bounds derived from authored exponential open/close rates in the same change; Phase 3's explicit C debug step is not that invariant.
- Envelope §2 ขับ `alphaLimitDeg` + `gAllowance`; High-G key ยังอยู่แต่ map เข้า `gAllowance` path เดียวกัน
- Port `activeGrip/recoveryGrip/recoveryAcceleration` ([stepFlight.ts:94-97](../src/game/flight/stepFlight.ts#L94-L97)) และ `gravityBlend` ([stepFlight.ts:116](../src/game/flight/stepFlight.ts#L116)) จาก phase → `separation` / lift ตาม q (ไม่งั้นไม่มี path alignment เลยเมื่อไม่มี phase)
- Mouse frame: `psmControl` ([FlightInput.ts:37](../src/game/input/FlightInput.ts#L37), [FlightScene.tsx:69](../src/render/FlightScene.tsx#L69)) → blend `LEVEL_FRAME` ตาม `highAoa` ต่อเนื่อง
- `flightWarning` ([telemetry.ts:13](../src/features/flight/telemetry.ts#L13)) → อ่าน label ไม่ใช่ phase
- Acceptance ใช้ **X** เป็น airbrake (Space ยังเป็น High-G จนถึง Phase 6)
- **ไฟล์:** `envelope.ts`, `controller.ts` (แยกจาก stepFlight), `stepFlight.ts`, `FlightInput.ts`, `FlightScene.tsx`, `telemetry.ts`, `maneuvers.ts`

### Phase 5 — Recovery assist
- `recovery.ts`: activity (attack fast, release `delaySeconds`) → `recoveryAssist` → damping, anti-spin, nose precision, path alignment ภายใน authority จริง + drag ต่อ path rotation ที่ q ต่ำ
- **ไฟล์:** `recovery.ts` (ใหม่), `envelope.ts`, `stepFlight.ts`, profiles

### Phase 6 — Remove legacy gates
- `PilotCommand`: ลบ `psmArm`, `highG` (replay format → bump schema/profile version)
- ลบ phase machine (`maneuvers.ts` เหลือ burner/airbrake หรือย้ายเข้า `engine.ts`)
- Space = Air Brake; X ว่าง; Shift contextual (burner boost ใน §2 + governor); Q/E ramp
- HUD: ลบ PSM speed band; flags ใช้ labels
- Locales help text, `docs/game-design/02-controls.md`, `04-maneuvers.md`, `docs/flight-profiles.md`
- **ไฟล์:** `commands.ts`, `FlightInput.ts`, `maneuvers.ts`, `practice.ts`, `replay.ts`, `PlaygroundHud.tsx`, `hudPainter.ts`, `FlightInstruments.tsx`, `FlightPage.tsx`, `locales/*`, `content/schemas.ts`, tests `maneuvers`/`poweredPsm`

### Phase 7 — Camera + HUD polish
- Camera: velocity-look share cap ~0.35–0.5 (จาก 0.88), offset lag ตาม decouple, up smoothing ช้าลงเมื่อ rate สูง, FOV ตาม decouple, ไม่มี phase
- HUD: regime tone, AoA bracket, departure warning ไม่รบกวน
- **ไฟล์:** `FlightCamera.ts`, `hudPainter.ts`, `FlightInstruments.tsx`

### Phase 8 — Aircraft validation
- F-22, Su-57 tuning ตาม personality; non-TVC จริง (F/A-18 หรือ F-16) ต้องมี model + rig (`presentationIds` มีแค่ `f22`/`su57` [schemas.ts:4](../src/content/schemas.ts#L4))
- **ไฟล์:** `content/flight-profiles/*`, `content/aircraft/index.ts`, `render/aircraft/*`, `docs/flight-profiles.md`

### Phase 9 — FX / Audio / Maneuver detector
- `feedback.ts`, vapor/vortex ใช้ separation/β, buffet shake, `src/audio/*`, `maneuverDetector.ts`

---

## 5. Acceptance: Hard Invariants vs Tuning Benchmarks

### 5.0 Policy

| | Hard Invariants | Tuning Benchmarks |
|---|---|---|
| ตรวจอะไร | กฎ physics/architecture ที่ผิดแล้วคือ bug | game feel |
| ที่อยู่ | `tests/**/*.test.ts` (`npm test`, CI) | `benchmarks/flight/*` (`npm run flight:bench`) |
| ผลเมื่อไม่ผ่าน | **fail build** | report แสดง ⚠ นอก target range, ไม่ fail |
| ตัวเลข | tolerance เชิงตัวเลข (ε) หรือค่าที่ profile ตั้งเอง | target range ปรับได้ใน `benchmarks/flight/targets.ts` |
| Promotion | – | เมื่อ tuning นิ่ง (หลัง Phase 8) เลือกบางตัวเป็น regression range ±10–15% แล้วย้ายเข้า tests |

**กฎเขียน invariant:** ต้องไม่มีตัวเลข feel — threshold ต้องเป็น ε, ค่าจาก profile (`maxRate`, path-rate cap), หรือเทียบกับงานทางฟิสิกส์ ถ้าต้องเลือกตัวเลข "กี่วินาที/กี่องศาถึงดี" = benchmark

**Legacy tests ที่เป็น feel** (เช่น `flightHandling`: High-G tighter path, `maneuvers`: Cobra OR 180° reversal, `poweredPsm`): คงไว้จน phase ที่ตั้งใจเปลี่ยนพฤติกรรมนั้น แล้ว **ย้ายเป็น benchmark** พร้อมบันทึกใน PR ไม่ลบเงียบ ส่วนที่เป็น invariant (determinism, replay version, nozzle limits) คงเป็น test

### 5.1 Hard Invariants

ID คงที่; คอลัมน์ Phase = phase ที่เริ่มบังคับ (บังคับต่อจากนั้นทุก phase)

| ID | Invariant | ตรวจอย่างไร | Phase |
|---|---|---|---|
| I1 | **No NaN / invalid state**: position, velocity, rates finite; \|quaternion\| = 1 ± 1e-6 | ทุก tick ใน trace + fuzz input (random seeds), รวม speed ≈ 0 และ reverse flow | 0 |
| I2 | **Determinism**: 30/60/144 FPS → snapshot เท่ากันแบบ exact (`toEqual` เหมือน tests เดิม เช่น [poweredPsm.test.ts:166](../tests/poweredPsm.test.ts#L166)) | ทุก scripted track | 0 |
| I3 | **Replay/version**: replay ต่าง `flightProfileVersion` หรือ command schema ถูกปฏิเสธ; replay เดียวกันเล่นซ้ำได้ตรง | `replay.ts` | 0 |
| I4 | **Refactor neutrality**: Phase 1 state ทุก field ต่างจาก golden Phase 0 ≤ `1e-9 · max(1, |x|)` ตลอด trace — ไม่ใช้ hash เพราะการย้ายสูตร (เช่น `Math.hypot` vs inline, ลำดับคูณ) เปลี่ยน bit โดยพฤติกรรมไม่เปลี่ยน | golden traces | 1 |
| I5 | **Airflow consistency**: `alphaDeg` = `angleOfAttack()`; β-independent; incidence ∈ [0,180]; `confidence → 0` ที่ airspeed < 2 | unit (reuse กรณีใน `stall.test.ts`) | 1 |
| I6 | **Restoring zeros**: moment = 0 ที่ incidence 0° และ 180°; stiffness ≥ 0; knots เรียง | unit + `validateProfile` | 2 |
| I7 | **Continuity**: `separation`, `limiterOpen` ไม่กระโดด > ε ต่อ substep (ε มาจาก rate ใน profile × dt) | trace | 2 |
| I8 | **Aero ไม่ขึ้นกับ input**: aero moment ด้วย state เดียวกัน command ต่างกัน = เท่ากัน | unit | 2 |
| I9 | **TVC geometry**: F-22 yaw capacity ≤ 1e-6 · pitch capacity (cant 0) | `thrustForces()` | 0 (ตรวจ) / 3 (บังคับผ่าน budget) |
| I10 | **TVC ∝ thrust**: capacity = 0 เมื่อ actual thrust = 0; linear ± ε | unit | 3 |
| I11 | **Actuator limits**: \|angle\| ≤ `maxAngle`, \|Δangle\|/dt ≤ `actuatorRate` | ทุก tick | 0 |
| I12 | **Budget respected**: `AllocationRecord` ทุกแกน `aero ≤ physicalAero`, `tvc ≤ tvc budget`, `floor ≤ floorAvail`, `aero+tvc+floor ≤ |request|` | ทุก tick | 3 |
| I13 | **Non-TVC ไม่มี powered authority**: `thrustVectoring: null` → `budget.tvc = 0`, `record.tvc = 0`, `poweredControlAvailable = 0` ทุก tick แม้ Shift/brake/limiterOpen = 1 | `f22-notvc` fuzz | 3 |
| I14 | **Floor เป็น gap-fill + ceiling**: `floor > 0` เฉพาะเมื่อ `physicalAero + tvc < floor.acceleration`; rate ที่ floor พาไป ≤ `maxRate` + ε; floor ไม่ขึ้นกับ thrust/powerIntent | unit + fuzz | 3 |
| I15 | **Assist ไม่สร้าง authority**: stability/recovery assist ไม่เพิ่ม \|rate\| ในทิศ request เกิน allocation (damping/อยู่ใน budget เท่านั้น) | property test | 3 (stability) / 5 (recovery) |
| I16 | **Intent/capability boundary**: `PilotIntent` ไม่ขึ้นกับ profile; `AuthorityBudget` ไม่ขึ้นกับ command (ทดสอบด้วยการสลับ input) + lint rule / import check | unit | 3 |
| I17 | **Governor**: requested power ไม่เพิ่มจาก α-drag, β-drag, brake (เทียบ state เดียวกัน drag ต่างกัน) | unit | 3 |
| I18 | **Energy bound**: Δ(v²/2 + g·h) ≤ ∫(thrust·v̂)dt − ∫(drag+brake)·v dt + ε ต่อ step | ทุก tick | 3 |
| I19 | **No instant path reversal จาก engine/lateral force**: ส่วนของ velocity heading rate ที่มาจาก engine force + lateral path force ≤ cap จาก profile (`pathRateFloorMps`) ทุก speed — **ไม่รวม gravity** (ที่ 5 m/s gravity เดียวก็หมุน velocity ได้ ≈ g/v ≈ 2 rad/s ซึ่งถูกต้อง) | fuzz ที่ speed 0–20 m/s + burner; วัดจาก force decomposition ต่อ step | 3 |
| I20 | **Recovery ไม่แย่ง**: input activity เกิน threshold → `recoveryAssist = 0` | ทุก tick | 5 |
| I21 | **No legacy gates**: `PilotCommand` ไม่มี `psmArm`/`highG`; flight ไม่อ่าน `maneuver.phase`; `FlightCamera` ไม่อ่าน phase | type + grep test | 6 (camera: 7) |
| I22 | **Detector pure**: มี/ไม่มี detector → state hash เท่ากัน | trace | 9 |

### 5.2 Tuning Benchmarks

Report ต่อลำ (F-22, Su-57, `f22-notvc`; ภายหลังลำอื่น) ตัวอย่าง:

```text
[F-22]                              value     target      status
Cobra Peak AoA                      86°       75–95°      ok
Cobra Time to 90°                   0.94 s    0.7–1.2 s   ok
Cobra Speed Loss                    142 km/h  100–220     ok
Cobra Velocity Heading Change       11°       ≤ 20°       ok
Recovery Assist Full                0.82 s    0.5–1.5 s   ok
Back to Normal                      2.4 s     (report)    –
Kulbit 360° Time                    4.3 s     3.0–4.5 s   ok
```

| Benchmark | ความหมาย | เริ่ม report | Target เริ่มต้น (ปรับได้) |
|---|---|---|---|
| B1 `cobra.peakAoa` | incidence สูงสุด | 0 (ผ่าน C) | 75–95° TVC |
| B2 `cobra.timeTo90` | เวลาถึง 90° | 0 | 0.7–1.2 s |
| B3 `cobra.speedLoss` | arcade km/h | 0 | report |
| B4 `cobra.headingChange` | velocity heading เปลี่ยน | 0 | ≤ 20° |
| B5 `kulbit.time360` | nose rotation 360° | 0 | 3–4.5 s TVC; notvc = ไม่ถึง |
| B6 `recovery.assistFull` | เวลา `recoveryAssist ≥ 0.9` | 5 | 0.5–1.5 s |
| B7 `recovery.backToNormal` | เวลาถึง label NORMAL | 2 | report (อาจหลายวินาที) |
| B8 `recovery.naturalDuringDelay` | incidence เปลี่ยนระหว่าง delay | 2 | > 0 |
| B9 `natural.release45` | seed 45° ปล่อย: incidence ที่ 0.2/0.5/1.5 s, max rate | 2 | ตั้งจาก **playtest Phase 2** (Phase 0 ไม่มี baseline เพราะ physics เดิมไม่มี restoring) |
| B10 `tailSlide.flipTime` | เวลาหัวลงต่ำกว่า horizon | 2 | ≤ 4 s |
| B11 `pedal.yawRate` | post-stall yaw rate Q/E 2 s | 3 | F-22 ≤ 50% Su-57 |
| B12 `beginner.fullStick500.peakAoa` | ไม่มี brake/burner 3 s | 4 | ≤ 25°, limiterOpen ≤ 0.35 |
| B13 `hardTurn900` | peak incidence, sustained G, speed loss | 0 | incidence ≤ αNormal+5°; G > golden |
| B14 `psmIntent.timeTo70` | 450 km/h + brake + Shift + pull | 4 | ≤ 1.2 s |
| B15 `reversal.headingChange` / `altitudeLoss` | 180° reversal | 0 | report |
| B16 `limiter.chatter` | จำนวนเปลี่ยนทิศใน speed sweep | 4 | ≤ 2 |
| B17 `cVsAuto.peakDelta` | C debug vs auto | 4 | ≤ 15° |
| B18 `handoffRateDip` | rate dip ตอน aero อิ่มตัว → TVC | 3 | report (ตัดสินใจเรื่อง participation) |
| B19 `notvc.maxRotation3s` | `f22-notvc` full pull + brake + Shift | 3 | < 180° |
| B20 `sideslip60.speedLoss1s` | β 60° ที่ 100 m/s | 2 | > golden +30% |
| B21 `camera.pipperOnScreen` / `upRate` | incidence 60° / Kulbit | 7 | pipper in frame; up rate ≤ limit |
| B23 `crossflow.authorityFraction` | `physicalAero` ที่ β 30/60/90 เทียบ β = 0 ต่อแกน (100 และ 45 m/s) | 3 | report (ตั้ง target ใน Phase 8) |
| B24 `crossflow.dampingFraction` | damping coefficient ที่ β 30/60/90 เทียบ β = 0 | 3 | report |
| B25 `crossflow.rateFraction` | rate ที่ทำได้จาก full stick 1 s ที่ β 30/60/90 เทียบ β = 0; ที่ 100 m/s authority ยังเกิน demand (≈1) ที่ 45 m/s request อิ่มตัวจึงเห็นผลจริง | 3 | report |
| B22 `personality.matrix` | Cobra/Kulbit/pedal/speed loss/time-to-normal ลำดับตามตาราง personality | 8 | ลำดับถูก |

B1–B5, B13, B15 มี golden ของ physics เดิม (ผ่าน C) ตั้งแต่ Phase 0 เพื่อเทียบก่อน-หลังทุก phase

---

## 6. จุดที่ไม่เห็นด้วย / ปรับจากข้อเสนอ (อ้าง codebase)

**D1 — Recovery ต้องมาก่อนลบ gates และต้องมี minimal port ใน Phase 4**
Path alignment ทั้งหมดตอนนี้ key ด้วย phase: `activeGrip/recoveryGrip` และ `recoveryAcceleration` ([stepFlight.ts:94-95](../src/game/flight/stepFlight.ts#L94-L95)), `gravityBlend` ([stepFlight.ts:116](../src/game/flight/stepFlight.ts#L116)) — phase เกิดจาก C เท่านั้น ถ้า Phase 4 breakout ไม่ผ่าน C แต่ recovery มาทีหลัง gate removal เครื่องจะไม่มี path alignment post-stall เลย → playtest Phase 4–5 จะหมุนควง/ลอย ดังนั้น: port grip → separation ใน Phase 4, recovery assist เต็มใน Phase 5, ลบ gates Phase 6

**D2 — Velocity marker + camera re-key ต้องมาเร็ว (Phase 0–1) ไม่ใช่ Phase 7**
HUD ไม่มี flight-path marker (painter รับ `velocity` แต่ไม่วาด) — ไม่มีมันจะ tune Phase 2–4 ด้วยตาไม่ได้ Camera `cinematic` เปิดเฉพาะ phase ([FlightCamera.ts:13](../src/render/FlightCamera.ts#L13)) → post-stall แบบไม่มี C จะดูเหมือนไม่มี drift เลย ทำให้ playtest ผิดเพี้ยน Polish ยังอยู่ Phase 7

**D3 — Phase 4 acceptance "Space + Shift + pull" ใช้ไม่ได้ก่อน Phase 6**
Space = High-G, X = airbrake ([FlightInput.ts:41-42](../src/game/input/FlightInput.ts#L41-L42)) ดังนั้น Phase 4 ทดสอบด้วย X; ย้าย binding ใน Phase 6 พร้อม command format change ครั้งเดียว

**D4 — "Sustained demand" เป็นตัวแยกแยะที่อ่อน**
Mouse stick เป็น positional — ตำแหน่งคงอยู่เมื่อหยุดขยับ ([mouseStick.ts](../src/game/input/mouseStick.ts) `moveStick` clamp แล้วถือไว้) ผู้เล่น dogfight ที่ลาก mouse ไปขอบจะ "sustained" โดยอัตโนมัติ จึงให้น้ำหนัก `T` ต่ำ และให้ตัวแยก breakout เป็น `E` (q) และ B/Pi; ตาม P4-1 owner decision ให้ `S` (ชน rate limit จริง) คุม automatic G เท่านั้น

**D5 — TVC capability ไม่ควรคำนวณจาก "actual nozzle deflection"**
`tvcTargets()` ได้ angle จาก command ([thrustVectoring.ts:22-28](../src/game/flight/thrustVectoring.ts#L22-L28)) ถ้า capacity = f(actual angle) จะวนกลับ: angle เล็ก → capacity เล็ก → allocation ขอน้อย → angle เล็ก ใช้ **capacity = max deflection × actual thrust × geometry** สำหรับ allocation และ **actual angle** สำหรับ moment ที่ใช้จริง (ตรงกับ `vectoredThrust` เดิม)

**D6 — Arcade assist ต้องมี minimum low-q control floor** → **resolved Rev. 3** เป็น `arcadeControlFloor` แยกจาก physical aero (§3.2, I13–I14)
ของเดิม `authority` floor 0.12 ([stepFlight.ts:26](../src/game/flight/stepFlight.ts#L26)) และ `stall.controlAuthority 0.25` คือสิ่งที่ทำให้ non-TVC ยังคุมได้ที่ความเร็วต่ำ

**D7 — Autothrottle ต้องไม่ชดเชย drag ที่ไม่ใช่ base drag**
ถ้า governor "ถือความเร็ว" จริงตอน α-drag/brake สูง จะ request power เต็มเอง → TVC authority ฟรีโดยไม่กด Shift ของเดิม trim เฉพาะ `drag·v²` ([speed.ts:33](../src/game/flight/speed.ts#L33)) — คงกฎนี้ไว้อย่างชัดเจน (I17)

**D8 — Engine spool ไม่ควรอยู่ Phase 0–1**
Thrust ปัจจุบันเกิดทันทีต่อ step; spool เพิ่ม lag = handling change ซึ่งขัดกับ "Phase 1 ไม่เปลี่ยน handling" และทำ golden traces เทียบไม่ได้ Phase 0 สังเกต thrust เดิมได้อยู่แล้ว → engine ย้ายไป Phase 3 ที่ต้องใช้ actual thrust กับ TVC

**D9 — Geometry TVC จริงอ่อนกว่า authority ปัจจุบันราว 4 เท่า**
§3: F-22 pitch ~3.45 rad/s² ที่ burner เทียบกับ ~13 rad/s² ของ PSM envelope เดิม ถ้าไม่มี scale Cobra/Kulbit จะช้าลงชัดเจน → ต้องมี `thrustVectoring.gain` scalar เดียว (รักษาสัดส่วนแกน ทำให้ F-22 yaw = 0 ยังคงอยู่)

**D10 — Non-TVC validation ต้องมีตั้งแต่ Phase 3 ไม่ใช่ Phase 8**
Acceptance Phase 3 ("non-TVC ต้องไม่ได้ authority ฟรี") ต้องมี profile ทดสอบ แต่ aircraft ต้องมี model + rig (`presentationIds = ['f22','su57']` [schemas.ts:4](../src/content/schemas.ts#L4), `rigFactories` [flightRig.ts:53](../src/render/aircraft/flightRig.ts#L53)) → ใช้ `f22-notvc` (F-22 model, `thrustVectoring: null`) เป็น validation variant; F/A-18/F-16 จริงรอ Phase 8

**D11 — Phase 2 ต้องแตะ neutral damper**
ไม่งั้น B8/B9 (natural response) ไม่เกิด: `neutralResponse 9` + F-22 `neutralDampingDuringPsm: true` ([stepFlight.ts:46](../src/game/flight/stepFlight.ts#L46)) หักล้าง restoring เหลือ ≈ 1/9

**D12 — Energy guard กับ thrust ตั้งฉาก velocity ที่ความเร็วต่ำ**
`velocity.setLength(poweredSpeed)` ([stepFlight.ts:111](../src/game/flight/stepFlight.ts#L111)) ทำให้ thrust ตั้งฉากหมุน path ได้แต่ไม่เพิ่ม speed; ที่ 5 m/s burner ตั้งฉาก ~40 m/s² หมุน path ได้ ~4 rad/s — อาจกลายเป็น "เปลี่ยนทิศเกือบทันที" หลัง Cobra ผลนี้ energy-neutral จึงหลุด I18 แต่ **คือ free instant-turn ที่ design ข้อ 7 ห้าม** และเกิดได้แล้ววันนี้ด้วย C + Shift → ใส่ path-rate cap ใน Phase 3 (ที่ engine force/vectored thrust ถูกแก้อยู่แล้ว) + I19 ไม่เลื่อนไป Phase 4–5

**เห็นด้วยทั้งหมดโดยไม่มีข้อแย้ง:** ลด scope Phase 2 (AD แยก A/B/C/D), body axes (AD5), แยก AirflowState/EnvelopeFactors (AD4), restoring curve ต่อลำ (AD7), engine แบบง่าย + thrust ≠ acceleration (AD9), recovery หลัง delay และไม่ใช่เวลาบังคับกลับ NORMAL (AD10)


---

## Errata — Rev. 3.1 candidates

> บันทึกจาก Phase 0 fix review — **ยังไม่เลือกสัญญา capacity หรือวิธีแก้ physics สำหรับ Phase 3**
> ข้อเท็จจริงด้านล่างมาจาก runtime ปัจจุบัน (`p3-powered-psm-1`); owner ต้องตอบคำถามที่ระบุก่อนเริ่ม Phase 3
> รอบนี้แก้เอกสาร instrumentation tests และ presentation ตาม sign-off E4 ไม่แก้ `stepFlight`, geometry, profile, gain หรือ golden ทั้ง 18 tracks

### E1 — Pitch capacity: max absolute / nose-up table / ±1% ขัดกัน

สามข้อเป็นจริงพร้อมกันไม่ได้:

- §0.1 กำหนด `tvcCapacity.pitch = max |pitch|` จาก nozzle ทั้งสองเต็ม ±
- ตาราง TVC ใน §3 แสดงค่า **nose-up**
- §0.7 กำหนดให้ capacity ตรงกับตาราง §3 ภายใน ±1%

ผล sweep `thrustForces()` ทุกคู่ `(left, right)` ใน ±maxAngle ทีละ 0.5°
(ตัวเลข rad/s²; nose-down ในตารางนี้เป็นขนาดสัมบูรณ์ แต่ solver คืน pitch ติดลบ):

| เครื่อง | Thrust (m/s²) | Nose-up | Nose-down magnitude | Pitch ในตาราง §3 |
|---|---:|---:|---:|---:|
| F-22 | 27.5 | 1.45774 | 1.54376 | 1.46 |
| F-22 | 65 | 3.44557 | 3.64888 | 3.45 |
| Su-57 | 27.5 | 1.30219 | 1.34722 | 1.30 |
| Su-57 | 65 | 3.07790 | 3.18433 | 3.08 |

ตาราง §3 ตรงกับ nose-up ตาม precision ที่แสดง **ไม่ได้ละพจน์ engine-height moment**
พจน์ `−height·dx` ใน `thrustForces` โดย `dx = engine·(cosθ−1)`
เกิดจากแรงขับตามแกนที่ลดลงเมื่อ nozzle เบน และให้ pitch moment เครื่องหมายเดียวกันเมื่อเบน ±
จึงลด nose-up แต่เพิ่มขนาด nose-down ทำให้ nose-down มากกว่า **+5.9% (F-22) / +3.5% (Su-57)**
helper ตาม §0.1 ปัจจุบันจึงคืนค่าสูงสุดฝั่ง nose-down

**ทางเลือกสำหรับ owner (ยังไม่ตัดสินใจ):**

- **(ก)** เปลี่ยน §0.1: คืน capacity แยกทิศ หรือคืน `min` ของสองทิศเป็นขอบเขต conservative;
  ถ้าแยกทิศ ต้องระบุว่า controller/allocation เลือก budget ตามเครื่องหมาย request อย่างไร
- **(ข)** คง `max`: แก้ตาราง §3 เป็น nose-down พร้อมระบุขอบเขตของ scalar maximum
  และเขียนให้ชัดว่า gain calibration ใช้ทิศใด; scalar max ไม่รับประกัน authority ฝั่งที่อ่อนกว่า

**Owner ต้องตอบก่อน Phase 3:** จะใช้ (ก) แบบแยกทิศหรือ conservative min หรือใช้ (ข)?
จะ calibrate `thrustVectoring.gain` ด้วยค่า signed nose-up สำหรับ Cobra/Kulbit และตรวจ nose-down แยกอย่างไร?
จะปรับ §0.7 ให้เปรียบเทียบ direction/precision เดียวกันอย่างไร?
อย่าใช้ nose-down maximum แทน pull authority โดยไม่ระบุ เพราะจะ over-state nose-up authority
ที่ใช้เทียบกับ golden Cobra/Kulbit ตาม §3 และ §6 D9

### E2 — Legacy floor ที่ 45 m/s เป็นข้อผิดพลาดใน spec

§0.7 สั่ง `legacy.floorRate > 0` ที่ 45 m/s แต่สูตร §0.1 และ runtime คือ
`max(0, 0.12 − v/90)` จึงมีส่วน floor เฉพาะ **v < 10.8 m/s** และเป็นศูนย์ที่ 45 / 150 m/s
Phase 0 tests ตรวจ 0, 5, 10.8, 45, 90, 150, 300 m/s ตามสูตรจริงแล้ว
candidate สำหรับ Rev. 3.1 คือแก้ตัวอย่าง assertion ใน §0.7 เป็น 5 m/s (หรือค่าอื่นต่ำกว่า 10.8)
และคง assertion ว่าเป็นศูนย์ที่ 45 / 150 m/s; ห้ามปรับ physics เพื่อให้ผ่านตัวเลข 45 เดิม

### E3 — F-22 yaw ไม่เป็นศูนย์สำหรับมุม nozzle ไม่สมมาตร

ข้อความใน §3 / §6 D9 และ I9 ที่ถือว่า cant 0 ทำให้ yaw เป็นศูนย์ทุกกรณีไม่ตรง runtime:
เมื่อ `|left| = |right|` พจน์ differential axial thrust หักล้างกันจริง แต่ถ้าขนาดมุมต่างกัน
แรงขับตามแกนสองฝั่งต่างกันและเกิด yaw ผ่าน `z·dx` ใน torque

ผล full-grid sweep ทีละ 0.5°:

| เครื่อง | Thrust (m/s²) | max ∣yaw∣ (rad/s²) | ตัวอย่างมุม (left, right) |
|---|---:|---:|---|
| F-22 | 27.5 | 0.01351 | (−20°, 0°) |
| F-22 | 65 | 0.03193 | (−20°, 0°) |
| Su-57 | 27.5 | 0.76482 | (−18°, +18°) |

F-22 full-grid max yaw ≈ **0.927% ของ nose-up pitch** จึงใช้ขอบเขต
`max |yaw| ≤ 0.01 × nose-up pitch` ใน I9 ของ Phase 0 ตาม fix review นี้
เป็น geometry bound ไม่ใช่ target feel; test เรียก `thrustForces()` โดยตรงทั้ง grid
และคง zero-yaw assertion เฉพาะ equal-magnitude travel พร้อมตรวจ Su-57 yaw > 0

**ข้อแก้ไขหลักฐานเรื่อง reachability:** profile F-22 ปัจจุบันมี `rollGain = 6°`, `yawGain = 0`
ดังนั้น differential 10° และคู่ (−20°, 0°) ใน full grid ไม่ใช่ target ที่ mixer นี้สั่งได้โดยตรง
แต่ `tvcTargets({ pitch: −0.7, roll: 1 }, 1, profile)` ให้คู่ **(−20°, −8°)** ซึ่งมี
|yaw| = **0.01133 / 0.02678 rad/s²** ที่ thrust **27.5 / 65** ตามลำดับ
command sweep ที่ authority 1 ยืนยันว่า reachable asymmetric yaw ไม่เป็นศูนย์เช่นกัน
ข้อจำกัด reachability นี้ไม่ทำให้ข้อผิดพลาดของ zero-yaw contract หายไป

**ผลต่อ Phase 3:** ถ้าประกาศ `budget.tvc.yaw = 0` สำหรับ F-22 แต่ `thrustForces`
ที่ actual deflection ยังให้ yaw ≠ 0 budget จะไม่ bound moment ที่ส่งออกจริง
I12/I13 ตามที่เขียนไว้ตรวจ `AllocationRecord` และ budget ไม่ได้ตรวจ actual torque จึงจับช่องว่างนี้ไม่ได้
ทั้ง pitch sign และ yaw cross-coupling ต้องได้รับคำตอบก่อนนำ helper ไปใช้เป็น authority budget

**Owner ต้องตอบก่อน Phase 3:** จะรวม coupled yaw ใน budget อย่างไร หรือจะมีนโยบายแยก
commanded authority ออกจาก coupled physical moment แบบใด? จะเพิ่ม invariant ที่เทียบ
actual actuator torque กับขอบเขตที่ประกาศอย่างไร (รวมช่วง actuator travel)?
ให้ owner อนุมัติ contract และการตรวจ actual moment ก่อนเปลี่ยน solver/allocator;
Phase 0 รอบนี้เพียงเปิดเผยข้อขัดแย้ง ไม่เลือกวิธีแก้ physics


### E4 — Phase 0 pipper/FPM shape sign-off

**Owner ตอบใน fix round นี้:** “คืน pipper เดิม แล้วเปลี่ยนรูป FPM”
จึงคืน `drawNosePipper` เป็นวงกลม+ปีก+หางเดิม และใช้ FPM เป็นสี่เหลี่ยมข้าวหลามตัดมีปีกสั้น
สีเดียวกับ pipper; off-screen chevron, projection, low-speed hiding คงเดิม
นี่เป็นข้อยกเว้นด้าน presentation ที่ owner อนุมัติแทนรูปวงกลมของ FPM ใน §0.3
ไม่ใช่การเปลี่ยน physics, control หรือ capability


## Phase 3 contract resolution — 20 September 2026

The owner authorized the proposed E1/E3 contract: **positive/negative command
capacity, separate coupled physical moments, and bounds on actual actuator torque
throughout travel**. Implemented in `tvcMomentCapacity`, `computeBudget`, the
reachable two-nozzle solve and per-step force ledger. The raw geometry solver and
its signed reference tables remain unchanged; one scalar gain scales all angular axes.
F-22 commanded yaw is zero while its small asymmetric axial-thrust yaw is retained
and bounded as coupled physics. Independent pitch/yaw/roll capacities are not a
simultaneously reachable actuator box.

[Phase 3 implementation report](psm-phase3-implementation.md) records tests,
benchmark deltas, calibration and two scope qualifications: legacy path/gravity
phase weights remain until the Phase 4 port, and a signed longitudinal speed
zero crossing is distinguished from the capped transverse path rotation. The
manual debug limiter may step to 1; automatic smoothed limiter opening remains Phase 4.
No automatic breakout, input remapping, full recovery assist or maneuver detector was added.


## Aero flow effectiveness resolution — 20 September 2026

Owner decisions on the four review findings, and what was implemented for each.

1. **Hard-zero `physicalAero` — model corrected.** `computeBudget` no longer multiplies by
   `(1 − separation)`. Angular authority is `q · confidence · aeroFlowEffectiveness · controlAcceleration`
   (AD16). Dynamic pressure alone carries the low-speed loss, so the 300–350 arcade km/h band can no
   longer zero the control surfaces as a side effect, and no magic floor was added inside `physicalAero`.
   `stall.severity` now reaches angular authority through no path at all.
2. **Restoring — physics unchanged, contract documented.** `naturalAerodynamics` keeps restoring free of
   any separation factor; the AD7 stiffness curve remains the only representation of post-stall static
   stability loss. Pinned by `restoringSeparationIndependence` in `tests/aerodynamics.test.ts`.
3. **Crossflow — airflow-derived effectiveness, not `highAoa`.** `aeroFlowEffectiveness` reads
   `AirflowState` and `AeroProfile` only. `AuthorityBudget` still never sees `EnvelopeFactors`; the
   Phase 3 import check in `tests/invariants/phase3.test.ts` is unchanged and a second check forbids a
   stall import in `authority.ts`. Damping blends with `max(separation, 1 − effectiveness)`, so pure
   sideslip damps as separated flow while the owner's pitch-alpha stall decision stands untouched.
   B23–B25 in `benchmarks/flight/crossflow.report.ts` measure authority, damping and achieved rate at
   β = 30/60/90, which B20's speed loss cannot see. They run at 100 m/s, where authority still exceeds
   the full-stick request and only the budget moves, and at 45 m/s, where the request saturates: yaw
   rate there falls to 0.156 (F-22) and 0.080 (Su-57) of the β = 0 value at β = 90.
4. **Naming — renamed before Phase 4.** `stall.recoveryAoaDeg` → `separationAttachedAoaDeg`,
   `recoverySpeedKph` → `separationAttachedSpeedKph`, `entrySeconds` → `separationEntrySeconds`,
   `recoverySeconds` → `separationRecoverySeconds`. `entrySeconds` was renamed for symmetry with the
   pair the owner named. `stallSpeedKph` and `criticalAoaDeg` are the opposite edges of the same two
   bands and are equally misleading; they were left alone pending an owner decision.

`flightProfileVersion` is `p3-flow-effectiveness-4`. I4 stays retired against the Phase 0 archive
(`benchmarks/flight/goldenPolicy.ts`); goldens were not regenerated, so the Phase 0 comparison baseline
is preserved. Out of scope and unchanged: automatic breakout, recovery assist, the legacy
`surfaceControl` / `gravityBlend` path-grip weights that still read `stall.severity`, and all
`arcadeControlFloor` tuning.
