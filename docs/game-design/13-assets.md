# 13 — GLB, Rig และ Asset Pipeline

[กลับ Master Plan](../../MASTER_PLAN.md) · P0/P3/P6 · เจ้าของ visual assets และ resource lifecycle

## สิ่งที่พบใน workspace

อัปเดตหลัง implementation แรก: `model/` มี `F22_compact.glb` ประมาณ 3.9 MB (10 clips), `SU57_compact.glb` ประมาณ 1.6 MB (ไม่มี clips), terrain และ AIM-9/AIM-120 แล้ว ทั้งสองเครื่องใช้ Meshopt; F-22 ใช้ KTX2/Basis และ Su-57 ใช้ WebP ยังไม่มี F/A-18E ที่ยืนยันแล้ว ดู [ผลตรวจ asset และ baseline](../phase-0-implementation.md) สำหรับชิ้นส่วนสำรองที่ซ่อนใน viewer โดยไม่แก้ไฟล์ต้นฉบับ ขนาดไฟล์เหล่านี้ไม่บอก VRAM หรือจำนวน draw calls ต้อง benchmark ก่อนตั้ง budget จริง

## Pipeline

```text
Source GLB + provenance
  → inspect dimensions / axes / nodes / clips / materials
  → normalize + author collider / hardpoints / rig mapping
  → make hangar and gameplay variants + LOD
  → optimize textures/geometry
  → validate + visual QA
  → content registry + cached runtime asset
```

ใช้ `GLTFLoader` ผ่าน adapter ที่เดียว หาก asset ใช้ Draco/KTX2/Meshopt ให้ติดตั้ง decoder ตาม extension ที่ไฟล์ใช้ ไม่ตั้ง decoder ทุกแบบโดยไม่จำเป็น Loader มี integration สำหรับ extension/decoder ตาม [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) ล็อกเวอร์ชัน dependency จาก baseline ที่ build ผ่าน ไม่ยก package เป็น latest ระหว่าง refactor

## Asset contract

- World units เมตร; canonical aircraft local +X forward, +Y up, +Z right
- Normalize model ที่ root transform เท่านั้นและบันทึก scale/rotation ไม่แก้ตำแหน่ง vertex หลายที่ใน runtime
- ระบุ pivot อ้างอิง body center ที่ใช้ simulation, ความยาว/wingspan และ collider dimensions
- Hardpoint มี stable id, local position/orientation, accepted weapon tags; อย่าให้ simulation ต้องหา GLB node
- Rig bindings มี semantic name → node path/exported id, local hinge axis, rest transform, limits และ input mix coefficients
- Animation clips มี semantic alias เช่น canopyOpen/gearRetract; อย่าสมมติชื่อ clip เหมือนกันทุกไฟล์

ตัวอย่าง rig entry เป็นข้อมูล เช่น `{ semantic: 'leftFlaperon', nodePath: 'Root/Rig/LeftFlaperon', axis: [0,1,0], minDeg: -20, maxDeg: 25, mix: { pitch: 0.7, roll: -0.8 } }` ค่าต้อง author จากโมเดลจริง ไม่คัดลอกแกนจาก F-22 ไปทุกเครื่อง

## Rig animation

Resolve nodes ตอนโหลดแล้ว cache reference ไม่ `getObjectByName` ทุก frame หาก node name ถูก exporter/loader normalize ให้ validator ตรวจ path/id ที่ resolve ได้จริง; ชื่อซ้ำต้อง fail พร้อมรายการ ambiguous paths ไม่เลือก node แรกแบบเงียบ ๆ

หนึ่ง transform มี owner เดียว: mixer เป็น owner ใน animation preview; surface driver เป็น owner ใน flight mode ถ้าจำเป็น blend ต้องกำหนด mask/weight ชัดเจน ไม่ปล่อยทั้งคู่เขียนทับกันตามลำดับ frame

Aircraft หลาย instance แยก skeleton, animation state และ material ที่จะ mutate เช่น damage tint แชร์ immutable geometry/textures ได้ การเปิด bay ของเครื่องหนึ่งต้องไม่เปิดอีกเครื่อง

## Budget เริ่มทดลอง

| Asset/use | เป้าตั้งต้นเพื่อ benchmark |
|---|---|
| Hangar hero | ≤150k triangles, textures ส่วนใหญ่ ≤2K, draw calls ≤80 |
| Player flight LOD0 | ≤60k triangles, draw calls ≤35 |
| Nearby bot LOD1 | ≤25k triangles, draw calls ≤15 |
| Far bot LOD2 | ≤8k triangles, draw calls ≤8 |
| Gameplay aircraft download | เป้าประมาณ ≤10 MB รวม texture ที่เกี่ยวข้องต่อชุด |
| First playable download | เป้าประมาณ ≤25 MB สำหรับสนามเรียบ+ลำแรก; วัดจริงก่อนยืนยัน |

นี่เป็น budget เสนอ ไม่ใช่ผลวัดของโมเดลปัจจุบัน ใช้ distance/screen size LOD พร้อม hysteresis ป้องกันสลับกระพริบ เก็บ collider เดิมแม้ลด visual LOD; texture compression ต้องตรวจสี/normal/alpha และภาพเครื่องในแสงจริงด้วย

## Load/cache/dispose

โหลด critical aircraft/world/collision ก่อนเริ่ม countdown ส่วน optional effects โหลดตามหลัง Asset cache เป็น owner shared geometry/material/texture และมี reference count หรือ lifetime policy ที่อธิบายง่าย Instance dispose เฉพาะ resource ที่ตนสร้าง เมื่อ cache eviction จึง dispose shared resource ที่ไม่มีผู้ใช้

การ remove Object3D ไม่คืน GPU resources อัตโนมัติ และ geometry/material/texture มี lifecycle แยกตาม [Three.js resource disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html) ห้าม dispose shared texture เพียงเพราะปิด viewer หนึ่งหน้า

Abort/ignore stale requests เมื่อเปลี่ยนเครื่องหรือออกหน้า; แสดง fallback สำหรับ optional texture แต่ required model/collider ล้มเหลวต้องบอกผู้เล่นและไม่ spawn entity ที่มองไม่เห็น

## Provenance และ readiness

เก็บ `asset-manifest.json` มี source, author, licenseReference, modifications, variants และ verifiedDate; นี่เป็น metadata ของ content pipeline ไม่อนุมานว่า MIT ของ source code ครอบคลุม GLB ทุกไฟล์โดยอัตโนมัติ

งาน: inspect F-22 จริง → เขียน manifest/rig → สร้าง flight variant → ทดสอบสอง instances → เพิ่มลำถัดไป ผ่านเมื่อ scale/axes/mounts/animation ถูกต้อง, gameplay LOD ไม่เปลี่ยน hitbox และสลับ scene หลายครั้งไม่มี resource โตต่อเนื่อง
