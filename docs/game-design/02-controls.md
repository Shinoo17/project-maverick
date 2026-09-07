# 02 — Controls: เมาส์และคีย์บอร์ด

[กลับ Master Plan](../../MASTER_PLAN.md) · P1 · เจ้าของปุ่มและการ resolve input เพียงไฟล์เดียว

## ปุ่มที่ใช้จริงใน P2 · 7 กันยายน 2026

W/S เร่ง/ลดความเร็วจริงตาม P1 (ไม่เก็บ target speed); X เบรก; Space ค้างร่วมกับเลี้ยวเป็น High-G; Shift ค้างเป็น afterburner; **C ค้าง + pitch/yaw เพื่อเข้า manual PSM** ในช่วง 65–115 m/s และสูง ≥150 m; ปล่อย C เพื่อออก ผู้เล่นยังคุมทุกแกนเอง; R reset ไปจุดเริ่มฝึกเดิมโดยยังบินต่อ; V สลับ camera roll mode; P/Esc พัก ไม่มี tap-to-Cobra หรือ input buffer สำหรับการแตะสั่งท่า

ใน PSM เมาส์อ่าน body pitch/roll โดยตรงเพื่อให้ดึงผ่าน vertical/inverted ต่อเนื่องได้; ผู้เล่นคืนคันบังคับกลางเพื่อหยุดหมุน เชิดแล้วกดหัวลงเป็น Cobra หรือดึงต่อเพื่อ 180° ก่อน W เร่งออก ไม่ใช้ Alt/Command ซึ่งชนปุ่มระบบ และไม่ผูก Airbrake+W ซึ่งเป็นคำสั่งเบรก/เร่งขัดกัน

Mouse positional stick และ keyboard overrides ใช้ P1 เดิม ทั้ง input presets ส่ง PilotCommand เดียวกัน รายการ rebinding/free-look/weapon ด้านล่างยังเป็นข้อเสนออนาคต ไม่ใช่ฟังก์ชันทั้งหมดที่เปิดใช้ใน P2

## แนวทางที่แนะนำ

ค่าเริ่มต้นเป็น **Mouse virtual stick + Keyboard**: เมาส์ขึ้น/ลงสั่ง pitch เมาส์ซ้าย/ขวาสั่ง roll พร้อม coordinated yaw assist เล็กน้อย เล็งด้วยการหันเครื่องจริง ไม่ให้เมาส์ย้าย crosshair แล้วยิงนอกแนวปืน ใช้แบบนี้เป็น baseline เพราะต่อจากตัวอย่างง่ายและยังควบคุม roll เองได้

เป้า aim-point ที่มี instructor บินตามจุดเป็นตัวเลือกทดลองภายหลัง ต้องเปรียบเทียบ playtest ก่อนเพิ่ม เพราะมีความซับซ้อนเรื่องการเลือก bank, inverted flight และ PSM ไม่ทำ control model สองชุดใน P1

## ปุ่มเริ่มต้น

| Input | Action | วิธีใช้/เหตุผล |
|---|---|---|
| Mouse Y | Pitch | เมาส์ขึ้น = เชิดหัว ค่าเริ่มต้น non-inverted; สลับ invert ได้ |
| Mouse X | Roll + yaw assist | เอียงเข้าทิศเลี้ยว; assist ไม่หันเครื่องแบนแบบรถ |
| W / S | เพิ่ม / ลด target speed | กดค้างเพื่อปรับ ปล่อยเพื่อเก็บค่าเป้าหมาย |
| A / D | Roll ซ้าย / ขวา | สั่งโดยตรง และ override mouse roll ขณะกด |
| Q / E | Yaw ซ้าย / ขวา | ปรับแนวหัวละเอียด; manual yaw override yaw assist |
| Arrow Up / Down | Pitch up / down | สำรองและใช้ใน Keyboard-only |
| Arrow Left / Right | Roll ซ้าย / ขวา | สำรองสำหรับมือขวาใน Keyboard-only |
| Shift | Afterburner | กดค้าง เร่งชั่วคราว; ไม่แก้ target speed ที่เก็บไว้ |
| Space | High-G | กดค้างร่วมกับคำสั่งเลี้ยว ใช้ง่ายใน dogfight |
| X | Airbrake | กดค้าง ลดความเร็วเร็วกว่า S; แยกจาก High-G |
| Z | PSM arm | กดค้างแล้ว pitch up เมื่อเข้าเงื่อนไข; ปล่อยเพื่อ recover |
| Left mouse | ยิงปืน | กดค้าง; click ที่ใช้เข้า pointer lock ครั้งแรกไม่ยิง |
| Right mouse | ยิง secondary missile | กดหนึ่งครั้งต่อคำขอปล่อย; ยิงได้เมื่อ lock พร้อม |
| F | Countermeasure | กดหนึ่งครั้งปล่อย flare burst เมื่อมี inventory |
| T | เลือกเป้าถัดไป | เลือก candidate หน้าเครื่อง; การเลือกยังไม่เท่ากับ lock |
| 1 / 2 | เลือก secondary slot | ตอนมี missile ชนิดเดียวแสดง slot เดียว; ไม่ต้องสลับออกจากปืน |
| R | มองหลัง | กดค้าง กลับมุมเดิมเมื่อปล่อย |
| Middle mouse + move | Free look | กดค้าง เมาส์ควบคุมกล้อง; keyboard ยังบินได้ |
| C | เปลี่ยน camera view | Chase → near chase → nose view |
| V | เปลี่ยน camera roll mode | Horizon / balanced / aircraft; HUD แจ้งชื่อ mode |
| Mouse wheel | ระยะ chase | จำกัดช่วง ไม่เปลี่ยน speed หรือ weapon |
| Escape / P | Pause menu | Escape ออกจาก pointer lock ด้วย; online เปิด menu แต่โลกไม่หยุด |
| I | Debug overlay | เฉพาะ Playground/dev; ไม่ใช้ใน tutorial ปกติ |
| J / K / L / U | ปืน / missile / countermeasure / เลือกเป้า | สำรองใน Keyboard-only |

