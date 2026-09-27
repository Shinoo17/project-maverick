# 06 — Hangar และ Aircraft Viewer

[กลับ Master Plan](../../MASTER_PLAN.md) · P3/P3b · พึ่ง aircraft, assets, localization, game shell (20)

## ผู้เล่นทำอะไรได้

เข้าโรงเก็บจาก Home (H) → เลือกเครื่องจากแถบล่าง → ดูโมเดล อ่านประวัติสั้น บทบาท และ stat bars → เปิดรายละเอียดเชิงลึก (D) หรือหน้าอาวุธ (W) → `SET ACTIVE` แล้วกลับ Home ไปกด Play โรงเก็บไม่มีปุ่มเริ่มบินของตัวเอง การเริ่มเกมอยู่ที่ Home และหน้า setup ของโหมด (20) Session ส่งแค่ `aircraftId` ไม่ส่ง Three.js scene ไป simulation

## โครงหน้าจอ Hangar

ภาพอ้างอิง 2 · Hangar ใน [example/Design.html](../../example/Design.html) ทุกอย่างเป็น overlay ลอยบนโมเดล ไม่มี panel หรือ rail ด้านข้าง โมเดลใช้ menu scene ร่วมกับ Home ตาม 20

| ตำแหน่ง | เนื้อหา/พฤติกรรม |
|---|---|
| บนซ้าย | breadcrumb `HOME / HANGAR` และ hotkey hints: ← → Aircraft, D Detail, W Armament, R Reset view |
| ซ้าย: identity | designation + ชื่อ (ตัวใหญ่), game role เช่น `AIR SUPERIORITY`, play style เช่น `ENERGY FIGHTER` |
| ซ้าย: เล่นอย่างไร | คำแนะนำหนึ่งถึงสองประโยคว่าลำนี้ชนะด้วยอะไร |
| ซ้าย: ความเป็นมา | ประวัติสั้นสองถึงสามประโยคจาก facts ที่ตรวจแล้ว พร้อมลิงก์ source |
| ซ้าย: PERFORMANCE | stat bars 0–100 (Speed, Acceleration, Agility, Post-stall, Firepower) พร้อม tick ของค่าลำที่เปรียบเทียบ |
| ซ้าย: DETAIL (D) | สลับ stat bars เป็นตารางเชิงลึก: top speed MIL/A-B, acceleration, pitch/yaw/roll rate, stall speed, critical AoA, PSM band, PSM pitch/yaw, thrust vector |
| ซ้าย: ARMAMENT | สรุป เช่น `1 GUN · 8 MSL` และแถว ชนิด / ชื่อ / station / จำนวน; ข้อความ “ติดเต็มความจุทุก station ไม่มีการแก้ loadout”; ปุ่ม `INSPECT ARMAMENT →` |
| กลาง | 3D viewer: orbit, zoom, reset, turntable และ stage animation เมื่อ GLB มี clip |
| ล่าง | `SELECT AIRCRAFT · n` แถบการ์ด thumbnail + ชื่อ + role tag; ช่องเครื่องที่ยังไม่มีแสดง `LOCKED` / `[AIRCRAFT 03]`; ปุ่ม `SET ACTIVE` |

Stat bars และตารางเชิงลึก **คำนวณจาก flight profile และ weapon content** ไม่พิมพ์ตัวเลขเองในหน้าจอ ใช้ตาราง normalization เดียว (ค่า min/max ของแต่ละ stat) เพื่อแปลงเป็น 0–100 และมี test ว่าเปลี่ยน profile แล้ว bar เปลี่ยนตาม ตัวเลขในภาพ mockup เป็นค่าตัวอย่าง ความหมายของ stat อยู่ใน 05

Stage animation, systems list และ flight preview ในโรงเก็บปัจจุบันยังใช้ได้ แต่ต้องไม่กลับไปเป็น panel: stage controls เป็นแถวเล็กใกล้ viewer ส่วนเครื่องมือทดลองบิน/Flight Lab ย้ายไป Training (20)

## หน้า Armament

ภาพอ้างอิง 2b · Hangar armament เปิดจาก `INSPECT ARMAMENT` หรือ W; Esc กลับ Hangar

| ส่วน | เนื้อหา |
|---|---|
| กลาง | ghost airframe; เลือกอาวุธแล้วเปิด bay ที่เกี่ยวข้องและแยกโมเดลอาวุธนั้นให้เห็น; `ALL` วางอาวุธทุกชนิดเรียงใต้เครื่อง; ปืนไม่มีโมเดลให้ framing ที่ช่องปืนแทน; B สลับเปิด/ปิด bay (สถานะ 28 ก.ย.: แสดงเฉพาะโมเดลอาวุธ, ไม่มี ghost airframe/bay/B; อาวุธที่ไม่มีโมเดลแสดงกรอบ `NO MODEL` ซึ่งอนาคตแทนด้วยรูป) |
| ซ้าย | ชนิดเต็ม (เช่น `INFRARED · SHORT RANGE`), ชื่อ, station + จำนวน, บทบาทในการรบเป็นภาษาผู้เล่น (“ยิงเปิดฉากจากระยะไกล แล้วเลี้ยวออกรักษาพลังงาน”), facts (guidance, ความยาว, bay) |
| ซ้าย: IN-GAME | bars ของ range, lock time, seeker FOV, damage (ปืน: range, rate, ammo, damage) จาก weapon content; ค่าที่ยังไม่ได้จูนแสดง `VALUES PENDING P5 TUNING` แทนตัวเลขปลอม |
| ขวา | คอลัมน์ ARMAMENT เดียวกับหน้า Hangar (ชนิด / ชื่อ / station / จำนวน) ไฮไลต์อาวุธที่เลือก และกดสลับอาวุธได้ — ผู้ใช้เลือกแทน STATIONS · TOP VIEW ของ mockup (28 ก.ย. 2026) |
| ล่าง | `SELECT WEAPON` การ์ด ALL + อาวุธแต่ละชนิดพร้อมจำนวน |

