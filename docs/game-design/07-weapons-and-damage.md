# 07 — ปืน, Missile, Countermeasure และ Damage

[กลับ Master Plan](../../MASTER_PLAN.md) · P4–P5 · พึ่ง runtime, flight, collision และ aircraft armament

## Combat loop

มองเห็นเป้า → เข้า position → เล็ง/lock → ยิง → ศัตรูหลบหรือปล่อย flare → ยืนยัน hit → เสีย HP/ถูกทำลาย → mode ตัดสินคะแนนและ respawn ปืนต้องสนุกก่อนเพิ่ม missile ไม่ใช้ missile กลบปัญหาที่บินเร็วเกินเล็ง

## ปืน: projectile ที่มีเวลาเดินทาง

ใช้ ballistic projectile จำลองเป็นข้อมูลและ swept collision ไม่สร้าง rigid body หรือ React component ต่อกระสุน รูป tracer เป็น pool/instanced view ต่างหาก ไม่ต้องวาดกระสุนทุกนัด: 20 มม. วาดทุกนัดที่สี่ 30 มม. ทุกนัดที่สอง (หนาขึ้นเล็กน้อย) ให้ได้ราว 12 เส้นต่อวินาทีเท่ากัน; กระสุนที่ชนใน tick ล่าสุดยังวาดต่อจนถึงจุดชน

ปืนแยกสองตระกูล (owner 2026-10-24) ตั้ง damage ต่อวินาทีเท่ากันที่ 100 HP/s เพื่อให้ต่างกันที่ความรู้สึก ไม่ใช่ความแรง: M61 สำหรับ F-14/F-15/F-16/F/A-18/F-22 และ GSh-30-1 สำหรับตระกูล Su และ MiG-29 ค่าเป็น gameplay ช้ากว่าปืนจริง และ provisional รอ playtest

| Baseline ทดลอง | M61 (20 มม. ลำกล้องหมุน) | GSh-30-1 (30 มม. ลำกล้องเดียว) |
|---|---:|---:|
| Rate | 50 นัด/s; สะสม shot budget ตาม dt | 25 นัด/s |
| Muzzle speed สัมพัทธ์เครื่องยิง | 1,030 m/s (M61A2 กับ PGU-28) | 870 m/s |
| Damage | 2 HP ต่อ hit | 4 HP ต่อ hit |
| Spread (มุมยอดเต็ม) | 0.3° | 0.45° |
| ยิงต่อเนื่องจน overheat | 3 s | 3.5 s |

| ใช้ร่วมกัน | ค่า |
|---|---:|
| แนวปืน | เงยขึ้นจากแนวลำตัว 0.5° (gun harmonisation) ชดเชย AoA ขณะเลี้ยวและการตก; วัดที่ 500 m: บินตรงสูงกว่าแนวหัว ~1.3 m, ดึงเต็มต่ำกว่า ~3 m (1.5° สูงเกินไป 4–9 m เพราะ flight model คุม AoA แค่ 1–4°) |
| HP | aircraft baseline 100 HP |
| Spread | cone ตามตารางบน (ครึ่งหนึ่งต่อข้าง) seeded ต่อนัดจาก ownerId + ลำดับนัด; ร้อนเต็มกว้างขึ้น 50% |
| ระยะที่อยากให้ใช้ | 200–700 m |
| Lifetime / path distance cap | 1.2 s หรือเดินทางรวม 1,000 m อย่างใดถึงก่อน |
| Ammo model MVP | ไม่จำกัดนัด แต่ heat จำกัด burst; ไม่ใช่จำนวนกระสุนจริงของเครื่อง |
| Heat | ยิงต่อเนื่องตามตารางบนจึง overheat; เย็นลง 0.5/s ขณะไม่ยิงหรือถูก lock; โทษสองระดับ (owner 2026-10-24): ปล่อยไกที่ heat ≥ 80% → lock จนต่ำกว่า 35% (~0.9–1.3 s), ยิงจนถึง 100% → overheat lock จนเย็นถึง 0% (2 s); ปล่อยไกต่ำกว่า 80% ยิงต่อได้ทันที (provisional รอ playtest) |

