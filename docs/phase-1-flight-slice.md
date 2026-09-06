# Phase 1 — Flight slice

อัปเดต 6 กันยายน 2026 · ต่อจาก [P0](phase-0-implementation.md) · [Master roadmap](../MASTER_PLAN.md)

## เส้นทางที่เล่นได้

เปิด `#/` → เลือกเครื่องในโรงเก็บ → เลือก **ฝึกซ้อม / สนามฝึกพื้นราบ** ใต้ `hangar-panel` → **เล่น** → เลือกการควบคุมและกล้อง → **เริ่มบิน**

มีโหมด `playground` และแผนที่ `flat-range` อย่างละหนึ่งรายการใน UI เท่านั้น เมนูเลือกใช้ native select พร้อม label ไทย/อังกฤษ ปุ่มเล่นใช้แถบเทา/ตราสีน้ำเงินและปุ่มเหลืองตามภาพอ้างอิง ทั้ง F-22 และ Su-57 ใช้ **ค่าทดลอง F-22 เดียวกัน** โดยแจ้งในหน้าก่อนบิน สมรรถนะรายลำเป็น P3 ไม่ถือว่า Su-57 ผ่านการบาลานซ์แล้ว

## Roadmap และเจ้าของงาน

| งาน | ผลที่ส่งมอบ | การตรวจ |
| --- | --- | --- |
| FLT-01 สนามและแกน | สนามเรียบ 8 km radius, runway/วงแหวนอ้างอิง, เกิดสูง 400 m ที่ 130 m/s; +X forward/+Y up/+Z right; โมเดลยาว 18.9 m ในสนาม | axis/sign tests, ดู F-22 ใน chase view; ชนพื้น/ออกขอบแล้วหยุดและเริ่มใหม่ได้ |
| FLT-02 ความเร็ว | `speed.ts`: W/S ปรับ target 30 m/s ต่อวินาที ช่วง 65–200; ปล่อยแล้วคง target; engine spool และ actual speed แยกกัน; X suppress thrust | target/release/clamp/airbrake priority tests |
| FLT-03 การบิน | `stepFlight.ts`: assisted rates, quaternion, bounded lateral acceleration, turn/climb energy loss, progressive overspeed drag; orientation/velocity แยก | command replay ตรงกัน 30/60/144 FPS, nose/path ต่างกัน, zero-speed finite |
| FLT-04 Input | `FlightInput.ts` และ browser lifecycle: mouse virtual stick/keyboard-only; opposite keys cancel, keyboard override, blur/hidden/unlock clear | adapter tests; browser keyboard flight และ pointer-denial fallback |
| FLT-05 ภาพ/กล้อง/HUD | `FlightScene.tsx` ขับ runtime หนึ่งครั้งต่อ frame; interpolated pose; `FlightCamera.ts` chase horizon/aircraft; HUD actual/target/altitude 10 Hz | camera ไม่เปลี่ยน state, vertical/inverted continuity และกลับขอบฟ้า; browser Play/Pause/Reset |
| FLT-06 Rig | `flightRig.ts` mapping control surfaces และ nozzle aperture จาก rates/engine state ของ instance | hinge isolation test; shared geometry แต่ skeleton/pose แยก |
| UI/i18n | `react-i18next` + i18next, typed key schema, en fallback, TH/EN persistence; mode/map/Play และเมนูบิน | key/placeholder parity, TypeScript build, browser TH/EN |

## การควบคุมใน slice นี้

- W / S: เพิ่ม/ลดความเร็วเป้าหมาย ไม่ใช่คันเร่งโดยตรง
- ลูกศรขึ้น/ลง: เชิด/กดหัว; A/D หรือลูกศรซ้าย/ขวา: เอียงปีก; Q/E: yaw
- Mouse + Keyboard: เมาส์ขึ้น/ลงสั่ง pitch ซ้าย/ขวาสั่ง roll พร้อม yaw assist; stick ค้างตำแหน่ง คืนกลางเพื่อหยุดเลี้ยว; deadzone 5%, curve 1.4
- X: airbrake ขั้นพื้นฐาน ไม่เปลี่ยน target
- V: สลับกล้อง Horizon locked / Aircraft locked
- P / Escape: Pause; กลับไปบิน, reset และกลับโรงเก็บอยู่ในเมนู
- HUD แสดง **ARCADE km/h** = world m/s × 3.6 × 1.5 ตามข้อเสนอใน 03 ไม่ใช่ความเร็วเครื่องจริง

## ขอบเขตทางเทคนิค

`GameRuntime` เป็นผู้เขียน world state คนเดียว ใช้ 60 Hz world tick และสอง flight substeps ที่ 120 Hz ไม่มี DOM/React/RAF ใน core ใช้ Three.js เฉพาะคณิตศาสตร์ การเปลี่ยนกล้อง/ภาษาไม่เข้า PilotCommand และ renderer ไม่เขียนตำแหน่งกลับเข้า simulation

โมเดลบินเป็น assisted arcade baseline: ใช้แรงแก้เส้นทางที่จำกัดและ trim ช่วยต้านแรงโน้มถ่วงขวางเส้นทาง ยังไม่ใช่ aerodynamic lift/AoA/stall model เต็มรูปแบบ Nozzle ใน P1 สื่อ engine power เท่านั้น ยังไม่ใช่ thrust-vectoring force

Simulation หยุดเมื่อเมนูเปิด/แท็บถูกซ่อน/เสียโฟกัส; pointer lock ต้องผ่าน browser engagement gesture หากถูกปฏิเสธมี retry และ Keyboard-only เมนูเป็น native dialog เพื่อกักโฟกัส มีทางออกกลับโรงเก็บแม้ asset/WebGL ล้มเหลว

## ผลตรวจรอบนี้

- `npm run build` ผ่าน (Three.js vendor chunk ยังมีคำเตือนเกิน 500 kB เดิม)
- ทดสอบ regression 19 cases ครอบคลุม P0, animation, flight, input, camera และ locale
- เบราว์เซอร์: Play เข้า F-22, Keyboard-only เริ่มบิน, W เปลี่ยน target 702 → 705 ARCADE km/h, V เปลี่ยนเป็น Aircraft locked, P เปิด Pause, Reset คืนหน้าพร้อมบิน และกลับโรงเก็บได้
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
