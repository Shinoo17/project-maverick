# 06 — Hangar และ Aircraft Viewer

[กลับ Master Plan](../../MASTER_PLAN.md) · P3 · พึ่ง aircraft, assets, localization

## ผู้เล่นทำอะไรได้

เข้าโรงเก็บ → เลือกเครื่อง → ดูโมเดล/อาวุธ → อ่านข้อมูลจริงหรือเทียบ status เกม → เข้า Playground หรือ Offline โดยส่ง `aircraftId` ใน SessionConfig ไม่ส่ง Three.js scene ไป simulation

## โครงหน้าจอและข้อมูล

| ส่วน | เนื้อหา/พฤติกรรม |
|---|---|
| Aircraft list | ชื่อ/รุ่น/บทบาทย่อ, พร้อมเล่นหรือยังไม่พร้อม, เลือกด้วยเมาส์และ keyboard focus |
| 3D viewer กลาง | orbit, zoom, reset view, เปิด canopy/bay หรือ animation ที่ asset รองรับ |
| ภาพรวม | คำอธิบายสั้น จุดเด่น/จุดด้อย gameplay และปุ่มทดลองบิน |
| แท็บ “ข้อมูลจริง” | curated facts, variant, source links และวันที่ตรวจ |
| แท็บ “สมรรถนะในเกม” | game stats, sweet spot, maneuver capability, คำแนะนำเล่น |
| แท็บ “อาวุธ” | hardpoints/internal bays, weapon role, จำนวนเต็มความจุของแต่ละจุด, ข้อจำกัดการติดตั้ง |
| Comparison | เทียบสองลำด้วย stat ที่มีหน่วย/วิธีวัดเดียวกัน |

เครื่องบินติดตั้งอาวุธทุกชนิดที่รองรับเต็มความจุอัตโนมัติ ไม่มี preset หรือตัวเลือกถอด/เปลี่ยนอาวุธ ผู้เล่นเลือก All หรือรายชิ้นเพื่อสำรวจโมเดลได้ โดยไม่เปลี่ยน inventory โมเดลที่ไม่มีแสดง No model; อาวุธที่ยังไม่ implement เก็บใน inventory ได้แต่ยังเปิดยิงไม่ได้

## State และ boundary

```ts
interface HangarSelection {
  aircraftId: string;
  tab: 'overview' | 'facts' | 'gameplay' | 'weapons';
  comparisonId: string | null;
}
```

React เป็น owner selection/tab/loader UI; asset cache เป็น owner GLB; viewer เป็น owner orbit/animation เฉพาะโรงเก็บ Flight state ไม่ถูกสร้างจนกดเริ่ม session เก็บตัวเลือกสุดท้ายใน settings แต่ validate id ทุกครั้งที่อ่านกลับ

โหลดเฉพาะเครื่องที่เลือกกับ thumbnail ของรายการ เมื่อสลับเร็ว A→B→C ให้ใช้ request token ป้องกันผลโหลด A มาทับ C Cache แบ่ง resource ที่ใช้ร่วมกับ instance ที่แยก animation/skeleton; ไม่โหลดทุก GLB เพียงเพื่อสร้าง aircraft cards

## Viewer interaction

- orbit ซ้าย/ขวาและ zoom ในขอบเขตที่ไม่ทะลุเครื่อง; เมื่อสลับลำจัด framing ตาม bounds ที่ normalize แล้ว
- keyboard ปุ่มหมุน/zoom/reset มี label และ focus ชัดเจน ผู้ที่ลากเมาส์ไม่ได้ยังสำรวจได้
- weapon inspection เปิด bay ตาม presentation state ไม่กระตุ้น weapon fire
- animation mixer กับ manual surface preview ต้องมีเจ้าของ transform ต่อ node คนเดียว แยกโหมด preview เพื่อไม่เขียนทับกัน
- มีแสง environment และวัสดุ fallback; backdrop กับเงาไม่บดบังเครื่อง
- render แบบ demand เมื่อไม่มี animation/orbit motion และ invalidate ขณะ interaction; ไม่เปิด flight loop ในโรงเก็บ

## Loading / failure / empty states

แสดง progress หากมี total bytes ที่เชื่อถือได้ มิฉะนั้นแสดงขั้น “โหลดโมเดล/เตรียมวัสดุ” ถ้า GLB ล้มเหลวให้ retry และเลือกเครื่องอื่นได้ ไม่วน retry อัตโนมัติไม่สิ้นสุด ถ้า asset ไม่พร้อมยังอ่าน facts ได้ แต่ปุ่มเริ่มลำนั้น disabled พร้อมเหตุผล

โมเดลโหลดได้แต่ไม่มี optional clip ให้ซ่อน action นั้น; missing required hardpoint/rig node ให้ asset ไม่ผ่าน ready validation ความรู้ที่ยังไม่ตรวจไม่แสดงเป็นข้อเท็จจริง verified

## งานและเกณฑ์ผ่าน

1. สร้าง aircraft catalog จาก content registry และ selection state
2. ทำ viewer ของหนึ่งลำก่อน แล้วสลับสองลำโดยไม่มี model-specific JSX
3. ต่อ facts/game/weapons tabs และ SessionConfig
4. ตรวจไทย/อังกฤษ ชื่อยาว เปลี่ยนเครื่องเร็ว โหลดล้มเหลว และกลับจาก match
5. สลับเข้าออกโรงเก็บ/เกม 20 ครั้ง resource counts ไม่โตต่อเนื่อง; จำนวนอาวุธเต็มความจุในหน้าจอตรงกับ inventory เมื่อเกิดในเกม
