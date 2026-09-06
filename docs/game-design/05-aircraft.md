# 05 — Aircraft, ความรู้จริง และความต่างในเกม

[กลับ Master Plan](../../MASTER_PLAN.md) · P3/P6 · พึ่ง flight profile และ asset pipeline

## เป้าหมาย roster

เริ่มบินด้วย F-22 หนึ่งลำ จากนั้นใช้ profile ที่ต่างกันทดสอบว่า core รองรับหลายลำจริง เป้าหมาย Offline release คือ F-22, Su-57 และ **F/A-18E Super Hornet** ถ้าโมเดลยังไม่พร้อมใช้ proxy ใน dev ได้ แต่ห้ามแสดงเป็นเครื่องสมบูรณ์ในโรงเก็บ release

## บุคลิกในเกมที่เสนอ

ตารางนี้เป็น **game design** ไม่ใช่การจัดอันดับสมรรถนะเครื่องบินจริง ทุกลำเริ่มด้วย HP 100 และ weapon baseline เดียวกันเพื่อแยกผลจาก flight tuning ก่อน

| ลำ | จุดเด่นในเกม | จุดด้อยในเกม | วิธีเล่น/วิธีรับมือ |
|---|---|---|---|
| F-22 | เก็บความเร็วใน turn ดี, เร่งกลับดี, pitch-vectoring และ Cobra ที่ recover ค่อนข้างง่าย | yaw authority ใน PSM ต่ำกว่า Su-57; slow sustained turn ด้อยกว่า F/A-18E | ใช้ energy/reposition; ฝ่ายตรงข้ามล่อให้เสียความเร็วแล้วบังคับวงเลี้ยวต่ำ |
| Su-57 | nose authority ตอน speed ต่ำ, PSM หลายแกนใน profile เกม, เล็งจังหวะ overshoot ได้ดี | PSM เสีย speed มากและฟื้นช้ากว่า F-22; ยิงต่อเนื่องหลังท่ายาก | ต้องเลือกจังหวะใช้ท่า; ฝ่ายตรงข้ามรักษาระยะและยิงช่วง recovery |
| F/A-18E | ควบคุมคาดเดาง่าย, sustained turn ช่วงต่ำ–กลางดี, gun platform เสถียร | top speed/acceleration ต่ำกว่า, ไม่มี PSM/vectoring assist ใน baseline | อยู่ใน turn band และยิงต่อเนื่อง; ฝ่ายตรงข้ามใช้แนวดิ่งหรือเร่งแยก |

เริ่มด้วย relative tuning ต่อ baseline ใน 03: F-22 turn-drag 0.95×/recovery acceleration 1.10×; Su-57 turn-drag 1.05×/recovery 0.95×; F/A-18E turn-drag 0.90×เฉพาะ sweet spot/acceleration 0.90× และ dry/boost top 0.90× ตัวเลขเป็นสมมติฐาน ไม่ใช่คะแนนที่ต้องรักษาถ้า playtest ขัดแย้ง

อย่าเพิ่ม stealth เป็นการหายตัวหรือยิงไม่โดน ใน MVP ทุกเครื่องใช้ visibility/lock rules เดียวกัน หากเพิ่ม sensor signature ภายหลัง ต้องมี UI และ counterplay พร้อม และระบุว่าเป็นค่าบาลานซ์เกม

## แยก facts / gameplay / presentation

```ts
interface AircraftDefinition {
  id: string; // เช่น 'fa18e'; stable id ไม่เปลี่ยนตามภาษา
  nameKey: string;
  factsId: string;
  flightProfileId: string;
  assetId: string;
  loadoutPresetIds: string[];
  availability: 'dev-only' | 'ready' | 'disabled';
}
interface AircraftFact {
  id: string;
  textKey: string;
  sourceUrl: string;
  checkedAt: string;
  variant: string;
  confidence: 'verified' | 'manufacturer-claim' | 'needs-review';
}
interface AircraftPresentation {
  assetId: string;
  hangarGlb: string; flightGlb: string;
  modelTransform: { scale: number; rotation: [number, number, number] };
  colliderId: string;
  rigId: string;
  hardpoints: Array<{ id: string; nodePath: string; allowedWeaponTags: string[] }>;
}
```

