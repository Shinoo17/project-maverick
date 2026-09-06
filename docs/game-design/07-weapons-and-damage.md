# 07 — ปืน, Missile, Countermeasure และ Damage

[กลับ Master Plan](../../MASTER_PLAN.md) · P4–P5 · พึ่ง runtime, flight, collision และ aircraft loadout

## Combat loop

มองเห็นเป้า → เข้า position → เล็ง/lock → ยิง → ศัตรูหลบหรือปล่อย flare → ยืนยัน hit → เสีย HP/ถูกทำลาย → mode ตัดสินคะแนนและ respawn ปืนต้องสนุกก่อนเพิ่ม missile ไม่ใช้ missile กลบปัญหาที่บินเร็วเกินเล็ง

## ปืน: projectile ที่มีเวลาเดินทาง

ใช้ ballistic projectile จำลองเป็นข้อมูลและ swept collision ไม่สร้าง rigid body หรือ React component ต่อกระสุน รูป tracer เป็น pool/instanced view ต่างหาก ไม่ต้องวาดกระสุนทุกนัด

| Baseline ทดลอง | ค่า |
|---|---:|
| Rate | 80 นัด/s; สะสม shot budget ตาม dt |
| Muzzle speed | 900 m/s สัมพัทธ์เครื่องยิง |
| Damage | 2 HP ต่อ hit; aircraft baseline 100 HP |
| Spread | cone 0.3° seeded; เพิ่มเล็กน้อยเมื่อร้อน |
| ระยะที่อยากให้ใช้ | 200–700 m |
| Lifetime / path distance cap | 1.2 s หรือเดินทางรวม 1,000 m อย่างใดถึงก่อน |
| Ammo model MVP | ไม่จำกัดนัด แต่ heat จำกัด burst; ไม่ใช่จำนวนกระสุนจริงของเครื่อง |
| Heat | ยิงต่อเนื่องราว 2 s จึง overheat; cool จนต่ำกว่า 35% จึงยิงใหม่ |

velocity เริ่มต้น = shooter velocity + muzzle direction × muzzle speed; gun direction อิง hardpoint simulation transform ใน aircraft profile ไม่ raycast จาก camera และไม่ยิงไปหา selected target อัตโนมัติ

ที่ 100% hits มี ideal damage time `100/(80×2) = 0.625 s`; ของจริงต้องนานกว่านี้จาก spread/geometry เป้าหมาย playtest คือ burst หลายครั้งรวมประมาณ 2–5 s ของการกดไกเพื่อ kill อย่าเพิ่ม HP ก่อนตรวจว่าปัญหาอยู่ที่ firing window หรือความแม่นยำ

MVP ช่วยด้วย lead indicator ที่คำนวณ intercept จาก relative velocity โดยใช้ projectile speed จริง ไม่ทำ bullet magnetism ถ้า finite TTL/ระยะทำให้ไม่มี intercept ให้ซ่อน lead solution และแสดง out of range ตัวกรอบเป้าช่วยมอง แต่ไม่เพิ่ม collider ตามขนาด UI

## Missile: เริ่มจาก IR หนึ่งแบบ

```text
No target → Acquiring → Locked → Launch → Tracking → Detonated / Missed / Expired
```

Target selection ไม่เท่ากับ lock: ตรวจมุม ระยะ line of sight และทีมทุก tick Lock เพิ่มต่อเนื่องเมื่อเงื่อนไขครบ หลุดแนวมี grace สั้นแล้ว decay การกด fire ขณะไม่พร้อมไม่คิวไปยิงทีหลัง

| IR missile baseline ทดลอง | ค่า |
|---|---:|
| Lock range | 150–2,200 m |
| Acquisition cone half-angle | 18° จาก seeker axis หน้าเครื่อง |
| Lock time | 1.25 s |
| Lock retention cone / grace | 25° / 0.25 s |
| Missile speed target | 360 m/s, acceleration จำกัด; รับ velocity ของ launcher เมื่อปล่อย |
| Guidance | lead pursuit แบบง่าย จำกัดอัตราหมุนสูงสุด 90°/s |
| Seeker cone หลังปล่อย | half-angle 60° จากหัว missile |
| Lifetime | 8 s |
| Arming | ต้องพ้น 50 m จากจุดปล่อย **และ** ผ่าน 0.2 s |
| Proximity radius | 8 m; ใช้ closest approach บน swept segment |
| Damage | direct 65 HP, proximity ลดตามระยะสูงสุด 65 HP |
| Inventory | preset 4 ลูก; salvo interval 1 s; ไม่เติมกลาง combat |

