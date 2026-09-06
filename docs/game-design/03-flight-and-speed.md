# 03 — Arcade Flight, Speed และ Energy

[กลับ Master Plan](../../MASTER_PLAN.md) · P1–P2 · เจ้าของหน่วยและ baseline ความเร็ว

## คำตัดสินหลัก

ใช้ **assisted rate-based flight** ที่มี orientation และ velocity แยกกัน บังคับ pitch/yaw/roll เป็นความต้องการอัตราหมุน FCS จำกัดตาม profile แล้วคำนวณแรงแบบง่าย ไม่จำลอง turbine, compressibility หรือ aerodynamic tables จริงทุกค่าจนดูแลไม่ไหว

W/S ปรับ `targetSpeedMps`; ไม่เขียน throttle และไม่เขียน velocity โดยตรง Auto-speed controller ค่อย ๆ เปลี่ยนแรงขับ ส่วน actual speed เปลี่ยนจากแรงและเวลา จึงยังเสียความเร็วเมื่อเลี้ยวแรงหรือไต่ขึ้นได้

## หน่วยและความเร็วที่ใช้จริง

Simulation ใช้ **เมตร วินาที m/s radian** เท่านั้น; world 1 unit = 1 m ทุกระบบปืน missile AI collision และ network ใช้หน่วยเดียวกัน

HUD ค่าเริ่มต้นเสนอ `arcadeSpeed = actualSpeedMps × 3.6 × 1.5` ติดป้าย **ARCADE km/h** และอธิบายใน tutorial ว่าเป็นค่าขยายเพื่ออารมณ์เกม ไม่ใช่ความเร็วเครื่องบินจริง การตั้งค่าขั้นสูงสลับเป็นความเร็วโลก `actualSpeedMps × 3.6 km/h` ได้ โดยไม่เปลี่ยน simulation เครื่องบินทุกลำใช้ตัวคูณ HUD เดียวกัน

| ช่วงทดลอง baseline | World speed | HUD แบบ Arcade | ความหมาย |
|---|---:|---:|---|
| พลังงานต่ำมาก | ต่ำกว่า 55 m/s | ต่ำกว่า 297 | lift/การควบคุมลดลง เริ่ม recovery assist |
| target ต่ำสุด | 65 m/s | 351 | S ลด target ได้ถึงจุดนี้ แต่ actual อาจต่ำกว่านี้ |
| main dogfight | 90–160 m/s | 486–864 | ช่วงที่อยากให้ผู้เล่นต่อสู้เป็นหลัก |
| sustained-turn sweet spot | 110–145 m/s | 594–783 | baseline; profile รายลำต่างกัน |
| dry target สูงสุด | 200 m/s | 1,080 | เร็วสำหรับย้ายตำแหน่ง แต่เลี้ยวกว้าง |
| afterburner soft top | 240 m/s | 1,296 | หนี/ไล่ชั่วคราว มี reserve และ turn penalty |
| overspeed safety band | มากกว่า 260 m/s | มากกว่า 1,404 | progressive drag + nose-down limiter; ไม่ clamp velocity ทันที |

ตัวเลขทั้งหมดเป็นจุดเริ่ม playtest ไม่ใช่เป้าบังคับทุกลำให้ใช้ความเร็วเท่ากัน การเพิ่มตัวเลข HUD อย่างเดียวไม่แก้ dogfight; ต้องปรับ world speed และระยะยิงด้วย

ตัวอย่างที่ใช้ประเมิน: เครื่องสองลำสวนกันลำละ 130 m/s มี closing speed 260 m/s ถ้าเริ่มมองยิงจาก 700 m ถึงระยะ 200 m จะมีเวลาประมาณ `(700-200)/260 = 1.92 s` ส่วน tail chase ที่ต่างความเร็ว 25 m/s จะอยู่ในช่วงระยะ 500 m ได้นานประมาณ 20 s ก่อนคิดผลเลี้ยว จึงต้องทดสอบทั้งสอง geometry

## Target speed controller

```ts
targetSpeedMps = clamp(
  targetSpeedMps + command.speedAdjust * speedAdjustMps2 * dt,
  profile.minTargetMps,
  profile.maxDryTargetMps,
);
const temporaryTarget = burnerAllowed
  ? Math.max(targetSpeedMps, profile.boostTargetMps)
  : targetSpeedMps;
const errorMps = temporaryTarget - length(velocity);
const requestedPower = clamp(trimPower + kp * errorMps, 0, 1);
enginePower = approach(enginePower, requestedPower, spoolRate, dt);
```

นี่เป็น pseudocode ไม่ใช่ flight implementation ครบสูตร ใช้ proportional controller + trim feed-forward ก่อน ไม่เริ่มด้วย PID integral ที่เสี่ยง wind-up ใน High-G ตั้ง `speedAdjustMps2 = 30` ทดลอง: กด W 1 s เพิ่ม target 30 m/s ไม่ใช่เพิ่ม actual 30 m/s ทันที

