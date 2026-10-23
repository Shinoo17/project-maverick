# 02 — Controls: เมาส์และคีย์บอร์ด

[กลับ Master Plan](../../MASTER_PLAN.md) · P1 · เจ้าของปุ่มและการ resolve input เพียงไฟล์เดียว

## เมาส์หลัง MR1 · 26 กันยายน 2026

ที่มา: [maneuver/control plan §4](../psm-maneuver-control-plan.md) และ [MR1 report](../psm-mr1-implementation.md). เป็น input เท่านั้น ไม่เปลี่ยน physics, `PilotCommand` หรือ command schema

- **โหมด Relative (default, owner D5; ป้ายในเมนู "Gamepad-style" ตั้งแต่ 23 ต.ค. 2026)**: เมาส์ขยับ stick เหมือนเดิม แต่ stick คืนกลางเองด้วย τ = 0.2 s ต่อ command tick (ไม่ใช่ต่อ frame) ขยับเร็ว = คำสั่งมาก หยุดขยับ = เครื่องหยุดหมุน สุดพิกัดที่ครึ่งหนึ่งของรัศมี gate
- **โหมด Positional stick (option)**: ตำแหน่งตัวชี้คือคันบังคับ ตั้งแต่ 23 ต.ค. 2026 port จาก `example/F22` ตรงตัว (แทน shaping ของ MR1 §4.2): gate เป็นวงกลมรัศมี 0.34 ของด้านสั้นของจอ ÷ sensitivity (sensitivity ย่อวง ไม่คูณระยะเมาส์), clamp ตามความยาว, dead zone 0.12, curve 2, กลับ pitch ก่อนหมุน, อ่านตามจอเสมอโดยไม่สน Stick frame (F22 ไม่มี body frame; ชี้ขวา = เอียงขวาแล้วค้างมุม ไม่ใช่หมุนไม่หยุด) มุมหมุนตามจอจำกัดความเร็ว 200°/s แบบ camera roll correction ของ F22, ไม่ fade ใกล้แนวดิ่ง แต่ค้างมุมไว้ในกรวยรอบแนวดิ่ง (horizon < 0.35) และบวกครึ่งรอบกลับเมื่อหัวผ่านแนวดิ่ง จนกว่าตัวชี้จะพักใน dead zone 0.25 s (ไม่คลายเมื่อแค่เปลี่ยนทิศ: Cobra เกิน 90° แล้วดันลงต้องยังเป็นการดัน ไม่งั้นหักล้างกับ body axes ของ post-stall จนเครื่องค้างหัวเชิด) ชี้ขึ้น/ลงค้าง = loop ครบ 360° (เดิม dive ค้างที่แนวดิ่งและบังคับไม่ได้), หมุนแบบ rotation ตรงๆ (ไม่มี antipodal roll) และคืน body axes ตาม highAoa, คำสั่งผ่าน rate limiter แบบ F22 `DIRECT_RESPONSE` (pitch 16/18, roll 18/20, yaw 14/16 ต่อวินาที) ทีละ command tick ส่วน `MOUSE_STICK` แบบเต็มจอเหลือให้ × ของ cursor mode ใช้
- **Control frame**: default คือ **ตัวเครื่อง** (เมาส์ขึ้น = เชิดหัวเสมอ ทุก bank และทุก incidence). Option "อิงเส้นขอบฟ้า" คือ polar mapping เดิมที่อ่านในกรอบของกล้อง
- **Settings** (เก็บใน `maverick.settings` ฟิลด์ `controls`): โหมด, control frame, ความไว ×0.5–2, invert pitch, เมาส์ X = roll หรือ yaw
- **ไม่มีคลิกขวาค้าง** (owner D6): สงวนไว้ให้ missile ท่าที่ต้องค้างการดึงใช้ ↑
- HUD: วงประแสดงระยะสุดพิกัด ตัวชี้ stick สว่างขึ้นเมื่อถึงขอบ

วิธีใช้ที่แนะนำ: เล็ง = ขยับน้อยๆ ใกล้กลาง + Q/E · เลี้ยว = เลื่อนข้างเพื่อเอียงแล้วดึงขึ้น, A/D หมุนเร็วสุด · high AoA = Space ค้างก่อนแล้วสะบัดขึ้น (หรือ ↑ ค้าง) · ออกจากท่า = ดันลงผ่านกลาง ปล่อย Space แล้ว W หรือ Shift

## ปุ่มที่ใช้จริงหลัง PSM Phase 6 · 25 กันยายน 2026

