# Phase 1 — Flight slice

อัปเดต 7 กันยายน 2026 · ต่อจาก [P0](phase-0-implementation.md) · [Master roadmap](../MASTER_PLAN.md)

## เส้นทางที่เล่นได้

เปิด `#/` → เลือกเครื่องในโรงเก็บ → เลือก **ฝึกซ้อม / สนามฝึกพื้นราบ** ใต้ `hangar-panel` → **เล่น** → เลือกการควบคุมและกล้อง → **เริ่มบิน**

มีโหมด `playground` และแผนที่ `flat-range` อย่างละหนึ่งรายการใน UI เท่านั้น เมนูเลือกใช้ native select พร้อม label ไทย/อังกฤษ ปุ่มเล่นใช้แถบเทา/ตราสีน้ำเงินและปุ่มเหลืองตามภาพอ้างอิง ทั้ง F-22 และ Su-57 ใช้ **ค่าทดลอง F-22 เดียวกัน** โดยแจ้งในหน้าก่อนบิน สมรรถนะรายลำเป็น P3 ไม่ถือว่า Su-57 ผ่านการบาลานซ์แล้ว

## Roadmap และเจ้าของงาน

| งาน | ผลที่ส่งมอบ | การตรวจ |
| --- | --- | --- |
| FLT-01 สนามและแกน | สนามเรียบ 8 km radius, runway/วงแหวนอ้างอิง, เกิดสูง 400 m ที่ 130 m/s; +X forward/+Y up/+Z right; โมเดลยาว 18.9 m ในสนาม | axis/sign tests, ดู F-22 ใน chase view; ชนพื้น/ออกขอบแล้วหยุดและเริ่มใหม่ได้ |
| FLT-02 ความเร็ว | `speed.ts`: W/S ขอแรงเร่ง/ลด 24 m/s²; ปล่อยแล้วแรงค่อยหมดและคงความเร็วจริง; ช่วงเร่ง/ลดด้วยปุ่ม 65–200 m/s; X suppress thrust | accelerate/decelerate/release/limits/airbrake priority tests |
| FLT-03 การบิน | `stepFlight.ts`: assisted rates, quaternion, bounded lateral acceleration, turn/climb energy loss, progressive overspeed drag; orientation/velocity แยก | command replay ตรงกัน 30/60/144 FPS, nose/path ต่างกัน, zero-speed finite |
| FLT-04 Input | `FlightInput.ts` และ browser lifecycle: mouse virtual stick/keyboard-only; opposite keys cancel, keyboard override, blur/hidden/unlock clear | adapter tests; browser keyboard flight และ pointer-denial fallback |
| FLT-05 ภาพ/กล้อง/HUD | `FlightScene.tsx` ขับ runtime หนึ่งครั้งต่อ frame; interpolated pose; `FlightCamera.ts` chase horizon/aircraft; HUD actual/altitude 10 Hz; aim/nose/path projection ทุก render frame | camera ไม่เปลี่ยน state, vertical/inverted continuity และกลับขอบฟ้า; browser Play/Pause/Reset |
| FLT-06 Rig | `flightRig.ts` mapping control surfaces และ nozzle aperture จาก rates/engine state ของ instance | hinge isolation test; shared geometry แต่ skeleton/pose แยก |
| UI/i18n | `react-i18next` + i18next, typed key schema, en fallback, TH/EN persistence; mode/map/Play และเมนูบิน | key/placeholder parity, TypeScript build, browser TH/EN |

## การควบคุมใน slice นี้