ปล่อย W/S ให้ target หยุดตรงนั้น **ไม่มี command inertia เป็นค่าเริ่มต้น** ความนุ่มอยู่ที่เครื่องยนต์และ actual acceleration เพื่อให้ผู้เล่นตั้งความเร็วได้คาดเดาง่าย ต่างจากข้อเสนอเก่าที่ target ไหลต่อ หาก playtest ขอความนุ่มเพิ่มค่อยทดลอง smoothing ที่ไม่ overshoot target

S ลด target; controller ลด thrust และใช้ mild auto-deceleration ที่จำกัดไว้เมื่อเร็วเกินเป้า โดยไม่ animate Airbrake เต็มใบ ปุ่ม Airbrake เป็นการเพิ่ม drag ชัดเจนและ suppress auto-speed thrust ระหว่างกด เมื่อปล่อยกลับไปไล่ target เดิม ไม่มีการลด target ลับ ๆ

## การหมุนและแรงแบบ Arcade

`stepFlight` แบ่งหน้าที่เป็นสี่ขั้น:

1. `resolveEnvelope`: อ่าน speed/AoA/profile, High-G/PSM และคำนวณ rate limits กับ authority
2. `stepRates`: normalized command → target body rates; exponential damping ด้วย `1-exp(-k*dt)` และจำกัด angular acceleration
3. `computeForces`: thrust ตามแนวหัว, drag สวน velocity, lift ตั้งฉาก velocity, gravity และ assist ที่จำกัด
4. `integrateFlight`: integrate rates เป็น quaternion ที่ normalize แล้ว; `v += a*dt`, `p += v*dt`

อย่าใช้ `velocity = forward * speed` ทุก frame เพราะจะทำลาย drift/Cobra; อย่า slerp orientation ไปหา mouse point โดยข้าม rate limits ใช้ local +X forward, +Y up, +Z right ตามตัวอย่าง แต่ rate fields ใช้ชื่อ pitch/yaw/roll และแปลง sign ไป quaternion ในที่เดียวพร้อม axis tests

ใช้ aerodynamic lift curve แบบไม่กี่จุด: low AoA → lift เพิ่ม → stall region lift ลดแบบ smooth; induced drag เพิ่มตาม lift demand และ high AoA เมื่อ velocity ใกล้ศูนย์ห้าม normalize zero vector ให้ใช้ last valid airflow และลด aerodynamic authority ตาม speed

Arcade assists ได้แก่ auto-trim ใกล้ level flight, coordinated yaw, angular damping, stall recovery cue/limited nose-down assist ห้าม auto-level ทำงานเต็มแรงขณะผู้เล่นตั้งใจ roll, inverted หรือใช้ PSM และห้าม recovery assist เพิ่มความเร็วฟรี

## Energy และขีดจำกัด

ไม่เพิ่ม “energy bar” ที่เป็น resource ซ้ำกับความเร็ว ใช้ speed/altitude เป็นพลังงานที่สัมผัสได้; หลังบ้านดู `specificEnergy = speed²/2 + g*altitude` เป็น diagnostic ได้ แต่ assist ทำให้ไม่ใช่ระบบอนุรักษ์พลังงานแบบ simulator

- normal turn เสียความเร็วเล็กน้อย; High-G เพิ่ม induced drag; PSM เสียมากและฟื้นช้า
- ไต่ขึ้นลดความเร็ว บินลงเพิ่มความเร็ว; จำกัดด้วย progressive drag แทน hard cap ทุก frame
- burner เพิ่มแรงขับแบบจำกัดและใช้ reserve ตาม 04; ห้ามคืน speed ทันทีหลังปล่อย High-G
- เริ่ม spawn ที่ speed/engine trim สอดคล้องกัน; ไม่ให้เพิ่งเกิดแล้วร่วงเพราะ controller ยัง spool จากศูนย์
- แยก actual speed, target speed, path turn rate, nose turn rate, AoA, G indicator ใน telemetry เพื่อหาสาเหตุที่เลี้ยวไม่เข้า

## พารามิเตอร์ที่ profile ควรมี

`minTargetMps`, `maxDryTargetMps`, `boostTargetMps`, `speedAdjustMps2`, `acceleration`, `spoolRate`, `drag`, `turnDrag`, `sweetSpotMps`, `pitchRateCurve`, `rollRateCurve`, `yawRateCurve`, `rateResponse`, `stallCurve`, `highG`, `psm`, `vectoring` แต่ละกลุ่มต้องมีคำอธิบายผลและหน่วย ไม่เพิ่มเลขปรับโดยไม่มี scenario ที่พิสูจน์ความจำเป็น

## งานและเกณฑ์ผ่าน

1. ทำ straight-flight speed controller บนสนามเรียบก่อน แล้วเพิ่ม pitch/roll/yaw
2. เพิ่ม turn/altitude energy loss และ stall recovery ต่อด้วย High-G/PSM
3. ทดสอบปล่อย W แล้ว target คงเดิม, High-G ทำ actual ลดแม้ target คง, Airbrake ไม่ถูก controller สู้กลับ
4. ทดสอบครบที่ render 30/60/144 FPS, หยุด/กลับแท็บ, speed ใกล้ศูนย์, inverted, spawn/reset
5. ใช้ gun duel ของ 07 ตรวจช่วงยิง; ปรับ world speed ก่อนขยาย HUD multiplier หรือ aim assist