W/S เร่ง/ลดความเร็ว; **Space ค้าง = Airbrake** และเป็นปุ่มหลักสำหรับเข้ามุมปะทะสูง (Space + ดึง/yaw ที่ 350–700 อาร์เคด กม./ชม.); Shift ค้าง = afterburner (และเพิ่ม power intent); Q/E yaw แบบ ramp เชิงเส้น 0.2 s ต่อ command tick (ปล่อยแล้วกลับศูนย์พอดี); A/D และลูกศร pitch/roll; R reset; V camera roll mode; P/Esc พัก

ไม่มี PSM mode หรือปุ่ม arm อีกแล้ว: **C และ X ไม่ได้ผูกกับการบิน**, Space ไม่ใช่ High-G อีกต่อไป การเลี้ยวแรง (hard turn) เกิดอัตโนมัติเมื่อดึงเต็มที่ความเร็วสูง `PilotCommand` ไม่มี `psmArm`/`highG`; replay schema เป็น 2 และ replay เก่าถูกปฏิเสธ รายละเอียดใน [Phase 6 report](../psm-phase6-implementation.md)

## ปุ่มที่ใช้ใน P2 · 7 กันยายน 2026 (ประวัติ, แทนแล้วโดย Phase 6)

W/S เร่ง/ลดความเร็วจริงตาม P1 (ไม่เก็บ target speed); X เบรก; Space ค้างร่วมกับเลี้ยวเป็น High-G; Shift ค้างเป็น afterburner; **C ค้าง + pitch/yaw เพื่อเข้า manual PSM** ในช่วง 65–115 m/s และสูง ≥150 m; ปล่อย C เพื่อออก ผู้เล่นยังคุมทุกแกนเอง; R reset ไปจุดเริ่มฝึกเดิมโดยยังบินต่อ; V สลับ camera roll mode; P/Esc พัก ไม่มี tap-to-Cobra หรือ input buffer สำหรับการแตะสั่งท่า

ใน PSM เมาส์อ่าน body pitch/roll โดยตรงเพื่อให้ดึงผ่าน vertical/inverted ต่อเนื่องได้; ผู้เล่นคืนคันบังคับกลางเพื่อหยุดหมุน เชิดแล้วกดหัวลงเป็น Cobra หรือดึงต่อเพื่อ 180° ก่อน W เร่งออก ไม่ใช้ Alt/Command ซึ่งชนปุ่มระบบ และไม่ผูก Airbrake+W ซึ่งเป็นคำสั่งเบรก/เร่งขัดกัน

**Post-stall push capture (input assist, 23 ต.ค. 2026, `src/game/input/pushCapture.ts`)**: ดันหัวลงที่เริ่มใน post-stall (highAoa > 0.5) จะหยุดหัวที่ขอบฟ้า (elevation 0 ไม่ใช่ attitude ก่อน Cobra) และค้างไว้ตราบที่ยังดันอยู่ ไม่ทิ่มเลยลงไปเป็น outside tumble กด W หรือ Shift = ปลดล็อก ดันต่อลงได้ และเมื่อคืนคันบังคับกลางขณะยังเร่งอยู่ หัวจะค้างมุมนั้น (pitch rate → 0) จน path ตามหัวมาและ flow ติดกลับ (เช่นตามเป้าที่ -20°) ทำงานใน FlightInput กับคีย์บอร์ดและโหมดเมาส์แบบคันบังคับ (ไม่ใช้กับ Mouse aim ที่มี hands-off recovery ของตัวเอง) ไม่มี state ในเครื่องบิน replay บันทึกคำสั่งที่ปรับแล้ว

Mouse positional stick และ keyboard overrides ใช้ P1 เดิม ทั้ง input presets ส่ง PilotCommand เดียวกัน รายการ rebinding/free-look/weapon ด้านล่างยังเป็นข้อเสนออนาคต ไม่ใช่ฟังก์ชันทั้งหมดที่เปิดใช้ใน P2

## แนวทางที่แนะนำ

ค่าเริ่มต้นเป็น **Mouse virtual stick + Keyboard**: เมาส์ขึ้น/ลงสั่ง pitch เมาส์ซ้าย/ขวาสั่ง roll พร้อม coordinated yaw assist เล็กน้อย เล็งด้วยการหันเครื่องจริง ไม่ให้เมาส์ย้าย crosshair แล้วยิงนอกแนวปืน ใช้แบบนี้เป็น baseline เพราะต่อจากตัวอย่างง่ายและยังควบคุม roll เองได้

