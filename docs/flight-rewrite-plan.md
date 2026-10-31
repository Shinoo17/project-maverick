# Flight / Control / Camera / PSM Rewrite — แผน (Rev. 1)

> สถานะ: **Rev. 1** (1 พ.ย. 2026). Owner ตัดสินครบทุกข้อ (§9), รวม D-REL และข้อเสนอใน §11. ยังไม่มีโค้ด; พร้อมเริ่ม FR0
> Requirements: [project-maverick-flight-control-psm-drift-rework-spec.md](project-maverick-flight-control-psm-drift-rework-spec.md) (owner, Draft v1.0) = **what** + acceptance FC-01–FC-18. เอกสารนี้ = **how**. จุดที่แผนนี้ต่างจาก spec อยู่ใน §10
> Branch: `feat/flight-rewrite` (แตกจาก main `9eb17bd`). ไม่ commit จนกว่า owner สั่ง
> แทน [psm-implementation-plan.md](legacy-flight/psm-implementation-plan.md) (Rev. 4) และ [psm-maneuver-control-plan.md](legacy-flight/psm-maneuver-control-plan.md) (Rev. 5) ทั้งหมด. เอกสารเก่าอยู่ใน [legacy-flight/](legacy-flight/) และจะลบเมื่องานนี้เสร็จ

## 0. เป้าหมาย

**ปัญหาที่ owner เจอ:** feel ไม่ดี เล่นยาก / เมาส์บังคับยาก / กล้องกับการควบคุมไม่สัมพันธ์กัน / จูนยาก / PSM ด้วยเมาส์ยาก / ระบบช่วยหมุนไม่ได้ตามใจ (อยากหมุนแต่ไม่หมุน ไม่อยากหมุนแต่หมุน เช่น ตอนเลี้ยว) / Positional stick กลับทิศหลัง loop ครึ่งวงแล้ว roll กลับ

**ทิศทาง:**
- Feel แบบ **Ace Combat 7**: Easy to Fly, Hard to Master
- **Arcade kinematic ปรุงด้วย physics นิดหน่อย**: การหมุนสั่งเป็น rate, การเคลื่อนที่ใช้แรงจริง
- **PSM เกิดจาก physics ของเกม** ไม่ใช่ animation หรือปุ่มทำท่า ไม่ต้องสมจริง แต่ต้องควบคุมง่ายและทำได้หลายท่า
- **เขียน core ใหม่** แต่เก็บส่วนที่ทำงานดี: `PilotCommand`, `FLIGHT_STEP` fixed step, replay, อาวุธ, collision

## 1. Complaint → สาเหตุเดิม → กฎใหม่ → วิธีพิสูจน์

