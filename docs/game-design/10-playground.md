# 10 — Playground, Tutorial และ Flight Lab

[กลับ Master Plan](../../MASTER_PLAN.md) · P1–P2 แล้วเพิ่มเครื่องมือ combat ใน P4–P5

## สถานะ P2 · 7 กันยายน 2026

Free Flight, บทฝึก 1–6 แบบย่อ, สี่ spawn presets, telemetry, slow motion, pause single-step และ replay export/runner อยู่ในโค้ดแล้ว ดู [ผลส่งมอบ P2](../phase-2-playground.md) สำหรับเกณฑ์ที่ตรวจจริง บทกล้องปัจจุบันตรวจการสลับ V; rear/free-look และตัวเลือก combat ในแผนด้านล่างยังไม่เปิดใช้ UI export ได้ แต่ยังไม่มี import/live tuning UI

## เป้าหมาย

เป็นที่ลองเครื่อง ฝึก control และปรับ flight feel โดยไม่ต้องชนะ match ใช้ runtime/flight/weapon ชุดเดียวกับ Offline เปลี่ยนเฉพาะ mode rules และ scenario ห้ามสร้าง `playgroundFlightModel` อีกชุด

## เส้นทางฝึก

| บท | สิ่งที่ลอง | เกณฑ์จบที่อ่านจาก simulation |
|---|---|---|
| 1 ดูรอบตัว | camera views, roll modes, rear/free look | สลับ mode แล้วกลับมุมปกติ |
| 2 คุมเครื่อง | pitch, yaw, roll | เคลื่อนแกนครบและผ่านวงแหวนกว้าง |
| 3 คุมความเร็ว | W/S, target vs actual, Airbrake | คง target ที่กำหนดและชะลอเข้า turn band |
| 4 เลี้ยว | normal turn เทียบ High-G | heading เปลี่ยนครบ พร้อมเห็น speed cost |
| 5 Recover | ลด AoA แล้วเร่ง | ออกจาก low energy กลับ controllable flight |
| 6 Cobra | entry speed/altitude, arm/pitch/release | สำหรับลำรองรับ: nose/path ต่างกันและ recover สำเร็จ |
| 7 ปืน | เป้านิ่ง → drone บินตรง | hit ต่อเนื่อง/ทำลายเป้า; ไม่มี hidden aim bonus |
| 8 Missile | select/lock/fire/flare | ยิงถูกหนึ่งครั้งและหลบ threat scenario หนึ่งครั้ง |

บท 7–8 เพิ่มเมื่อ combat พร้อม ไม่ขวางการส่ง P2 ทุกบท skip/retry ได้ prompt อ่าน keybinding ปัจจุบันและภาษา ไม่ใส่ตัวอักษรปุ่มตายตัวในข้อความ

## Sandbox options

เลือกสนามเรียบ/สนามจริง, aircraft, spawn altitude/speed, dummy drone, bot passive, guns-only, unlimited ammo, invulnerability และ reset-to-safe-flight แสดง practice modifiers ที่เปิดไว้เสมอ ไม่เอาผลที่เปิด invulnerability ไปปน score Offline

Time scale 0.25/0.5/1 และ pause single-step เป็น dev tools ใช้ fixed dt เดิมแต่เปลี่ยนอัตราที่เติม accumulator; one-shot command ส่งครั้งเดียวต่อ tick ไม่ยิงซ้ำทุก step ที่กดใน UI

Reset เป็น mode action ที่ล้าง projectiles, threats, lock, maneuver state, cooldowns และ input ตาม scenario seed เดิม Camera reset แยกจาก aircraft reset

## Flight Lab สำหรับผู้พัฒนา

Panel แสดง world speed m/s, Arcade HUD speed, target speed, AoA, nose-off-path, body rates, flight-path turn rate, G indicator, drag groups, engine output, PSM state และ fixed-step cost เปิด debug vectors: nose, velocity, lift, terrain probes

มี scenario presets ที่ serialize ได้:

```ts
interface FlightScenario {
  id: string;
  seed: number;
  aircraftId: string;
  spawn: { position: [number, number, number]; speedMps: number };
  commandTrack: Array<{ fromTick: number; toTick: number; command: Partial<PilotCommand> }>;
  durationTicks: number;
}
```

Track ที่เป็น Partial ต้องเติม neutral defaults ก่อนส่งจริง และ one-shot actions กำหนด tick เฉพาะ ไม่ใส่ repeated action id ในทุก tick เก็บ tuning overrides ใน session ชั่วคราว; export JSON พร้อม profile/schema version เพื่อ review ก่อนนำเข้า content จริง

## ชุด scenario เริ่มต้น

- Straight acceleration/deceleration และปล่อย W/S
- 360° normal turn ในช่วง speed หลายจุด เทียบ High-G
- Airbrake แล้ว release/recover กลับ target เดิม
- Cobra entry ถูก/ผิดเงื่อนไข และ cancel ระหว่างท่า
- Keyboard-only กับ mouse command track ที่ normalized เหมือนกัน
- Gun head-on pass, tail chase, missile crossing target และ terrain occlusion

## งานและเกณฑ์ผ่าน

สร้าง Free Flight + reset ก่อน → telemetry/debug vectors → lessons 1–6 → scenario runner/export → combat lessons เมื่อพร้อม Test ว่า reset หลายครั้งได้ initial state เดิม, pause ไม่ปล่อย simulation เดินต่อ และ practice modifiers ไม่ติดไป Offline

ผ่านเมื่อใช้ Playground ตอบได้ว่า “เลี้ยวไม่ทันเพราะ input, speed, authority หรือกล้อง” และผู้เล่นลองผิดแล้วกลับมาบินได้โดยไม่ต้อง reload หน้า
