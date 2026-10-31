# Flight Rewrite — Prompt เริ่ม session ต่อ Phase

ใช้คู่กับ [flight-rewrite-plan.md](flight-rewrite-plan.md) (Rev. 1). คัดลอก **ส่วนกลาง** + **prompt ของ phase** ไปวางใน session ใหม่

## ลำดับ session

| Session | Phase | ทำต่อกันได้ไหม |
|---|---|---|
| 1 | FR0 | แยก — แตะ consumer หลายไฟล์ ต้องใช้ context อ่านโค้ดเยอะ |
| 2 | FR1 | แยก — core ใหม่ งานใหญ่สุด |
| 3 | FR2 | แยก — กล้องเขียนใหม่ทั้งหมด |
| 4 | FR3 | แยก — Mouse Aim + bot |
| 5 | FR4 → FR5 | **ต่อกันได้** — FR5 (Joystick) งานเล็ก อยู่ชั้น input ทำต่อหลัง owner playtest FR4 ได้ถ้า context ยังเหลือ (ต่ำกว่า ~50%) |
| 6 | FR6 | แยก — จูนตาม playtest หลายรอบ |
| 7 | FR7 → FR7b | **ต่อกันได้** — FR7b คือการลบโฟลเดอร์หลัง owner sign-off |

---

## ส่วนกลาง (วางก่อน prompt ของทุก phase)

```text
งาน Flight Rewrite ของ Project Maverick, branch feat/flight-rewrite
อ่านก่อนเริ่ม:
- docs/flight-rewrite-plan.md (Rev. 1) — แผน, มติทั้งหมดอยู่ §9
- docs/project-maverick-flight-control-psm-drift-rework-spec.md — requirements ของ owner + acceptance FC-xx (ห้ามแก้ไฟล์นี้; จุดที่แผนต่างจาก spec อยู่ §10 ของแผน)
- รายงาน phase ก่อนหน้า docs/flight-rewrite-frN.md (ถ้ามี)

กฎ:
- ห้าม commit จนกว่า owner สั่ง
- ทำเฉพาะ phase นี้ หยุดที่ stop point แล้วเขียนรายงาน docs/flight-rewrite-frN.md:
  สิ่งที่ทำ, ไฟล์ที่แตะ, ผล test/benchmark (ตัวเลขจริง), สิ่งที่ยังไม่ผ่าน, "owner decisions requested"
- ตัวเลขใน profile เป็น placeholder จนกว่าจะ playtest; ห้ามลอกค่าจาก AC7/วิดีโอ
- ห้ามสร้าง hidden mode / latch; assist ทุกตัวต้องเห็นใน overlay และปิดได้ (แผน §3.7)
- test/golden/benchmark เก่าต้องอยู่ครบจนถึง FR7; ห้ามลบหรือ regenerate
- ไฟล์ของ owner ห้ามแก้: benchmarks/flight/noseFlick.report.ts, pedalEnergy.report.ts,
  docs/legacy-flight/psm-phase8-pedal-energy-findings.md, ย่อหน้า pedal-energy ใน benchmarks/flight/README.md
- noseFlick.report.ts ทำให้ tsc -b fail อยู่แล้ว (pre-existing) ไม่ต้องแก้
- ถ้าเจอว่าแผนผิดหรือขัดกัน ให้หยุดถาม owner พร้อมหลักฐานจากโค้ด อย่าเปลี่ยนมติเอง
- ตอบ owner เป็นภาษาไทย
```

---

## FR0 — Readout seam (session 1)

```text
ทำ FR0 ตามแผน §3.2 และ §7:
1. นิยาม FlightReadout ชุดเดียว (alphaDeg, betaDeg, noseVelocityDeg, g, pathRateDeg, hudSpeed, power,
   burner, airbrake, psmAuthority, nozzle, postStall + ค่าที่ HUD ใช้จาก intent) คำนวณจาก core เก่า
2. ย้าย consumer ทุกตัวที่อ่าน state.maneuver / state.stall / state.intent / state.thrustVectoring
   หรือ import observeAirflow / getFlightProfile นอก src/game/flight/ ให้อ่าน readout แทน
   (อย่างน้อย: hudPainter, PlaygroundHud, telemetry, WeaponPanel, FlightInstruments, hudPreview,
   flightRig, su57Rig, exhaust/profile, exhaust/preview, vapor/conditions, practice, HangarFlightView,
   FlightCamera, botPilot) — grep หาให้ครบเอง
3. dispatch ใน GameRuntime ด้วย dev setting flightCore: 'legacy' | 'new' ('new' ยังไม่มี ให้ fallback legacy)
4. CAMERA_TRACE: dump ต่อ frame (look, up, boom, FOV, α, rates, blend weights) แบบเปิดด้วย env/dev flag

เงื่อนไขผ่าน: พฤติกรรมเกมเหมือนเดิมทุกอย่าง — test เดิมเขียวทั้งหมด, golden เท่าเดิม,
camera.report.ts (B21) ตัวเลขเท่าเดิม (รันเดี่ยวด้วย CAMERA_REPORT_LABEL ไม่ผ่าน flight:bench ทั้งชุด)
หยุดและรายงาน docs/flight-rewrite-fr0.md
```