Reset อยู่ใน pause/Playground panel เพื่อลดการกดพลาด ไม่มีปุ่ม flaps, landing gear หรือ thrust-vector nozzle รายแกนใน combat เพราะ FCS จัดการเอง เลือก Z แทน Alt/Ctrl เพื่อลด browser/OS shortcut conflicts และไม่วาง PSM บน W+S ที่ขัดกับการปรับความเร็ว

## Mouse virtual stick ที่ต้องระบุให้ชัด

- Pointer lock เมื่อผู้เล่นคลิก “เริ่มบิน/กลับไปบิน”; ใช้ movement delta สะสมเป็น virtual stick ในวงกลมที่แสดงบน HUD
- deadzone ทดลอง 5%, response curve exponent 1.4, sensitivity slider; clamp ความยาวเวกเตอร์ไม่เกิน 1
- virtual stick คงตำแหน่งเมื่อหยุดขยับเมาส์; ขยับกลับศูนย์เพื่อหยุดสั่ง ไม่ใช้การหมุนตรงตามพิกเซล
- เมาส์สั่ง normalized body rates ที่ผ่าน envelope เดียวกับ keyboard; ไม่มี teleport orientation
- เข้า free look ให้ตั้ง mouse flight axes เป็นศูนย์และ damping angular rates ตาม FCS ปกติ; ออกจาก free look เริ่ม stick ที่ศูนย์ ไม่มีการเอา delta ที่มองกล้องไปสะสมคำสั่งบิน
- ให้มี setting “auto-center mouse stick” ทดลองภายหลัง; default ปิดเพื่อไม่เปลี่ยนคำสั่งขณะยิงโดยผู้เล่นไม่รู้
- จังหวะ pointer lock เปลี่ยนต้อง clear held state และ consume activation click; ถ้า browser ไม่อนุญาต แสดง retry กับ Keyboard-only fallback

Pointer Lock ต้องเริ่มจาก engagement gesture และต้องรับการปลด lock จากผู้ใช้ ตาม [MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)

## Resolve rules

| กรณี | ผลลัพธ์ |
|---|---|
| W และ S พร้อมกัน | `speedAdjust = 0`; ไม่แอบเปิด High-G/PSM |
| ปุ่มทิศตรงข้ามพร้อมกัน | แกนนั้นเป็นศูนย์; ไม่ขึ้นกับลำดับ keydown |
| keyboard และ mouse บนแกนเดียวกัน | ถ้ามี keyboard override แกนนั้น; ปล่อยแล้วกลับ mouse ปัจจุบัน |
| High-G และ PSM | ถ้า PSM เข้าเงื่อนไขให้ PSM มี priority; ถ้าเข้าไม่ได้อนุญาต High-G ตาม envelope |
| Airbrake + Afterburner | Airbrake มี priority ปิด burner และกด auto-speed controller ชั่วคราว |
| menu / text field focused | ไม่ส่ง flight/weapon actions; shortcut ของช่องกรอกทำงานได้ |
| blur / hidden / pointer unlock | เคลียร์ทุก held action และ one-shot pending; ไม่ยิงต่อเอง |
| key repeat | ใช้ได้กับ held state; ห้ามสร้าง missile/flare event ซ้ำ |

## Rebinding และ accessibility

ใช้ `KeyboardEvent.code` เป็น binding เพื่อให้ตำแหน่ง W/A/S/D ไม่เปลี่ยนตอนสลับภาษาไทย แสดงชื่อปุ่มอ่านง่ายตาม layout เมื่อทำได้ รองรับ primary/secondary binding รวม mouse buttons ไม่ใช้ข้อความแปลเป็น action id

เก็บ `bindingVersion` แยกจาก save version การชนกันใน context เดียวกันให้ UI เสนอ swap/unbind พร้อมบอก action ที่ได้รับผล ก่อนยืนยัน หากทำให้ไม่มีปุ่ม pause/back ให้ปฏิเสธและคง Escape เป็นทางออกเสมอ รับ rebind เฉพาะหน้า settings และเก็บไว้ local

มี preset Mouse + Keyboard และ Keyboard-only, invert pitch, sensitivity, deadzone, hold/toggle สำหรับ action ที่เหมาะสม ผู้ใช้สอง preset ส่ง PilotCommand แบบเดียวกัน Settings แสดง preview และ “คืนค่าเริ่มต้น”

## งานและเกณฑ์ผ่าน

1. เปลี่ยน action names เดิมจาก throttle-up/down เป็น speed-increase/decrease; แยก semantic command จาก key table
2. สร้าง input context และ browser adapter; ต่อ mouse stick และ keyboard adapter
3. ทำ binding editor/validation/save หลัง preset หลักใช้ได้
4. ทดสอบทุก conflict ในตาราง, สลับภาษา OS, pointer lock ล้มเหลว และ alt-tab ขณะยิง
5. ผู้เล่นฝึก pitch/roll/yaw, เร่ง/ชะลอ, ยิง, flare และ pause ด้วยทั้งสอง preset ได้ครบ ไม่มี stuck input
