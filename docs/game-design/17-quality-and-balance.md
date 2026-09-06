# 17 — Quality, Performance และ Balance

[กลับ Master Plan](../../MASTER_PLAN.md) · ใช้เป็น gate ของทุก phase

## แยกสิ่งที่ตรวจอัตโนมัติจากสิ่งที่ต้องเล่นจริง

Tests พิสูจน์กฎ/ความเสถียร แต่ไม่พิสูจน์ความสนุก ใช้ headless scenario tests กับส่วนที่ผิดแล้วทำให้ระบบเสีย เช่น input, flight energy, projectile hit, death และ match lifecycle ส่วน layout/feel ต้อง visual QA และ playtest ไม่เขียน test เพียงเพื่อ assert ค่า config ซ้ำกับต้นฉบับ

## Acceptance matrix

| ระบบ | การตรวจสำคัญ | Gate |
|---|---|---|
| Runtime | command track เดียว 30/60/144 render FPS, mount/unmount, fixed-step budget | ไม่มี state drift จาก render; loop เดียว |
| Controls | W+S, opposing axes, mouse override, key repeat, blur/unlock, ไทย/อังกฤษ | ไม่เกิด stuck input หรือ fire ซ้ำ |
| Speed | W/S เปลี่ยน target, release คง target, brake priority, turn cost/recovery | ไม่ set velocity ตาม target โดยตรง |
| Maneuver | ทุก state transition, capability off, zero speed, abort, cooldown | Cobra nose/path แยก; ไม่มี free speed/turn |
| Camera | roll/loop/vertical/inverted/terrain ทุก roll mode | ไม่มี NaN/snap และไม่เปลี่ยน flight state |
| Guns | rate/heat, moving target sweep, terrain first hit, owner ignore | ไม่ tunneling และไม่คิด damage ซ้ำ |
| Missile | range/cone/LOS/grace, turn budget, flare, TTL/arming | lock/หลบสอดคล้องกับ cue |
| Bot | perception occlusion, energy recovery, cooldown, terrain avoid | ไม่มี privileged physics/ข้อมูลทะลุฉาก |
| Mode | pause/time, simultaneous deaths, score limit, spawn protection, rematch | จบรอบได้และ event ครั้งเดียว |
| Content | ids, profiles, variant facts, hardpoints, asset refs | เพิ่มลำใหม่โดยไม่ branch ใน core |
| Localization | key/placeholder parity, focus, long Thai text, save migration | เส้นทางหลักไม่มีข้อความหาย/ตัด |

Same-build headless replay เป้าคลาดเคลื่อนหลัง 60 s: position <0.1 m, speed <0.01 m/s, orientation <0.05° เมื่อเทียบ command track ที่ tick เดียวกันและ seed เดียวกัน ค่าคาดหวังจริงควรใกล้ศูนย์ เพราะ render ไม่ควรเกี่ยว ถ้าคลาดเกินให้หาผู้เขียน state ที่ผิด ไม่เพิ่ม tolerance กลบอาการ

ไม่รับประกัน replay ข้าม engine/browser/version แบบ bitwise ให้เก็บ build/content hash กับ scenario result

## ชุดทดสอบเดิมที่ควรใช้เป็น baseline

ตัวอย่างมี `input-check`, `bindings-check`, `camera-check`, `flight-physics-check`, `performance-check`, `high-g-check`, `maneuver-surface-check`, `psm-check`, `maneuver-check`, `stall-check` ใน package.json ให้รันก่อน refactor และบันทึกผล

การทำเอกสารครั้งนี้ **ยังไม่ได้รัน test suite หรือวัด FPS ของเกมเดิม** รายการข้างต้นเป็นสิ่งที่พบจากไฟล์ ไม่ใช่รายงานว่าผ่าน เมื่อเปลี่ยน control/speed spec ต้องปรับ behavioral expectations พร้อมเหตุผล ไม่บังคับทุก test เดิมที่อ้าง throttle ให้ผ่านด้วยการแอบคืนพฤติกรรมเดิม

## Performance budget ตั้งต้น

ตั้ง reference machine/GPU/browser/resolution จริงใน P0 ก่อนใช้ตัวเลขต่อไปนี้เป็น release gate:

| Scenario | เป้าทดลอง |
|---|---|
| Flat field, 1 aircraft | 60 FPS ที่ 1080p Medium; p95 frame time ≤16.7 ms |
| Offline 4 aircraft + combat | 60 FPS เป้าหมาย; low preset 30 FPS fallback โดย simulation rate ไม่เปลี่ยน |
| Simulation CPU | p95 ≤3 ms ต่อ world tick สำหรับ 4 aircraft + normal combat load |
| Rendering | draw calls เป้ารวม ≤250 ที่ Medium; ปรับจาก hardware จริง |
| Dynamic objects | รองรับ bullets 512, missiles 32, decoys 64 ตาม loadout/cadence ที่ถูกกติกา |
| Scene lifecycle | สลับ 20 ครั้งแล้ว geometry/texture/listener counts plateau ไม่โตต่อเนื่อง |

Projectile pool เต็มห้ามลบนัดที่กำลังเดินทางเงียบ ๆ จนทำให้ hit ต่างกัน ใช้ worst-case cadence×TTL คำนวณ capacity; ถ้าถึง hard safety limit ให้ reject fire พร้อม event และ metric โดยกติกาเดียวกันทุกฝ่าย Visual pools ล้นลด effect ได้โดยไม่เปลี่ยน sim

วัด CPU update, render frame, GPU indicators, draw calls, triangles, loaded textures, loading bytes และ memory trend แยกกันก่อน optimize ไม่ใช้ขนาด `.glb` เป็นตัวแทนทั้งหมด

## Playtest ที่ต้องทำก่อนขยาย content

1. ผู้เล่นใหม่อย่างน้อย 3 คนลอง basic tutorial; เป้าทดลองคือบิน/เลี้ยว/ชะลอได้ภายใน 5 นาที
2. Gun duel head-on, tail chase, crossing และ low-altitude อย่างละหลายรอบ เก็บ range/speed/firing-window/shot-hit ratio
3. ให้ลอง F-22 mirror ก่อนเพื่อแยกปัญหา controls จาก balance รายลำ
4. เปรียบเทียบ Normal vs High-G vs Cobra ในสถานการณ์เดียวกัน พร้อมตรวจ recovery vulnerability
5. เมื่อเพิ่มสามลำ ให้สลับฝ่าย/ผู้เล่นเพื่อลด skill bias ไม่ดู win rate รวมอย่างเดียว

เป้าทดลอง: กลับเข้าปะทะหลัง respawn ราว 10–25 s, tail engagement มองเห็น target เป็นลำได้บ่อย, normal gun kill ใช้หลาย burst ตาม 07 และ High-G/Cobra ไม่เป็นคำตอบที่ต้องกดตลอดเวลา ตัวเลขต้องปรับตามผลจริงและระบุ sample size ในรายงาน

## รายงาน tuning สั้นที่ต้องเก็บ

`build`, `contentVersion`, `aircraft pair`, `scenario/seed`, `input preset`, `camera mode`, `world speed`, `time on target`, `accuracy`, `kill time`, `energy loss`, `recovery time`, `frame p95` และคำอธิบายผู้เล่น

เปลี่ยนครั้งละกลุ่ม เช่น speed envelope ก่อน weapon damage ถ้าแก้หลายกลุ่มพร้อมกันจะไม่รู้ว่าความสนุกดีขึ้นเพราะอะไร เก็บก่อน/หลังและเหตุผลใน decision log ไม่เพิ่มกฎพิเศษให้ลำที่แพ้โดยยังไม่รู้สาเหตุ

## Offline release checklist

- [ ] Hangar สามลำพร้อม facts/game distinction และโมเดล/rig ผ่าน
- [ ] Input สอง presets, W/S target speed, Airbrake/High-G/PSM ที่รองรับ
- [ ] Camera modes + vertical/inverted checks และ accessibility toggles
- [ ] Playground lessons/retry และ Offline full match/rematch
- [ ] Guns + IR + flare + bot counterplay; terrain occlusion ถูกต้อง
- [ ] ไทย/อังกฤษครบ; settings reload/migration/error handling ผ่าน
- [ ] Performance และ resource lifecycle บน reference hardware ผ่าน
- [ ] เล่นต่อได้เมื่อ network ถูกตัดหลังโหลด assets; cold-offline ไม่ถูกโฆษณาถ้ายังไม่มี cache
- [ ] Runtime ไม่มี React/DOM/renderer dependency และ snapshots serialize ได้

ทุกช่องยังเป็นงานที่จะตรวจตอน implementation ไม่ใช่ผลสำเร็จของการจัดทำแผนนี้