**อัปเดต 2026-10-21 (D05):** ค่าเริ่มต้นเปลี่ยนเป็น **Mouse aim** แบบ War Thunder / Battlefield 6 Simplified Jet Controls เพราะ virtual stick เล่นยาก รายละเอียดอยู่ในหัวข้อ "Mouse aim" ด้านล่าง ส่วน virtual stick ยังเลือกได้ใน Settings

## Mouse aim (`src/game/input/mouseAim.ts`)

- เมาส์หมุน**ทิศเล็ง**ในโลก (0.08°/px × sensitivity) รอบแกนขวา/บนของกล้องเฟรมล่าสุด HUD วาดเป็น × และกล้อง cruise มองตามทิศเล็ง
- **Instructor** อยู่ใน input layer ทำงานทุก command tick และส่งออกเป็น pitch/roll/yaw ปกติ `PilotCommand` ไม่เปลี่ยน replay ได้ผลเหมือนเดิม
  - ไกลกว่า 40°: roll ให้ lift ชี้ไปหาจุดเล็งแล้วดึง (g บวก)
  - ใกล้กว่า 30°: roll ทางที่สั้นกว่า ดังนั้นเป้าใต้จมูกเล็กน้อยจะกดหัวลง ระหว่าง 30–40° ใช้การเลือกครั้งก่อน (hysteresis)
  - roll หา lift vector ที่รวม 3 อย่าง: แรงไปหาจุดเล็ง (ตามระยะ error), การเลี้ยวของจุดเล็งเอง, และแรงต้าน gravity ถ้าจุดเล็งไกลจะเอียงหาจุดเล็ง ถ้าใกล้ gravity จะชนะ ทำให้ปีกระดับเมื่อจุดเล็งหยุด และรักษาความสูงเมื่อเลี้ยวค้าง
  - ภายใน 3–10°: หางเสือช่วยเล็งละเอียด
  - มี feedforward อัตราหมุนของจุดเล็ง ทำให้ตามเป้าที่บินวนได้โดยไม่ lag
- **PSM เป็นของผู้เล่น:**
  - ปุ่มแกนบิน (↑↓ A D Q E) ที่กดค้างจะคุมทั้ง 3 แกน และจุดเล็งค่อยๆ กลับมาที่จมูก (10/s)
  - เมื่อ incidence อยู่ในช่วง 22–35° instructor จะส่งต่อให้ relative stick ใน body frame และ × จะจางหาย
  - ถ้าปล่อยมือ (ไม่กดปุ่ม และไม่ขยับเมาส์) ประมาณ 0.6–1.4 s ระหว่าง post-stall ทิศเล็งจะไปอยู่ที่ flight path และ instructor จะพาจมูกกลับเอง (hands-off recovery)
- **กล้อง:**
  - ผลของทิศเล็งหมดไปตั้งแต่ handover 0.85
  - level horizon คำนวณจากทิศมองที่ไม่มีผลจากทิศเล็ง (`noseLook`) ทำให้ภาพ PSM เป็น Phase 7 shot เดิมทุกเฟรม (`tests/mouseAim.test.ts`)
- **Mouse aim · ล็อกบนจอ (`cursor`, 2026-10-22):** instructor ตัวเดียวกัน แต่ × เลื่อนได้ทั่วจอเหมือน positional stick และค้างตรงที่วางไว้
  - × คือจุดที่ปืนเล็ง (ทางเลือก 2, 2026-10-22): ยิงเส้นจากกล้องที่ render ล่าสุดผ่าน pixel ของ × (`cursorRay`) ไปที่ระยะเดียวกับ reticle แล้วหมุนจมูกจนจุด default reticle (รวมความเร็วเครื่องและการตกของกระสุน) มาอยู่บนจุดนั้น (`aimAtRay`) ผลคือ × กับ reticle ที่วาดบนจอเป็นจุดเดียวกัน ส่วนก่อนเฟรมแรก fallback ไปใช้ FOV โดยนับกลางจอเป็นจมูก
  - คำสั่งขึ้นกับกล้องเฟรมล่าสุด จึงไม่เหมือนกันทุกบิตในแต่ละ FPS แต่ replay บันทึกคำสั่งไว้แล้ว
  - กล้องตามจมูกเครื่อง จุดใต้ × จึงเลื่อนตาม ค้าง × ไว้ข้างเครื่องจะเลี้ยวต่อเนื่อง ยิ่งห่างกลางยิ่งเลี้ยวแรง × กลางจอคือคงทิศเดิมและปีกระดับ
  - กรอบอ้างอิง: กล้อง Horizon locked ใช้ขอบฟ้าจริง (ไม่รวมการเอียงตกแต่งของ Balanced ไม่อย่างนั้นเลี้ยวค้างแล้วจะจม) ส่วนกล้อง Aircraft locked ใช้แกนตัวเครื่อง
  - ใน post-stall × ทำหน้าที่เป็น positional stick
