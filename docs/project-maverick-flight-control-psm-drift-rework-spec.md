# Project Maverick — Flight Control, High-AoA, PSM & Jet Drifting Rework

> **Design Specification / Planning Reference**  
> เวอร์ชัน: **Draft v1.0** · วันที่: **31 ตุลาคม 2026**  
> ขอบเขต: **Single-player และ Multiplayer flight gameplay, Mouse + Keyboard, Keyboard-only, Camera, HUD, Physics, Maneuvers, Tuning และ Testing**  
> สถานะ: **เอกสารสำหรับวางแผนและตรวจ Codebase ก่อน Implement** — ไม่ใช่การยืนยันว่าโค้ดปัจจุบันทำงานตามนี้แล้ว

---

## 0. Executive Summary — ข้อเสนอหลัก

**เป้าหมาย:** สร้างระบบบินแบบ **Easy to Fly, Hard to Master**: ผู้เล่นใหม่บิน Dogfight ได้ง่าย แต่ผู้เล่นที่ชำนาญสามารถทำ High-G Drift, Banked Drift, Cobra, Kulbit, Pedal Turn, Herbst-like Turn, Tail Slide, Bell และ PSM Chaining ได้อย่างต่อเนื่อง โดยไม่ต้องเรียก Animation เฉพาะท่า

**Architecture ที่แนะนำ:** **Physics-driven + Flight Envelope Protection + Contextual PSM Assistance + Cinematic Chase Camera**

**ข้อกำหนด Default ที่เสนอให้ใช้เป็นฐานการวางแผน**

1. **Mouse Aim + Aircraft Follow** เป็นรูปแบบหลัก; Mouse สั่งทิศทางที่ต้องการ ส่วน Flight Controller ควบคุมการหมุนและฟิสิกส์
2. **Space (Hold) = PSM Override**: ส่งสัญญาณความตั้งใจทำ PSM และผ่อนข้อจำกัดตามสมรรถนะเครื่องบิน ไม่ใช่เปิดฟิสิกส์อีกชุดหรือเล่น Animation
3. **High-AoA และ Stall เกิดได้จากฟิสิกส์เสมอ** แต่ใน Arcade Default มีระบบป้องกันไม่ให้กด Pitch ค้างแล้วหลุดเข้า Full PSM โดยไม่ตั้งใจ
4. **W/S = Hybrid Speed Assist**: กด W เพื่อเร่ง กด S เพื่อชะลอ ปล่อยปุ่มแล้วช่วยรักษาความเร็วล่าสุดเท่าที่ฟิสิกส์อนุญาต; **Shift = Afterburner, Ctrl = Airbrake**
5. **Keyboard-only ต้องเล่นได้จริง**: ใช้ลูกศรสำหรับ Pitch/Coordinated Turn พร้อม Virtual Stick / Rate Command และ Flight Envelope Protection; ไม่ส่ง Elevator 100% ตรงไปยัง Physics
6. **Orientation, Velocity, Angular Velocity ต้องแยกจากกัน**: หัวเครื่องสามารถหันออกจากทิศทางการเคลื่อนที่ได้โดยไม่หัก Velocity ตามทันที
7. **Drift เกิดจากการผสม Input + Momentum** ไม่ต้องกดปุ่มเริ่ม Drift โดยเฉพาะ; Space ใช้สำหรับ Post-Stall Control ขั้นรุนแรงเท่านั้น
8. **Camera เปลี่ยนพฤติกรรมอย่างต่อเนื่อง** ระหว่าง Normal, Drift และ PSM โดยแสดงมุมด้านข้างของลำตัวขณะไถล แต่ยังรักษาความสามารถในการเล็ง
9. **มี Preset Arcade (Default) และ Advanced** โดยใช้ Flight Physics ชุดเดียวกัน ต่างกันที่ Assistance / Envelope / Input Mapping
10. **ตรวจ Codebase เดิมก่อนแก้** โดยเฉพาะ Velocity Alignment, Mouse Aim, Roll/Yaw Control, Camera Follow, Speed Controller, Stall/PSM และ Fixed Timestep

> **การตัดสินใจที่ต้องแยกให้ชัด:** รายการข้างต้นคือ **ข้อเสนอ Design Default** จากการสนทนา ไม่ใช่การอนุมัติแก้ Codebase แล้ว ส่วนค่าตัวเลขในเอกสารเป็น **Initial Tuning Hypothesis** ต้องทดลองในเกมจริงก่อนกำหนด Final Balance

---

## 1. Product Goals และหลักออกแบบ

### 1.1 Player Experience

- **บินง่ายทันที:** ใช้เมาส์ชี้ไปในทิศที่ต้องการ เครื่องบินตามอย่างนุ่มนวล มี Auto Bank/Coordinated Turn และ Flight Envelope Protection
- **ทำ Drift ได้เป็นธรรมชาติ:** Roll + Pitch/Yaw + Airbrake สามารถสร้าง Nose–Velocity Separation ได้เมื่อเงื่อนไขเหมาะสม โดยไม่ต้องจำท่าสำเร็จรูป
- **ทำ PSM ขั้นสูงได้ง่าย:** กด Space พร้อม Pitch/Yaw/Roll เพื่อลดการจำกัด AoA และเพิ่ม High-AoA Control Authority อย่างต่อเนื่อง
- **Skill Ceiling สูง:** ผู้เล่นควบคุมจังหวะเริ่มหมุน หยุดหมุน สลับแกนหมุน ใช้ Afterburner Recovery และเชื่อมหลายท่าได้เอง
- **สวยจากมุมกล้อง:** กล้องเปิดมุมให้เห็นลำตัวไถล/หมุน แต่ไม่เหวี่ยงจนเมาส์เล็งเป้าผิดทิศ
- **Keyboard-only เป็น First-class Input:** ไม่ลงโทษผู้เล่นเพียงเพราะ Digital Input มีค่า 0 หรือ 1

### 1.2 Design Principles

| หลักการ | คำอธิบาย |
|---|---|
| Player Intent ≠ Raw Surface Deflection | W/S, Mouse, Arrow Keys ส่งความต้องการของผู้เล่น ไม่ใช่ Deflection 100% ให้ทุก Control Surface |
| One Flight Dynamics Model | Normal, Drift, High-AoA, PSM ใช้ Position/Velocity/Orientation/Forces/Torques ชุดเดียวกัน |
| Continuous Blending | Control Authority, Protection, Stabilization และ Camera ค่อย ๆ เปลี่ยน ไม่ Snap เมื่อผ่าน Speed Threshold |
| Momentum Preservation | การเปลี่ยน Nose ไม่เปลี่ยน Velocity ทันที; การเร่งและแรงอากาศพลศาสตร์ค่อย ๆ เปลี่ยนเส้นทาง |
| No Mandatory Animation Maneuvers | Cobra/Kulbit/Drift เกิดจาก Dynamics + Input; อาจมี Visual Assist แต่ห้ามยึด Simulation State ไว้กับ Animation |
| Readable Arcade Physics | ไม่ต้องจำลอง CFD หรือ Full 6-DOF แบบอากาศยานจริงทั้งหมด แต่ต้องสอดคล้องต่อเนื่อง และสมเหตุสมผลทางภาพ |
| Safe Defaults, Optional Mastery | Arcade เปิด Protection; Advanced ลด Protection หรือรองรับ Natural PSM Entry |
| Multiplayer Determinism | คำสั่งผู้เล่นและฟิสิกส์ต้องอัปเดตตาม Fixed Timestep; ไม่ขึ้นกับ Render FPS |

### 1.3 Non-goals (รอบ Rework นี้)

- ไม่มุ่งจำลอง Aerodynamics ทุกลำให้ตรงกับข้อมูลลับ/ข้อมูลจริงระดับ Flight Simulator
- ไม่สร้างปุ่มเฉพาะแยกสำหรับ Cobra, Kulbit, Drift, Bell ทุกท่า
- ไม่ทำการเคลื่อนที่แบบล็อก Animation หรือ Teleport Orientation/Velocity เพื่อให้ได้ท่า
- ไม่เปลี่ยนระบบยิง อาวุธ หรือ AI ทั้งหมดใน Rework นี้ ยกเว้นจุดที่ได้รับผลจากการเปลี่ยน Aim/Camera
- ไม่คัดลอกความเร็ว G หรือองศาจากวิดีโอเป็นตัวเลขทางฟิสิกส์โดยตรง

---

## 2. Video References และบทเรียนจากการสังเกต

### 2.1 Reference A — *AC7 Basic and Advanced Post-Stall Maneuvers*

คลิปที่วิเคราะห์ก่อนหน้า ความยาวประมาณ **4:30 นาที** ใช้เป็น Reference ด้านการทำ Maneuver และการเชื่อมท่า

