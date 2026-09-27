# 14 — World, Terrain และ Collision

[กลับ Master Plan](../../MASTER_PLAN.md) · P1/P4/P5b/P5c · simulation ใช้เมตรตาม 03

## ขนาดสนามทดลอง

P1 เริ่ม flat field ที่มีกริด/landmarks อ่านระยะได้ ก่อนโหลดภูเขาสวย Flat Training Range ใช้เล่น TDM ได้ตั้งแต่ P4 P5b เพิ่มสนาม PVE ที่มีฐานและจุดยึด (ชื่อชั่วคราวใน mockup: Mountains, Coastal) สนาม dogfight เป้าขนาดประมาณ **10×10 km**, altitude เล่น 200–2,500 m และมี warning band ก่อนเพดาน/ขอบสนาม ไม่สร้างโลกเปิดไม่สิ้นสุดก่อนพิสูจน์ combat pacing

ที่ cruise 130 m/s ระยะ 10 km ใช้เวลาราว 77 s จึงไม่เกิดจากมุมตรงข้ามสุดของแผนที่ทุกครั้ง Spawn/engagement zones ควรห่างกันประมาณ 1.5–3 km เพื่อกลับมาต่อสู้ได้เร็ว ค่านี้ต้องปรับจาก re-engage time ใน playtest

## แยก visual กับ gameplay world

```ts
interface MapDefinition {
  id: string;
  visualAssetId: string;
  collisionAssetId: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  spawnPoints: Array<{
    id: string;
    position: [number, number, number];
    headingRad: number;
    safeRadiusM: number;
  }>;
  engagementZones: Array<{ center: [number, number, number]; radiusM: number }>;
  supportedModes: Array<'playground' | 'tdm' | 'control-point' | 'ctf' | 'priority-target' | 'flyover' | 'campaign'>;
  teamSpawns: Record<'blue' | 'red', string[]>;          // spawnPoint ids ของแต่ละทีม
  controlPoints?: Array<{ id: 'A' | 'B' | 'C'; center: [number, number]; radiusM: number; ceilingAglM: number }>;
  flagBases?: Record<'blue' | 'red', { center: [number, number]; radiusM: number; ceilingAglM: number }>;
  crownSpawns?: Array<{ id: string; position: [number, number, number]; pickupRadiusM: number }>;
  flyoverPoints?: Array<{ id: 'A' | 'B' | 'C'; position: [number, number, number]; radiusM: number }>;
  campaignTargets?: Array<{ id: string; kind: string; position: [number, number, number]; headingRad: number }>;
  preview: { imageId: string; boundaryOverlay: boolean };  // ภาพใน PVE Setup / Campaign (20, 21)
}
```

Validation ต้องปฏิเสธ map ที่ประกาศ `supportedModes` แต่ไม่มีข้อมูลของโหมดนั้น เช่น `ctf` ที่ไม่มี `flagBases`, `priority-target` ที่มีจุดเกิดมงกุฎน้อยกว่าสองจุด หรือ `flyover` ที่ไม่มีจุดครบสามจุด และตรวจว่าจุดยึด/ฐานอยู่ใน bounds และสูงกว่าพื้นพอให้บินผ่านใต้เพดานได้ ค่ารัศมีและเพดานเริ่มต้นอยู่ใน 09

Visual terrain ใช้ GLB/LOD ได้; simulation อ่าน collision data ที่โหลดเป็นตัวเลขได้ใน Node ภายหลัง ห้ามเรียก mesh raycast ใน React เป็นแหล่งเดียวสำหรับ server physics

สนามที่เป็นภูเขาไม่มีถ้ำใช้ heightfield + simplified collision mesh/proxies ส่วนสะพาน/overhang ต้องใช้ collider ที่รองรับจริง ไม่อ้างว่า heightfield แทน geometry ทุกแบบได้ ตรวจ visual terrain กับ collision ใน build QA

## Collision queries

API ขั้นต่ำ: `heightAt(x,z)`, `segmentCast(from,to)`, `sweepAircraft(collider,previous,current)`, `hasLineOfSight(from,to)` return hit fraction/point/normal/id ไม่ return Three.js mesh

ใช้ broadphase candidates ก่อน precise query; เริ่ม simple spatial grid สำหรับ dynamic aircraft/projectile หาก profiling จำเป็น ไม่สร้าง octree ซับซ้อนโดยไม่มี benchmark Static map ใช้ baked acceleration data ได้

- Ground/AGL HUD query ทำ 10 Hz และ smooth ได้ เพราะเป็น presentation
- **Collision ที่ตัดสิน crash** ตรวจเส้นทางทุก physics substep/รวม swept path อย่างถูกต้อง ไม่ใช้ค่า AGL ที่ smooth และช้า 10 Hz
- Aircraft ที่เคลื่อนและหมุนใช้ conservative capsule/sphere sweep หรือ substep ให้ไม่พลาดปีก; broadphase sphere อย่างเดียวไม่พอเป็น hit shape สุดท้าย
- Bullet/missile ใช้ sweep ตาม 07 พร้อม moving-target relative motion และ earliest hit
- Aircraft ชนกัน MVP เป็น destruction ของทั้งคู่; ไม่ทำ rigid body debris response

## ขอบสนาม

เตือน “กลับเข้าสนาม” พร้อมทิศและเวลาเมื่อออก soft bounds ให้เวลา 8 s ก่อน destruction ด้วย cause boundary; ไม่ bounce/teleport เครื่องกลาง combat ถ้ากลับเข้ามาต้องอยู่ใน safe band ต่อเนื่อง 0.5 s จึงล้าง timer ป้องกันกระพริบ boundary exploit

Playground เปลี่ยนเป็น reset-safe ได้โดยประกาศใน mode rules ส่วน Offline ใช้ death/scoring ตาม 09 ทั้งผู้เล่นและบอทใช้ขอบเดียวกัน ไม่มี invisible wall ที่ missile ผ่านแต่เครื่องถูก snap กลับโดยไม่มีเหตุผล

## สิ่งที่เลื่อนออกไป

ยังไม่ทำ weather ที่เปลี่ยน flight forces, terrain destruction, takeoff/landing, ground vehicles หรือ world streaming ใน MVP เวลา/ท้องฟ้าเริ่มเป็น visual preset ที่ไม่เปลี่ยน LOS gameplay โดยไม่บอกผู้เล่น

## งานและเกณฑ์ผ่าน

1. Flat map + safe spawn + world units validation
2. Collider API และ swept collision tests ก่อน map สวย
3. Bake/inspect terrain ตัวอย่างแล้วตรวจ flyby, mountain occlusion, edge cases
4. เพิ่ม spawn scoring, boundary warning และ map registry
5. เพิ่ม team spawns, control points, flag bases, crown spawns, flyover points และ preview ของ map PVE (P5b) และ map/เป้าภาคพื้นของ Campaign (P5c)
5. ตรวจไม่มี tunneling ที่ max baseline speed, collision ตรงโมเดล, map โหลดล้มเหลวกลับเมนูได้ และ camera probe ไม่เปลี่ยน aircraft physics
