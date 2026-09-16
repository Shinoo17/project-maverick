# P3 — Aircraft profiles และอาวุธประจำเครื่อง

สถานะ 14 กันยายน 2026: ส่งมอบ foundation สำหรับ Phase 3; **ยังไม่ปิด Phase 3 ทั้งหมด**

## สิ่งที่ใช้งานได้

- Aircraft registry อ้าง `flightProfileId`, `presentationId`, `weaponStationProfileId`; `AircraftId` เป็น stable string ที่ตรวจผ่าน registry ไม่ต้องเพิ่ม union ทุกครั้ง
- F-22 คง handling เดิม ส่วน Su-57 มีค่าทดลองแยก: acceleration 22.8 m/s², turn drag 3.15, normal yaw .48 rad/s, PSM yaw 1.85 rad/s, recovery acceleration 66.5 m/s², cooldown 4.5 s ยังต้อง playtest
- Flight, speed, maneuver, thrust vectoring, HUD และ rig normalization อ่าน profile ของ entity ตัวนั้น
- Weapons แสดงอาวุธเฉพาะเครื่องบิน รวมปืน ทุกจุดติดตั้งเต็มความจุ: F-22 = 1/2/6, Su-57 = 1/2/4 (ปืน/IR/เรดาร์); All แสดงโมเดลที่โหลดได้และเลือกรายชิ้นได้ ไม่มีโมเดลขึ้น No model
- Flight tab ควบคุม pitch/roll/yaw, แรงขับและไอพ่น; F-22 ขยับพื้นผิวควบคุมแบบนุ่มนวล
- Play พร้อมใช้หลังโมเดลพร้อม ป้องกันเปลี่ยนหน้าในระหว่าง decode asset แล้วยกเลิก loader ที่หน้า Flight ยังต้องใช้
- ไม่มีระบบเลือกหรือบันทึก Loadout; settings v1 เดิมยังอ่านได้โดยละทิ้ง preset เก่าและคงเครื่องบิน/ภาษา
- SessionConfig ระบุ aircraftIds; runtime เติมอาวุธทุกจุดจาก station profile และไม่ส่ง preset ลง replay; replay เดิมละทิ้ง preset เก่า
- `AircraftState.stores` แยกแต่ละ entity; spawn/reset/replay เริ่มด้วยอาวุธเต็มความจุจาก `fullArmament`
- ตรวจ profile references, finite tuning/envelopes, station ID ซ้ำ/ไม่รู้จัก, weapon ID ที่รู้จัก และ capacity ที่เป็นจำนวนเต็มบวก

## ผลตรวจ branch ตามชื่อเครื่อง

| จุดเดิม | วิธีที่ใช้แล้ว |
| --- | --- |
| `stepFlight.ts`: F-22 TVC และ neutral damper | ใช้ `thrustVectoring` nullable profile และ `neutralDampingDuringPsm` |
| `thrustVectoring.ts`: update เฉพาะ F-22 | solver อ่าน profile และหยุดเมื่อไม่มี capability |
| `flightRig.ts`: เดารุ่นจาก Gimbal แล้ว fallback เป็น F-22 | factory registry เลือกจาก presentationId ที่ส่งมาชัดเจน |
| Exhaust vector angle / lip pivot | อ่าน capability และ exhaust geometry profile |
| Condensation wing span/height แบบ Su-57 else F-22 | อ่าน vapor profile |
| Exhaust preview เลือก Su-57 else F-22 | roster lookup, scenario flow ร่วมกัน, fixed-step TVC เมื่อ profile รองรับ |
| Preview dropdown รายการตายตัว | สร้างจาก aircraft registry |
| HUD burner/PSM band และ rig rate normalization | ใช้ค่าของเครื่องบินที่เลือก |

ชื่อ `f22`/`su57` ยังปรากฏใน **ข้อมูล registry, ค่าเริ่มต้น, fixture และ adapter ของโมเดล** ตามหน้าที่ ไม่ใช่ branch เพื่อเลือกสมรรถนะใน simulation. Compatibility exports `f22Tvc*` ยังมีไว้ให้ fixture เก่าเรียก; production เรียก solver ด้วย profile ชัดเจน

Su-57 ยังใช้ generic PSM assist กับ nozzle rig ใน render layer; **ยังไม่ได้จำลองแรง TVC สามแกน** จึงไม่เอา solver pitch-only ของ F-22 มาใช้แทน

## เพิ่มเครื่องบินลำถัดไป