| ช่วงวิดีโอโดยประมาณ | ท่า | Behavioral Reference |
|---|---|---|
| 00:18–00:53 | **Kulbit** | Pitch ต่อเนื่องผ่านแนวดิ่งและครบวงหมุน โดยโมเมนตัมยังมีอยู่ |
| 00:54–01:21 | **Pugachev's Cobra** | เชิด Nose สู่ High-AoA แล้วสั่งให้กลับก่อนครบวง |
| 01:30–02:14 | **Pedal Turn** | Rudder/Yaw เปลี่ยนทิศหัวเครื่องในสภาวะ High-AoA |
| 02:15–02:38 | **Drifting & Boosting** | หัวเครื่องหันก่อน Flight Path และใช้แรงขับเปลี่ยนเส้นทางต่อเนื่อง |
| 02:39–03:05 | **Reversing PSM** | Nose Reversal จนสวนแนวการเคลื่อนที่เดิมในบางจังหวะ |
| 03:06–03:41 | **PSM Chaining** | เปลี่ยนท่าต่อเนื่องโดยไม่มีจังหวะรีเซ็ตการหมุน |
| 03:51–04:17 | **Kvochur Bell** | เชิดเกือบแนวดิ่ง ความเร็วลด แล้วหมุนกลับ/Recover |

**ข้อสังเกต:** เวลาคือช่วงบทและตัวอย่าง ไม่ใช่ระยะเวลาทำ Maneuver จริงทั้งช่วง และจากกล้อง Chase ไม่สามารถยืนยันค่ามุม AoA/Sideslip หรือ Angular Velocity ได้แม่นยำ

### 2.2 Reference B — *Ace Combat 7 Is Very Realistic* (Jet Drifting)

คลิปความยาวประมาณ **11.17 วินาที** เป็น Reference ด้านความรู้สึกของ Jet Drift และกล้องใกล้สิ่งกีดขวาง

| ช่วงเวลาโดยประมาณ | พฤติกรรม |
|---|---|
| 0.0–2.5 s | Pitch-Up สูง / Cobra-like Movement และกลับสู่ท่าบิน |
| 2.5–4.25 s | Aggressive Roll และการตอบสนองของกล้อง |
| 5.0–7.25 s | บินใกล้สิ่งกีดขวางและทางยกระดับ |
| **7.25–9.5 s** | **Jet Drifting เด่นที่สุด**: ลำตัวหันเบี่ยงจากแนวการเคลื่อนที่ที่เห็นจากฉากแวดล้อม |
| 9.5–11.17 s | รักษา Drift/High-AoA ต่อเนื่อง มี Afterburner และคำเตือนเกี่ยวกับ Stall/ความสูง |

**บทเรียนหลัก:** ความสวยของ Jet Drifting เกิดจาก **การเห็น Nose, Body Orientation และ Flight Path แตกต่างกัน** รวมถึงการตอบสนองของกล้องที่ไม่ตาม Nose ทุกองศา

**ขอบเขตความน่าเชื่อถือของภาพ:** ไม่ควรตีความ Perspective/Camera Roll ว่าเป็น Aircraft Angular Motion ทั้งหมด; การทะลุ/เฉียดกำแพงในคลิปไม่ควรกลายเป็นข้อกำหนด Collision ของเกม

### 2.3 สิ่งที่นำมาใช้ และสิ่งที่ไม่ควรคัดลอก

**นำมาใช้:** Smooth Nose–Velocity Decoupling, Short-radius PSM, Drift Boost, PSM Chaining, Camera Angle Reveal, Energy-based Recovery

**ไม่ควรคัดลอกตรง ๆ:** ปุ่มตาม Ace Combat 7, Animation ระยะเวลาตายตัว, การเปลี่ยนทิศ Velocity ทันที, การทะลุผนัง, ตัวเลขสมรรถนะจาก HUD โดยไม่คำนึงถึงมุมกล้องและโมเดลเกม

---

## 3. Maneuver Catalog — พฤติกรรมที่เกมควรรองรับ

### 3.1 นิยามสถานะพื้นฐาน

- **Normal Flight:** ทิศหัวเครื่องค่อนข้างใกล้ Velocity, ใช้ Coordinated Turn และ Aerodynamic Control เป็นหลัก
- **High-G Turn:** เลี้ยวรุนแรงภายใต้แรง G และการบริหารความเร็ว อาจเกิด High-AoA แต่ไม่จำเป็นต้องเข้า Full PSM
- **High-AoA:** มุมระหว่างแกนลำตัวกับกระแสอากาศสูงขึ้น แรงยก/ต้าน/การควบคุมเปลี่ยนตามโมเดล
- **Drift / Sideslip:** มีองค์ประกอบความเร็วด้านข้างและ Nose–Velocity Separation สูงกว่าปกติ
- **Post-Stall:** High-AoA/Stall regime ที่ Conventional Control ประสิทธิภาพลด แต่ยังควบคุมท่าทางได้ผ่าน TVC/Assist ตาม Profile
- **Recovery:** ทำให้ Angular Rate ลดลง คืนเสถียรภาพและค่อย ๆ ฟื้นความเร็ว โดยไม่ Snap

> High-AoA เป็น **สถานะจาก Dynamics**; `PSM Override` เป็น **คำสั่ง Intent / Controller Permission**; `Drift` เป็น **พฤติกรรมการเคลื่อนที่** สามสิ่งนี้เกี่ยวข้องกันแต่ไม่ใช่คำเดียวกัน

### 3.2 รายการ Maneuvers พร้อมวิธีควบคุมที่เสนอ

| Maneuver | Input / Intent | Dynamic Behavior | เงื่อนไข/การจบ |
|---|---|---|---|
| **Pugachev's Cobra** | Space + Pitch Up; จากนั้นลด/กลับ Pitch | Nose เชิดเร็วกว่า Flight Path; AoA เพิ่ม; ความเร็วลด | สั่ง Pitch กลับก่อนหมุนครบวง; Recovery ต่อเนื่อง |
| **Kulbit** | Space + Pitch Up ต่อเนื่อง | Pitch หมุนผ่านแนวดิ่งโดยรักษา Velocity และ Angular Velocity | จบตาม Input/Energy/Authority ไม่ล็อก 360° Animation |
| **Pedal Turn** | Space + Pitch/Yaw (Q/E) | หัวเครื่องหมุนด้านข้างขณะ High-AoA; Sideslip สูง | ควบคุม Roll/Yaw Damping และ Recovery ไม่ให้ Flat Spin ง่ายเกินไป |
| **Herbst-like Turn** | Space + Pitch + Roll/Yaw | เปลี่ยน Nose Heading อย่างรวดเร็วด้วยการหมุนหลายแกน | Rate Control และ Camera ต้องนิ่งพอให้บังคับต่อ |
| **Banked Drift** | Roll + Pitch; อาจใช้ Ctrl | เครื่องเอียงและเลี้ยวขณะ Flight Path เปลี่ยนช้ากว่า Nose | ทำได้โดยไม่ต้องกด Space |
| **High-G Drift** | High-G Turn + Strong Pitch/Roll (+ Ctrl ถ้าต้องการ) | เกิด Nose–Velocity Separation เพิ่มชั่วคราว | คุม G/Energy และลด Authority ตามความเร็วสูง |
| **Jet Drift / Sideslip** | Mouse Yaw หรือ Q/E + Roll/Pitch ตามสภาวะ | หัวเครื่องชี้ออกจากทางที่กำลังเคลื่อนที่ | จำกัดระยะเวลา/องศาด้วยฟิสิกส์และ Energy; ไม่จำเป็นต้อง Space |
| **Drift Boost** | เริ่ม Drift แล้วกด Shift | Thrust ไปตาม Nose; Velocity ค่อย ๆ เปลี่ยนทิศ | กลับไปยัง Normal เมื่อการไถลลดลง |
| **Reversing PSM** | Space + Pitch/Yaw ต่อเนื่องจน Nose Reversal | Nose เปลี่ยน 180° ได้ แม้โมเมนตัมยังเคลื่อนทางเดิม | ต้องแยก Nose Reversal ออกจาก True Backward Flight |
| **Tail Slide** | เชิดชันจนความเร็วไปข้างหน้าต่ำ/เป็นลบชั่วคราว | อาจมี Air-relative Local Forward Speed ติดลบ; Gravity/Attitude มีผลมาก | Recovery ต้องรักษาแรงโน้มถ่วงและการลดอำนาจควบคุม |
| **Kvochur Bell** | Space + Pitch Up แล้วค่อยจัดท่าด้วย Rudder/Pitch | เชิดเกือบแนวดิ่ง ความเร็วลด จากนั้นหมุน/ตก/กลับ | ไม่ Freeze กลางอากาศ; ควบคุมได้ตาม Profile |
| **Falling Leaf** | High-AoA / Low-speed + สลับ Yaw/Roll อย่างควบคุม | ลดระดับพร้อมแกว่ง/ส่ายเป็นจังหวะ | ใช้จริงอย่างระมัดระวังใน Campaign/Advanced Challenges |
| **Flat Spin** | Sustained Stall + Yaw/Roll Imbalance | หมุนรอบแกนใกล้แนวดิ่งพร้อมสูญเสียความสูง | ไม่ควรเกิดง่ายใน Arcade Default; Advanced รองรับ Recovery |
| **PSM Chaining** | เปลี่ยน Pitch/Roll/Yaw ระหว่าง PSM | สืบทอด Velocity, Angular Velocity, AoA, Energy ข้ามท่า | ไม่มี Animation Gate หรือ Reset State |