## FR1 — Core ใหม่ + keyboard (session 2)

```text
ทำ FR1 ตามแผน §3.1, §3.3, §3.4, §3.6, §3.8, §4.2, §4.5:
1. Core ใหม่ใน src/game/flightCore/ (เขียน FlightReadout ชุดเดียวกับ FR0):
   - rotation แบบ rate-command (target × maxRate, G/α limit ต่อเนื่อง, weathervane, tau, maxAccel)
     roll axis blend ตาม α (FD7) ใส่โครงไว้ได้ แต่ PSM จริงเป็น FR4
   - translation แบบแรงจริง (thrust, lift q·CL(α) cap G, drag cd0 + induced + high-α, side จาก β, gravity)
     ห้ามก๊อปทิศจมูกใส่ velocity; ไม่มี lateral damping แยก
   - speed Hybrid ทางกลาง (§3.6) พร้อม anti-windup
   - profile แบน F-22 / Su-57 (~20 ค่า, placeholder)
2. PilotCommand เพิ่ม psm (bump command schema); ใน FR1 α limit ยังปิดเสมอ
3. Bindings: Space = PSM (hold/toggle), X = airbrake, ←/→ = coordinated turn; bump bindings version
   และ migrate save เดิมโดยไม่ทับ key ที่ผู้เล่นตั้งเอง; ปุ่มตรงข้าม = ยกเลิก; digital rise/release 120–200 ms
4. Keyboard coordinated turn (←/→): เอียง ~60° + ดึงประคองความสูง, ปล่อยแล้วกลับระดับ
5. Dev: overlay (ค่าตาม spec §10.2) + tuning panel แก้ profile สด
6. Hard invariant ใหม่ (แผน §6): determinism, no NaN, energy sanity, ปล่อยมือ rate → 0 ภายใน ~3τ,
   FPS independence (FC-16)
7. Mouse modes เดิมให้ยังขับ core ใหม่ได้ชั่วคราวผ่าน PilotCommand (ไม่ต้องจูน — FR3/FR5 เขียนใหม่)

Acceptance: FC-01, FC-10, FC-16. กล้องยังเป็นตัวเดิม (อ่าน readout)
Stop point: owner บินด้วย keyboard บน flightCore='new'. รายงาน docs/flight-rewrite-fr1.md
พร้อมตัวเลข roll/pitch rate, turn rate vs speed, corner speed ที่วัดได้
```

## FR2 — Camera (session 3)

```text
ทำ FR2 ตามแผน §5 (เฉพาะสภาวะ "บินปกติ" และ "drift"; แถว PSM เป็น FR4):
1. เขียนกล้องใหม่สำหรับ flightCore='new': target pose (look, up, boom offset, FOV) จาก state + readout
   + style → critically damped spring ต่อค่า; blend ขับด้วยสถานะจริง (nose–path angle, α) ไม่ใช่ปุ่ม
2. 3 สไตล์เดิม (Horizon locked + Balanced default, Horizon locked + Dynamic, Aircraft locked)
   ใช้ Settings.camera เดิม
3. Drift: Horizon locked clamp เบี่ยงจากหลังเครื่อง ~20–30°; Aircraft locked ตามจมูกแบบ lag + ดู path เล็กน้อย
4. กล้องห้ามแก้ velocity / rates / aim
5. HUD: nose marker + FPM เสมอ
6. FOV: three.js เป็นแนวตั้ง (base 56 ≈ 88° แนวนอนที่ 16:9); ค่าใน spec §9.2 คือแนวนอน
7. ใช้ CAMERA_TRACE เทียบกล้องเก่า/ใหม่ ในท่า loop, roll, drift, หัวกลับ, ดิ่ง

Acceptance: FC-13, FC-15 (ส่วนกล้อง: ไม่ flip ใกล้ 180°, ไม่ NaN ที่ความเร็วใกล้ศูนย์)
Stop point: owner เทียบกล้องเก่า/ใหม่. รายงาน docs/flight-rewrite-fr2.md
```