- W: เร่งความเร็วจริง; S: ลดความเร็วจริง; ปล่อยแล้วไหลต่อประมาณ 4 m/s (เมื่อกดค้างจนเต็มแรง) ก่อนคงที่ในการบินตรง ไม่มี Target Speed ใน state/HUD/controller
- ลูกศรขึ้น/ลง: เชิด/กดหัว; A/D หรือลูกศรซ้าย/ขวา: เอียงปีก; Q/E: yaw
- Mouse + Keyboard: เมาส์เป็น positional stick ตาม `example/F22` ใน `src/game/input/mouseStick.ts` ตำแหน่งตัวชี้ใน gate คือตำแหน่งคันบังคับ ไม่ใช่การสะสมระยะลาก; gate เป็นวงกลมรัศมี 34% ของด้านสั้นของ surface หาร sensitivity, clamp ด้วยความยาว (ไม่ใช่รายแกน) จึงเป็นดิสก์ไม่ใช่กล่อง; dead zone 12% ของรัศมี, radial curve กำลังสอง; ไม่มี auto-bank/auto-level/heading assist เหลืออยู่
- `screenFrame(state, mode)` คืน `{ angle, blend }` = มุมที่ตัวเครื่องดูหมุนอยู่ในเฟรม; โหมด `aircraft` ได้ 0 (stick ดิบ) โหมด `horizon` ได้เท่ามุมเอียงปีกรอบแกนบิน; หมุน vector ที่วาดบนจอด้วยมุมนี้ก่อนอ่านค่า จึงได้พฤติกรรมทั้งหมดพร้อมกัน: ลากลง = หัวลง, ลากลงตอนคว่ำ = pitch up ให้หัวลงเหมือนเดิม, ชี้ขึ้นจากท่ามีดโกน = roll กลับระดับ, ควงตัวชี้รอบ gate = roll ต่อเนื่อง
- อ่านมุมจาก attitude ไม่ใช่จาก up ของกล้อง เพราะ up ของกล้องถูก smooth และตัวมันเองก็ไล่ตามเครื่องอยู่ ถ้าอ่านจากตรงนั้นจะเกิดลูป: ในท่าดิ่งชัน correction เปลี่ยน elevator เป็น aileron, roll ไปขยับเส้นอ้างอิง, เครื่องเข้า barrel roll ที่ไม่มีใครสั่ง
- ใกล้แนวดิ่ง (ความยาวแนวราบของหัวเครื่อง < 0.35) blend คำสั่งสองชุดเข้าหากัน ไม่ใช่ย่อขนาดมุม เพราะครึ่งหนึ่งของ bank 180° คือท่ามีดโกน เครื่องจะไปนั่งค้างอยู่ตรงนั้น; การ blend คำสั่งให้ผลที่ท่านั้นต้องการจริง คือดิ่งอยู่นิ่ง ๆ ไม่สั่นข้าม branch cut
- เป็น lift-vector control: roll command เป็นศูนย์พอดีเมื่อมุมเอียงปีกเท่ากับมุมที่ถือตัวชี้ ตัวชี้ที่จอดนิ่งจึงเป็น *มุมเอียงปีก* ไม่ใช่ roll rate; ถือสุดด้านข้าง = มีดโกน 90° พร้อมดึงเต็ม; ระยะห่างจากกลางคือแรงดึง
- `screenFrame` อ่านใหม่ทุก simulation tick ไม่ใช่ทุกเฟรมที่วาด เพราะ sim เดิน 120 Hz ภายใน advance() เดียว และเมื่ออ่านจาก attitude ล้วน ผลจึงตรงกันทุก render rate
- `MOUSE_SENSITIVITY` 0.5–2 หาร gate radius เลือกได้จาก pause menu; 0.5 = วงกว้างเกือบเต็มจอตามที่ขอให้ตัวชี้เดินได้ทั้งจอ, 2 = วงแคบขยับนิดเดียวพอ
- Roll ผ่าน angular acceleration/rates และ speed authority เดิม ไม่มี canned animation หรือ quaternion snap; `PilotCommand` เหลือแค่แกน pitch/roll/yaw ไม่มี mouseAim ใน simulation contract อีกแล้ว
- Tuning เมาส์รวมใน `MOUSE_STICK` (radius/deadZone/curve/sensitivity); ไม่มี aim smoothing ใน simulation แล้ว ความหน่วงที่เหลือคือ angular inertia (`rateResponse`) อย่างเดียว
- + คือหัวเครื่อง, ◇ คือทิศ velocity จริง; สองอันนี้ project จากทิศ 3D ส่วน gate กับหมุดคันบังคับวาดขนาดจริงบนจอ ไม่ project เพราะคันบังคับไม่มีตำแหน่งในโลก
- X: airbrake ขั้นพื้นฐาน มี priority เหนือ W; ปล่อยแล้วไม่เร่งคืนความเร็วเดิม
- Trim ชดเชยเฉพาะ base drag; การเลี้ยว ไต่ระดับ และ overspeed ยังมีผลต่อพลังงาน ไม่มีการเพิ่ม High-G/PSM/Afterburner ในรอบนี้
- V: สลับกล้อง Horizon locked / Aircraft locked
- P / Escape: Pause; กลับไปบิน, reset และกลับโรงเก็บอยู่ในเมนู
- HUD แสดง **ARCADE km/h** = world m/s × 3.6 × 1.5 ตามข้อเสนอใน 03 ไม่ใช่ความเร็วเครื่องจริง

## ขอบเขตทางเทคนิค