**หมายเหตุเรื่องท่าชื่อเฉพาะ:** บางท่าจากวิดีโอมีลักษณะเป็น *arcade interpretation* ไม่จำเป็นต้องเข้ากับนิยามทางการบินจริงทุกขั้น โดยเฉพาะ Tail Slide, Bell, Falling Leaf และ Flat Spin ควรใช้เป็น Behavior Class พร้อมจูนแยก ไม่เหมารวมว่าเป็น PSM แบบเดียวกัน

### 3.3 แยก Skill Curve ของท่า

- **Beginner:** Normal Turn, High-G Turn, Banked Drift ระดับเบา
- **Intermediate:** Drift + Afterburner, Cobra, High-AoA Reversal
- **Advanced:** Kulbit, Pedal Turn, Herbst-like Turn, Bell, PSM Chaining
- **Optional Challenge:** Tail Slide, Falling Leaf, Flat Spin และ Recovery Exercises

**ข้อกำหนด:** ไม่ต้องสร้าง `startCobra()` / `startKulbit()` เป็นคำสั่งฟิสิกส์หลัก ท่าควรเป็นผลจากลำดับคำสั่งและ Dynamics ที่เหมาะสม; อาจมีระบบ *Maneuver Recognition* ภายหลังสำหรับ Tutorial, Score หรือ Mission Objectives โดยไม่ควบคุม Simulation แทนผู้เล่น

---

## 4. Input Mapping — Mouse + Keyboard และ Keyboard-only

### 4.1 Default: Mouse + Keyboard

| Input | Action | หมายเหตุ |
|---|---|---|
| Mouse X/Y | Desired Direction / Pitch–Yaw | Normal = Aim Follow; PSM = Blend ไปสู่ Angular Rate Command และ Edge Command |
| **A / D** | Roll Left / Right | Manual Roll ใช้ได้ทั้ง Normal และ PSM |
| **Q / E** | Rudder / Direct Yaw | Normal มี Coordination Assist; PSM เพิ่ม Yaw Authority |
| **W** (Hold) | Accelerate | เพิ่มแรงขับ/เปลี่ยนคำสั่งชดเชยความเร็ว ไม่ Teleport Speed |
| **S** (Hold) | Decelerate | ลด Throttle พร้อมเบรกอ่อนตาม Config; Ctrl คือ Airbrake เต็มบทบาท |
| **Shift** (Hold) | Afterburner | Override Power Command ตามเครื่องบินที่รองรับ |
| **Ctrl** (Hold) | Airbrake | ลด Throttle/Cruise Conflict; ใช้ช่วยเข้า Drift/PSM Envelope |
| **Space** (Hold) | **PSM Override** | ปลดข้อจำกัดบางอย่างแบบ Continuous Blend; ไม่ Trigger Animation |
| LMB | Gun | ตามระบบอาวุธเดิม |
| RMB | Missile | ตามระบบอาวุธเดิม |
| Mouse 4 (Optional) | Alternative PSM Bind | ไม่ตั้งเป็น Default เพราะเมาส์บางรุ่นไม่มี |

**Space ไม่ใช่ปุ่ม Recovery ตาม Default ฉบับนี้:** ก่อนหน้านี้เคยเสนอให้ Space เป็น Emergency Recovery แต่ข้อสรุปล่าสุดกำหนดให้ Space เป็น PSM Override จึงต้องย้าย Recovery Assist ไปเป็นระบบอัตโนมัติ/ปุ่มกำหนดใหม่หากจำเป็น เพื่อลด Key Conflict

### 4.2 Keyboard-only: ต้องรองรับอย่างจริงจัง

| Input | Action |
|---|---|
| **↑ / ↓** | Pitch Up / Pitch Down (Rate Command + Envelope) |
| **← / →** | Coordinated Turn Left / Right ใน Arcade; สามารถเปลี่ยนเป็น Direct Yaw ใน Advanced |
| **A / D** | Manual Roll Left / Right |
| **Q / E** | Direct Rudder Left / Right |
| **W / S** | Accelerate / Decelerate |
| **Shift / Ctrl** | Afterburner / Airbrake |
| **Space** | PSM Override |
| **J / K** (ตัวอย่างแก้ไขได้) | Gun / Missile สำหรับผู้เล่นไม่มีเมาส์ |

**หลักการ Keyboard-only:** กด ↑ ค้างไม่ควรหมายถึง Elevator เต็มกำลังแบบไม่มี Protection แต่หมายถึง **ขอ Pitch Rate สูงสุดที่อนุญาตภายใต้ Flight Envelope ปัจจุบัน**; เมื่อกด Space จึงเพิ่มช่วงคำสั่งและ Control Authority ให้เข้าสู่ PSM ได้ง่ายขึ้น

**Input conflicts:** ลูกศรซ้าย/ขวา (Coordinated Turn) กับ Q/E (Direct Rudder) ต้องมีนโยบายการรวมคำสั่ง/Clamp; ปุ่มตรงข้ามที่กดพร้อมกัน เช่น W+S ควรกำหนดให้ **Neutral / Cancel** โดย Default เพื่อผลลัพธ์คาดเดาได้ ไม่ใช่ Trigger PSM

### 4.3 Alternative PSM Keybinding

| Binding | สถานะที่แนะนำ | เหตุผล |
|---|---|---|
| **Space (Hold)** | **Default** | กดง่าย แยกจาก Speed/Brake/Afterburner |
| Shift + Ctrl | Optional | สไตล์เร่ง+เบรกแบบ Arcade แต่มี Key/Power Conflict ต้องจัด Priority |
| C (Hold) | Optional | ปุ่มเดียว แต่ตำแหน่งอาจไม่เหมาะกับทุกคน |
| Mouse Button 4 | Optional | สะดวกสำหรับเมาส์เกมมิ่ง |
| W + S | **ไม่ใช้เป็น Default** | W/S เป็น Speed Intent และอาจกดพร้อมกันโดยไม่ตั้งใจ |
| Double Tap Ctrl | ไม่แนะนำ | จับ Timing ยากและ Trigger ผิดโดยไม่ตั้งใจ |

**Input Priority Rule:** `PSM Override` ส่งเฉพาะคำสั่งลดข้อจำกัด Envelope; `Afterburner` ยังเป็น Engine Command; `Airbrake` ยังเป็น Drag Device Command; ห้ามให้ Override ทำหน้าที่เพิ่มความเร็วหรือเบรกเองโดยอัตโนมัติจากปุ่มเดียว

### 4.4 Input Shaping / Virtual Stick

- Digital Inputs ต้องมี **Rise/Release Rate** แยกกัน ไม่เปลี่ยน Control Demand 0→100% ในหนึ่ง Frame
- ค่าตั้งต้นเพื่อทดลอง: **Rise 120–200 ms**, **Release 100–180 ms**; ระหว่าง PSM สามารถลด Time Constant เพื่อให้ตอบสนองไวขึ้น
- Input Shaping เพียงอย่างเดียว **ไม่** แก้ปัญหากดค้าง เพราะในที่สุด Demand จะถึง 100%; ต้องมี Envelope/Rate Protection
- ใช้ **Desired Angular Rate** หรือ **Desired Attitude** เป็นชั้นกลางก่อนออก Torque/Surface Command
- รองรับ Keybinding Remap และตรวจ Key Ghosting / Keyboard Rollover รวมถึง Focus Loss และ Resume

---

## 5. PSM Entry Design — Hybrid Physics + Intent

### 5.1 แนวทางที่เลือก

**Default: Protected Natural High-AoA + Intent-based Full PSM.**

- Physics คำนวณ AoA, Stall, Drag และการควบคุมจริงตลอดเวลา แม้ไม่ได้กด Space
- ใน **Normal Arcade Flight** เมื่อผู้เล่นกด Pitch Up ค้าง ระบบช่วยจำกัด Excessive AoA / Angular Rate / G เพื่อไม่เผลอทำ Kulbit
- **Space (Hold)** ส่ง `psmIntent=1` และให้ Flight Controller เพิ่ม Control Authority กับลด Envelope Protection ตามความเร็ว/AoA/เครื่องบิน
- ไม่ใช้ `isPSM` แบบเปิด/ปิดเพื่อสลับชุดฟิสิกส์ ให้คำนวณ `psmAuthority ∈ [0,1]` และ Blend ด้วย Time Constant
- ปล่อย Space = ลด Override แบบ Smooth; ไม่ Snap Orientation, Velocity หรือ Angular Velocity กลับ Normal

### 5.2 Normal / PSM Control Policy

