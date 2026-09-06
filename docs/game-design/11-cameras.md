# 11 — Camera System

[กลับ Master Plan](../../MASTER_PLAN.md) · P1/P2 · อ่าน interpolated flight state; ไม่เขียน simulation

## แยก View กับ Roll Mode

View เลือกตำแหน่ง/ระยะกล้อง ส่วน roll mode เลือกว่า up vector หมุนตามเครื่องเท่าไร จึงใช้ horizon lock กับ near chase ได้โดยไม่สร้าง camera implementation ทุก combination

| View | หน้าที่ |
|---|---|
| Chase | ค่าเริ่มต้น เห็นเครื่องและพื้นที่รอบตัว ระยะทดลอง 24–38 m หลังเครื่อง |
| Near chase | ใกล้ขึ้นราว 16–24 m สำหรับเล็งและดู maneuver |
| Nose view | first-person จากจุดอ้างอิงหน้าเครื่อง; ซ่อน own aircraft ที่บังภาพ |
| Cockpit | เพิ่มเมื่อมี interior GLB ที่อ่านได้; ไม่อ้างว่า nose view คือ cockpit จริง |
| Rear view | temporary view จาก action ใน 02; ปล่อยกลับ view เดิม |
| Free look | temporary yaw/pitch offset รอบ anchor; ไม่เปลี่ยนทิศบิน |

| Roll mode | พฤติกรรม |
|---|---|
| Horizon locked | screen up อิง world up ตราบที่คำนวณได้; aircraft roll เห็นผ่านลำเครื่อง/HUD |
| Balanced | ตาม bank เพียงบางส่วน จำกัด roll ประมาณ ±20° แล้วค่อยคืน; default เสนอให้ทดลองเทียบ Horizon |
| Aircraft locked | up vector ตาม aircraft up หมุน 360° ได้ ไม่มีการบังคับคืนขอบฟ้า |

Preset เริ่มต้นสำหรับมือใหม่ใช้ Chase + Horizon locked; Balanced เป็นทางเลือกให้รู้สึกแรงเลี้ยวมากขึ้น สลับ view กับ roll mode ตามปุ่มใน 02 และตั้งแยกใน settings ได้

## Camera rig

`CameraRigState` เก็บ current pose, smoothed anchor, freeLook offset, previous stable up/right, selected view/roll และ transition progress; `CameraPreferences` เก็บ distance, FOV, shakeScale, dynamicFovScale, sensitivity โดยไม่อยู่ใน AircraftState

```text
Interpolated aircraft pose + velocity
  → desired anchor / look direction
  → stable roll frame
  → damping + view transition
  → final terrain collision constraint
  → final CameraPose
```

Anchor ตาม aircraft position ส่วน look target ผสม nose กับ velocity เล็กน้อยเพื่อลดอาการเหวี่ยงระหว่าง drift โดยลด velocity-look weight เมื่อ speed ต่ำ/PSM active ห้ามกล้องตาม velocity เต็มจนไม่เห็นว่า Cobra หัวหันไปทางไหน

## Horizon lock ที่ไม่พลิกตอนบินตั้งฉาก

ไม่เรียก `lookAt` กับ world-up ตรง ๆ ทุกกรณี เพราะเมื่อ look direction ขนาน world up จะหา right vector ไม่ได้ ให้ project world up ลง plane ตั้งฉากกับ look; หากความยาวใกล้ศูนย์ใช้ previous stable frame และ transport frame ผ่านช่วง vertical อย่างต่อเนื่อง

เมื่อออกจาก singularity ให้ blend กลับ world horizon ด้วย shortest quaternion path พร้อม hysteresis ป้องกันสลับ sign ซ้ำ การบินดิ่งลง/ขึ้น/กลับหัวไม่ควรทำกล้องหมุน 180° ทันที ส่วน Aircraft locked ใช้ aircraft quaternion เป็นหลักและไม่แก้ roll ให้ level

Mouse flight input ยังเป็น body-axis virtual stick ตาม 02 ในทุก camera mode เปลี่ยนกล้องไม่เปลี่ยนความหมาย pitch/roll/yaw และไม่แอบเปลี่ยน flight assistance แสดง bank indicator ชัดใน Horizon mode เพื่อให้ผู้เล่นรู้ว่าตัวเครื่องเอียงอยู่

## ความนุ่มและความเร็ว

ใช้ time-based damping `1-exp(-k*dt)` แยก position/look/roll ไม่ lerp ด้วยค่าคงที่ต่อ frame ค่าเริ่มต้น vertical FOV ทดลอง 69°, ปรับ 55–85°; burner เพิ่ม FOV ไม่เกิน 4° เมื่อเปิด dynamic FOV เท่านั้น

อย่าเพิ่ม shake/FOV จนเครื่องเป้าหมายหดมองไม่เห็น ให้ปรับ shake/dynamic FOV เป็นศูนย์ได้ UI และ lead indicator project ด้วย final camera pose เดียวกับที่ render ไม่ใช้ simulation pose ที่ยังไม่ interpolate

Camera terrain collision ใช้ segment จาก anchor ไปตำแหน่งกล้องหลัง damping/transition และดันเข้าเมื่อถูกบัง เพื่อไม่ให้ smoothing พากล้องกลับเข้า terrain ค่อยคืนระยะเมื่อพ้น ไม่ทำ simulation aircraft ชนตามกล้อง ถ้าต้องเข้าใกล้ลำจนทะลุ mesh ให้ fade own-aircraft/เปลี่ยน near clipping อย่างควบคุมได้

## งานและเกณฑ์ผ่าน

1. Extract camera rig จาก AircraftView; ทำ Chase + Horizon/Aircraft ก่อน
2. เพิ่ม stable vertical frame, transition, rear view และ free look
3. เพิ่ม distance/FOV/collision และ Balanced หลัง baseline นิ่ง
4. ใช้ command track เดิมแล้วเปลี่ยน camera mode: aircraft state ต้องเหมือนเดิม
5. ดู loop, 360° roll, inverted flight, vertical climb, Cobra, terrain flyby และ reset ว่าไม่มี snap/NaN/ภาพค้าง

ทดสอบหลาย aspect ratios และ render FPS; เปลี่ยน view ขณะ free look/rear view ต้องคืนไป base view ล่าสุด ไม่กลับไปค่าที่ถูกยกเลิกแล้ว