FlightProfile เป็น numeric data serializable ตาม 03/04 ไม่มี mesh predicates, React component, Vector3 instance หรือ aircraft-specific function ใน content schema Rig mapping แยกจาก profile ถ้าต้องใช้ animation adapter ใหม่ให้เพิ่มใน render layer ไม่ให้ core รู้จักชื่อ bone

## ความรู้จริงในโรงเก็บ

เนื้อหาเริ่มต้นแต่ละลำ: รุ่นที่แสดง, ผู้พัฒนา/ประเทศ, บทบาท, จำนวนลูกเรือ, แนวคิดการออกแบบ, ลักษณะอาวุธและช่องเก็บ, จุดที่ควรสังเกตบนโมเดล พร้อมแหล่งอ้างอิงและวันที่ตรวจ ข้อมูลที่แหล่งไม่เปิดเผยให้เขียนว่าไม่เปิดเผย แทนการเดา RCS, radar range หรือค่าลับ

ตัวอย่าง facts ที่มีแหล่งเริ่มต้น:

- F-22: เครื่องบินขับไล่ที่เน้น air superiority มีอาวุธภายในและความสามารถ thrust vectoring ตาม [USAF fact sheet](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f-22-raptor/)
- F/A-18E/F: ตระกูล Super Hornet ทำหน้าที่ fighter และ attack; ต้องเลือกข้อความตรงกับรุ่น E เมื่อระบุจำนวนที่นั่ง ตาม [NAVAIR](https://www.navair.navy.mil/product/FA-18EF-Super-Hornet)
- Su-57: ใช้หน้า UAC ที่อยู่ใน 19 เป็นจุดเริ่มตรวจข้อมูลผู้ผลิต รายละเอียดที่จะเผยแพร่ต้องตรวจหน้าเต็มอีกครั้ง เพราะการอ่านครั้งนี้ดึงหน้าเต็มไม่สำเร็จ

ไม่ดึงข้อมูลสดทุกครั้งที่เปิดโรงเก็บ ให้เก็บ curated content สองภาษาใน repo และตรวจที่มาเมื่ออัปเดต

## Game stats ที่มีความหมาย

แสดง acceleration, sustained turn, energy retention, roll response, low-speed nose authority และ recovery เป็นแถบเปรียบเทียบ 1–5 พร้อม tooltip วิธีวัด ต้อง derive จาก standardized flight scenarios หรือ curated summary ที่อ้าง benchmark revision ไม่ใช้ค่าคะแนนนั้นเป็น physics parameter ซ้ำอีกชุด

โชว์ sweet spot และตัวอย่าง “เลี้ยวดีเมื่ออยู่ในช่วงนี้” มากกว่า top speed ใหญ่ที่สุด Loadout หน้าจอใช้ display label เดียวกับ HUD ว่าเป็นค่าภายในเกม

## ขั้นตอนเพิ่มเครื่องใหม่

1. เพิ่ม id, facts และคำแปล; กำหนด variant ให้แน่ชัด
2. เพิ่ม flight profile จาก baseline แล้วเปลี่ยนเฉพาะกลุ่มที่สร้างเอกลักษณ์
3. เพิ่ม GLB/rig/collider/hardpoint mapping ผ่าน validator
4. เพิ่ม loadout ที่ตรวจ mount compatibility ได้
5. รัน flight benchmark เดียวกันกับทุกลำ แล้วตรวจ hangar/flight/maneuver visually
6. เปลี่ยน availability เป็น ready เมื่อ asset และ facts ที่จำเป็นผ่าน

ผ่านเมื่อเพิ่มเครื่องที่ใช้ capability เดิมได้ด้วย content/rig mapping โดยไม่แก้ `stepFlight` หรือ HangarPage และการดวลข้ามลำมีจุดที่แต่ละฝ่ายได้เปรียบจริง