| ระบบ | Normal Arcade | PSM Override |
|---|---|---|
| Mouse | Desired Direction | Blend ไป Angular Rate / Edge Command |
| Pitch Rate | จำกัดตาม G, AoA, Dynamic Pressure | ขยายเพดานตามสมรรถนะและ Energy |
| Yaw / Rudder | Coordinated / จำกัด Sideslip | Direct Yaw Authority เพิ่มสำหรับบางลำ |
| Auto Bank | เปิด ช่วยเลี้ยว | ลดลงเพื่อไม่ต้าน PSM |
| AoA Protection | สูง | ผ่อนคลาย ไม่ปิด Aerodynamics |
| Velocity Alignment Assist | ระดับน้อยที่เหมาะกับ Arcade | ลดลงชั่วคราว แต่ไม่ใช่การปิด Drag จริง |
| Auto Recovery | เปิด | ไม่แย่งคำสั่งขณะ Hold; เริ่มช่วยเมื่อปล่อย/สูญเสียการควบคุม |
| Engine / Speed Hold | ปกติ | ระงับ Speed Hold ชั่วคราว |
| Energy Loss | ตามโมเดลแรง | สูงขึ้นตาม Drag, AoA และการเคลื่อนไหว |

### 5.3 Natural PSM Entry — Advanced Option

ผู้เล่น Advanced อาจเปิด `Natural PSM Entry` ให้ระบบยอมเข้าสู่ Full PSM ได้โดยไม่กด Space เมื่อมีสัญญาณ Intent หลายอย่างร่วมกัน เช่น Airspeed ใน Envelope, Pitch/Yaw Demand สูง, AoA กำลังเพิ่ม, Airbrake/Control Inputs และลักษณะเครื่องบินสนับสนุน

**อย่าใช้เพียง `pitchInput === 1` หรือ `speed < threshold`** เป็นตัวสั่ง PSM เพราะจะทำให้ Keyboard-only เข้า PSM โดยไม่ได้ตั้งใจ

### 5.4 ตัวอย่างลำดับ PSM

- **Cobra:** ลดสู่ Envelope ที่เหมาะสม → Space + Pitch Up → ลดหรือย้อน Pitch ก่อนหมุนครบ → ปล่อย Space → Recover
- **Kulbit:** เหมือน Cobra แต่รักษา Pitch Up ต่อเนื่อง → หมุนต่อผ่านแนวดิ่ง → ใช้ Control Input จัดท่าตอนจบ
- **Pedal Turn:** เริ่ม High-AoA ด้วย Space + Pitch → สั่ง Q/E → ใช้ Roll/Pitch คุมแกนหมุน → Align/Boost/Recover
- **PSM Chaining:** ไม่ Reset Physics; เปลี่ยน Pitch, Roll, Yaw ต่อเนื่อง → ยอมให้ Energy/Authority ลดลงตามการใช้งาน

---

## 6. W/S Speed Control — Hybrid Speed Assist

### 6.1 เปรียบเทียบ Design Options

| Mode | จุดแข็ง | ข้อเสีย |
|---|---|---|
| Target Speed (W/S เพิ่ม-ลดตัวเลข Target) | เข้าใจง่ายและคงความเร็วดี | ค่าความเร็วเป้าหมายกับความเร็วจริงอาจต่างกัน; ช่วง PSM มีการเร่งสวน |
| Manual Throttle | คุมพลังงานละเอียด เหมาะสาย Simulation | ใช้ Input เยอะ; ต้องปรับกำลังเครื่องบ่อยขณะ Dogfight |
| **Hybrid Speed Assist (Default)** | **W/S เป็นคำสั่งเร่ง/ชะลอโดยตรง และปล่อยแล้วช่วยคงความเร็ว** | ต้องออกแบบ Capture Target, Anti-Windup, Priority และ Recovery อย่างระวัง |

### 6.2 พฤติกรรมที่ควรได้

1. **W Hold:** ขอแรงขับเพิ่ม / Rate Command เพื่อเร่งตาม Physics; ไม่แก้ `velocity` โดยตรง
2. **S Hold:** ขอชะลอโดยลด Throttle และใช้ Brake อ่อนถ้าคอนฟิกเปิด; Ctrl เป็น Airbrake โดยตรงและแรงกว่า
3. **Release W/S:** จับ **Current Airspeed** เป็น `cruiseTargetSpeed` แล้ว Auto-Throttle ช่วยคงความเร็วเท่าที่แรงขับ/แรงต้าน/การบินอนุญาต
4. **Shift:** Afterburner Override; เมื่อปล่อย Shift กลับเข้าสู่ Speed Assist ตามนโยบายเดิมโดยไม่กระชากแรงขับ
5. **Ctrl:** Airbrake Priority เหนือ Cruise Hold; Auto-Throttle ต้องไม่เพิ่มกำลังเพื่อชดเชยเบรกเต็มที่
6. **Space / Active PSM:** Suspend Cruise Hold; ให้ Pilot Engine Input ทำงาน และไม่เร่งเพื่อไล่ความเร็วเป้าหมายเก่าระหว่าง High-AoA
7. **Recovery:** กลับมา Enable Cruise Hold เมื่อเครื่องบินเสถียร และ **Capture ความเร็วใหม่** แทนเร่งกลับไปหาค่าก่อนทำ PSM ทันที
8. **Manual Throttle:** เปิดเป็น Optional Advanced Control Preset โดยใช้ W/S เพิ่ม/ลด Throttle Setting แทน Hybrid

### 6.3 Input Priority / Speed Controller

| สถานะปุ่ม/สถานการณ์ | พฤติกรรม Default |
|---|---|
| W เท่านั้น | Accelerate |
| S เท่านั้น | Decelerate |
| W+S | Neutral / ไม่ปรับ Speed Intent |
| W/S ปล่อยทั้งหมด | Cruise Hold หากสถานะบินเสถียร |
| Shift | Afterburner ระหว่างกด; Controller รู้สถานะ Override |
| Ctrl | Airbrake; ระงับการเร่งชดเชยจาก Cruise Hold |
| Shift+Ctrl | ไม่ใช้เป็น PSM Default; นิยาม Priority Engine/Brake แยกชัดเจน |
| Space | PSM Intent; Suspend Cruise Hold ไม่สั่ง Afterburner |
| Stall/Low-speed Recovery | ป้องกัน Auto-Throttle Windup; Recovery Assist ทำงานแบบจำกัดและคาดเดาได้ |

**คำเตือน:** Speed Hold เป็น **Controller** ไม่ใช่การตั้ง `speed = target` และไม่ควรรักษาความเร็วได้เมื่อกำลังเครื่อง/แรงขับไม่พอหรือเครื่องบินกำลังเสียพลังงานรุนแรง

### 6.4 Speed / Unit Convention

- ฟิสิกส์ภายในใช้ **m/s**, แสดงผล HUD เป็น **km/h** ได้ตามความต้องการ
- ใช้ **Airspeed (velocity relative to wind/air mass)** เป็นหลักใน Stall/PSM Envelope; ไม่ใช้ Ground Speed เป็นตัวตัดสิน PSM
- หากอนาคตต้องการความถูกต้องระดับสูงขึ้น ให้แยก IAS/EAS/TAS/Mach, Dynamic Pressure, Altitude และ Engine Performance; ระหว่างนี้ใช้ Arcade Proxy อย่างสม่ำเสมอ

---

## 7. Flight Physics — Core Architecture

### 7.1 State ที่ต้องแยก

```ts
interface FlightState {
  positionWorld: Vector3;
  orientationWorld: Quaternion;
  velocityWorld: Vector3;
  angularVelocityBody: Vector3;

  airVelocityWorld: Vector3;   // velocity - wind
  airspeedMS: number;
  angleOfAttackRad: number;   // signed alpha
  sideslipRad: number;        // signed beta
  noseVelocityAngleRad: number;
  gLoad: number;
  energy: number;             // gameplay abstraction, if used
}
```

**ต้องไม่ทำสิ่งนี้:**

```ts
// BAD: turns the entire velocity vector instantly with the aircraft nose
velocityWorld.copy(forwardWorld.multiplyScalar(speedMS));
```

### 7.2 หลัก Dynamics

กำหนด Force/Acceleration ใน World Space และ Torque/Angular Dynamics ใน Body Space อย่างสอดคล้องกัน

\[
\frac{d\vec v}{dt}=\frac{\vec F_{thrust}+\vec F_{lift}+\vec F_{drag}+\vec F_{side}+\vec F_{assist}}{m}+\vec g
\]

โดย `F_assist` เป็น Gameplay Assist ที่ **จำกัดขนาดและเปลี่ยนอย่างต่อเนื่อง** ไม่ใช่ Teleport ทิศทาง Velocity และ `F_side` / Damping ต้องไม่ซ้ำซ้อนกับแรง Aerodynamic ที่มีอยู่แล้ว

การหมุนต้องเก็บ Angular Velocity ต่อเนื่องและคำนวณผลของ Torque / Rate Controller โดยไม่ Reset เมื่อเปลี่ยนจาก Cobra ไป Kulbit

### 7.3 AoA, Sideslip และ Nose–Velocity Separation

