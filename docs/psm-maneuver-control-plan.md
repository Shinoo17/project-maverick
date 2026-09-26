# Maneuver & Control Rework — แผนใหม่ (Rev. 5 draft)

> สถานะ: **D1–D6, D8, D9 ตอบแล้ว, D7 ยังเปิด** (§7). ความคืบหน้า: MR0 ส่งแล้ว ([report](psm-mr0-implementation.md))
> Baseline: commit `77333d9`, physics `p8-pedal-turn-1`, command schema 2
> Core Separation Rules ใน [psm-implementation-plan.md §0](psm-implementation-plan.md) ยังใช้ทุกข้อ ท่าทุกท่าต้องเกิดจาก input + physics ไม่มี state, animation หรือปุ่มทำท่า
> แผนนี้แทนงานที่เหลือของ Phase 8 (personality/effectiveness/breakout/B23) โดยรวมเข้า MR7 และมาก่อน Phase 9

## 0. เป้าหมายจาก owner (26 ก.ย. 2026)

1. การบังคับต้อง smooth กว่านี้ และต้องมีคำแนะนำการใช้เมาส์ที่เล่นง่าย
2. ทำท่าเหล่านี้ได้: Herbst, pedal turn, power loop, Kvochur's Bell, Immelmann (รวม Cobra และ Kulbit เดิม)
3. roll rate เร็วสมจริง
4. Space + pitch up ต้องเข้า high AoA เร็วขึ้น เพื่อทำ Cobra เร็ว และกดหัวกลับลงมาที่ระดับเดิมได้ง่าย

---

## 1. Baseline ที่วัดได้ (ก่อนแก้)

วัดด้วย probe ชั่วคราวผ่าน `benchmarks/flight/harness.ts` (`runTrack`) ที่ 120 Hz, สูง 3000 m, เริ่ม trim. ความเร็วเป็น arcade km/h (HUD). MR0 จะย้าย script เหล่านี้เข้า report ถาวร

### 1.1 Roll (full roll, level)

| ความเร็ว | Peak rate | เวลาถึง 90° | สิ่งที่จำกัด |
|---:|---:|---:|---|
| 250 | 35°/s | 2.9 s | **budget-limited**: aero 2.79 rad/s² ใช้หมด, unmet 2.48, servo damping −2.75 |
| 450 | 105°/s | 1.06 s | ผสม |
| 700 | 116°/s | 0.97 s | **target-limited**: aero budget 21.8 แต่ใช้แค่ 10.3; rate = `rollRate 2.1 × speedAuthority` |
| 1000 | 97°/s | 1.11 s | target-limited (`speedAuthority` ลดที่ความเร็วสูง) |

F-22 กับ Su-57 เท่ากันทุกค่า เพราะใช้ `rollRate` และ `controlAcceleration.roll` ชุดเดียวกัน ยังไม่มีลำไหนหมุนครบ 360° ใน 3 s

### 1.2 Cobra entry (Space + full pull, level)

| ลำ | ความเร็ว | Shift | 30° | 60° | 90° | Peak incidence |
|---|---:|---|---:|---:|---:|---:|
| F-22 | 450 | – | 0.74 s | 1.23 s | 2.08 s | 97° |
| F-22 | 450 | ✓ | 0.61 s | 0.92 s | 1.38 s | 116° |
| Su-57 | 450 | – | 0.78 s | 1.29 s | 2.23 s | 94° |
| Su-57 | 450 | ✓ | 0.64 s | 0.98 s | 1.46 s | 110° |
| F-22 | 350 | – | 0.82 s | 1.36 s | 2.32 s | 93° |
| F-22 | 550 | – | 0.69 s | 1.11 s | 1.88 s | 101° |

- B2 (`cobra.timeTo90`, target 0.7–1.2 s) **พลาดทุกกรณี** (1.27–2.3 s)
- B1 (`cobra.peakAoa`, target 75–95°) เกินแล้วเมื่อกด Shift (110–120°) ถ้า entry เร็วขึ้นจะเกินมากขึ้น จึงต้อง reset target (§7 D8)
- Pitch rate สูงสุดแค่ 1.25 rad/s (72°/s) ขณะที่ target ≈ 2.85 rad/s

### 1.3 Cobra exit (ดึงถึง incidence 85° แล้วกด full push จน attitude ≤ 5°)

| ลำ | Peak → attitude 5° | Flight-path angle สูงสุด | สูงขึ้น ณ จุด level | ความเร็ว ณ จุด level |
|---|---:|---:|---:|---:|
| F-22 | 3.55 s | 54° | +143 m | 301 |
| Su-57 | 4.92 s | 61° | +185 m | 283 |

Incidence กลับต่ำกว่า 15° เร็วกว่านั้น (1.4–1.5 s หลัง push) แต่ตอนนั้น path ปีนอยู่ ~47–53° หัวจึงยังสูง attitude ต้องรอ path โค้งลงอีกหลายวินาที

