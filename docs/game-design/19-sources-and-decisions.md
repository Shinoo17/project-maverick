# 19 — Sources, Assumptions และ Decision Log

[กลับ Master Plan](../../MASTER_PLAN.md) · ตรวจแหล่งข้อมูลวันที่ 6 กันยายน 2026

## น้ำหนักของข้อมูล

1. คำขอผู้ใช้ปัจจุบันเป็นขอบเขตหลัก
2. Source code และไฟล์ที่มีจริงใน workspace ใช้บอกสถานะปัจจุบัน
3. เอกสารเก่าเป็นบริบท/เหตุผล ไม่ถือว่าคำว่า “user answered” ในไฟล์เก่าเป็นคำยืนยันใหม่ในบทสนทนานี้
4. แหล่งทางการใช้รองรับข้อเท็จจริงและ technical API; ค่าบาลานซ์กับ architecture ของเกมนี้เป็นข้อเสนอของแผน

## เอกสารและ source ภายในที่ใช้

- [package.json](../../example/F22/package.json): stack, scripts ที่ประกาศไว้
- [FlightAircraft.jsx](../../example/F22/src/features/flight/FlightAircraft.jsx), [flight-model/step.js](../../example/F22/src/features/flight/flight-model/step.js): ownership ปัจจุบัน, separate orientation/velocity และ fixed step
- [flightInput.js](../../example/F22/src/features/flight/flightInput.js), [keybindings.js](../../example/F22/src/features/flight/keybindings.js): bindings/power semantics และ W+S chord เดิม
- [ROADMAP.md ของตัวอย่าง](../../example/F22/ROADMAP.md): เหตุผลการแยก simulation/view และ death/reset
- [control-speed-system.md เดิม](../../design-system-claude/control-speed-system.md): แนวคิด target speed, energy และ combat envelope ใช้เป็นฐานเปรียบเทียบ ไม่รับทุกค่ามาตรง ๆ
- [desing-project-maverick.md](../../design-system-claude/desing-project-maverick.md) และ [d2.md](../../design-system-claude/d2.md): บันทึกแผนเก่าที่มีข้อเสนอเรื่อง repo/ภาษา/controls ต่างจากคำขอปัจจุบัน

การอ่านครั้งนี้เป็น targeted source inspection ไม่ใช่ audit ทุกบรรทัด และยังไม่ได้เปิดดู GLB ภายในหรือรันแอป/test suite

## แหล่งภายนอกที่อ่านได้