- คำนวณ **Signed AoA (α)** จาก Air-relative Velocity ในกรอบแกนลำตัวและแกน Pitch
- คำนวณ **Signed Sideslip (β)** จากองค์ประกอบด้านข้าง เทียบกับแนวลำตัว
- คำนวณ **Nose–Velocity Angle** สำหรับ Camera/HUD แต่ **ไม่ถือว่าเท่ากับ AoA** โดยอัตโนมัติ เพราะมุมนี้รวมการเบี่ยงในหลายแกน
- เมื่อ Airspeed ใกล้ศูนย์ ให้ใช้ Threshold/Hysteresis เพื่อเลี่ยงค่า Angle กระโดดและ `atan2` ไม่เสถียร

### 7.4 Angular Rate Controller / Input Intent

Pipeline ที่เสนอ:

```text
Physical Input (Mouse / Keys / Gamepad)
    -> Intent Normalization + Input Shaping
    -> Aim / Desired Rate Resolver
    -> Flight Envelope + PSM Authority + Aircraft Profile
    -> Angular Rate / Attitude Controller
    -> Control Surfaces + TVC / Arcade Assist Torques
    -> Force/Torque Integration (fixed dt)
    -> Position, Orientation, Velocity, Angular Velocity
    -> Telemetry / HUD / Camera
```

ควรใช้ **PD/Rate Control ที่มี Saturation, Anti-Windup, Torque Limits และ Damping** เพื่อให้ผู้เล่นสามารถเริ่มหมุน หยุดหมุน และเปลี่ยนแกนได้ ไม่ใช่แค่ทำให้อัตราหมุนสูงขึ้นเสมอ

### 7.5 Momentum-Preserving Jet Drift

- อนุญาตให้ **Body Heading** และ **Flight Path** ต่างกันชั่วคราว
- ลดการช่วยบังคับ Alignment ในช่วง Drift แต่ **ไม่ปิดแรงอากาศพลศาสตร์จริงทั้งหมด**
- เมื่อใช้ Afterburner ให้แรงขับไปตามทิศหัวเครื่อง แล้วค่อย ๆ เปลี่ยน Velocity
- ไม่ใช้ Lerp/Slerp ของ Velocity ไปทาง Forward แบบแรงเกินไปเพื่อลบ Drift
- ระวังการใช้ Lateral Damping ซ้ำสองครั้ง ถ้าระบบ Stall/Drag มี Sideforce อยู่แล้ว
- แยก Ground/Obstacle Collision ออกจาก Camera Collision และอย่าให้โมเดลปีกทะลุผนังเพราะกล้องสวย

### 7.6 Flight Envelope และ Energy

- ความเร็วสูง: Dynamic Pressure สูง, G/Control Limit และแรงต้านต้องจำกัดการหมุนเกินเหตุ
- ความเร็วกลาง: ทำ High-G Drift และ High-AoA ได้ง่าย
- ความเร็วต่ำ: Stall/Recovery/TVC/Gravity มีบทบาทมากขึ้น; ไม่ควรอนุญาตเครื่องบินทุกลำหมุนควบคุมได้เหมือนกัน
- Energy Loss ต้องขึ้นกับ Drag, Airspeed, Orientation, Input และ Engine ไม่ใช่หัก Energy แบบคงที่ทุกท่าเท่ากัน
- หากมี Arcade Energy Meter ให้ใช้เป็นตัว Balance เสริม โดยไม่ทดแทน Velocity/Gravity ทั้งหมด

### 7.7 Important Physics Edge Cases

- **Nose Reversal ≠ Backward Flight:** หัวเครื่องหันสวน Velocity ไม่ได้แปลว่าเครื่องบินเคลื่อนถอยหลังสัมพัทธ์กับลำตัวเสมอ
- **Tail Slide:** ให้ Local Forward Velocity ติดลบได้ช่วงสั้น ๆ เฉพาะ Model ที่รองรับ และต้องมีแรงโน้มถ่วง/การควบคุมที่เหมาะสม
- **Flat Spin/Falling Leaf:** ควรแยกจาก Maneuver ที่ควบคุมได้สมบูรณ์; Arcade Assist ป้องกันการติด Spin โดยไม่ตั้งใจ
- **Engine AB + Airbrake:** Physics ไม่ควรทำให้แรงหักล้างทันทีแบบไม่สมจริง; Controller ต้องมี Priority และ Power Limits

---

## 8. Speed Envelope และ PSM / Drift Tuning

> **ทุกตัวเลขในหัวข้อนี้เป็นค่าเริ่มต้นสำหรับ Playtest เท่านั้น** ไม่ใช่ขีดจำกัดเครื่องบินจริงหรือค่าที่วัดจากวิดีโอ

### 8.1 Proposed Speed Bands

| Airspeed | Gameplay Behavior |
|---|---|
| ต่ำกว่า ~250 km/h | Near Stall, Recovery, Bell/Tail Slide (เฉพาะบางลำ) |
| 250–350 km/h | Low-speed High-AoA, PSM Authority เพิ่มขึ้นตามสภาวะ |
| **350–500 km/h** | **Primary Full-PSM Window** สำหรับลำที่รองรับ |
| 500–700 km/h | High-G Drift, Limited Cobra / Reduced PSM Authority |
| มากกว่า ~700 km/h | High-speed Normal Flight, High-G Turn; ลด Full PSM อย่างต่อเนื่อง |

### 8.2 Example PSM Authority Curve

| Airspeed (km/h) | Authority สำหรับต้นแบบ Full-PSM Aircraft |
|---:|---:|
| 200 | 15% |
| 300 | 55% |
| 350 | 85% |
| 400 | 100% |
| 450 | 100% |
| 500 | 100% |
| 550 | 80% |
| 600 | 55% |
| 650 | 25% |
| 700 | 5% |
| 800 | 0% |

ตัวเลขข้างบนเป็นตัวอย่างของ **ส่วนเพิ่ม Assist/Authority** ไม่ใช่สั่งให้เครื่องบินทุกลำเสียการควบคุมทันทีที่หมด Assist; ความสามารถพื้นฐานยังขึ้นกับ Control Surface, TVC, Engine และ Dynamic Pressure

### 8.3 Initial Tuning Table

| Parameter | Initial Hypothesis |
|---|---|
| PSM Entry Blend | 0.15–0.30 s |
| PSM Recovery Blend | 0.25–0.50 s |
| High-AoA Assist เริ่มมีบทบาท | ราว 20–30° AoA |
| PSM Pitch Rate Limit | ทดลอง 100–160 °/s |
| PSM Yaw Rate Limit | ทดลอง 60–110 °/s |
| Cobra Region | ทดลอง 70–110° AoA (ขึ้นกับ Flight Model) |
| Drift Target Offset | ทั่วไป 25–55°; สูงกว่านี้สำหรับ Advanced/บางลำ |
| Drift Hold Feel | ประมาณ 0.5–1.5 s ที่ยังมองเห็น Sideslip |
| Normal Lateral Damping | ตัวอย่าง 1.3–2.2 s⁻¹ ถ้าไม่มี Sideforce ซ้ำ |
| Drift Lateral Damping | ตัวอย่าง 0.3–0.7 s⁻¹ ถ้าไม่มี Sideforce ซ้ำ |
| Digital Input Rise | 120–200 ms |
| Digital Input Release | 100–180 ms |

**ข้อควรระวัง:** บางค่าข้างบนขัดกันได้เมื่อรวมกับโมเดลปัจจุบัน เช่น Rate Limit สูงกับ Torque ต่ำ หรือ Lateral Damping กับ Aero Sideforce ซ้ำ ควรจูนเป็นกลุ่ม ไม่คัดลอกลง Config ทั้งหมดพร้อมกัน

---

## 9. Camera Rework — Cinematic Chase Camera

### 9.1 เป้าหมายกล้อง

- Normal Flight: เล็งง่าย อ่านตำแหน่งศัตรูและทิศบินชัด
- Drift: เห็นปีกและด้านข้างลำตัว ขณะที่ Body Direction เบี่ยงจาก Flight Path
- PSM: เห็นมุมการหมุนของเครื่องกับเส้นขอบฟ้า โดยไม่มี Motion Sickness หรือ Reticle Snap
- Near Obstacles: ไม่ให้กล้องทะลุผนัง/ภูเขา/พื้น; ไม่ใช้มุมสวยแลกกับการบังคับที่มองไม่เห็นทาง

### 9.2 Three Blended Camera Behaviors

| Parameter | Normal Chase | Dynamic Drift | PSM Cinematic |
|---|---:|---:|---:|
| Nose Orientation Reference | ~90% | ~55% | ~75% |
| Flight-path Reference | ~10% | ~45% | ~25% |
| Roll Follow | ~60% | ~30% | ~20% |
| Camera Lag | ~0.12 s | ~0.20 s | ~0.24 s |
| Base FOV | ~88° | ~94° | ~96° |

**หมายเหตุ:** Nose/Velocity Weight คือแนวทางในการออกแบบ **Camera Desired Direction** ไม่ใช่นำ Quaternion สองอันมาบวกถ่วงน้ำหนักโดยตรง หาก Velocity ต่ำ ใกล้ศูนย์ หรือชี้สวน Nose ให้ใช้ Fall-back, Clamping, Up-vector และ Smoothing เพื่อกันกล้องพลิก

### 9.3 Procedural Camera Behaviors