ตัวเลขเป็น gameplay profile ของ IR missile ไม่ใช่สเปก AIM-9 จริง Guidance ค่อย ๆ เปลี่ยน velocity โดยมี turn budget ไม่ `lookAt(target)` แล้วหมุน velocity ทันที หากหลุด seeker ให้ coast 0.5 s แล้ว expire/miss; MVP ไม่ reacquire เพื่อให้กติกาเข้าใจง่าย

Occlusion ต้องใช้ world collision data ไม่ใช่ความโปร่งใสของวัสดุ render Missile ชน terrain ถูกทำลายและไม่ทำ splash ทะลุสันเขา Direct/proximity ใน tick เดียวกันต้องเลือกผลเดียว ป้องกัน damage ซ้ำ

## Countermeasure และการหลบ

F ปล่อย flare burst ทดลอง 2 decoys ต่อ burst, inventory 6 bursts, interval อย่างน้อย 1 s, decoy lifetime 2 s IR seeker พิจารณา flare เฉพาะใน cone/range/line of sight และมี score ดึงดูดลดลงตามอายุ

เริ่มด้วย scoring แบบ deterministic ต่อสถานะ หรือ seeded RNG ต่อ decoy opportunity หนึ่งครั้ง ไม่สุ่มทุก frame จน FPS เปลี่ยนโอกาสหลบ ห้าม flare ตัด missile lock ทั้งสนามทันที ทุกฝ่ายใช้ logic เดียวกัน ผู้เล่นยังต้อง turn/reposition หลังปล่อย flare

Radar missile เป็น extension หลัง IR ผ่าน: ต้องมี weapon profile แยก, support/active seeker rules, lock warning และ chaff ถ้ายังไม่มี counterplay ห้ามเปิด AIM-120 ใน combat เพียงเพราะมีโมเดลพร้อม ช่วงแรกให้ดู AIM-120 ในโรงเก็บได้อย่างเดียว

## Damage, hit และ event ownership

ใช้ HP ก้อนเดียวใน MVP ไม่เพิ่ม damage subsystem ปีก/เครื่องยนต์จน flight loop นิ่ง การ hit ลด HP, ส่ง `damage-applied`; เปลี่ยน alive เป็น false ได้ครั้งเดียวและส่ง `aircraft-destroyed` ให้ mode รับ ห้าม renderer นับ score เอง

`WeaponDefinition` มี id, kind, damage, cadence, range, projectile/seeker params, visualAssetId; `LoadoutPreset` อ้าง weaponId/count/mountId และ validator ตรวจ compatibility ส่วน `WeaponState` เก็บ heat, cooldown, inventory และ lock แยกต่อ entity

ขณะ pending launch bay animation ใช้เวลาเปิดที่กำหนดใน simulation profile หากใช้ delayed launch ให้ reserve ammo เมื่อยอมรับคำสั่งและ spawn เมื่อ delay จบ; ถ้าถูกทำลายก่อนให้ cancel โดยไม่มี projectile ค้าง ไม่รอ animation callback จาก GLB เพื่ออนุญาตยิง

## Collision และความยุติธรรม

- ใช้ collider aircraft เป็น capsule/box proxies ที่ author เทียบโมเดล; กระสุนตรวจ relative swept path กับ target ที่เคลื่อนที่ด้วย
- กระสุน/มิสไซล์มี ownerId, teamId, spawnTick, id ที่ไม่ใช้ซ้ำ; own-aircraft ignore window เฉพาะช่วงออกจากปากกระบอก/rail
- เลือก earliest impact ใน segment ไม่ให้โดนเครื่องที่อยู่หลังภูเขาก่อนภูเขา
- friendly fire ปิด baseline ตาม mode; ไม่แก้ weapon physics ให้ bot ยิงทะลุเพื่อน
- ตายใน tick เดียวกันให้ resolve damage batch ตามกติกาตายพร้อมได้ ไม่ขึ้นกับลำดับ render

## งานและเกณฑ์ผ่าน

1. Target drone คงที่ → moving drone → gun-only duel และปรับ speed/range
2. เพิ่ม damage/death/heat/events; ต่อ tracer/audio หลังผล simulation ถูกต้อง
3. เพิ่ม IR lock/guidance ก่อน flare แล้วทดสอบ missile miss/recover scenarios
4. ตรวจ high-speed tunneling, moving targets, terrain occlusion, self-hit, heat/cadence, duplicate events
5. Offline match ต้องเล่นด้วยปืนอย่างเดียวได้; missile มีเงื่อนไขยิงและมีวิธีหลบที่ผู้เล่นเข้าใจ