| แหล่ง | ใช้รองรับอะไร | ขอบเขต |
|---|---|---|
| [React useRef](https://react.dev/reference/react/useRef) | ref mutation ไม่กระตุ้น re-render | ไม่ได้แปลว่า UI ต้องอ่าน ref ระหว่าง render โดยไม่มี subscription |
| [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) | GLB/glTF loading และ decoder integrations | ตรวจ API กับ dependency ที่ล็อกจริงตอน implement |
| [Three.js resource disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html) | geometry/material/texture lifecycle | แผน cache/reference ownership เป็นข้อเสนอของโปรเจกต์ |
| [MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) | engagement gesture, lock/unlock lifecycle | browser support/fallback ต้องทดสอบบน browser เป้าหมาย |
| [Glenn Fiedler: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/) | fixed-step, accumulator, catch-up budget | จำนวน Hz/tolerance ในแผนเป็นค่าที่เราเสนอ |
| [USAF F-22 fact sheet](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f-22-raptor/) | ข้อมูลทั่วไป F-22 และ capability ที่เปิดเผย | ไม่ใช้เป็นตัวเลขบาลานซ์หรือจัดอันดับความเหนือกว่าจริง |
| [USAF Museum F-22](https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/196040/lockheed-martin-f-22a-raptor/) | รายละเอียด F-22A และหัวฉีด thrust-vectoring สองมิติ | แยกประวัติเครื่องจัดแสดงจากข้อมูลรุ่นที่ใช้ในเกม |
| [NAVAIR F/A-18E/F Super Hornet](https://www.navair.navy.mil/product/FA-18EF-Super-Hornet) | บทบาท/ตระกูล Super Hornet | ข้อมูล E/F ร่วมกันต้องแยกรุ่นเมื่อลงรายละเอียด |

## แหล่งที่ยังตรวจได้ไม่ครบ

- [UAC Su-57](https://uacrussia.ru/en/aircraft/lineup/military/su-57/): พบจากผลค้นหาทางการ แต่เปิดหน้าเต็มครั้งนี้ timeout จึงใช้เป็น research lead เท่านั้น ยังไม่ใช้ยืนยัน engine variant, vectoring geometry หรือข้อเท็จจริงละเอียด
- [R3F Performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls): เปิดหน้าไม่สำเร็จเนื่องจากขนาด response; ไม่ใช้เป็นหลักฐานอ้างว่าอ่านเนื้อหาครบ แผน state/loop อิง source เดิมและเอกสาร React/Three ที่อ่านได้

ไม่ใช้แหล่งความเห็นผู้เล่นเป็นหลักฐานสเปกเครื่องบิน และไม่อ้างค่ากลไก Battlefield 6 ที่ยังไม่ได้ตรวจ แผนนี้กำหนด flight feel ของเกมเราเอง

## Decisions ที่แผนนี้เสนอให้ใช้

| ID | เรื่อง | ข้อเสนอและเหตุผล | เจ้าของ |
|---|---|---|---|
| D01 | โครงโค้ด | TypeScript + feature/core separation ในแอปเดียวก่อน; ไม่เริ่มด้วยหลาย packages | 01 |
| D02 | W/S | target speed จริง; ลบ semantics throttle/power และ W+S extreme chord เดิม | 02/03 |
| D03 | ปล่อย W/S | target หยุดปรับทันที; actual ยังมี inertia เพื่อลด overshoot ของคำสั่ง | 03 |
| D04 | Speed | world m/s ถูกบีบ; HUD multiplier เดียวพร้อม label Arcade | 03 |
| D05 | Mouse | virtual stick baseline ต่อจากของเดิม; instructor aim-point รอ playtest | 02 |
| D06 | Maneuver | High-G กับ PSM แยก intent; PSM release/recovery/budget ชัดเจน | 04 |
| D07 | กล้อง | view และ roll mode แยก; Horizon default สำหรับมือใหม่ | 11 |
| D08 | Aircraft identity | F/A-18E ระบุรุ่นชัด; ข้อได้เปรียบ gameplay ไม่อ้างเป็นอันดับจริง | 05 |
| D09 | Combat | gun duel ก่อน IR missile; radar missile รอ support/counterplay | 07 |
| D10 | Offline | ไม่มี server ระหว่างเล่น; cold-offline cache เป็นงานเพิ่มเติม | 09 |
| D11 | Multiplayer | หลัง P6; authoritative 1v1 ก่อน; ไม่รับประกัน 16 คนล่วงหน้า | 16 |
| D12 | Migration | เก็บ example เป็น reference; ย้ายทีละ seam ไม่สั่ง rewrite ทุกอย่างจากบันทึกเก่า | 18 |

สถานะทุก decision คือ **proposed baseline สำหรับ implementation/playtest** ผู้ใช้ยังไม่ได้ยืนยันรายละเอียดทุกข้อ การเริ่มทำตามแผนในอนาคตควรคงบันทึกว่าเปลี่ยนอะไรเพราะผลทดสอบ ไม่ทำให้ข้อเสนอเหล่านี้กลายเป็น “ความต้องการผู้ใช้เดิม” โดยไม่มีหลักฐาน

## รูปแบบบันทึกเมื่อมีการเปลี่ยน

```text
Decision ID / วันที่ / ผู้แก้
ปัญหาที่พบและ scenario/build ที่ใช้วัด
กฎเดิม → กฎใหม่
เหตุผลและ tradeoff
ไฟล์ specification / profile / tests ที่เปลี่ยน
ผลตรวจและสิ่งที่ยังต้อง playtest
```

เมื่อเปลี่ยนกฎแก้เอกสารเจ้าของเรื่องก่อน แล้วอัปเดต Master เฉพาะเมื่อ scope/dependency/gate เปลี่ยน ไม่คัดลอกตาราง controls หรือ tuning ไปทุกไฟล์จนมีหลาย source of truth

## D13 / 7 กันยายน 2026 / P2 manual PSM

ผู้ใช้แก้ brief ให้ผู้เล่นกำหนดท่าเอง จึงเลิก tap-to-Cobra prototype และใช้ hold C + steer ใน speed envelope ไม่มี auto-brake/auto-pitch/auto-nose-recovery; Cobra, pitch-led 180° และ yaw-led 180° เกิดจาก axis commands ต่างกันผ่าน core เดียวกัน Recovery รักษาหัวที่ผู้เล่นเลือกและใช้ bounded force ทำให้ velocity ตามหัว มีต้นทุนพลังงาน/budget/cooldown ผลทดสอบอยู่ [P2 ผลส่งมอบ](../phase-2-playground.md) และ `tests/maneuvers.test.ts`

เลือก C hold เป็น modifier ที่ไม่ชนปุ่มระบบ; X/S ชะลอเข้าโซนและ W เร่งออกแยกกัน เพื่อไม่ต้องจำ chord Airbrake+W ที่ขัดคำสั่งกัน ไม่เพิ่ม Alt/Command shortcut หรือ rebinding ในรอบนี้

ลิงก์อ้างอิงที่ผู้ใช้ให้: [คลิป 1](https://www.youtube.com/shorts/q0Tuyx5WwA8), [คลิป 2](https://www.youtube.com/shorts/Yw5KgrmmnPo), [คลิป 3](https://www.youtube.com/watch?v=T2FeMftBUYc) เครื่องมือ web fetch เปิดไม่สำเร็จ จึงใช้แนวทางเกมที่ผู้ใช้ระบุเป็น brief และไม่อ้างรายละเอียดที่มองไม่เห็นจากคลิป

## D14 / 27 กันยายน 2026 / Game shell ตาม Design example

ผู้ใช้ขอให้ปรับเกมให้เป็นเกมมากขึ้น และให้แผนตรงกับ [example/Design.html](../../example/Design.html) ซึ่งมี 6 หน้าจอ: Home, Select Mode, Hangar, Hangar Armament, Campaign Map และ PVE Setup

- กฎเดิม: `#/` คือ Hangar ที่มี control rail 320px, แท็บ systems/flight/weapons และปุ่มเริ่มบินใน rail; สีเลือกเป็น sand; release แรกมีแค่ Dogfight vs Bots
- กฎใหม่: Home เป็นหน้าแรก ทุกหน้าเมนูเป็น overlay บน 3D scene เดียว ไม่มี panel; เริ่มเกมจาก Home หรือหน้า setup; โหมดหลักคือ Campaign และ PVE; สไตล์ภาพตาม DESIGN.md ฉบับใหม่ (cyan selection, Barlow)
- เพิ่ม phase P3b (game shell), P5b (PVE objective modes), P5c (Campaign) โดยไม่เปลี่ยนเลข P0–P7 เดิม เพราะเอกสาร phase, โค้ด และภาพอ้างอิง (`BUILD P3`, `VALUES PENDING P5 TUNING`) อ้างเลขเดิมอยู่ Offline release (P6) ต้องรวมงานเหล่านี้
- เจ้าของรายละเอียด: [20](20-game-shell.md) หน้าจอและการนำทาง, [21](21-campaign.md) Campaign, [09](09-offline.md) กติกา PVE, [06](06-hangar.md) Hangar/Armament
- เลข phase ของ Master (P0–P7, P3b, P5b, P5c) แยกจาก Phase ของงาน PSM ใน `docs/psm-*`

## D15 / 27 กันยายน 2026 / PVE เป็นโหมดทีมสามแบบ

ผู้ใช้กำหนดให้ PVE มี Team Deathmatch, Control Point และชิงธง แทน 1v1/FFA ในภาพ PVE Setup

- TDM ขนาด 1v1 ทำหน้าที่เป็น gun duel ของ P4 จึงไม่เก็บโหมด Duel/FFA แยก; ลำดับ gun ก่อน IR (D09) ไม่เปลี่ยน
- ขนาดทีมเริ่มที่ 2v2 (4 ลำตาม budget เดิม) เป้า 4v4 หลัง benchmark
- Friendly fire ปิด และมี IFF ใน PVE/Campaign (07)
- ค่าจุดยึด/ฐานธงเป็นค่าทดลอง รัศมีจุดยึดอิงรัศมีเลี้ยวที่ cruise (09)
- ข้อเสนอที่ต่างจากภาพ: เพิ่ม Training เป็นรายการรองใน Select Mode (ภาพมีแค่ Campaign/PVE) เพราะ Definition of Done ยังต้องฝึกบินได้โดยไม่เข้า match; เพิ่มปุ่ม Settings บน Home เพราะภาพไม่มีทางเข้า Settings; ผู้ถือธงใช้ PSM ไม่ได้ **ทั้งสามข้อรอผู้ใช้ยืนยัน**

## D16 / 27 กันยายน 2026 / คำถามเปิดของ Campaign

- **วิธีโจมตีเป้าภาคพื้น (รอผู้ใช้ตัดสิน):** mission M02, M03, M05 ต้องทำลายเรดาร์ ฐาน หรือเครื่องที่จอดอยู่ แต่อาวุธที่มีเป็นอาวุธอากาศสู่อากาศทั้งหมด ตัวเลือก: ปืนอย่างเดียว, ให้ IR missile lock เป้าภาคพื้นบางชนิด หรือเพิ่มอาวุธโจมตีภาคพื้นเป็น content ใหม่ ก่อนตัดสิน mission เหล่านี้เป็น PLANNED
- ผู้เล่นไม่มี respawn ใน mission ถูกยิงตกคือ failed แล้ว retry (ข้อเสนอ)
- Campaign ไม่ปลดล็อกเครื่องบินหรือมี economy ตามขอบเขตเดิมใน Master
- Settings ยังไม่มีภาพอ้างอิง ต้องออกแบบก่อน implement หน้าจอ

## D17 / 27 กันยายน 2026 / เพิ่ม Priority Target และ Flyover

ผู้ใช้เพิ่มสองโหมด PVE รวมเป็นห้าโหมด กติกาเต็มอยู่ใน [09](09-offline.md)

- **Priority Target** (แนวชิงมงกุฎ) ตามที่ผู้ใช้กำหนด: ถือมงกุฎได้ 1 แต้มต่อวินาที, ถึง score limit ชนะ, หมดเวลาแต้มมากกว่าชนะ, เสมอต่อเวลา 2 นาที, ถือได้ไม่เกิน 30 s แล้ว reset, ผู้ถือตายมงกุฎตกค้าง 20 s แล้ว reset
- **Flyover** ตามที่ผู้ใช้กำหนด: 3 จุดใน map, บินผ่านก็ยึดได้, ทีมที่ยึดได้มากกว่าได้แต้มต่อเนื่อง, ไม่ต้องเฝ้าพื้นที่ ชื่อ “Flyover” และ id `flyover` เป็นชื่อที่แผนตั้งให้ เปลี่ยนได้
- ข้อเสนอที่แผนเติม **รอผู้ใช้ยืนยัน**:
  - ต่อเวลาแล้วยังเสมอเป็น draw ไม่ต่อซ้ำ
  - หลัง reset 30 s มงกุฎเกิดที่จุดอื่น และผู้ถือล่าสุดเก็บซ้ำไม่ได้ 10 s
  - มงกุฎที่ตกต่ำกว่า 150 m เหนือพื้นถูกยกขึ้นให้เก็บได้ปลอดภัย
  - แต้มคิดจากเวลาถือรวมของทีม เศษวินาทีไม่หาย
  - Flyover: จุดที่เพิ่งถูกยึดล็อก 5 s, ถือครบ 3 จุดได้ 2 แต้มต่อวินาที, เข้าจุดพร้อมกันเจ้าของไม่เปลี่ยน
  - ค่าเริ่มต้น: Priority Target 8 นาที/100 แต้ม, Flyover 10 นาที/300 แต้ม, รัศมีเก็บมงกุฎ 200 m, รัศมีจุด Flyover 300 m