1. **Normal:** กล้องอยู่ด้านหลัง/สูงกว่าเครื่องเล็กน้อย; Roll Follow ตามสัดส่วน; Aim สม่ำเสมอ
2. **Drift Entry:** เมื่อ Nose–Flight Path Angle เพิ่มขึ้น กล้องตาม Nose ช้าลงเล็กน้อย และเปิดมุมให้เห็นด้านข้างเครื่อง
3. **Sustained Drift:** Blend Reference ตาม Velocity บางส่วน แต่จำกัดความเบี่ยงจากด้านหลังเครื่องราว **20–30°** ช่วงแรกเพื่อรักษาการเล็ง
4. **Drift Boost / Recovery:** เมื่อ Velocity เริ่มตาม Nose และ Angular Rate ลดลง กล้องค่อย ๆ กลับ Normal
5. **Cobra/Kulbit:** ลด Roll Follow/ปรับระยะอย่างระมัดระวัง เพื่อให้เห็นรูปทรงการหมุนและเส้นขอบฟ้า
6. **Afterburner:** เพิ่ม FOV เล็กน้อย (เช่น +4–8°, จำกัดรวมประมาณ 104°) โดยไม่ทำให้ Aim Cone ผิดความรู้สึก
7. **Collision:** ใช้ Spring Arm / Camera Ray/Sphere Cast กับฉาก; ลดระยะเมื่อกล้องใกล้ผนังและคืนระยะอย่าง Smooth

### 9.4 Camera/Flight/Aim Separation

ควรแยกสามชั้น:

- **Flight Controller:** กำหนด Physics และ Orientation ของเครื่อง
- **Aim Controller:** แปลง Input ให้เป็น Intent ใน World/Camera Space ที่นิยามชัดเจน
- **Camera Controller:** วางกล้องตามตัวแปรการบินเพื่อให้อ่านการเคลื่อนไหวได้

**ข้อห้ามสำคัญ:** การเปลี่ยนกล้อง **ห้ามแก้ Flight Velocity, Angular Velocity หรือ Aim World Target** โดยตรง มิฉะนั้นจะเกิด Mouse Aim สะบัด/กลับทิศเมื่อเข้าสู่ Drift หรือ PSM

### 9.5 Camera Stability / Comfort

- Blend Camera Weights ด้วย Critically Dampened Spring หรือ Smoothing ที่ไม่ขึ้นกับ FPS
- ใช้ Angular Clamp/Hysteresis เพื่อไม่ให้ Mode สลับสั่นเมื่อ Drift Angle อยู่ใกล้ Threshold
- Camera Horizon Stabilization เปิด/ปิดได้ตาม Setting
- Screen Shake ใช้น้อย; ควรสื่ออารมณ์ผ่าน Parallax, Camera Lag และ FOV มากกว่าแรงสั่น
- มีตัวเลือกลด Camera Motion / Lock Horizon สำหรับ Accessibility

---

## 10. HUD / Telemetry / Feedback

### 10.1 HUD ที่ควรมี

| UI | ความสำคัญ | เหตุผล |
|---|---|---|
| Actual Airspeed (km/h) | Must | ผู้เล่นรู้ความเร็วจริงก่อนทำ PSM |
| `PSM READY` | Should | แจ้งเมื่อเครื่องอยู่ในเงื่อนไขเหมาะสมสำหรับ PSM Override |
| PSM Assist/Override Indicator | Should | แยกสิ่งที่ผู้เล่นสั่งจากความสามารถจริงของเครื่อง |
| Aim Reticle / Nose Reference | Must | แสดงทิศที่ผู้เล่นต้องการหรือหัวเครื่องกำลังเล็ง |
| Flight Path Indicator | Should | ให้เห็นว่าเครื่องกำลังเคลื่อนที่ไปทางไหน ต่างจาก Nose |
| Stall / Low Energy Warning | Must | สื่อความเสี่ยงจากการทำ High-AoA ต่อเนื่อง |
| G / AoA / Sideslip (Advanced HUD) | Optional | ช่วย Tuning และผู้เล่นชำนาญ |
| Drift Intensity Visual | Optional | ให้ Feedback ต่อ Sideslip และ Maneuver State |

**ข้อควรระวัง:** `PSM READY` เป็นตัวบอกโอกาสทำท่าได้ดี ไม่ใช่รับประกันว่ากด Space แล้วจะทำท่าได้สำเร็จทุกสภาวะ

### 10.2 Debug Overlay สำหรับ Developer

บันทึกอย่างน้อย: Airspeed, Velocity Vector, Body Forward, AoA, Beta, Nose–Velocity Angle, Pitch/Yaw/Roll Rate, G-load, PSM Intent, PSM Authority, Camera Blend Weights, Engine Throttle, Airbrake, Drift State, Speed Hold State, Flight Controller Saturation

ควรมี **Replay / Telemetry Capture** สำหรับเปรียบเทียบ Input Sequence และปรับ Tuning โดยไม่พึ่งความรู้สึกอย่างเดียว

---

## 11. Aircraft-specific Profiles & Balance

ทุกลำใช้ Flight Architecture เดียวกัน แต่มี Envelope/Authority/Assist แตกต่างกัน โดยไม่จำเป็นต้องทำให้ทุกลำทำ Full PSM ได้

| Aircraft | Identity / Control Character ที่เสนอ | PSM Policy |
|---|---|---|
| **Su-57** | High-AoA, Multiaxis Post-Stall Control, Pedal Turn, Chaining | Full PSM, Yaw/Pitch Authority สูง |
| **F-22** | Pitch PSM, Cobra/Kulbit, Controlled Reversal, Recovery | Full PSM แต่ไม่ให้ Direct TVC Yaw เหมือน Su-57 |
| **Su-35** | High-AoA และ Post-Stall Agility | Full/High PSM ตาม Balance |
| **F/A-18** | High-AoA Handling, Low-speed Turning | Limited/Medium PSM Assist |
| **F-16** | Responsive High-G/Energy Fighter | High-G/Drift เป็นหลัก, Full PSM จำกัด |
| **F-15** | Speed/Climb/Energy | High-G/Drift จำกัดตาม Variant |
| **F-14** | Momentum/Variable-sweep Handling | Drift ต้องบริหาร Energy; Full PSM จำกัด |
| **F-35** | Stable Control/Multirole | ไม่มี TVC แบบ F-22/Su-57 ในโปรไฟล์หลัก; PSM จำกัด |
| **JAS 39 / F-2 / MiG-35 / อื่น ๆ** | สร้าง Identity ต่างกันตาม Profile | ทดสอบและจูนทีละรุ่น |
| **YF-23 / เครื่องต้นแบบ** | ใช้ความโดดเด่นเฉพาะใน Campaign/Test Flight | ไม่ให้เก่งทุกมิติโดยไม่มี Tradeoff |

**ข้อควรระวัง:** ตารางนี้คือ **Gameplay Identity Proposal** ไม่ใช่ Performance Data ที่ยืนยันทางวิศวกรรมสำหรับทุกเครื่อง/ทุก Variant

### 11.1 Sample Aircraft Tuning Schema

```ts
interface AircraftFlightTuning {
  maxNormalPitchRateDegS: number;
  maxNormalYawRateDegS: number;
  maxPSMPitchRateDegS: number;
  maxPSMYawRateDegS: number;
  psmAuthorityVsAirspeed: Array<[number, number]>;
  aoaProtectionNormalDeg: number;
  highAoAControlGain: number;
  tvcPitchAuthority: number;
  tvcYawAuthority: number;
  driftAssistStrength: number;
  lateralDampingMultiplierInDrift: number;
  recoveryAssistStrength: number;
  speedAssistConfigId: string;
}
```

ควรแยก **Physical Capability**, **Arcade Assistance** และ **Presentation Camera** เป็นคนละ Config เพื่อไม่ให้การปรับกล้องทำให้สมดุลการบินเปลี่ยนโดยไม่ตั้งใจ

---

## 12. Architecture / Module Responsibilities (Proposed)

> ชื่อไฟล์/โมดูลต่อไปนี้เป็นเพียง **Logical Modules** ไม่ใช่การยืนยัน Path หรือ Structure ของ Repository ปัจจุบัน ต้อง Map กับ Codebase จริงก่อน

| Module | Responsibility |
|---|---|
| `input/` | Keyboard/Mouse binding, conflict handling, Virtual Stick, smoothing |
| `aim/` | Desired Direction, Mouse Edge Command, aim stabilization, cursor handling |
| `flight/intent/` | Translate pilot intent → Normal/High-G/PSM control requests |
| `flight/envelope/` | Speed, AoA, G, Stall, PSM Authority, capability limits |
| `flight/control/` | Desired angular rate/attitude → control torque/surfaces/TVC |
| `flight/dynamics/` | Forces, angular dynamics, gravity, airspeed, state integration |
| `flight/speed/` | Hybrid Speed Assist, Auto-Throttle, AB/Airbrake priority |
| `flight/stall/` | High-AoA/Stall/Spin/Tail Slide dynamics and recoverability |
| `camera/` | Chase, Drift, PSM, cinematic blend, collision avoidance |
| `hud/` | Airspeed, Aim, FPI, Stall Warning, PSM Ready |
| `telemetry/` | Replays, debug overlay, acceptance logging |
| `content/aircraft/` | Per-aircraft control/physics/assist tuning |