| # | อาการ | สาเหตุในโค้ดเดิม | กฎใหม่ | ตรวจด้วย |
|---|---|---|---|---|
| C1 | ระบบช่วยหมุนเองตอนไม่อยาก / ไม่หมุนตอนอยาก | instructor (`mouseAim.ts`) bank ตาม lift vector เสมอ; pull รอ roll; offset เล็กก็ bank; handover band 22–35° สลับไป relative stick; ปล่อยปุ่มแล้ว instructor ดึงกลับหา × | bank แบบ threshold (§4.3); ปุ่มยึดแกนเดียว ปล่อยแล้ว × ย้ายมาที่จมูก (K1); ไม่มี handover | benchmark "unwanted roll": matrix ของ aim offset วัด roll travel เทียบขั้นต่ำ + เวลาเริ่ม roll |
| C2 | กล้องกับการควบคุมไม่สัมพันธ์ | 3+ frame: horizon-locked look, body stick frame, `noseLook`, aim look | Mouse Aim อ่านเมาส์ใน frame ของกล้องที่ render จริงเสมอ (Joystick ใช้ stick frame, C6) | invariant: mouse delta บนจอ → × เคลื่อนทิศเดียวกันบนจอ ทุก camera style ทุก attitude |
| C3 | PSM ด้วยเมาส์ยาก | handover ไป relative stick ที่ 22–35°; breakout ผ่าน `powerIntent` (Shift/W) | Space ค้าง = จมูกไล่ × ตรงๆ ไม่ bank; เมาส์ความหมายเดิม | benchmark + playtest: Cobra, Kulbit, pedal turn ด้วยเมาส์อย่างเดียว |
| C4 | กล้องบางทีขยับแปลก | หลาย branch (cruise/PSM/drift/handover) + rate cap หลายตัว | 1 ค่า = 1 spring critically damped; blend ขับด้วยสถานะจริง ไม่ขับด้วยปุ่ม | `CAMERA_TRACE` + FC-13, FC-15 |
| C5 | จูนยาก | ~12 layer ซ้อน (stall → maneuvers → intent → envelope → natural aero → budget → allocation → TVC → arcade floor → path response 3 grip + assist) | 1 แนวคิด = 1 กลุ่ม parameter; profile ต่อลำ ~20 ค่า; tuning panel สด + overlay; assist ทุกตัวเห็นได้และปิดได้ (§3.6) | นับ parameter; owner จูนเองใน panel ได้ |
| C6 | Positional stick กลับทิศ (หลัง loop ครึ่งวงแล้ว roll กลับ) | `FlightInput.flip` ([FlightInput.ts:300-330](../src/game/input/FlightInput.ts#L300-L330)) บวกครึ่งรอบเมื่อจมูกผ่านแนวดิ่ง ปลดเมื่อเมาส์อยู่ใน dead zone ครบ 0.25 s เท่านั้น | Joystick ทิศตายตัว: ขึ้น = ดึงเข้าหา canopy, ขวา = roll ขวา; ไม่มี screen turn / flip state | invariant: input เดิม → คำสั่งเดิม ทุก attitude ทุก camera style |

## 2. บทเรียนที่วัดแล้ว — ห้ามทำซ้ำ

1. **Servo free dissipation**: damping แยกกินอัตราที่สั่ง (pitch ค้าง ~1.25 จาก target 2.85 rad/s) → rate ตาม target ด้วย response law เดียว
2. **Request กระโดดตอนสลับ counter/rate response** → response law เดียว ต่อเนื่อง
3. **Polar mapping หมุนตาม bank** → Mouse Aim อ่านใน camera frame, Joystick ใช้ stick frame
4. **Instructor ป้อน pull จาก pitch rate จริง** ทำให้ bank overshoot → ใช้ค่าที่วางแผน
5. **Hidden modes / latch** (handover band, push capture, hands-off recovery, `flip`) → ไม่มี state ซ่อน; assist ต้องเห็นบน overlay/HUD และปิดได้
6. **Budget-limited roll** (35°/s ที่ 250 km/h) → ขีดจำกัดการหมุนเป็นค่าตรงต่อแกน ไม่ใช่ผลรวม torque

## 3. Flight core

### 3.1 Contract ที่คงไว้ / เปลี่ยน

- `PilotCommand`: pitch / roll / yaw (rate request −1..1), speedAdjust, airbrake, afterburner, gunHeld, actions + **ฟิลด์ใหม่ `psm`** → bump command schema (replay เก่าใช้ไม่ได้)
- `AircraftState` core: position, velocity, orientation, rates, alive, stopReason
- Fixed `FLIGHT_STEP`, command ต่อ command tick, deterministic. Bump `flightProfileVersion` ตอนสลับ core

### 3.2 `FlightReadout` (seam, FR0)

ตอนนี้ HUD, PlaygroundHud, telemetry, WeaponPanel, FlightInstruments, rigs (nozzle), exhaust, vapor, practice, HangarFlightView, FlightCamera และ bot อ่าน `state.maneuver`, `state.stall`, `state.intent`, `state.thrustVectoring` ตรงๆ และ FlightCamera import `observeAirflow` + `getFlightProfile`

→ `FlightReadout` ชุดเดียว: `alphaDeg`, `betaDeg`, `noseVelocityDeg`, `g`, `pathRateDeg`, `hudSpeed`, `power`, `burner`, `airbrake`, `psmAuthority`, `nozzle` (มุมต่อหัวฉีด), `postStall` (0..1, ป้ายสำหรับ HUD/FX ไม่ใช่โหมด) + ค่าที่ HUD ใช้จาก intent

ย้าย consumer ทุกตัวมาอ่าน readout **ตอน core เก่ายังทำงาน** test เขียวทั้งหมด หลังจากนั้นสลับ core ใน `GameRuntime` เป็นแค่ dispatch (dev setting `flightCore: 'legacy' | 'new'`)

### 3.3 Rotation — rate-command

```ts
// ต่อแกน ต่อ tick
target = input * maxRate(axis, q, psmAuthority)   // เพดานต่อแกน
target = min(target, gLimitRate, aoaLimitRate)     // FBW ต่อเนื่อง: gLimitRate = nz·g / V; α limit เปิดตาม psmAuthority
target += weathervaneRate                          // ∝ q · sin α ดึงจมูกกลับหาทิศบิน
rate  += (target - rate) * (1 - exp(-dt / tau))     // tau ต่อแกน
rate   = clampAcceleration(rate, maxAccel)
```

- **Roll axis (FD7):** blend จากรอบลำตัวไปรอบ velocity vector ตาม α: < ~15° ลำตัว, > ~30° velocity vector เต็ม, smooth ระหว่างนั้น; น้ำหนักต่อลำ (Su-57 เต็ม, F-22 อาจน้อยกว่า)
- **Defaults เพื่อเล่นง่าย:**
  - ปล่อยมือ = หยุดหมุนและคงท่า (ไม่ auto-level)
  - rate เท่ากันทุกความเร็วในช่วงรบ ลดเฉพาะสุดขั้ว (G limit ที่ความเร็วสูง, q ต่ำใกล้ stall)
  - τ ~0.1–0.15 s (ยืนยันใน playtest); ถ้ารู้สึกเบาเกิน เพิ่ม τ หรือจำกัด `maxAccel`
  - ไม่กด Space ไม่มีทางเข้า PSM: α limit ปิดไว้ (FC-01)
  - Space ยกเพดานอย่างเดียว ไม่เปลี่ยนความหมายของปุ่มหรือเมาส์

### 3.4 Translation — force-based

```text
a = thrust (ตามจมูก) + lift (⊥ ทิศบิน, q·CL(α), cap ด้วย G limit)
  + drag (cd0·q + induced ∝ CL² + drag ที่ α สูง) + side (จาก β) + gravity
velocity += a·dt      // ไม่ก๊อปทิศจมูกใส่ velocity
```

- `CL(α)`: ขึ้นถึง αcrit แล้วตก → เกิน αcrit ทิศบินไม่ตามจมูก = post-stall
- เกิดเอง: momentum, corner speed, **drift** (จมูกหมุนเร็วกว่า lift ดัด path), **drift boost** (thrust ตามจมูกที่เบี่ยง), energy loss ตอนเลี้ยว
- ไม่มี lateral damping แยก: side force จาก β คือตัวเดียว (กัน double counting ตาม spec §7.5)
- Low-speed safeguard: α/β/nose-velocity ใช้ threshold + hysteresis เมื่อ airspeed ใกล้ศูนย์ (FC-15)

### 3.5 PSM (Space)

- `psm` ใน command → `psmAuthority ∈ [0,1]` blend ด้วย time constant (entry ~0.15–0.30 s, release ~0.25–0.50 s; playtest)
- `psmAuthority` ทำสองอย่างเท่านั้น: **เปิด α limit** และ **ให้ rate ที่ q ต่ำ** (`psmRate` ต่อแกน, แบบ TVC arcade)
- เส้นโค้ง `psmAuthority(speed)` ต่อลำ (spec §8.2 เป็นจุดเริ่ม, หน่วย **HUD km/h**)
- ท่าที่ต้องเกิดเอง: Cobra (ดึงเกินแล้วปล่อย → weathervane คืน), Kulbit (ดึงค้าง; เร็วไป weathervane ชนะ หมุนไม่ครบ), pedal turn (yaw ที่ q ต่ำ), Herbst (α สูง + roll รอบ velocity), reversal, Bell / tail slide (ไหลถอยหลัง → weathervane พลิกจมูกลง), J-turn, power loop, PSM chaining (ไม่ reset อะไร)
- ปล่อย Space = recovery: α limit ค่อยๆ ปิด + weathervane. ไม่มี auto-recovery assist ในรอบแรก (owner รับ 1 พ.ย.); ทบทวนหลัง FR4 playtest และถ้าเพิ่มต้องเห็นบน HUD

### 3.6 Speed — Hybrid ทางกลาง

- W/S เร่ง/ชะลอ (S มีเบรกอ่อน); ปล่อย → จับความเร็วปัจจุบันเป็น `target`
- auto-throttle คง `target` ตอนไต่/ดิ่ง ได้สูงสุดเท่า dry thrust
- **ตอน G สูงหรือ PSM: `target` ลดตามความเร็วจริง** (ratchet down) → ความเร็วที่เสียจากการเลี้ยวไม่ถูกเติมคืน; W/burner เท่านั้นที่เพิ่ม `target`
- Shift = afterburner override; X = airbrake ระงับ auto-throttle; W+S = ยกเลิกกัน
- Speed hold เป็น controller ไม่ใช่ `speed = target`; มี anti-windup

### 3.7 Assist inventory

assist ทุกตัวมี owner module เดียว, เห็นใน debug overlay, ปิดได้ใน dev panel:

| Assist | อยู่ที่ | หมายเหตุ |
|---|---|---|
| FBW G / α limit | core rotation | เปิดตาม `psmAuthority` |
| Mouse Aim instructor | input | threshold bank, K1 re-anchor |
| Coordinated turn (←/→) | input | ผูกกับปุ่มนี้เท่านั้น |
| Digital input shaping | input | rise/release 120–200 ms |
| Speed hold | core speed | §3.6 |

### 3.8 Aircraft profile

ตารางแบนต่อลำ ~20 ค่า: ต่อแกน `maxRate`, `tau`, `maxAccel`; `gLimit`, `aoaLimit`; `CLα`, `αcrit`, `CLmax`, `CLpost`, `cd0`, `inducedK`, `weathervaneK`; `psmRate` ×3, `psmAuthority(speed)`, roll-axis weight (FD7); thrust dry/burner. แยก config ตาม spec §11: physical capability / arcade assist / camera presentation. เริ่ม F-22 และ Su-57; **ทุกตัวเลขเป็น placeholder จนกว่าจะ playtest** (ไม่ลอกค่าจาก AC7 หรือวิดีโอ)

## 4. Controls

### 4.1 Schemes

**Mouse Aim** (default), **Mouse Joystick** (Positional default, Relative เป็นตัวเลือกย่อย), **Keyboard**. ทุก scheme เขียนแค่ `PilotCommand`; bot ใช้ instructor เดียวกับ Mouse Aim (`instruct(state, readout, aimWorld, opts) → { pitch, roll, yaw }`)

Settings migration: `'aim'` → Mouse Aim, `'cursor'` → Mouse Aim (ตัด cursor), `'stick'` → Joystick Positional, `'relative'` → Joystick Relative

### 4.2 ปุ่ม (ชุดเดียวทุก scheme)

| ปุ่ม | หน้าที่ | เปลี่ยนจากเดิม |
|---|---|---|
| W / S | เร่ง / ชะลอ | — |
| Shift | Afterburner | — |
| **X** | Airbrake | เดิม Space |
| **Space** | PSM Override (ค้าง; ตัวเลือก toggle) | ใหม่ |
| A / D | Roll | — |
| Q / E | Yaw | — |
| ↑ / ↓ | Pitch | — |
| **← / →** | Coordinated turn | เดิม roll สำรอง |
| LMB / J, RMB / K | ปืน / มิสไซล์ | — |
| 1–4, T, F, C, R, V | เลือกอาวุธ, เป้า, flare, free look, look back, กล้อง | — |

- ไม่ใช้ Ctrl เป็น default (Ctrl+W ปิดแท็บ, Ctrl+R reload, macOS Ctrl+ลูกศร)
- ปุ่มตรงข้ามพร้อมกัน = ยกเลิก
- Bump bindings version: `parseBindings` ให้ key ที่เซฟไว้ชนะ จึงต้อง migrate ให้ save เดิมได้ Space = PSM, X = airbrake, ←/→ = coordinated turn โดยไม่ทับ key ที่ผู้เล่นตั้งเองและไม่ชน

### 4.3 Mouse Aim

- × เป็นทิศในโลก; กล้องมองตาม ×; อ่านเมาส์ใน camera frame (C2)
- Bank threshold: × ใกล้จมูก (< ~10°) = pitch + yaw ไม่เอียง; × ไกล = bank-to-turn; มี hysteresis
- **D-REL (A):** auto-level เฉพาะ bank เล็ก (< ~15–20°, ค่าจูนได้) แบบต่อเนื่อง ไม่มี latch: เอียงนิดหน่อยแล้วปล่อย ปีกกลับระดับ; ตั้งใจเอียงมาก (เช่น 90°) แล้วปล่อย ค้างไว้
- **K1:** ปุ่มทิศทางยึดเฉพาะแกนตัวเองขณะกด; ปล่อยแล้ว × ย้ายมาที่จมูกปัจจุบัน จมูกจึงไม่ถูกดึงกลับ; ปีกเป็นไปตาม D-REL (เอียงมากค้าง, เอียงน้อยกลับระดับ)
- **Space:** จมูกไล่ × ตรงๆ ไม่ bank; Cobra = สะบัดขึ้นแล้วปล่อย, Kulbit = ลากขึ้นต่อเนื่องข้ามหัว, pedal turn = ลากไปข้าง, Herbst = ลาก + A/D
- Horizon locked + PSM: × อาจหลุดจอ → edge arrow + nose marker
- C free look: × แช่นิ่งระหว่างหันมอง

### 4.4 Mouse Joystick

- คันโยกทิศตายตัว (C6): ขึ้น = ดึงเข้าหา canopy เสมอ, ขวา = roll ขวาเสมอ (เลือกเป็น yaw ได้, K4); ระยะโยก = rate
- Positional: วงกลมกลางจอ + dead zone + curve. Relative: ขยับแล้วเด้งกลับกลาง
- ผลที่รู้ไว้: หัวกลับใต้ Horizon locked ดึง = จมูกไปทางล่างจอ (เหมือนคันโยกทุกเกม); โยกขวาค้าง = roll ต่อเนื่องจนกลับกลาง

### 4.5 Keyboard-only

- ↑↓ pitch, A/D roll, Q/E yaw, J/K ยิง, Space PSM
- ←/→ coordinated turn: เอียง ~60° + ดึงประคองความสูง; ปล่อยแล้วปีกกลับระดับ
- ↑ ค้างไม่เข้า PSM (FC-01); ↑ + Space เข้า (FC-12)

## 5. Camera

3 สไตล์เดิม: Horizon locked + Balanced (default), Horizon locked + Dynamic, Aircraft locked

**โครง:** คำนวณ target pose (look, up, boom offset, FOV) จาก state + readout + style → smooth ด้วย critically damped spring ต่อค่า. Blend ขับด้วย**สถานะจริง** (nose–path angle, α) ไม่ใช่การกด Space: กด Space แต่ยังไม่หมุนกล้องไม่ขยับ, ปล่อยกลาง Cobra กล้องไม่กระตุก. กล้องห้ามแก้ velocity / rates / × (spec §9.4)

| สภาวะ | Horizon locked (Balanced / Dynamic) | Aircraft locked |
|---|---|---|
| บินปกติ | มองตาม × / จมูก, ขอบฟ้าระดับ (Balanced เอียงเล็กน้อย, Dynamic boom โคจรแบบ BF6) | ตามจมูก roll ตามเครื่อง |
| Drift | ดู path บางส่วน แต่ clamp เบี่ยงจากหลังเครื่อง ~20–30° (spec §9.3) ให้ยังเล็งได้ | ตามจมูกแบบมี lag + ดู path เล็กน้อยให้เห็นข้างลำ |
| PSM | **ตาม path** เห็นเครื่องหมุน ขอบฟ้านิ่ง | **ตามจมูกแบบมี lag** เห็นจมูกยกออกแวบหนึ่งแล้วตามทัน |

- FOV: three.js เป็น**แนวตั้ง** (base ปัจจุบัน 56° ≈ 88° แนวนอนที่ 16:9); ค่าใน spec §9.2 อ่านเป็นแนวนอน (owner รับ 1 พ.ย.)
- HUD: nose marker + FPM เสมอ; edge arrow เมื่อ × หลุดจอ
- เครื่องมือ: `CAMERA_TRACE` dump ต่อ frame (look, up, boom, FOV, α, rates, blend weights)

## 6. Testing

- **Hard invariant (CI fail):** determinism; ไม่มี NaN; energy sanity (หมุนแล้วไม่มีพลังงานงอก); ปล่อยมือใน post-stall โดยไม่กด Space แล้ว α กลับต่ำกว่า αcrit ภายใน N s (N ตั้งหลัง FR4); ปล่อยมือตอนบินปกติ rate กลับเป็น 0 ภายใน ~3τ; Mouse Aim camera frame (C2); Joystick ไม่กลับทิศ (C6); readout อยู่ในช่วง; FPS independence (FC-16)
- **Feel benchmark (report only):** roll/pitch rate, turn rate vs speed, corner speed, Cobra peak α, Kulbit, pedal turn, unwanted roll (C1), aim settle time, drift offset/hold (FC-07), **noseFlick ใหม่** (drift จากหัวกลับ), **pedalEnergy ใหม่** (FC-05 + energy ใน PSM)
- Test / golden / benchmark เก่าอยู่ครบจนถึง FR7

## 7. Phases

ทุก phase: หยุดให้ owner playtest, รายงาน `docs/flight-rewrite-frN.md`, ไม่ commit จนกว่าจะสั่ง

| Phase | งาน | Acceptance (spec §14) | Stop point |
|---|---|---|---|
| FR0 | `FlightReadout` + ย้าย consumer ทุกตัว (core เก่า); dispatch toggle; `CAMERA_TRACE` | test เก่าเขียวทั้งหมด | เกมเหมือนเดิม |
| FR1 | Core ใหม่: rotation + translation + speed (§3.3, §3.4, §3.6); `PilotCommand.psm`; bindings migration; keyboard ครบ (coordinated turn, shaping); overlay + tuning panel | FC-01, FC-10, FC-16 | owner บินด้วย keyboard บนกล้องเดิม |
| FR2 | Camera ใหม่ 3 สไตล์ (ปกติ + drift); HUD nose marker + FPM | FC-13, FC-15 (กล้อง) | owner เทียบกล้องเก่า/ใหม่ |
| FR3 | Mouse Aim ใหม่ (threshold bank, K1) + bot ใช้ instructor เดียวกัน | C1, C2 | playtest เมาส์ |
| FR4 | PSM (§3.5) + roll axis FD7 + กล้อง PSM ต่อสไตล์ + edge arrow | FC-02–06, FC-09, FC-11, FC-12, FC-15 | playtest ท่าด้วย keyboard และเมาส์ |
| FR5 | Mouse Joystick (Positional + Relative, C6) + settings migration | C6 | playtest |
| FR6 | Personality F-22 / Su-57; จูน drift / drift boost; HUD stall / low energy / `PSM READY`; port noseFlick + pedalEnergy; จูน bot | FC-07, FC-08, FC-17 | playtest |
| FR7 | สลับ default เป็น core ใหม่; ลบ core เก่า (รายชื่อทุกไฟล์ test/golden/benchmark + owner sign-off); ย้ายไฟล์ owner เข้า `docs/legacy-flight/` (นอก `tsconfig` include และ vitest glob จึงไม่เข้า build); bump `flightProfileVersion`; เขียน game-design 02/03/04/11 ใหม่; อัปเดต memory | ครบทุกข้อข้างบน | owner sign-off |
| FR7b | ลบ `docs/legacy-flight/` ทั้งโฟลเดอร์ **รวมไฟล์ owner ที่เก็บเข้าคลังตาม FD6** | — | owner sign-off แยก ระบุชื่อไฟล์ owner ชัดเจน |

**เลื่อนไปหลัง FR7 (owner รับ 1 พ.ย.):** FC-14 camera/obstacle collision (lakebed ยังไม่มีกำแพง), FC-18 multiplayer reconciliation, Natural PSM Entry (spec §5.3), Advanced preset / manual throttle (spec §16.1 ติ๊กเป็น baseline), roster อื่นนอกจาก F-22/Su-57, falling leaf / flat spin (owner เคยตั้งเป็นเป้าหมาย 31 ต.ค.)

## 8. กฎเก่า — เก็บหรือทิ้ง

| กฎเดิม | ผล |
|---|---|
| PSM ไม่ใช่ state / animation / ปุ่มทำท่า | **เก็บ** — Space เป็น permission ต่อเนื่อง ไม่ใช่ท่า |
| Arcade floor ≠ Physical aero ≠ TVC authority | **ทิ้ง** — model ใหม่มีชั้นเดียว |
| Breakout intent อ่านแค่ Shift/W | **ทิ้ง** — แทนด้วย Space |
| PSM shot เหมือนกันทุกโหมดกล้อง (B21, `noseLook`) | **แทน** ด้วยตาราง §5 (ต่างกันตามสไตล์ตามที่ owner เลือก) |
| Aim ห้ามป้อน level horizon | **แทน** ด้วย C2 + กล้องห้ามแก้ × |
| ห้าม regenerate Phase 0 goldens / ห้ามลบ legacy feel test เงียบๆ | ลบพร้อม core เก่าที่ FR7 โดยระบุทุกไฟล์ |
| ไฟล์ของ owner (`noseFlick.report.ts`, `pedalEnergy.report.ts`, `psm-phase8-pedal-energy-findings.md`, ย่อหน้า pedal-energy ใน `benchmarks/flight/README.md`) | port เป็น benchmark ใหม่ + ของเดิมเข้า `legacy-flight/` ตัดออกจาก build ไม่แก้เนื้อหา |
| Throttle hold (31 ต.ค.) | **แทน** ด้วย Hybrid ทางกลาง (§3.6) |
| Push capture, hands-off recovery | **ทิ้ง** |

## 9. Decision log

| ID | เรื่อง | ผล | วันที่ |
|---|---|---|---|
| Q1–Q7 | เป้าหมาย | §0 | 31 ต.ค. |
| R1 | รื้อหรือแก้ gap | core ใหม่ เก็บ `PilotCommand`, `FLIGHT_STEP`, replay, อาวุธ, collision | 31 ต.ค. |
| R2 / FD2 | ปุ่ม | Space ค้าง = PSM, X = airbrake | 31 ต.ค. |
| R3 | Model การหมุน | rate-command + translation แรงจริง + defaults §3.3 | 31 ต.ค. |
| R5 / FD3 | ความเร็ว | Hybrid ทางกลาง (§3.6) | 31 ต.ค. |
| FD1 | Mouse Aim bank | threshold + hysteresis | 31 ต.ค. |
| FD4 | กล้อง PSM | Horizon locked ตาม path, Aircraft locked ตามจมูก (lag); blend ขับด้วยสถานะ | 31 ต.ค. |
| FD5 / K2 | Cursor mode | ตัด | 1 พ.ย. |
| K1 | ปุ่มระหว่าง Mouse Aim | ยึดแกนเดียว ปล่อยแล้ว × ย้ายมาที่จมูก | 1 พ.ย. |
| K3 | ←/→ | coordinated turn ทุก scheme | 1 พ.ย. |
| K4 | Joystick แกน X | roll (เลือก yaw ได้) | 1 พ.ย. |
| K5 | PSM key | hold + ตัวเลือก toggle | 1 พ.ย. |
| FD6 | ไฟล์ owner | port + archive | 1 พ.ย. |
| FD7 | Roll ที่ α สูง | blend ลำตัว → velocity vector ตาม α, น้ำหนักต่อลำ | 1 พ.ย. |
| FD8 | Joystick กลับทิศ | คันโยกทิศตายตัว ไม่มี flip | 1 พ.ย. |
| D-REL | ปล่อยมือใน Mouse Aim | A: auto-level เฉพาะ bank < ~15–20°, เอียงมากค้าง | 1 พ.ย. |
| §11 | ข้อเสนอค้าง | รับทั้งหมด: ไม่มี auto-recovery รอบแรก, FOV spec = แนวนอน, รายการเลื่อนหลัง FR7 | 1 พ.ย. |

## 10. จุดที่แผนนี้ต่างจาก owner spec

สำหรับอัปเดต spec ภายหลัง (ไฟล์ spec เป็นของ owner, แผนนี้ไม่แก้):

| Spec | แผนนี้ | เหตุผล |
|---|---|---|
| §13 note, §17 "audit แล้วแก้เฉพาะ gap ไม่ rewrite" | core ใหม่ (R1) | Q7 + ปัญหามาจากโครง layer |
| §7.4 rate controller → surfaces/TVC → torque + PD | rate-command โดยตรง (R3) | torque chain คือต้นเหตุ servo dissipation และ budget-limited roll |
| §4.1 Ctrl = airbrake | X (R2) | Ctrl+W ปิดแท็บ |
| §4.1, §5.2 เมาส์ blend ไป rate/edge command ตอน PSM | × คงเดิม จมูกไล่ × ตรงๆ | handover คือต้นเหตุ C3 |
| §9.2 PSM nose 75% / path 25% ทุกสไตล์ | ต่อสไตล์ (§5) | FD4 |
| §5.2 Auto Recovery เปิดใน Normal | ยังไม่มี, ทบทวนหลัง FR4 | กฎห้าม hidden assist |
| §16.1 Advanced preset เป็น baseline | เลื่อนหลัง FR7 | ทำ Arcade ให้ดีก่อน |
| §3.2 Falling Leaf / Flat Spin | เลื่อนหลัง FR7 | ต้องจูน PSM หลักให้นิ่งก่อน |
| §6.2 ปล่อย W/S แล้วคงความเร็วเต็มที่ | ratchet down ตอน G สูง / PSM | Hybrid ทางกลาง |
| §6.4, §8 ความเร็วเป็น km/h | **HUD km/h** = m/s × 5.4 (arcade 1.5×, `ARCADE_KPH_PER_MPS`) | หน่วยเกมจริง |
| §9.2 FOV 88–96° | อ่านเป็นแนวนอน (three.js ใช้แนวตั้ง) | กันตั้งค่าผิด |
| §1.3 ไม่แตะ AI | bot ใช้ instructor ใหม่ | `botPilot.ts` import `instruct`/`stepAim` |

## 11. รอ owner

ไม่มีข้อค้าง (1 พ.ย. 2026). D-REL ตอบ A; ข้อเสนอที่ค้างรับทั้งหมด (ดู §9)

หมายเหตุ D-REL: Rev. 1 เคยขัดกันเอง — FD1 "× กลางจอ = ปีกกลับระดับ" + K1 "ปล่อยแล้ว × ย้ายมาที่จมูก" ทำให้เอียง 90° แล้วปล่อยกลับระดับ ไม่ค้างตามที่อธิบาย owner. ตัวเลือก A แก้โดยให้ auto-level ทำงานเฉพาะ bank เล็ก. Release rules สุดท้าย: core (A/D, Joystick) คงท่า; Mouse Aim คงท่าถ้าเอียงมาก กลับระดับถ้าเอียงน้อย; ←/→ ปล่อยแล้วกลับระดับ (ปุ่มเลี้ยว)
