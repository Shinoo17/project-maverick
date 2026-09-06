# 12 — HUD, UI, Audio และ VFX

[กลับ Master Plan](../../MASTER_PLAN.md) · เพิ่มตาม P1–P6 · อ่าน state/events จาก simulation

## เป้าหมาย

ผู้เล่นควรตอบได้ทันทีว่าเครื่องกำลังไปทางไหน ความเร็วเหมาะกับการเลี้ยวหรือยัง ยิงได้หรือยัง และกำลังถูกอะไรคุกคาม แสดงข้อมูลที่ช่วยตัดสินใจโดยเว้นพื้นที่กลางจอให้เห็นเครื่องศัตรู

## HUD ตามลำดับความสำคัญ

| ส่วน | ข้อมูล |
|---|---|
| กลางจอ | gun boresight, flight-path marker, lead cue เฉพาะเป้าที่มี solution |
| รอบเป้า | selected target, ระยะ, team shape, acquiring/locked; เป้าหลังสิ่งกีดขวางไม่แสดงข้อมูลเกิน sensor rules |
| ความเร็ว | actual + target tick, turn-band hint, label หน่วย Arcade/World ตาม 03 |
| Flight awareness | altitude/AGL warning, bank/horizon cue, low energy และ recovery prompt |
| Combat resources | HP, gun heat, secondary type/count, flare bursts, burner reserve |
| Threat | lock warning กับ missile inbound แยกกัน; แสดงทิศเมื่อ sensor rules ให้ข้อมูล |
| Match | score/time แบบกะทัดรัด; death/respawn/results มีลำดับชัด |
| Maneuver | High-G active, PSM ready/blocked reason/recovering; ไม่แสดง internal state machine ทั้งชุดให้ผู้เล่นปกติ |

G indicator เป็นค่าจาก simplified sim จึงไม่ใช้ข้อความสื่อว่าเป็นผลทดสอบเครื่องจริง ไม่มี blackout เต็มจอใน MVP; ใช้ vignette เบาและปิดได้

## การส่งข้อมูลไป UI

`HudSnapshot` เป็น read-only projection ของ player entity, target visibility, threat และ match state ไม่ส่ง WorldState ทั้งก้อนไป React ตัวเลข refresh 10–20 Hz; sight/markers ที่ต้องตรงภาพทำใน render update ด้วย interpolated transforms

`UiNotice` เก็บ localization key + params เช่น `{ key: 'flight.psm.speedTooHigh', params: { max: formattedSpeed } }` ไม่ฝังภาษาไทย/อังกฤษใน physics และไม่เอา event ยิงทุกนัดไปสร้าง toast ทุกครั้ง

เฉพาะ confirmed damage event เท่านั้นทำ hit marker; การยิง animation/เสียงออกไม่ได้แปลว่าโดน เป้าถูกทำลายหรือหลุด sensor ต้องล้าง lead/lock cues ใน tick ที่ข้อมูลเปลี่ยน

## เมนูและ error flow

Main → Hangar → Mode setup → Loading → Flight → Results; settings เปิดจาก main/hangar/pause ได้ ค่า flight ที่ต้อง recreate session ต้องบอกว่าใช้รอบถัดไป ค่า sensitivity/volume/locale ใช้ทันที

มี explicit loading, model failed/retry, WebGL unavailable, pointer-lock unavailable, save failed และ unknown aircraft/map states แต่ละ state มีทางกลับหรือ retry ไม่มีหน้าจอดำและ console error อย่างเดียว

## Audio

`AudioDirector` รับ snapshot สำหรับ engine/airflow continuous loops และรับ events สำหรับ gun, missile launch, lock tone, flare, hit, explosion เริ่ม audio context หลัง user gesture และ handle context suspended เมื่อสลับแท็บ

แยก volume master/engine/weapons/UI; จำกัดเสียงพร้อมกันและลดความดังตามระยะ ไม่สร้าง audio source ทุก frame Engine pitch อิง actual engine output และ speed ไม่ใช่ W held เฉย ๆ Pause local หยุด/ลด loops; resume คืนเสียงจาก current state โดยไม่เล่น one-shot เก่าซ้ำ

## VFX และความรู้สึกเร็ว

ใช้ exhaust/burner, wing vapor เฉพาะ turn load ที่เหมาะสม, tracer บางนัด, contrail ตามระยะและ profile, near-terrain parallax และ dynamic FOV เบา ๆ แทนเร่ง world speed จนยิงไม่ได้

VFX มี budget/pool ของตัวเอง ถ้า pool เต็มให้ลด effect ได้โดยไม่ลบ simulation projectile หรือเปลี่ยน damage ไม่ให้การเลือกกราฟิก Low ทำให้ศัตรูได้เปรียบจาก smoke gameplay ที่หายไป ถ้า smoke ไม่เป็น gameplay occluder ต้องไม่อ้างว่ามันบัง seeker

## Accessibility และการตรวจ

- สีทีม/lock/threat ใช้ shape, icon และข้อความร่วมกัน ไม่พึ่งแดง–เขียวอย่างเดียว
- รองรับ reduced motion, shake off, dynamic FOV off, subtitles/visual warning แทนเสียง และ UI scale
- Fonts รองรับไทยจริง วรรณยุกต์ไม่ถูก line-height ตัด; ตัวเลขอัปเดตไม่ทำ layout กระโดด
- Pause/settings ใช้ keyboard ได้ครบ focus กลับถูกตำแหน่ง; focus menu ไม่ส่งคำสั่งบิน
- Test ภาษาไทย/อังกฤษที่ 1280×720, 1920×1080 และ wide aspect พร้อม UI scale 125–150%

ผ่านเมื่อผู้เล่นอธิบายได้ว่า lock ยังไม่พร้อมเพราะอะไร, PSM ใช้ไม่ได้เพราะอะไร และกำลังขาด speed โดยไม่ต้องเปิด debug overlay