### 12.1 Recommended Simulation Update Order

```text
1. Sample Inputs -> Normalize / shape / resolve conflicts
2. Resolve Aim / Desired Angular Rates
3. Compute air-relative Flight State (speed, AoA, sideslip, G)
4. Calculate Envelope / PSM Intent / Authority
5. Calculate Rate Controller outputs / TVC / Control Surfaces
6. Calculate aerodynamic forces, engine thrust, drag, gravity
7. Integrate velocity, angular velocity, position, orientation (fixed dt)
8. Resolve collision and update authoritative flight state
9. Emit telemetry / camera presentation state / HUD
10. Interpolate for render
```

**การซิงก์ Multiplayer:** ส่ง Player Inputs/Intent เป็นหลักเมื่อออกแบบ Prediction/Authoritative Simulation; Camera เป็น Local Presentation ไม่ควรทำให้ผล Simulation ต่างกันตามผู้เล่นหรือ Frame Rate

---

## 13. Implementation Roadmap — ควรทำอะไรก่อนหลัง

### Phase 0 — Codebase Audit & Baseline

**ตรวจ:**

- มีการทำ `velocity = forward * speed` หรือ Velocity Alignment แบบ Hard/Snap หรือไม่
- `Mouse Aim / Virtual Stick` เป็น Desired Attitude, Rate หรือ Surface Deflection กันแน่
- Auto Bank / Roll Follow / Rudder Coordination แย่ง Input ผู้เล่นหรือไม่
- Stall/PSM ใช้ Force/Torque ต่อเนื่องหรือ Scripted Pose/State Gate
- Speed Controller ปัจจุบันใช้ Target Speed กับ Throttle อย่างไร
- Camera Orient/LookAt อิง Nose หรือ Velocity และส่งผลกลับไปยัง Aim หรือไม่
- Collision, Physics Timestep และ FPS Independence มีข้อจำกัดอะไร

**Deliverable:** Architecture Review + Baseline Telemetry + Existing-vs-Target Behavior Matrix

### Phase 1 — Physics Consistency / Decoupling

- ตรวจ State Coordinate Systems และ World/Body Transform
- แยก Velocity กับ Orientation; รักษา Angular Velocity
- ลบ Hard Alignment ที่ทำให้ Drift หาย (หรือจำกัดเป็น Arcade Assist ที่ Blend ได้)
- ทำ AoA/Beta/Nose–Velocity Telemetry + Low-speed Safeguards
- เพิ่ม Unit Tests สำหรับ Rotation/Velocity/Gravity/Stall Edge Cases

**Exit Criteria:** หมุน Nose รุนแรงแล้ว Velocity ไม่หักตามทันที; ไม่เกิด Numerical Instability

### Phase 2 — Input / Aim / Keyboard-only Rework

- Implement Pilot Intent Layer, Digital Input Shaping, Angular Rate Controller
- Normal Mouse Aim + Edge Command และการ Recenter/Transition ไป PSM
- Keyboard-only Arrow Coordinated Turn + Manual Roll/Rudder
- Conflict Resolution/Keybinding และ Focus Loss Handling

**Exit Criteria:** ผู้เล่นกด Pitch ค้างใน Normal ไม่ทำ Full PSM โดยไม่ตั้งใจ; Keyboard-only ทำ Normal Dogfight ได้

### Phase 3 — PSM Override / Envelope / Recovery

- Space Hold → PSM Intent, Authority Blend, Envelope Protection Relaxation
- Aircraft Capability Gates และ Energy-aware Rate/Torque Limits
- Cobra, Kulbit, Pedal Turn, Herbst-like Turn, PSM Chaining จาก Physics
- Smooth Recovery เมื่อปล่อย Space

**Exit Criteria:** ทำ PSM ที่สนใจได้โดยไม่เกิด Snap/Teleport, เปลี่ยนท่าระหว่างทางได้

### Phase 4 — Hybrid Speed Assist

- W/S Accelerate/Decelerate, Release Capture / Cruise Hold
- AB/Airbrake Priority / Cruise Suspend During PSM
- Low-speed Recovery, Anti-Windup, Physical Throttle Constraints
- Advanced Manual Throttle Preset

**Exit Criteria:** ลดความเร็วเข้า PSM ได้ง่าย; ไม่เกิด Auto-Throttle เร่งสวนเบรก/PSM

### Phase 5 — Drift Physics / Camera / HUD

- Jet Drift / High-G Drift / Banked Drift และ Drift Boost
- Smooth Nose/Velocity Camera Blend + Camera Collision
- FPI / PSM READY / Stall Feedback / Debug UI
- Camera Accessibility Options

**Exit Criteria:** Drift สวยและบังคับได้ โดย Reticle ยังเสถียรและไม่ชนกล้องทะลุกำแพง

### Phase 6 — Aircraft Balance / Campaign / Multiplayer Validation

- จูน F-22 และ Su-57 ก่อน แล้วขยายรุ่นอื่น
- ปรับ Presets Arcade/Advanced และ Mission/Tutorial Challenges
- Fixed-step Cross-FPS Tests และ Multiplayer Input/State Synchronization
- Performance Test กับ Camera/Telemetry/Physics Cost

**Exit Criteria:** สมรรถนะต่างกันตามเครื่อง มี Tradeoff และเล่นได้จริงทุก Control Scheme

> **Note:** หาก Codebase ปัจจุบันทำ Phase บางส่วนไปแล้ว ต้อง Audit และปรับเฉพาะ Gap ไม่เริ่มเขียนใหม่ทั้งหมด

---

## 14. Acceptance Criteria / Test Plan

### 14.1 Test Cases หลัก

| ID | Scenario | Expected Result |
|---|---|---|
| FC-01 | กด Pitch Up ค้างที่ Normal Flight | เครื่องบินตอบสนองแรงแต่ไม่เข้า Full PSM โดยไม่ตั้งใจ |
| FC-02 | กด Space + Pitch Up ที่ความเร็วเหมาะสม | เข้าสู่ High-AoA ได้ง่ายขึ้นโดยไม่ Teleport ท่าทาง |
| FC-03 | Cobra (Pitch Up → Pitch Down) | Nose เชิดสูงและกลับได้, Velocity มีความต่อเนื่อง |
| FC-04 | Kulbit (Space + Pitch Up ต่อเนื่อง) | Pitch ผ่านแนวดิ่ง/หมุนต่อโดยไม่หยุดที่ Animation Boundary |
| FC-05 | Pedal Turn (Space + Q/E) | Direct Yaw Control เห็นชัด แต่ไม่มี Uncontrolled Spin ทันทีใน Arcade |
| FC-06 | PSM Chaining | Angular Velocity/Energy ไม่ถูกรีเซ็ตเมื่อเปลี่ยน Input |
| FC-07 | Drift ที่ 450–550 km/h | Nose/Flight Path Offset มองเห็นได้ราว 25–45° ตาม Tune |
| FC-08 | Drift + Shift | เครื่องค่อย ๆ เปลี่ยน Flight Path ตามแรงขับ ไม่หัก Velocity ทันที |
| FC-09 | ปล่อย Space กลาง High-AoA | Recovery ต่อเนื่อง ไม่มี Quaternion/Velocity Snap |
| FC-10 | S + Ctrl ก่อน PSM | ลดความเร็วตาม Physics, Cruise Hold ไม่เร่งสวน |
| FC-11 | Space ในระหว่าง Speed Hold | Controller ระงับการไล่ Target เดิมระหว่าง PSM |
| FC-12 | Keyboard-only ↑ ค้าง / ↑+Space | แยก Normal Pitch กับ PSM Intent ได้สม่ำเสมอ |
| FC-13 | Camera Drift 30–60° Heading Offset | เห็นด้านข้างลำตัวและยังเล็งได้; ไม่พลิกที่มุมใกล้ 180° |
| FC-14 | Camera Near Wall / Terrain | กล้องไม่ทะลุและไม่บังคับให้อากาศยานทะลุฉาก |
| FC-15 | Low-speed Tail Slide / Near-zero Velocity | ไม่มี NaN/Camera Flip/Unbounded Controller |
| FC-16 | 30 / 60 / 144 FPS | ฟิสิกส์ใกล้เคียงกันภายใต้ Input Script เดียวกัน |
| FC-17 | Aircraft Profile F-22 vs Su-57 | แตกต่างด้าน Yaw/PSM Authority ตาม Profile |
| FC-18 | Network Latency / Reconciliation | ไม่ทำให้ PSM Snap รุนแรง/Camera หักเมื่อ State ถูกแก้ |

### 14.2 Telemetry / Metrics

เก็บข้อมูลขั้นต่ำเพื่อเปรียบเทียบภายใน Playtest:

