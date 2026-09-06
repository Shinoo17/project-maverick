# 08 — Bot Pilot และ Difficulty

[กลับ Master Plan](../../MASTER_PLAN.md) · P4–P5 · พึ่ง flight/commands, world และ weapons

## หลักการ

บอทส่ง PilotCommand เหมือนผู้เล่น ใช้ acceleration, turn limits, PSM, ammo, heat และ lock ชุดเดียวกัน ไม่ย้าย position, set target speed หรือหัก HP ผู้เล่นเอง บอท maneuver ในตัวอย่างเป็น scripted tester ใช้เป็นแนวทาง command adapter ได้ แต่ยังไม่ถือว่าเป็น combat AI

## Pipeline ที่อ่านง่าย

```text
World snapshot → Perception → Tactical state → Steering + weapon intent → PilotCommand
```

- `perceive`: สร้างสิ่งที่บอทรู้จาก visible targets, warning sensors, ทีม และ remembered contacts
- `decide`: finite-state machine เลือกพฤติกรรมระดับยุทธวิธี
- `steer`: desired heading/aim/energy → pitch/roll/yaw/speedAdjust ตาม body frame
- `combatIntent`: ยิงเมื่อ aim error, range, heat หรือ lock เข้าเงื่อนไข

ไม่เริ่มด้วย behavior tree editor, machine learning หรือ pathfinding 3D เต็มโลกใช้ state machine + steering ก่อน

## States

| State | ทำอะไร | ออกเมื่อ |
|---|---|---|
| Patrol/Search | บิน waypoint รักษา speed/altitude | พบเป้าหรือ threat |
| Intercept | เข้าแนวตัด ไม่ไล่ตำแหน่งปัจจุบันอย่างเดียว | ใกล้ combat range |
| Engage | เลือก pursuit และรักษา firing geometry | พลังงานต่ำ/โดนจี้/เป้าหาย |
| Extend | บินออกไปฟื้น speed หรือแยกระยะ | energy ฟื้นและมีพื้นที่กลับเข้า |
| Evade | break turn, flare, เปลี่ยนแนวตาม warning | threat ผ่านหรือ timeout |
| Recover | ลด AoA, เร่ง, หลีกพื้น | controllable envelope กลับมา |

ความปลอดภัยมี priority สูงสุด: terrain avoidance → recovery → missile evade → tactics ใช้ forward collision probe และ projected altitude ไม่รอ AGL ต่ำค่อยดึงหัว ไม่เปิด PSM เมื่อไม่มี recovery clearance

## Perception และความยาก

บอทเห็นเฉพาะสิ่งที่ sensor rules อนุญาต ไม่อ่าน position ศัตรูที่หลังกำแพงจาก WorldState มาเล็งตรงทันที เก็บ last seen position/velocity กับอายุความจำแล้วคาดการณ์ระยะสั้น เมื่อหมดเวลาค้นหาบริเวณเดิมแทน perfect tracking

| Difficulty ทดลอง | Reaction delay | Aim error | การตัดสินใจ |
|---|---:|---:|---|
| Easy | 0.7–1.0 s | มากและเปลี่ยนช้า | burst สั้น ไม่ใช้ PSM, หลบบาง threat ช้า |
| Normal | 0.3–0.5 s | ปานกลาง | จัดการ energy, flare หลัง warning, สลับ chase/extend |
| Hard | 0.15–0.25 s | น้อยแต่ไม่ศูนย์ | เลือก High-G/PSM ตามโอกาสและ cost |

ไม่เพิ่ม HP/damage/turn rate ตาม difficulty Seeded error ให้ reproducible และอย่าเปลี่ยน noise ทุก tick แบบ jitter หากต้องมี adaptive difficulty ภายหลังต้องเป็น setting ที่ระบุชัด

## Data และ scheduling

`BotState` มี tacticalState, targetId, lastSeenContact, decisionAtTick, reactionQueue, seededRngState, steeringMemory และ threatMemory `BotProfile` มี difficulty params แยกจาก aircraft profile

Decision/perception 10 Hz กระจายตาม bot index; steering 60 Hz ไม่รัน expensive LOS checks ทุก substep เปลี่ยน target เมื่อ candidate ใหม่ดีกว่า threshold ต่อเนื่องเพื่อลดอาการสลับเป้าทุก tick

Basic steering คำนวณ desired direction ใน body frame ใช้ bank-to-turn + pitch ตาม turn plane และ yaw trim ไม่ใช้ yaw เป็น steering หลัก เครื่องกลับหัวก็ต้อง steer ด้วย body frame ไม่ใช้ world-up อย่างเดียว

## ลำดับพัฒนาและเกณฑ์ผ่าน

1. บิน waypoint บน flat map โดยไม่ชนพื้น 5 นาที
2. ไล่ moving target โดยยังไม่ยิง แล้วตรวจว่ารักษาระยะ/ไม่วนติดวงเดียว
3. เพิ่ม gun bursts, extend และ recover ให้ได้ match P4
4. เพิ่ม missiles/warnings/flare และ difficulty presets
5. เพิ่ม PSM เฉพาะ Hard หลังผู้เล่นใช้และรับมือได้แล้ว

ใช้ deterministic scenarios ตรวจว่าบอทหลบ terrain, obey weapon cooldown, ไม่เห็นทะลุภูเขา, recover low-speed และเส้นทางเปลี่ยนตาม aircraft profile บันทึก state/เหตุผลการตัดสินใจใน dev overlay ให้แก้ AI ได้โดยไม่ต้องเดา