- B4 (`cobra.headingChange` ≤ 20°) **พลาด**: path ปีนขึ้น 54–61°
- ถ้าปล่อย stick เฉยๆ (ไม่ push) หัวค้างที่ 115–119° นานกว่า 5 s

### 1.4 ท่าอื่น

| ท่า | Script | ผล F-22 / Su-57 |
|---|---|---|
| Loop | 700, full pull | 360° ใน 6.97 / 6.95 s, สูง 274 m, incidence ≤ 4° |
| "Power loop" | 350, Shift + W + full pull | 360° ใน 8.7 s, incidence ≤ 5°, จบที่ −545 m และ 1126 km/h (เป็น burner dive loop ไม่ใช่ power loop) |
| Kulbit (B5) | 350, Space + Shift + pull | 4.30 / 4.56 s (target 3–4.5 s) |
| Immelmann | 800, pull ถึงกลับหัวแล้ว full roll | half loop 3.73 s + roll out 1.65 s, ด้านบน 685 km/h |
| Herbst | 450, Space + pull ถึง 70° แล้ว pull + full roll (± yaw), Shift หลัง 1.2 s | heading เปลี่ยนสูงสุด 119–125° / 81–93° **ไม่ครบ 180°** |
| Bell (tail slide) | 500, attitude 88°, ปล่อย stick | apex 9.3 s, หัวลงต่ำกว่า horizon 3.1 s หลัง apex (B10 ≤ 4 s ผ่าน) แต่ entry ไม่ใช่ท่าที่ผู้เล่นใช้จริง |
| Pedal turn (B11) | 150, Space + full yaw | Su-57 360° ใน 5.6 s; F-22 36% ของ Su-57 (Phase 8 ผ่าน) |

### 1.5 Mouse