## FR3 — Mouse Aim + bot (session 4)

```text
ทำ FR3 ตามแผน §4.1, §4.3 และ C1/C2 ใน §1:
1. Mouse Aim ใหม่บน core ใหม่: × เป็นทิศในโลก, กล้องมองตาม ×, อ่านเมาส์ใน frame ของกล้องที่ render จริง
2. Bank threshold (FD1): × ใกล้จมูก (< ~10°) = pitch + yaw ไม่เอียง; ไกล = bank-to-turn; hysteresis
3. D-REL (A): auto-level เฉพาะ bank เล็ก (< ~15–20°) แบบต่อเนื่อง; เอียงมากแล้วปล่อยค้างไว้
4. K1: ปุ่มทิศทางยึดเฉพาะแกนตัวเอง; ปล่อยแล้ว × ย้ายมาที่จมูก
5. instructor ใช้ค่าที่วางแผน ไม่ใช้ pitch rate ที่วัดได้ (บทเรียน §2.4); ไม่มี handover band
6. C free look แช่ ×; ระบบ aim assist / gunnery เดิม (aimAssist.ts, gunSolution.ts) ต้องยังทำงาน
7. Space hook: จมูกไล่ × ตรงๆ ไม่ bank (โครงไว้ จูนจริงใน FR4)
8. Bot: แยก instruct(state, readout, aimWorld, opts) → {pitch, roll, yaw} เป็น pure function
   ให้ botPilot.ts ใช้ตัวเดียวกับผู้เล่น
9. Benchmark C1 "unwanted roll" (matrix aim offset: roll travel เทียบขั้นต่ำ + เวลาเริ่ม roll),
   aim settle time; invariant C2 (mouse delta บนจอ → × ไปทิศเดียวกัน ทุก camera style ทุก attitude)

Stop point: owner playtest เมาส์ + ยิงเป้า. รายงาน docs/flight-rewrite-fr3.md
```

## FR4 — PSM (session 5, ต่อ FR5 ได้)

```text
ทำ FR4 ตามแผน §3.5, §3.3 (FD7), §5 แถว PSM:
1. psm → psmAuthority ∈ [0,1] blend (entry ~0.15–0.30 s, release ~0.25–0.50 s)
   ทำสองอย่างเท่านั้น: เปิด α limit + ให้ psmRate ที่ q ต่ำ; เส้น psmAuthority(speed) ต่อลำ (HUD km/h)
2. weathervane ∝ q·sin α; roll axis blend ลำตัว → velocity vector (α ~15° → ~30°) น้ำหนักต่อลำ
3. Speed hold: ระหว่าง PSM target ratchet down, ไม่เร่งสวน (FC-11)
4. Mouse Aim + Space: จมูกไล่ × ตรงๆ ไม่ bank; เมาส์ความหมายเดิม
5. กล้อง PSM: Horizon locked ตาม path, Aircraft locked ตามจมูกแบบ lag; blend ขับด้วย α / nose–path
   ไม่ใช่ปุ่ม Space; HUD edge arrow เมื่อ × หลุดจอ
6. ไม่มี auto-recovery assist; ปล่อย Space = α limit ค่อยปิด + weathervane
7. Benchmark ต่อท่า: Cobra (peak α), Kulbit, pedal turn, Herbst, reversal, Bell/tail slide, J-turn,
   power loop, PSM chaining — ทั้ง keyboard และ Mouse Aim
8. Invariant: ปล่อยมือใน post-stall (ไม่กด Space) α < αcrit ภายใน N s (เสนอค่า N ในรายงาน)

Acceptance: FC-02, 03, 04, 05, 06, 09, 11, 12, 15
Stop point: owner playtest ท่าด้วย keyboard และเมาส์. รายงาน docs/flight-rewrite-fr4.md
```

### FR5 — Mouse Joystick (ต่อใน session 5 ได้)