เครื่องบินติดตั้งอาวุธทุกชนิดที่รองรับเต็มความจุอัตโนมัติ ไม่มี preset หรือตัวเลือกถอด/เปลี่ยนอาวุธ การเลือกในหน้านี้เป็นการสำรวจเท่านั้น ไม่เปลี่ยน inventory ความหลากหลายของอาวุธมาจากโหมดแทน: PVE มีกติกา `GUNS ONLY` / `GUNS + IR` และ Campaign mission กำหนดชนิดที่เปิดใช้ (21) โมเดลที่ไม่มีแสดง No model; อาวุธที่ยังไม่ implement เก็บใน inventory ได้แต่ยังเปิดยิงไม่ได้

## State และ boundary

```ts
interface HangarSelection {
  aircraftId: string;             // ลำที่กำลังดู
  activeAircraftId: string;       // ลำที่ SET ACTIVE แล้ว ใช้ใน session
  view: 'performance' | 'detail';
  comparisonId: string | null;    // ค่าเริ่มต้นเป็น active aircraft เมื่อดูลำอื่น
  armament: { weaponId: string | 'all' } | null;  // null = อยู่หน้า Hangar
}
```

React เป็น owner selection/view/loader UI; asset cache เป็น owner GLB; viewer เป็น owner orbit/animation เฉพาะโรงเก็บ Flight state ไม่ถูกสร้างจนกดเริ่ม session เก็บตัวเลือกสุดท้ายใน settings แต่ validate id ทุกครั้งที่อ่านกลับ

โหลดเฉพาะเครื่องที่เลือกกับ thumbnail ของรายการ เมื่อสลับเร็ว A→B→C ให้ใช้ request token ป้องกันผลโหลด A มาทับ C Cache แบ่ง resource ที่ใช้ร่วมกับ instance ที่แยก animation/skeleton; ไม่โหลดทุก GLB เพียงเพื่อสร้าง aircraft cards

## Viewer interaction

- ลากเพื่อหมุนกล้องรอบเครื่อง (เครื่องเป็นจุดศูนย์กลาง): แนวนอนรอบได้ 360° แนวตั้งจากเกือบตรงด้านบนถึงเกือบตรงใต้ท้อง (หยุดก่อนขั้วราว 6°) กล้องไม่ roll พื้นจึงเรียบเสมอ ปล่อยเมาส์แล้วค้างมุมนั้น (ไม่มีแรงเฉื่อย) R คืนมุม; zoom ในขอบเขตที่ไม่ทะลุเครื่อง; กล้องเคลื่อนกลับ shot อื่นตามทรงกลมรอบเครื่อง ไม่ตัดผ่านลำตัว; เมื่อสลับลำจัด framing ตาม bounds ที่ normalize แล้ว
- keyboard ปุ่มหมุน/zoom/reset มี label และ focus ชัดเจน ผู้ที่ลากเมาส์ไม่ได้ยังสำรวจได้
- weapon inspection เปิด bay ตาม presentation state ไม่กระตุ้น weapon fire
- ← → เปลี่ยนลำที่ดู ไม่เปลี่ยน active aircraft จนกด `SET ACTIVE`; ออกจากโรงเก็บโดยไม่กดให้ถามหรือคืนค่าเดิมอย่างชัดเจน
- animation mixer กับ manual surface preview ต้องมีเจ้าของ transform ต่อ node คนเดียว แยกโหมด preview เพื่อไม่เขียนทับกัน
- มีแสง environment และวัสดุ fallback; backdrop กับเงาไม่บดบังเครื่อง
- render แบบ demand เมื่อไม่มี animation/orbit motion และ invalidate ขณะ interaction; ไม่เปิด flight loop ในโรงเก็บ

## Loading / failure / empty states

แสดง progress หากมี total bytes ที่เชื่อถือได้ มิฉะนั้นแสดงขั้น “โหลดโมเดล/เตรียมวัสดุ” ถ้า GLB ล้มเหลวให้ retry และเลือกเครื่องอื่นได้ ไม่วน retry อัตโนมัติไม่สิ้นสุด ถ้า asset ไม่พร้อมยังอ่าน facts ได้ แต่ `SET ACTIVE` ของลำนั้น disabled พร้อมเหตุผล

โมเดลโหลดได้แต่ไม่มี optional clip ให้ซ่อน action นั้น; missing required hardpoint/rig node ให้ asset ไม่ผ่าน ready validation ความรู้ที่ยังไม่ตรวจไม่แสดงเป็นข้อเท็จจริง verified

## งานและเกณฑ์ผ่าน

1. สร้าง aircraft catalog จาก content registry และ selection state
2. ทำ viewer ของหนึ่งลำก่อน แล้วสลับสองลำโดยไม่มี model-specific JSX
3. ย้ายหน้าจอเป็น overlay บน menu scene ร่วม (20): identity, stat bars/detail, armament summary, แถบเลือกเครื่อง
4. Stat normalization จาก profile พร้อม test; หน้า Armament จาก weapons view เดิม
5. ตรวจไทย/อังกฤษ ชื่อยาว เปลี่ยนเครื่องเร็ว โหลดล้มเหลว contrast ของข้อความบนโมเดล และกลับจาก match
6. สลับเข้าออกโรงเก็บ/เกม 20 ครั้ง resource counts ไม่โตต่อเนื่อง; จำนวนอาวุธเต็มความจุในหน้าจอตรงกับ inventory เมื่อเกิดในเกม