- Default preset คือ mouse positional stick ([mouseStick.ts](../src/game/input/mouseStick.ts)). Full deflection = ครึ่งหนึ่งของด้านสั้นของจอ (1080p ≈ 540 px ของ pointer travel)
- `deadZone 0.08`, `curve 2`: เลื่อนครึ่งทางได้คำสั่ง **21%**, สามในสี่ทางได้ 53%. กลางนิ่มมาก ขอบกระชาก
- Default camera คือ `'horizon'` ([FlightPage.tsx:24](../src/features/flight/FlightPage.tsx#L24)) ทำให้ polar screen-frame mapping ทำงานเสมอ
- วัดด้วย pointer ค้างที่มุมขวาบน (45°, full) แล้วเปลี่ยน bank: pitch command เปลี่ยนจาก +0.71 ไปถึง −1.0 และ roll เปลี่ยนเครื่องหมายที่ bank 180° **โดยที่มือไม่ขยับเลย** ในโหมด `'aircraft'` คำสั่งคงที่ 0.71 / 0.71

---

## 2. สาเหตุหลัก

### RC1 — Servo free dissipation ใน pitch และ roll (สาเหตุใหญ่ที่สุด)

ปัญหาเดียวกับที่ [Phase 8](psm-phase8-implementation.md) พบใน yaw: rate servo แยก drive (ต้องใช้ authority) กับ dissipation `−rate · response` (ฟรี). เมื่อ drive ถูก budget จำกัด dissipation ยังเบรก rate ทั้งก้อน steady rate จึงเป็น `authority / rateResponse` ไม่ใช่ target

หลักฐานจาก Cobra 450 (F-22, t = 0.8 s): aero 3.08 + TVC 3.70 = 6.8 rad/s², servo damping −6.1, restoring −0.44, natural damping −0.23 → net ≈ 0 ที่ rate 1.25 rad/s. Unmet 7.1 rad/s². Roll 250 km/h ก็เป็นแบบเดียวกัน (§1.1)

Phase 8 แก้เฉพาะ yaw ด้วย `commandedRateHold` และจำกัดด้วย speed band 200→300 km/h. Speed band แบบเดียวกันจะ **ไม่** ช่วย Cobra ที่ 350–550 km/h

### RC2 — Roll target ต่ำ

`rollRate 2.1 rad/s` (120°/s) × `speedAuthority` คือเพดานที่ความเร็วปกติ budget เหลือเกินสองเท่า แค่ยกเพดานก็เร็วขึ้นได้โดยไม่ต้องเพิ่ม authority

### RC3 — Cobra exit ช้าและ path ปีน

- **Thrust ตั้งฉากกับ path**: control power 0.74 × dry thrust ≈ 37 m/s² ที่ incidence 80° ชี้เกือบตั้งฉากกับ path จึงยก path ขึ้น. Lateral path force (`pathAcc`) มีแค่ 2–4 m/s² จึงไม่ใช่ต้นเหตุ
- **Nozzle กลับทิศช้า**: F-22 ต้องหมุน 40° ที่ 45°/s ≈ 0.9 s, Su-57 36° ที่ 36°/s ≈ 1.0 s. ระหว่างนั้น TVC ยังดันหัวขึ้น
- **Aero ที่ 80° แทบไม่มี**: effectiveness 0.15–0.2 × q ต่ำ ≈ 0.8 rad/s²
- **Servo**: RC1 ทำให้ rate ตอน push ก็ขึ้นช้าเช่นกัน

ยิ่งหัวค้างสูงนาน thrust ยิ่งยก path นาน ทางแก้ที่ซื่อตรงคือ ลดเวลาที่หัวค้างสูง (เข้าเร็ว ออกเร็ว) ไม่ใช่บังคับ path

### RC4 — Response สลับแบบขั้นบันได

`requestControl` เลือก `counterResponse 12` (roll: `rollReversalResponse 18`) เมื่อ rate สวนทาง target และ `rateResponse 5` เมื่อทางเดียวกัน. ที่จุด rate ตัดศูนย์ request กระโดด เช่น −32.6 → −14.0 rad/s² ในหนึ่ง substep เป็นจุด jerk ที่มือรู้สึกได้ทุกครั้งที่กลับทิศ

### RC5 — Mouse mapping

- Polar screen-frame mapping ใน camera `'horizon'` ทำให้ความหมายของตำแหน่ง pointer หมุนตาม bank และ highAoa blend (§1.5)
- Curve 2 ทำให้ช่วงกลางตอบช้าแล้วกระชากที่ขอบ
- Positional stick ต้องพา pointer กลับกลางเองเพื่อหยุดหมุน ผู้เล่นใหม่มักค้างคำสั่งไว้โดยไม่รู้ตัว

### RC6 — ไม่มี roll รอบ velocity vector (Herbst ทำไม่ได้)

AD5 กำหนด body-axis roll ตลอด ที่ incidence 70° body roll กวาดหัวเป็นวงกว้างแทนที่จะหมุน lift vector รอบ path จึงเลี้ยว heading ได้แค่ 81–125°. FCS จริงหมุนรอบ velocity vector โดยผสม yaw ตาม α (`r = p·tan α` โดยประมาณ) ซึ่งต้องใช้ yaw authority จริง

### RC7 — Power loop ไม่มี incidence

Shift + pull ที่ 350 ได้ incidence ≤ 5°. `stepEnvelope` ปลด path assist เฉพาะเมื่อมี brake, deceleration หรือ continuation และ attached flow ดึง path ตามหัว. การเพิ่ม breakout weight อย่างเดียวจึงไม่ให้ incidence

---

## 3. Maneuver catalogue

แต่ละท่ามีสูตร input สำหรับผู้เล่น, กลไก physics ที่ต้องทำงาน และ benchmark (report only ตามนโยบาย §5.0). ตัวเลข target เป็นข้อเสนอเริ่มต้น owner ปรับได้

| ID | ท่า | สูตร input (mouse + keyboard) | กลไก | Benchmark · target เสนอ | ขึ้นกับ |
|---|---|---|---|---|---|
| M1 | Roll | เมาส์ซ้าย/ขวา หรือ A/D | roll target + roll servo | **B26** peak rate และเวลาถึง 90°/360° ที่ 250/450/700/1000 · ตาม D4 | MR2, MR3 |
| M2 | Cobra | 400–550, กด Space ค้าง + ดึงเมาส์ขึ้นสุด, หัวถึง ~90–110° แล้วดันเมาส์ลงกลับ, ปล่อย Space + W | limiter + pitch servo + TVC + push authority | B1 (reset), **B2** 90° ≤ 1.0 s ไม่มี Shift, **B27** peak → attitude ±10° ของตอนเข้า ≤ 1.2 s, path climb ≤ 20°, สูงขึ้น ≤ 60 m | MR2, MR4 |
| M3 | Pedal turn | ลดความเร็วถึง ~150 หัวสูง, Space + Q/E ค้าง | yaw hold (Phase 8) | B11 เดิม | ทำแล้ว; ตรวจซ้ำหลัง MR2 |
| M4 | Herbst (J-turn) | 400–500, Space + ดึงขึ้นสุดจน ~70°, ค้างดึงแล้วเลื่อนเมาส์เฉียงไปทางที่จะเลี้ยว (pull + roll), เมื่อ heading กลับ 180° ดันเมาส์ลง + Shift | stability-axis roll ผ่าน yaw allocation | **B28** heading ≥ 170° ภายใน ≤ 4 s หลังถึง 70°, ความสูงเปลี่ยน ≤ ±200 m | MR5 (D2) |
| M5 | Power loop | ตาม D3 | ตาม D3 | **B29** ตาม D3 | MR6 |
| M6 | Kvochur's Bell | 400–500, Space + ดึงขึ้นจน attitude ~90–100° แล้วปล่อยเมาส์กลาง, ความเร็วหมดแล้วหางไถลลง หัวแกว่งลงเอง, W/Shift ออก | departure channel + restoring (มีแล้ว) | **B30** ถึงความเร็วศูนย์, ไถลถอยหลัง > 0 m, หัวลงต่ำกว่า horizon ≤ 3 s หลัง apex, ไม่ spin | MR0 วัด; MR6 ปรับ |
| M7 | Immelmann | 700–900, ดึงเมาส์ขึ้นสุดจนกลับหัวบนสุด แล้ว A/D หมุน 180° | pitch + roll ปกติ | **B31** half loop ≤ 4 s, roll out 180° ≤ 1.0 s, ความเร็วบนสุด ≥ 300 | MR3 |
| – | Kulbit | 300–400, Space + Shift + ดึงค้าง | TVC | B5 เดิม (3–4.5 s) | ตรวจซ้ำหลัง MR2 |

Script ของทุกท่าเป็น closed-loop ใน harness (ใช้ incidence, attitude, heading เป็นเงื่อนไขสลับขั้น) เพื่อให้ benchmark เป็นสูตรเดียวกับที่สอนผู้เล่น

---

## 4. Mouse: คำแนะนำและแผน input

### 4.1 หลักการ

- ผู้เล่นใหม่ต้องการ "ขยับ = หมุน, หยุด = หยุด" แบบ Battlefield
- ผู้เล่นที่เล็งต้องการกลางที่ละเอียดแต่ไม่ตาย
- ความหมายของทิศเมาส์ต้องไม่เปลี่ยนเองเมื่อเครื่องหมุน โดยเฉพาะระหว่างท่า high AoA

### 4.2 ข้อเสนอ

1. **แยก control frame ออกจาก camera mode.** Camera `'horizon'` ยังเป็นภาพ default ได้ แต่ control frame default เป็น **body** (เมาส์ขึ้น = หัวเชิดเสมอ). Polar mapping เดิมเป็น option "Horizon-relative stick" สำหรับคนที่ชอบ
2. **เพิ่มโหมด Relative (spring-return) และเสนอเป็น default.**
   - Mouse delta ขยับ stick เหมือนเดิม แต่ stick คืนกลางเองด้วย time constant τ
   - ค่าเริ่ม τ ≈ 0.2 s เลือกจาก playtest ช่วง 0.12–0.35 s
   - ขยับเมาส์เร็ว = deflection มาก ได้ท่าเต็ม. หยุดขยับ = stick กลับกลาง เครื่องหยุดหมุน
   - Spring ต้องเดินต่อ command tick ไม่ใช่ต่อ frame ตาม precedent ของ pedal ramp ([FlightInput.ts](../src/game/input/FlightInput.ts)) replay จึง deterministic
   - ท่าค้าง (Cobra, Kulbit, loop) ใช้ keyboard ↑ หรือ "hold" ได้ง่ายกว่า: เสนอ **คลิกขวาค้าง = ล็อก stick ที่ตำแหน่งปัจจุบัน** (ไม่ spring) ถ้า owner ยังไม่ต้องการ right mouse สำหรับ missile
3. **โหมด Stick เดิมคงไว้แต่ปรับ shaping**: `curve` 2 → 1.5 (ครึ่งทาง ≈ 30–35%), `deadZone` 0.08 → 0.04, full deflection เป็น setting (ค่าเริ่ม 35% ของด้านสั้น แทน 50%) เพื่อ flick ถึงขอบได้เร็ว
4. **Settings**: sensitivity, invert pitch, mouse X = roll (default) หรือ yaw (สำหรับเล็งละเอียด โดยใช้ A/D roll), stick mode, control frame. เก็บ local ตาม [02-controls.md](game-design/02-controls.md)
5. **HUD**: แสดงตำแหน่ง stick และวงกลม deflection เสมอ (มีบางส่วนแล้ว) + ขีดบอกว่า stick อยู่ในช่วง "เต็ม" หรือไม่
6. **ไม่เปลี่ยน physics และไม่เปลี่ยน `PilotCommand`**: MR1 ไม่ bump `flightProfileVersion` หรือ command schema

### 4.3 วิธีใช้เมาส์ที่แนะนำ (ร่างสำหรับ help text)

- **เล็ง**: ขยับเมาส์น้อยๆ ใกล้กลาง ใช้ Q/E ช่วยจัดหัวละเอียด
- **เลี้ยว**: เลื่อนเมาส์ไปด้านข้างเพื่อเอียงปีก แล้วดึงเมาส์ขึ้น. ถ้าต้องการหมุนเร็วสุดใช้ A/D (full deflection ทันที)
- **ท่า high AoA**: กด Space ค้างก่อน แล้วสะบัดเมาส์ขึ้นสุด. Relative mode: ค้างคลิกขวาหรือ ↑ เพื่อค้างคำสั่ง
- **ออกจากท่า**: ดันเมาส์ลงผ่านกลาง ปล่อย Space แล้วกด W หรือ Shift
- **ระหว่าง PSM** ให้ใช้ body control frame (default ใหม่) เพื่อให้เมาส์ขึ้นแปลว่าหัวเชิดเสมอ

---

## 5. Phases

ลำดับ: **MR0 → MR1 → MR2 → MR3 → MR4 → MR5 → MR6 → MR7 → Phase 9**. MR1 เป็น input-only จึงทำคู่ขนานกับ MR2 ได้. แต่ละ phase มี report `docs/psm-mrN-implementation.md` พร้อม neutrality evidence, retirement table และ owner decisions requested ตามธรรมเนียมเดิม

### MR0 — Maneuver instrumentation (ไม่แตะ physics)

- `benchmarks/flight/maneuvers.report.ts`: script M1–M7 + Kulbit, ต่อลำ (f22, su57, f22-notvc)
- Smoothness metrics ต่อแกน:
  - command → 63% rate latency
  - overshoot
  - peak |Δ request| ต่อ substep ที่จุดกลับทิศ (RC4)
  - jerk ของ rate
- Cobra exit แบบ "push กลับ attitude ตอนเข้า": เวลา, flight-path angle, ความสูง
- Mouse probe: pointer ค้าง + bank sweep (RC5) เป็น unit report
- `targets.ts` เพิ่ม `maneuverTargets` (report only)
- ย้าย probe ใน §1 เข้า report นี้และบันทึก baseline เป็นไฟล์ `out/maneuvers-baseline.{json,md}`

### MR1 — Input และ mouse (input-only, ไม่ bump physics)

- Control frame แยกจาก camera, relative spring mode, shaping settings, stick hold (ถ้า D5 อนุญาต)
- Tests:
  - Determinism ของ spring ที่ 30/60/144 FPS (I2): spring เดินต่อ tick
  - `readStickAxes` ใน body frame ไม่ขึ้นกับ bank
  - Keyboard override ยังมี priority
- Locales th/en, `02-controls.md`, help overlay (§4.3)
- ไฟล์: `mouseStick.ts`, `FlightInput.ts`, `FlightPage.tsx`, `FlightScene.tsx`, `session.ts`, `platform/storage.ts`, `locales/*`

### MR2 — Servo rework (physics bump: `mr2-servo-1`)

1. **Commanded-rate hold สำหรับ pitch และ roll** ตาม scope ที่ owner เลือก (D1). ใช้สูตร Phase 8 เดิม: hold ย้าย drive ออกจาก free dissipation เท่านั้น `request + servoDamping` เท่ากับ hold-0 ทุกกรณี
2. **Response แบบต่อเนื่องแทนการสลับ (RC4)**: แยก rate เป็นส่วนที่สวนทาง target (damp ด้วย `counterResponse`) กับส่วนที่ทางเดียวกัน (damp ด้วย `rateResponse`) request จึงต่อเนื่องที่ rate = 0
3. **Evidence gates ก่อนส่ง** (before/after ทุกตัว):
   - Jet-drift entry, hold, handoff, exit tracks และ cross-axis
   - Banked drift 4.5D
   - B12 (beginner fullStick500), B13 (hardTurn900), B16 (limiter chatter)
   - **B19**: `f22-notvc` ต้องหมุนน้อยกว่า 180° ใน 3 s
   - B5, B11, B14, B21 (camera report รันเดี่ยวด้วย `CAMERA_REPORT_LABEL`)
4. Invariants: I12, I14, I15 ต้องผ่าน. ขยาย `tests/invariants/phase8.test.ts` เป็นทุกแกน: hold neutrality, damping dissipative, drive ไม่เกิน hold-0
5. `goldenPolicy.ts` เพิ่ม I4 retirement entry ห้าม regenerate Phase 0 goldens

### MR3 — Roll rate

- `rollRate` ต่อลำตาม band ที่ owner เลือก (D4)
- Roll response แยกจาก pitch/yaw (`rateResponse` ต่อแกน) เพื่อให้ onset ~0.1 s
- ตรวจ low-speed roll หลัง MR2 ก่อนเพิ่ม `controlAcceleration.roll` (ถ้า hold แก้ได้แล้วไม่ต้องเพิ่ม)
- Personality: Su-57 roll เร็วกว่า F-22 เล็กน้อยหรือเท่ากัน ตาม D4
- B26, B31, B21 camera up-rate (roll เร็วขึ้นกระทบกล้องโดยตรง)

### MR4 — Cobra entry และ exit

ทำหลัง MR2 เพราะ RC1 น่าจะแก้ entry ได้ส่วนใหญ่ วัดก่อนแล้วค่อยเลือก lever:

1. `thrustVectoring.actuatorRate` F-22 45 → ~90°/s, Su-57 36 → ~80°/s (ลด reversal เหลือ ~0.45 s)
2. ถ้า path ยังปีนเกิน B27: ทดลองลด control power ขณะกด airbrake (intent-based ตาม jet-drift §5 จึงอนุญาต) **ต้องวัดคู่กัน** เพราะ TVC authority ∝ actual thrust การลดจะทำให้ทั้ง entry และ push ช้าลงด้วย
3. ห้าม: บังคับ path, gate thrust เพื่อรักษาความสูง, เพิ่ม floor
4. Targets: B2, B27, B1 ใหม่ (D8), B14

### MR5 — Stability-axis roll coordination (ถ้า D2 อนุมัติ)

- Roll command ที่ incidence สูงแปลงเป็น body roll + yaw ตาม α เพื่อหมุนรอบ velocity vector
- ส่วน yaw ต้องผ่าน yaw allocation (aero + TVC + floor ภายใน budget) ไม่สร้าง authority ใหม่. F-22 commanded yaw TVC ยังเป็น 0 จึงได้ Herbst ช้ากว่า Su-57 ตามธรรมชาติ
- Weight ต่อลำ `stabilityAxisRoll` 0..1 และ fade-in ตาม incidence
- Amend AD5 ใน plan หลัก. Invariant ใหม่ **I23**: yaw ที่มาจาก coordination ≤ yaw budget ทุก tick และ F-22 yaw TVC = 0
- Target B28

### MR6 — Power loop และ Bell

- Power loop ตาม D3 + D9: ทำ A (ลด W drive ที่ความเร็วต่ำ) → evidence gate → owner playtest → B เฉพาะเมื่อเงื่อนไข D9 ครบ
- Bell: ถ้า B30 พลาด ปรับ `aero.departure` / restoring ต่อลำ ไม่เพิ่ม mechanism ใหม่
- Immelmann ตรวจ B31 หลัง MR3

### MR7 — Personality pass และ promotion (งานค้างจาก Phase 8)

- Per-axis control effectiveness, breakout per aircraft, B23 target, B22 personality matrix
- Promote benchmark ที่นิ่งแล้ว (B2, B26, B27, B11) เป็น regression range ±10–15% ใน tests
- Human playtest checklist ต่อท่า M1–M7 ด้วย mouse ทั้งสองโหมด
- อัปเดต `04-maneuvers.md` เป็น guide ท่าปัจจุบัน

---

## 6. Invariants และข้อห้ามที่ต้องคงไว้

- I1–I22 เดิมยังบังคับทั้งหมด
- Hold และ coordination ย้ายแค่ drive ออกจาก dissipation หรือแบ่ง request ข้ามแกน ห้ามเพิ่ม authority. ทุก drive ผ่าน allocation
- `powerIntent` อ่าน Shift/W เท่านั้น
- Recovery assist ไม่แย่ง input (I20)
- ห้ามแก้ไฟล์ของ owner: `noseFlick.report.ts`, `pedalEnergy.report.ts`, `psm-phase8-pedal-energy-findings.md`, ย่อหน้า pedal-energy ใน benchmarks README และ bullet "Pedal turn energy" ใน plan Phase 8

---

## 7. Owner decisions requested

**ตอบแล้ว 26 ก.ย. 2026:**

- **D1 = (b)**: pitch hold ถ่วงด้วย `limiterOpen`, roll hold ทุกความเร็ว. ยังต้องผ่าน evidence gates ใน MR2 ก่อนส่ง
- **D2 = (a)**: อนุมัติ amend AD5, stability-axis roll weight ต่อลำ
- **D3 = (a)**: power loop = loop แคบแบบ attached ความเร็วต่ำ thrust พาข้ามด้านบน ใช้ tuning ไม่เพิ่มกลไกปลด path grip. B29 เสนอ: เริ่ม 300–400, Shift + full pull, ครบ 360° โดยความเร็วต่ำสุด ≥ 150 และไม่ดำจนเกิน afterburner top speed
- **D4 = (b)**: roll ~220–240°/s, ถึง 90° ≈ 0.55 s

**D3 follow-up (26 ก.ย. 2026, ภาพอ้างอิง F-22 power loop จาก owner):** รูปทรงคือไต่ vertical แล้วตีวงแคบด้านบนจนออกระดับไปทางตรงข้าม วงกว้างราว 6–8 ลำ (~120–160 m) ในภาพ incidence ปานกลาง หัวนำ path เล็กน้อย

ผลวัด (เริ่ม vertical, full pull, วัดเมื่อ path หมุน 270°):

| เริ่มที่ | Power | เวลา | กว้าง | Peak incidence | Nose − path | ผล |
|---:|---|---:|---:|---:|---:|---|
| 450 | ไม่มี | 5.9 s | 201 m | 10° | ~4° | power loop แบบ attached ใกล้ภาพที่สุด |
| 350 | ไม่มี | – | – | 15° | – | ไม่ข้ามด้านบน กลายเป็น tail slide/Bell |
| 350–450 | W | 5.3–5.5 s | 433–453 m | ≤ 10° | ~4° | ความเร็วไม่ลดเลยตอนไต่ vertical วงจึงใหญ่ |
| 350–450 | Shift | 5.7–5.9 s | 756–805 m | ≤ 7° | ~3° | วงใหญ่ที่สุด |
| 250–450 | Shift + Space | 4.4–4.8 s | 99–136 m | 99–106° | ~95–100° | คือ Kulbit ไม่ใช่ power loop |

ข้อสรุป:
- Power loop กับ Kulbit แยกกันด้วยตัวชี้วัด: power loop มี nose − path ≤ ~30° และ incidence ≤ ~30°; Kulbit หัวหมุนนำ path เกือบ 90–100°
- ปัญหาคือ W/Shift ทำให้วงใหญ่ขึ้น ไม่ใช่แคบลง เพราะแรงขับที่ความเร็วต่ำชนะ gravity ตอนไต่ vertical ความเร็วจึงไม่ลด (เรื่องเดียวกับ findings §3.4 recovery acceleration ที่เลื่อนไว้)
- รัศมีต่ำสุดแบบ attached ≈ `referenceSpeedMps / pitchRate` ≈ 95 m ไม่ขึ้นกับความเร็ว เพราะ pitch target แปรผันตาม speed
- B29 แก้เป็น: เริ่ม vertical 400–450, path หมุน 270° ≤ 5 s, กว้าง ≤ 160 m, peak incidence ≤ 30°, nose − path ≤ 30°, ความเร็วต่ำสุด ≥ 150

**D9 — Power loop: ทำ A ก่อน, B เป็นทางสำรองแบบมีเงื่อนไข (owner, 26 ก.ย. 2026)**

*A — ลด W drive ที่ความเร็วต่ำ (ทำใน MR6):*
- ลดเฉพาะ `acceleration` (W drive) ในช่วงความเร็วต่ำด้วย speed band ต่อเนื่อง (smoothstep ไม่มีขั้น). ค่า band และแรงเร่งต่ำสุดเลือกจากการวัด
- เป้า: ไต่ vertical ด้วย W ต้องเสียความเร็ว; Shift (AB) ประคองความเร็วได้โดยมีราคาเป็น burner reserve
- **ห้ามแตะ** `maxThrust`, `controlPower`, `controlPowerAxisWeight`, `afterburnerAcceleration` เพราะ TVC authority แปรตาม actual thrust (pedal ของ Su-57, Kulbit, Cobra + Shift)
- เป็นการตัดสินใจเรื่อง recovery acceleration (findings §3.4) ที่เลื่อนไว้ใน Phase 8 เฉพาะส่วน W drive; ไม่แก้ไฟล์ findings ของ owner
- Bump physics version + I4 retirement entry ตามสัญญาเดิม

*Evidence gate ของ A (ต้องครบก่อนส่งให้ owner เล่น):*
- B29 before/after ทั้งสูตร "ปล่อย W" และ "แตะ Shift ด้านบน"
- B11 pedal turn: ต้องยังผ่าน (Su-57 360° ≤ 8 s, ความเร็วอยู่ใน ±30 km/h แบบ level flow) เพราะ pedal ไม่ใช้ W จึงคาดว่าไม่เปลี่ยน
- B5 Kulbit, B14 psmIntent, B2 Cobra: ต้องไม่ช้าลง (AB และ control power ไม่ถูกแตะ)
- เวลาฟื้นจาก 150 → 351 km/h ด้วย W อย่างเดียว และ W + Shift (เดิม W + Shift 0.84 s) รายงานเป็นตัวเลข ไม่มี target จนกว่า owner ตัดสิน
- เวลาเร่งระดับ 400 → 1000 km/h ด้วย W ต้องไม่เปลี่ยน (band ต้องไม่ถึงช่วงความเร็วปกติ)
- Jet-drift exit tracks และ I17/I18 ผ่าน

*Playtest gate:* owner ลองเล่น power loop, pedal turn, Bell และการออกจากท่าหลัง A แล้วตัดสินว่าพอใจหรือไม่

*B — ยอม incidence 25–30° ตอน Shift + pull ที่ความเร็วต่ำ: เริ่มได้ก็ต่อเมื่อครบทุกข้อ*
1. A ส่งแล้วและผ่าน evidence gate
2. B29 ยังกว้างเกิน 160 m **หรือ** owner playtest แล้วไม่พอใจความแคบของวง
3. Owner อนุมัติ B อีกครั้งโดยเห็นตัวเลขหลัง A

*ข้อบังคับถ้าทำ B:* เพดาน incidence แบบ power-only ≤ 30° (pattern เดียวกับ `bankedDrift.maxAlphaDeg`), ต้องไม่มีผลเมื่อกด Space (Kulbit ยังเป็นของ Space + Shift), คำนวณจาก `powerIntent` (Shift/W) เท่านั้น, ผ่าน I19 และ jet-drift entry tracks. B เป็น amendment ของ D3 เพราะเพิ่มกลไกปลด path grip ภายใต้ power

**ตอบแล้ว 26 ก.ย. 2026 (ก่อนเริ่ม MR0):**

- **D5 = (a)**: relative spring เป็น default พร้อม body control frame. Stick เดิมยังเลือกได้
- **D6 = ไม่**: คลิกขวาสงวนไว้ให้ missile. ท่าค้างใช้ keyboard ↑ (§4.2 ข้อ 2 และ §4.3 ตัดเรื่องคลิกขวาออก)
- **D8 = 90–120°**: B1 `cobra.peakAoa` เปลี่ยนแล้วใน `targets.ts`

D7 ยังเปิด ถามหลังเห็นตัวเลข MR4

| # | คำถาม | ตัวเลือก | ข้อเสนอ |
|---|---|---|---|
| D1 | Scope ของ pitch/roll commanded-rate hold (amend Phase 3 contract) | (a) speed band เหมือน yaw: ช่วย pedal speed เท่านั้น **ไม่แก้ Cobra 450**; (b) pitch ถ่วงด้วย `limiterOpen` (permission side, attached flight และ beginner ไม่เปลี่ยน) + roll ทุกความเร็ว; (c) ทุกแกนทุกความเร็ว | (b) ต้องผ่าน evidence gates ใน MR2 ก่อนส่ง |
| D2 | Amend AD5: roll รอบ velocity vector ที่ high AoA เพื่อ Herbst | (a) อนุมัติ, weight ต่อลำ; (b) ไม่อนุมัติ Herbst ทำด้วย body roll + yaw เองเท่าที่ได้ | (a) F-22 จะอ่อนกว่า Su-57 เพราะไม่มี yaw TVC |
| D3 | Power loop หมายถึงอะไร | (a) loop แบบ attached รัศมีเล็ก ความเร็วต่ำ thrust พาข้ามด้านบน (ปรับ tuning); (b) loop ที่ค้าง AoA 30–60° ด้วย thrust ต้องมีกลไกใหม่ปลด path grip ภายใต้ power | ขึ้นกับภาพที่ owner ต้องการ |
| D4 | Roll rate target | (a) ~180°/s; (b) ~220–240°/s, 90° ≈ 0.55 s; (c) ≥ 270°/s | (b) ตัวเลขเป็น game target ไม่ใช่ spec จริงของเครื่อง |
| D5 | Default mouse mode | (a) relative spring (ใหม่); (b) stick เดิมที่ปรับ curve | (a) + body control frame default |
| D6 | คลิกขวาค้าง = hold stick ใน relative mode | ใช่ / ไม่ (สงวนไว้ให้ missile) | ใช่จนกว่าระบบอาวุธจะมา |
| D7 | Cobra exit: ถ้าหลัง MR2 + actuator ยังปีนเกิน target ยอมลด control power ขณะ airbrake หรือไม่ | ใช่ / ไม่ | ตัดสินหลังเห็นตัวเลข MR4 |
| D8 | Reset B1 `cobra.peakAoa` | 75–95° เดิม / 90–120° | 90–120° เพราะ Shift ได้ 110–120° อยู่แล้ว |

---

## 8. ความเสี่ยง

- **Hold ทำให้ entry เร็วทุกท่าที่ budget-limited** รวม banked drift และ jet-drift ความเร็วกลาง ต้องดู evidence gates ไม่ใช่แค่ Cobra
- **Roll เร็วขึ้นทำให้ camera up-rate สูงขึ้น** อาจต้องปรับ smoothing ใน `FlightCamera.ts` (presentation เท่านั้น)
- **Relative spring mode ทำให้ค้างท่านานยากขึ้น** จึงต้องมี hold (D6) หรือพึ่ง keyboard
- **Stability-axis roll เปลี่ยน feel ของ hard turn ที่ 15–25°** ด้วย ต้อง fade-in ให้ attached flight เปลี่ยนน้อย
- **ลด control power** แลกกับ TVC authority เสมอ (thrust เดียวกัน) ห้ามแยก thrust ที่ nozzle เห็นกับ thrust ที่ translation เห็น