`GameRuntime` เป็นผู้เขียน world state คนเดียว ใช้ 60 Hz world tick และสอง flight substeps ที่ 120 Hz ไม่มี DOM/React/RAF ใน core ใช้ Three.js เฉพาะคณิตศาสตร์ การเปลี่ยนกล้อง/ภาษาไม่เข้า PilotCommand และ renderer ไม่เขียนตำแหน่งกลับเข้า simulation

โมเดลบินเป็น assisted arcade baseline: ใช้แรงแก้เส้นทางที่จำกัดและ trim ช่วยต้านแรงโน้มถ่วงขวางเส้นทาง ยังไม่ใช่ aerodynamic lift/AoA/stall model เต็มรูปแบบ Nozzle ใน P1 สื่อ engine power เท่านั้น ยังไม่ใช่ thrust-vectoring force

Simulation หยุดเมื่อเมนูเปิด/แท็บถูกซ่อน/เสียโฟกัส; pointer lock ต้องผ่าน browser engagement gesture หากถูกปฏิเสธมี retry และ Keyboard-only เมนูเป็น native dialog เพื่อกักโฟกัส มีทางออกกลับโรงเก็บแม้ asset/WebGL ล้มเหลว

## ผลตรวจรอบนี้

- `npm run build` ผ่าน (Three.js vendor chunk ยังมีคำเตือนเกิน 500 kB เดิม)
- ทดสอบ regression 30 cases ครอบคลุม P0, animation, flight, input, camera และ locale
- เบราว์เซอร์รอบแก้ระบบบิน: F-22, Keyboard-only เริ่มบิน, W เปลี่ยนความเร็วจริง 702 → 703 ARCADE km/h, P เปิด Pause, HUD ไม่มี Target Speed; Pointer Lock ถูกปฏิเสธและ fallback ยังใช้งานได้
- Headless เพิ่ม gate disc/dead zone/curve, screenRoll frame correction, `screenRollFor` ที่ทั้งสองโหมดกล้อง, roll 360° ซ้าย/ขวาจาก circling pointer, ลากลงทั้งท่าปกติและท่าคว่ำ, ชี้ขึ้นจากมีดโกน, bank ตามมุมตัวชี้, keyboard override รายแกน และ path เดียวกันที่ 30/60/144 FPS
- Headless เพิ่ม mouse held-bank/mirrored turn, diagonal climb, centre recovery, manual override, precision curve, speed envelope, vertical finite และ mouse+speed replay 30/60/144 FPS
- สลับ TH/EN; ที่ 390×844 ปุ่มเล่น/แผนที่อยู่ใต้ panel และ document width = scroll width = 390 ไม่มีแนวนอนล้น คืน viewport หลังตรวจแล้ว
- Mechanical UI detector ไม่พบรายการ; independent review ตรวจพบ horizon recovery/rig/pointer lifecycle และแก้พร้อม regression coverage แล้ว

## งานถัดไป / Exit gate

P1 มี baseline ที่เล่นได้และ regression tests ของผลการบินแล้ว การรับรอง flight feel และประสิทธิภาพจริงบนหลาย GPU/browser ยังต้อง playtest; ผล equal-FPS เป็นการ replay headless ไม่ใช่ benchmark GPU

- P2: AoA/stall envelope และ recovery cues, High-G, burner reserve, PSM/Cobra, telemetry lab/tutorial; ขยาย Airbrake ให้ครบ tuning
- กล้องรอบถัดไป: rear/free look, near/nose, Balanced, distance/FOV preferences
- Settings รอบถัดไป: persist preset/camera, sensitivity/invert/rebinding
- P3: flight profile รายลำและ rig Su-57; loadout/facts/game tabs
- P4 เป็นต้นไป: อาวุธ บอท damage/respawn และ match lifecycle

รายละเอียด validation ล่าสุดดูผล `npm test` และ `npm run build` การทดสอบ Pointer Lock ผ่านเครื่องมือเบราว์เซอร์พบ `WrongDocumentError` จาก root document ของแท็บทดสอบที่อยู่เบื้องหลัง จึงยืนยันได้เฉพาะทางปฏิเสธและ fallback ในรอบนี้ ต้องตรวจ successful mouse capture บนแท็บ Chrome ที่ผู้เล่นโฟกัสจริงเพิ่มเติม

อ้างอิงการเชื่อมภาษา: [react-i18next initialization](https://react.i18next.com/latest/i18next-instance), [useTranslation](https://react.i18next.com/latest/usetranslation-hook)