velocity เริ่มต้น = shooter velocity + muzzle direction × muzzle speed; gun direction อิง hardpoint simulation transform ใน aircraft profile ไม่ raycast จาก camera และไม่ยิงไปหา selected target อัตโนมัติ

ที่ 100% hits มี ideal damage time `100/100 = 1 s` ทั้งสองตระกูล (M61 `50×2`, GSh `25×4`); ของจริงต้องนานกว่านี้จาก spread/geometry เป้าหมาย playtest คือ burst หลายครั้งรวมประมาณ 2–5 s ของการกดไกเพื่อ kill อย่าเพิ่ม HP ก่อนตรวจว่าปัญหาอยู่ที่ firing window หรือความแม่นยำ

MVP ช่วยด้วยการแสดงผล และ aim assist ที่ stick (ผู้ใช้ขอเพิ่ม 21 ต.ค. 2026 หลังลองแบบแสดงผลอย่างเดียวแล้วเล็งไม่ได้) ไม่ทำ bullet magnetism: กระสุนไม่เลี้ยว hitbox ไม่ขยาย Aim assist (`src/game/combat/aimAssist.ts`) เติม pitch/yaw เข้าหา gun solution เมื่อ reticle ห่างจาก solution ไม่เกิน cone (ปกติ 8°, แรง 14°; เต็มที่ภายใน 4°/8°) และกระสุนไปถึงได้ ไม่สั่ง roll ยอมให้เมื่อผู้เล่นโยกคันเกินหนึ่งในสาม คิดตอนสร้าง command จึงบันทึกใน replay และบอทใช้ได้ ตั้งค่า ปิด/ปกติ/แรง ใน Settings › การเล็ง (ค่าเริ่มต้นปกติ) HUD ขึ้น ASSIST ใต้ reticle ขณะทำงาน; ค่าทั้งหมด provisional. Mouse aim (ผู้ใช้ขอ 23 ต.ค. 2026): โหมด world-locked ดึงทิศ aim เข้าหา solution ทุก tick; โหมด × ค้างบนจอ (`'cursor'`) ดึงตัว × เข้าหา lead marker ทุก frame เหมือนมือ (ปล่อยแล้วเครื่องไม่สะบัดกลับ) มือที่ขยับเร็วกว่า ~150–700 px/s ชนะแรงดูด; กดยิงค้างดูดแรงขึ้น 3 เท่าและเต็มแรงทั้ง cone และจับได้แม้ × ชี้ที่ตัวเป้า (เป้าตัดขวาง lead ห่างตัวเป้า ≈ ความเร็วเป้า/ความเร็วกระสุน เช่น 7° ที่ 150 m/s) แล้วดูดไปที่ lead (trigger แบบ A) ใน cursor mode reticle ที่ × เล็งคือ reticle เดียวกับที่ HUD วาด (`drawnReticle`: ที่ระยะเป้าเมื่อมี solution) และ × คงมุมเดิมเมื่อ FOV เปลี่ยน (ความเร็ว, burner, gun zoom) เลือกเป้าและ lock ใน sim (`src/game/combat/targeting.ts`, ผู้ใช้ขอ 24 ต.ค. 2026): เป้าที่เลือกคือเป้าที่ lock ล็อกได้เฉพาะเครื่องที่ radar จับได้ (`src/game/combat/radar.ts`: อยู่ใน radar cone และระยะของเครื่องเรา ค่าต่อลำใน `AircraftDefinition.radar` เป็นค่าเกม ไม่ใช่สเปกจริง: F-22 ±60° / 10 km, Su-57 ±70° / 9 km, provisional) ล็อกอัตโนมัติเมื่อมีเป้าใน cone 30° จากหัวเครื่อง, T สลับไปเป้าถัดไปที่ radar จับได้ (ล็อกใหม่แล้วเป้าเก่าหลุดทันที), เป้าออกนอก radar cone หรือระยะ เริ่มนับ grace 3 s ถ้าหันหัวกลับทันก่อนหมดเวลา lock ยังอยู่ ไม่ทันก็หลุด, ตายแล้วหลุดทันที radar cone ใช้แทน "ออกนอกจอ" เพราะ lock อยู่ใน sim (replay, aim assist, บอท) ส่วนจอเป็นของกล้อง เครื่องที่อยู่ใกล้ใน 2 km เห็นได้รอบตัวแม้ไม่อยู่ใน cone (แสดงบน radar scope แต่ล็อกไม่ได้) Gun solution (`gunSolution.ts`) ใช้ physics เดียวกับ `spawnRound`/`stepRound` (muzzle offset, elevation, ความเร็วเครื่องบวก muzzle speed, gravity) และนำเป้าด้วยความเร็วกับความเร่งของเป้า จึงนำเป้าที่กำลังเลี้ยวได้ HUD แสดง computed gun reticle (จุดที่กระสุนที่ยิงตอนนี้จะอยู่ ที่ระยะของเป้า หรือ 500 m ถ้าไม่มีเป้า) และ lead marker (จุดที่เป้าจะอยู่เมื่อกระสุนไปถึง) ทั้งสองเป็นจุดใน world จึงเอา reticle ทับ lead marker แล้วโดนจริงจากกล้องใดก็ได้ ถ้ากระสุนไปไม่ถึงก่อน lifetime/1,000 m ให้ซ่อน lead และแสดง OUT RNG; IN RNG ที่ ≤ 800 m (provisional) ตัวกรอบเป้าช่วยมอง แต่ไม่เพิ่ม collider ตามขนาด UI Distance scale (`src/render/targetVisibility.ts`, ผู้ใช้ขอ 21 ต.ค. 2026): เครื่องบินลำอื่นวาดใหญ่ขึ้นตามระยะจากกล้อง 1× ที่ ≤ 300 m ถึง 2× ที่ ≥ 1 km (smoothstep, provisional) เหมือน model visibility ของ DCS เฉพาะภาพเท่านั้น hitbox, collision และ on-solution ยังใช้ขนาดจริง; `?hitboxes` แสดง hitbox จริงไม่ขยาย

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

