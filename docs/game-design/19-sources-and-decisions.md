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