- instructor วางมุมเอียงจาก lift ที่ต้องใช้: เริ่มจากแผน 2g แล้วใช้แรงดึงจริง (pitch rate × ความเร็ว) เมื่อเครื่องดึงแรงกว่านั้น
- **Aim assist ในโหมดนี้:** ดึง*จุดเล็ง*เข้าหา gun solution ภายใน cone เดิม แทนที่จะเพิ่มค่าเข้า stick ส่วน HUD ยังแสดง ASSIST

## ปุ่มเริ่มต้น

| Input | Action | วิธีใช้/เหตุผล |
|---|---|---|
| Mouse Y | Pitch | เมาส์ขึ้น = เชิดหัว ค่าเริ่มต้น non-inverted; สลับ invert ได้ |
| Mouse X | Roll + yaw assist | เอียงเข้าทิศเลี้ยว; assist ไม่หันเครื่องแบนแบบรถ |
| W / S | เพิ่ม / ลด target speed | กดค้างเพื่อปรับ ปล่อยเพื่อเก็บค่าเป้าหมาย |
| A / D | Roll ซ้าย / ขวา | สั่งโดยตรง และ override mouse roll ขณะกด |
| Q / E | Yaw ซ้าย / ขวา | ปรับแนวหัวละเอียด; ramp 0.2 s จนเต็ม และกลับศูนย์พอดีเมื่อปล่อย (Phase 6) |
| Arrow Up / Down | Pitch up / down | สำรองและใช้ใน Keyboard-only |
| Arrow Left / Right | Roll ซ้าย / ขวา | สำรองสำหรับมือขวาใน Keyboard-only |
| Shift | Afterburner | กดค้าง เร่งชั่วคราว; ไม่แก้ target speed ที่เก็บไว้ |
| Space | Airbrake | กดค้าง; Space + ดึงเข้า high AoA ในช่วงความเร็วต่ำ (Phase 6: แทน High-G เดิม) |
| X | — | ว่างตั้งแต่ Phase 6 (เดิม Airbrake) |
| Z | — | ข้อเสนอ PSM arm เดิมถูกยกเลิก: high AoA เป็นอัตโนมัติ ไม่มีปุ่ม arm |
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
| W และ S พร้อมกัน | `speedAdjust = 0`; ไม่แอบเปิด high AoA |
| ปุ่มทิศตรงข้ามพร้อมกัน | แกนนั้นเป็นศูนย์; ไม่ขึ้นกับลำดับ keydown |
| keyboard และ mouse บนแกนเดียวกัน | ถ้ามี keyboard override แกนนั้น; ปล่อยแล้วกลับ mouse ปัจจุบัน |
| Hard turn และ high AoA | envelope ต่อเนื่องเดียวกันตัดสิน: ความเร็วสูงให้ G, ความเร็วต่ำเปิด incidence limiter; ไม่มีปุ่มแยก |
| Airbrake + Afterburner | Airbrake มี priority ปิด burner และกด auto-speed controller ชั่วคราว |
| menu / text field focused | ไม่ส่ง flight/weapon actions; shortcut ของช่องกรอกทำงานได้ |
| blur / hidden / pointer unlock | เคลียร์ทุก held action และ one-shot pending; ไม่ยิงต่อเอง |
| key repeat | ใช้ได้กับ held state; ห้ามสร้าง missile/flare event ซ้ำ |

## ปุ่มในเมนู

หน้าจอเมนู (20) ใช้ input context แยกจาก flight ปุ่มในเมนูไม่ส่ง PilotCommand และปุ่ม flight ไม่ทำงานในเมนู

| ปุ่ม | หน้าจอ | Action |
|---|---|---|
| Enter | Home | Play โหมดที่เลือกไว้ |
| M / H | Home | เปิด Select Mode / Hangar |
| ← → | Hangar, Armament | เปลี่ยนลำ / อาวุธที่ดู |
| D / W / R | Hangar | สลับ Detail / เปิด Armament / reset view |
| B | Armament | เปิด/ปิด bay |
| Esc | ทุกหน้าเมนู | ย้อนกลับหนึ่งระดับ |

Hotkey เป็นทางลัด ทุก action ต้องกดด้วยเมาส์หรือ Tab + Enter ได้ด้วย ไม่รับ hotkey ขณะ focus อยู่ในช่องพิมพ์ เช่น callsign ปุ่มเมนูยังไม่ให้ rebind ใน P3b

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