## Combat effects (view only)

เพิ่ม 21 ต.ค. 2026 ตามที่ผู้ใช้ขอ (`src/render/vfx/`): effect อ่านจาก `drainHits()` และ `aircraft-destroyed` ที่ scene drain ครั้งเดียวต่อ frame แล้วแบ่งให้ HUD ใช้ด้วย ไม่เปลี่ยน simulation นับเวลาด้วยนาฬิกา sim จึงหยุดตอน pause และ reset ล้างทั้งหมด
- กระสุนโดนเครื่อง: flash, ประกาย 3 เส้น, ควันเล็ก วิ่งไปกับเป้า และดึงเข้าหากล้อง 2.5 m ไม่ให้โมเดลบัง; โดนพื้น: ฝุ่น; แสดงไม่เกิน 6 hit ต่อ frame
- เครื่องที่ไม่มีนักบิน (drone) ถูกยิงตก: ระเบิดกลางอากาศ (flash, วงคลื่น, ลูกไฟส้มกลายเป็นเขม่า, ประกายตก, ควันค้าง) แล้วซาก (โมเดลสีไหม้) เสียการควบคุม: ได้แรงกด 25 m/s ลง, ตกตาม gravity drag เบา, หมุน roll 2.6 rad/s, หัวค่อยๆ ชี้ตามทางตก จาก 400 m ใช้ ~7 s ([wreck.ts](../../src/render/vfx/wreck.ts)) ระหว่างตกมีไฟและควันตามหลัง ถึงพื้นระเบิดอีกครั้งพร้อมฝุ่นและเสาควัน ~10 s ซากเป็น view อย่างเดียว drone ใน sim ยังเกิดใหม่ 3 s ตามเดิม ตกพร้อมกันได้ 2 ซาก
- ผู้เล่นตายยังไม่มี effect
- particle เป็น billboard instanced สองชั้น: glow (additive, เฉพาะ flash/ประกาย) และ smoke (alpha, ลูกไฟและควัน) เพราะฟ้าสนามซีด additive แทบไม่เห็น; มีขนาดขั้นต่ำเป็น pixel ให้เห็นจากไกล ค่าทั้งหมด provisional ดูได้ที่ `vfx-preview.html` (`?at=วินาที` render ช่วงเวลาเดียว)