```text
ต่อจาก FR4 (หลัง owner playtest แล้ว) ทำ FR5 ตามแผน §4.4 และ C6:
1. Mouse Joystick: Positional (วงกลมกลางจอ + dead zone + curve) และ Relative (เด้งกลับกลาง)
2. คันโยกทิศตายตัว: ขึ้น = ดึงเข้าหา canopy เสมอ, ขวา = roll ขวาเสมอ (ตัวเลือก yaw, K4)
   ไม่มี screen turn / flip state (ต้นเหตุเดิม: FlightInput.flip)
3. Settings migration: 'aim'/'cursor' → Mouse Aim, 'stick' → Positional, 'relative' → Relative; ตัด cursor
4. Invariant C6: input เดิม → คำสั่งเดิม ทุก attitude ทุก camera style
   (รวมเคส owner: ดึง loop ครึ่งวงแล้ว roll กลับหัวตั้ง → ทิศไม่กลับ)

Stop point: owner playtest. รายงาน docs/flight-rewrite-fr5.md
```

## FR6 — Personality + polish (session 6)

```text
ทำ FR6 ตามแผน §3.8, §7:
1. Personality F-22 vs Su-57 (spec §11): Su-57 multiaxis + yaw PSM สูง, roll-axis weight เต็ม;
   F-22 pitch PSM เด่น yaw น้อยกว่า (FC-17)
2. จูน drift / banked drift / high-G drift / drift boost (FC-07 offset ~25–45° ที่ 450–550, FC-08)
3. HUD: stall / low energy warning, PSM READY (เป็นตัวบอกโอกาส ไม่ใช่รับประกัน), PSM indicator
4. FD6: port noseFlick (drift จากหัวกลับ) และ pedalEnergy (FC-05 + energy ใน PSM) เป็น benchmark
   ใหม่ของ core ใหม่ — เขียนไฟล์ใหม่ อย่าแก้ไฟล์เดิมของ owner
5. จูน bot (botPilot) บน core ใหม่: ยังสู้ได้ ไม่ชนพื้น
6. ทำงานเป็นรอบ: เสนอค่า → owner playtest → ปรับ; บันทึกทุกรอบในรายงาน

Stop point: owner พอใจ feel ทั้งสองลำ. รายงาน docs/flight-rewrite-fr6.md
```

## FR7 — สลับ default + ลบของเก่า (session 7, ต่อ FR7b ได้)

```text
ทำ FR7 ตามแผน §7, §8:
1. สลับ default เป็น flightCore='new'; ลบ dispatch toggle
2. ทำรายชื่อ "ทุกไฟล์" ที่จะลบ (core เก่า src/game/flight/*, input เก่า, test, golden, benchmark,
   baseline archives) แล้ว **ถาม owner sign-off ก่อนลบ** (ห้ามลบเงียบ)
3. ไฟล์ของ owner (noseFlick.report.ts, pedalEnergy.report.ts) ย้ายเข้า docs/legacy-flight/
   โดยไม่แก้เนื้อหา (docs/ อยู่นอก tsconfig include และ vitest glob); ย่อหน้า pedal-energy ใน
   benchmarks/flight/README.md ย้ายไปไว้กับไฟล์เหล่านั้น
4. bump flightProfileVersion
5. เขียน docs/game-design/02-controls, 03-flight-and-speed, 04-maneuvers, 11-cameras ใหม่ตามระบบใหม่;
   แก้ลิงก์ใน MASTER_PLAN.md / README.md
6. อัปเดต memory: flight-rewrite-plan เป็นสถานะเสร็จ; memory เก่าที่ถูกแทน (psm-final-baseline,
   maneuver-control-plan, camera-styles, mouse-aim, positional-stick-f22, throttle-hold) ให้ระบุว่าเลิกใช้
7. test/benchmark ใหม่ทั้งหมดเขียว; tsc -b ผ่าน (noseFlick ออกจาก build แล้ว)

รายงาน docs/flight-rewrite-fr7.md
```

### FR7b — ลบเอกสารเก่า (ต่อใน session 7 ได้)

```text
ถาม owner sign-off แยกต่างหาก ระบุชัดว่าจะลบ docs/legacy-flight/ ทั้งโฟลเดอร์
รวมไฟล์ของ owner ที่เก็บเข้าคลังตาม FD6 (ระบุชื่อทุกไฟล์) — ลบเมื่อได้คำยืนยันเท่านั้น
แล้วแก้ลิงก์ที่ชี้ไป legacy-flight ทั้ง repo
```