1. เพิ่ม definition ใน `src/content/aircraft/index.ts` พร้อม stable ID, ชื่อ/role/description สองภาษา, model transform และ removeNodes
2. เพิ่มไฟล์รายลำใน `src/content/flight-profiles/` และลงทะเบียนใน `index.ts` หรือ reuse profile เดิม; profile ต้องเป็น plain serializable data. Defaults ตั้ง `psmEnabled: false` ให้เปิดเฉพาะลำที่รองรับ; thrustVectoring เป็น null เมื่อไม่ใช้ solver นี้ ดู [คู่มือ flight profile](flight-profiles.md) สำหรับการจูนลำที่ทำ PSM ได้จำกัด
3. Reuse presentationId ได้เฉพาะ geometry/rig ที่ตรงกัน หากเป็น asset ใหม่ให้เพิ่ม ID ใน `content/schemas.ts`, adapter ใน render/aircraft/flightRig.ts และค่าตำแหน่งใน render/exhaust/profile.ts + render/vapor/profile.ts; ตรวจ anchor เทียบ GLB จริง ไม่ fallback ไป F-22
4. เพิ่ม weapon definitions และ station profile ใน `src/content/weapons/index.ts`; แต่ละ station ระบุ weaponId/capacity และเครื่องบินอ้าง weaponStationProfileId ทุกจุดจะติดตั้งเต็มจำนวนอัตโนมัติ
5. รัน `npm test` และ `npm run build`; ตรวจทั้ง model/rig, สลับลำ/ดูอาวุธ, reload, launch/reset/replay และ flight feel
6. เมื่อแก้ tuning/กติกาที่กระทบ trajectory ให้เพิ่ม `flightProfileVersion`; replay รุ่นก่อนถูกปฏิเสธเพื่อไม่เล่นด้วยฟิสิกส์คนละชุด

เพิ่มเครื่องบินที่ reuse กลไกเดิมไม่ต้องแก้ `stepFlight`, `stepSpeed`, `stepManeuvers` หรือ Weapons UI มี test `future-airframe` พิสูจน์ runtime + presentation profiles + catalog ด้วย ID ใหม่

## ขอบเขตข้อมูลอาวุธ

F-22 ใช้ชื่อ M61A2, AIM-9 และ AIM-120 จาก [USAF fact sheet](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f22/f-22-raptor/). Su-57 แสดงปืน 30 มม. ตาม [Rostec](https://www.rostec.ru/media/news/istrebitel-su-57-pyatoe-pokolenie-na-vzlet/). ตรวจแหล่งข้อมูล 14 ก.ย. 2026; เก็บ URL ใน catalog และอ่านข้อมูลจาก repo ขณะเล่น

มิสไซล์ Su-57 ใช้ชื่อ **IR/Radar training missile** พร้อมป้าย provisional ไม่อ้างรุ่น domestic ที่ยังไม่ยืนยัน และไม่เอาข้อมูล Su-57E export มาปนโดยไม่ระบุ variant. Stations/capacities/counts เป็นค่าของเกม ไม่ใช่ใบรับรองการติดตั้งอาวุธจริง

P3 นี้ยังไม่มี projectile, damage, lock, ammo consumption, ผลของมวล/แรงต้านจากอาวุธ หรือโมเดลอาวุธที่ attach/detach บน GLB. ป้าย preview ใช้กับอาวุธทุกชนิด รวม radar missile ซึ่งยังเปิดยิงไม่ได้ตามแผน P4/P5

## Verification และ gate ที่เหลือ

Automated: ชุด regression เดิมด้าน flight/PSM/rig/HUD/effects; เพิ่ม profile ของ ID ใหม่, ความต่างของ tuning, ปิด PSM ผ่าน capability, invalid references/capacity/station/weapon, per-entity inventory, full-armament sessions, settings sanitation, reset และ replay

การตรวจระบบอาวุธอัตโนมัติครอบคลุมจำนวนเต็มทุกจุด, inventory แยกลำ, reset/replay และการละทิ้ง preset เก่า; รัน `npm test` และ `npm run build` หลังแก้ไข

Browser: F-22/Su-57 catalog, แสดงจำนวนเต็มความจุ, สลับภาษา, reload คงเครื่องบิน/ภาษา, keyboard tab navigation, เริ่มบิน/pause F-22 และ Su-57, reset Su-57, Play disabled ระหว่างโหลดและพร้อมใช้เมื่อโหลดเสร็จ, desktop 1440×900 และจอแคบ 390 px. ภาพ evidence อยู่ `.impeccable/review/` ระหว่างการตรวจ

งานถัดไปก่อนปิด P3:

- Curated facts tab ครบรุ่น พร้อม source/date/confidence และแยกจาก game stats
- จุดติดอาวุธที่ผูกกับ GLB node paths, inspection camera/highlight และ weapon geometry
- Hangar/flight asset variants, gameplay LOD, availability gates และ benchmark หลาย entity
- Comparison scenario/flight playtest สำหรับ tuning ของแต่ละลำ รวม cost/recovery ของ PSM
- F/A-18E เมื่อ asset/rig พร้อม (เป็นเป้าหมาย roster P6 ไม่ใช้โมเดลผิดลำแทนโดยเงียบ ๆ)