- เวลาตอบสนองของ Pitch/Yaw/Roll Rate ต่อ Input
- Peak AoA, Peak Sideslip, Nose–Velocity Angle, Maximum G
- เวลาคง Drift, ความเร็วที่สูญเสีย, เวลาฟื้นเข้าสู่ Normal
- จำนวนครั้งที่ PSM เกิดโดยไม่ตั้งใจจาก Normal Input
- อัตรา Controller Saturation / Assist Intervention / Camera Angle Clamp
- FPS/Frame Time และความสอดคล้องกับ Fixed Timestep
- ความสำเร็จของ Mission/Tutorial Tasks และความเห็นผู้เล่นด้านความง่าย

**Target เชิง UX:** ผู้เล่นใหม่ควรทำ Normal Turn และ Drift เบื้องต้นได้โดยไม่ต้องอ่านคำอธิบายยาว; Full PSM ต้องทำได้สม่ำเสมอเมื่อกด Space พร้อม Direction แต่ยังมีข้อจำกัดด้าน Energy และท่าทาง

---

## 15. Risks, Failure Modes และ Guardrails

| ความเสี่ยง | แนวทางจัดการ |
|---|---|
| Keyboard Pitch ค้างแล้วเผลอ Kulbit | Rate/Envelope Protection ใน Normal; Full PSM ต้องมี Intent |
| Space ปล่อยแล้ว Snap | Continuous Blend, Preserve Angular State, Recovery Controller |
| Mouse Aim แย่ง PSM | Edge Command, transition ไป Rate Control, stable World-space Target |
| Drift ไม่เกิดเพราะ Velocity Alignment | Audit Hard Alignment; ลด Alignment Assist ไม่ลบ Drag จริง |
| Drift ดูไม่ออกจากกล้อง | Velocity-aware Camera Blend และ Side-body Reveal |
| กล้องทำให้ Aim สะบัด | แยก Aim Controller จาก Camera Presentation |
| Camera Flip ตอน Nose สวน Velocity | Low-speed fallback, Quaternion smoothing, angle clamp, stable up-vector |
| S กับ Ctrl ลดความเร็วซ้ำจนแรงเกิน | Defined Power/Brake Priority และแรงต้านตาม Physical Constraints |
| Cruise Hold เร่งสวน PSM | Suspend/Hold Target Capture, Anti-Windup, Recovery Gate |
| ทุกลำ PSM เก่งเหมือนกัน | Aircraft Profiles + TVC Axis / Energy / Authority Differences |
| Flat Spin เกิดง่ายเกิน | Default Arcade Recovery Assist / Hysteresis / Controller Limits |
| PSM กลายเป็น Infinite Spin | Energy Loss, Torque Limits, Low-speed Authority, G & Envelope |
| Collision ทะลุกำแพงตอน Drift | Swept Collision หรือ CCD ตามความเร็ว และขนาดปีก/หาง |
| ฟิสิกส์ขึ้นกับ FPS | Fixed Timestep และ Render Interpolation |
| Dynamic Camera กินสเปค/ทำให้งง | ลด Sample, ใช้ Camera Settings Presets, Motion Accessibility |

---

## 16. Decisions / Open Questions ก่อนเริ่ม Implement

### 16.1 Decisions ที่แนะนำให้ยึดเป็น Baseline

- [x] Default = **Mouse Aim + Aircraft Follow**
- [x] **Space Hold = PSM Override**; ไม่ใช้ Separate PSM Animation/Physics Mode
- [x] **W/S = Hybrid Speed Assist**, Shift = AB, Ctrl = Airbrake
- [x] **Keyboard-only Supported** พร้อม Rate Command + Protection
- [x] Drift สามารถเกิดจาก Normal Controls โดยไม่จำเป็นต้อง Space
- [x] Physics ต้องรักษา Velocity/Orientation/Angular Velocity ต่อเนื่อง
- [x] Camera Blend Normal/Drift/PSM และแยกจาก Aim/Physics
- [x] Arcade Default; Advanced เป็น Optional Preset

> เครื่องหมาย `[x]` หมายถึง **Baseline Design ที่สรุปจากการสนทนา** ไม่ใช่การยืนยันว่า Implement แล้ว

### 16.2 Questions ที่ต้องตรวจ/ตัดสินก่อน Coding

- [ ] Flight Model ปัจจุบันมี Sideforce/Lateral Damping ซ้ำกับ Assist หรือไม่
- [ ] Mouse Aim ปัจจุบันเป็น Virtual Stick หรือ Desired Direction ในชั้นใด และควร Transition ไป PSM อย่างไร
- [ ] Normal Flight Auto Bank ปรับได้มากน้อยแค่ไหนโดยไม่กระทบ Combat Aim
- [ ] Escape / Recovery Assist จะเป็น Auto อย่างเดียว หรือมีปุ่มเพิ่มต่างหาก
- [ ] S (Hold) ให้ลด Throttle อย่างเดียวหรือเสริม Drag Device แบบเบาเพียงใด
- [ ] Shift+Ctrl ควรเป็น Alternative PSM Binding จริงหรือเพียง Custom Binding ที่ต้องผู้เล่นเปิดเอง
- [ ] Camera Drift Clamp, HUD FPI และ World-space Aim Projection สามารถ Implement โดยไม่แตะระบบยิงเดิมได้แค่ไหน
- [ ] เครื่องบินรุ่นไหนรองรับ Full PSM และรุ่นไหนจำกัด High-AoA / Drift
- [ ] ค่าความเร็ว/แรง G/AoA ใดให้ภาพสวยและบาลานซ์จริงหลัง Playtest
- [ ] Multiplayer จะ Sync Input/Physics/Correction ด้วยวิธีใด และ Timestep ปัจจุบันเป็นอย่างไร

---

## 17. Suggested Prompt สำหรับ Codebase Audit และ Implementation Plan

คัดลอกข้อความนี้ไปให้ Coding Agent ใช้วางแผน โดยแนบเอกสารฉบับนี้:

> อ่าน `project-maverick-flight-control-psm-drift-rework-spec.md` ทั้งฉบับ แล้ว **ตรวจ Codebase ปัจจุบันก่อน** ห้ามเริ่มเขียนโค้ดทันที ตรวจ Input Mapping, Mouse Aim, Flight State, Velocity Alignment, Angular Controller, Aerodynamics/Stall, PSM, Speed Control, Camera, HUD, Aircraft Config และ Fixed Timestep พร้อมอ้างอิงไฟล์และบรรทัดจริงจาก Repository
>
> สร้าง **Gap Analysis** เทียบกับ Baseline Design ของเอกสาร แยกสิ่งที่ Implement อยู่แล้ว / ต้องแก้ / ต้องเพิ่ม / มีความเสี่ยง Regression ให้ชัด จากนั้นเสนอแผน Implement เป็น Phase ขนาดเล็กพร้อม Dependency, Acceptance Tests, Rollback Plan และ Tuning Parameters ที่ปรับได้ หลีกเลี่ยงการ Rewrite ระบบที่ทำงานถูกต้องอยู่แล้ว และหลีกเลี่ยงการสร้าง Scripted Maneuver/Teleport Velocity
>
> ให้ความสำคัญกับ 1) Physics Decoupling 2) Mouse + Keyboard-only Intent 3) Space PSM Override + Envelope 4) Hybrid W/S Speed Assist 5) Dynamic Drift Camera 6) Aircraft Profiles และ Test Harness ขณะวางแผนตรวจ Key Conflict, Camera/Aim Conflict, PSM Transition, Sideforce Double Counting, Multiplayer และ FPS Independence
>
> สรุปผลเป็น Architecture Review, Proposed Phases, Files to Change, Test Plan และ Open Questions โดย **ยังไม่แก้ Code** จนกว่าจะได้รับคำสั่ง Implement

---

## 18. Final Design Statement

**Project Maverick ควรมีระบบบินที่ผู้เล่นสั่งทิศทางได้ง่าย แต่การเคลื่อนที่ยังมีโมเมนตัม**  
เมื่อกด Pitch/Roll/Yaw รุนแรง เครื่องบินสามารถทำ High-G Turn และ Drift ได้จาก Dynamics ตามปกติ; เมื่อกด **Space + Direction** ระบบยอมให้เข้าสู่ Post-Stall Maneuver ได้ง่ายขึ้นตามสมรรถนะและพลังงาน; เมื่อปล่อย Override เครื่องบิน Recover อย่างต่อเนื่อง; และกล้องเปิดมุมให้เห็นความแตกต่างระหว่าง **Nose Direction** กับ **Actual Flight Path** โดยไม่ทำให้ Aim สั่นหรือสูญเสียการควบคุม

**แนวทางสำคัญที่สุดคือ:** *ไม่สร้างท่าบินให้ผู้เล่นกดดู แต่สร้างระบบการบินที่ทำให้ท่าเหล่านั้นเกิดขึ้นได้จากฝีมือของผู้เล่น*

---

### Document Change Log

| Version | Date | Detail |
|---|---|---|
| Draft v1.0 | 2026-10-31 | Consolidated design from discussions on Ace Combat 7 PSM video, Jet Drifting video, Mouse/Keyboard controls, Space Override, Hybrid W/S, camera, HUD, physics, tuning, architecture and tests |