ใช้ HP ก้อนเดียวใน MVP ไม่เพิ่ม damage subsystem ปีก/เครื่องยนต์จน flight loop นิ่ง การ hit ลด HP, ส่ง `damage-applied`; เปลี่ยน alive เป็น false ได้ครั้งเดียวและส่ง `aircraft-destroyed` ให้ mode รับ ห้าม renderer นับ score เอง

`WeaponDefinition` มี id, kind, damage, cadence, range, projectile/seeker params, visualAssetId; `WeaponStation` ระบุ weaponId/capacity และ runtime เติมทุกจุดเต็มความจุ; validator ตรวจ station/weapon ID และ capacity ส่วน `WeaponState` เก็บ heat, cooldown, inventory และ lock แยกต่อ entity

ขณะ pending launch bay animation ใช้เวลาเปิดที่กำหนดใน simulation profile หากใช้ delayed launch ให้ reserve ammo เมื่อยอมรับคำสั่งและ spawn เมื่อ delay จบ; ถ้าถูกทำลายก่อนให้ cancel โดยไม่มี projectile ค้าง ไม่รอ animation callback จาก GLB เพื่ออนุญาตยิง

## Collision และความยุติธรรม

- ใช้ collider aircraft เป็น capsule/box proxies ที่ author เทียบโมเดล; กระสุนตรวจ relative swept path กับ target ที่เคลื่อนที่ด้วย
- กระสุน/มิสไซล์มี ownerId, teamId, spawnTick, id ที่ไม่ใช้ซ้ำ; own-aircraft ignore window เฉพาะช่วงออกจากปากกระบอก/rail
- เลือก earliest impact ใน segment ไม่ให้โดนเครื่องที่อยู่หลังภูเขาก่อนภูเขา
- friendly fire ปิดในทุกโหมด PVE และ Campaign (09, 21): กระสุน/มิสไซล์ผ่านเพื่อนร่วมทีมโดยไม่ทำ damage แต่ยังชนพื้นและเป้าศัตรูตามปกติ; ไม่แก้ weapon physics ให้ bot ยิงทะลุเพื่อน และบอทยังต้องไม่ยิงเมื่อเพื่อนอยู่ในแนวยิงใกล้
- IFF: เพื่อนร่วมทีมเลือกเป็นเป้าหรือ lock ไม่ได้ ทั้งผู้เล่นและบอท; seeker ของ missile ไม่ไล่เพื่อน
- เป้าภาคพื้นของ Campaign (21) ใช้ collider และ damage event เดียวกับ aircraft; วิธีโจมตีภาคพื้นยังรอ D16 ใน 19
- ตายใน tick เดียวกันให้ resolve damage batch ตามกติกาตายพร้อมได้ ไม่ขึ้นกับลำดับ render

## งานและเกณฑ์ผ่าน

1. Target drone คงที่ → moving drone → gun-only duel และปรับ speed/range
2. เพิ่ม damage/death/heat/events; ต่อ tracer/audio หลังผล simulation ถูกต้อง
3. เพิ่ม IR lock/guidance ก่อน flare แล้วทดสอบ missile miss/recover scenarios
4. ตรวจ high-speed tunneling, moving targets, terrain occlusion, self-hit, heat/cadence, duplicate events
5. Offline match ต้องเล่นด้วยปืนอย่างเดียวได้; missile มีเงื่อนไขยิงและมีวิธีหลบที่ผู้เล่นเข้าใจ
