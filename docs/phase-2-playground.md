# P2 — Playground & maneuver

Implementation: 7 กันยายน 2026 · ต่อจาก [P1](phase-1-flight-slice.md)

เข้า `#/flight` แล้วเลือกบทฝึก ระบบเลือกจุดเกิดที่เหมาะกับบทให้อัตโนมัติ เปลี่ยนจุดเกิดเองได้ เลือก Keyboard-only หาก browser ไม่อนุญาต pointer lock ปุ่มในเกมดู [02 Controls](game-design/02-controls.md)

## สิ่งที่เล่นได้

- Airbrake deploy/retract แบบ smooth, High-G เพิ่ม nose/path authority และ induced drag เมื่อดึงจริง ไม่มีค่าใช้จ่ายจากการกด Space เฉย ๆ
- Manual PSM: **ค้าง C + บังคับทิศ** เมื่อ 65–115 m/s (351–621 ARCADE km/h), สูง ≥150 m; C อย่างเดียวไม่เชิด/เบรก/เร่งเครื่อง ผู้เล่นใช้ X/S เข้าโซนเองและ W เร่งเมื่อช้าเกินไป
- `normal → armed → active → recovery → cooldown`; armed ต้องมี pitch/yaw >0.35 จึง active และผู้เล่นยังควบคุม pitch/yaw/roll ได้เต็มทุกช่วง ปล่อย C ออกจาก active; budget สูงสุด 3 s / 360° การหมุนรวม, speed <25 m/s หรือ altitude <80 m บังคับออกจาก envelope และ cooldown 4 s ต้อง release ก่อน re-arm
- ทำ Cobra ด้วยการเชิดแล้วกดหัวลงเอง หรือเอียงปีกเลือก plane แล้วดึงผ่านไปถึง 180°; ใช้ yaw ร่วมได้ ค่าแกน/ระยะเวลาที่ผู้เล่นป้อนเป็นตัวกำหนดท่า ไม่มี field เลือกชื่อท่าใน simulation
- Recovery ไม่หันหัวกลับไปตาม velocity เก่า; หัวตอบเฉพาะ player input, velocity ค่อย ๆ ตามหัวด้วยแรงที่จำกัด ผู้เล่นคืนคันบังคับกลางเพื่อหยุดหมุนและ W เร่งออกจากท่า มี speed loss, gravity และ recovery timeout 6 s; timeout ไม่อ้างว่าฟื้นสำเร็จ
- เมาส์ใน PSM อ่านตาม body axes จึงดึงผ่าน vertical/inverted ได้ไม่กลับทิศกลางท่า; นอก PSM ใช้ screen-relative stick เดิม
- Afterburner: ใช้ได้ 6 s, พัก 1 s ก่อน recharge 12 s; ใช้หมดต้องกลับถึง 25% ก่อนเริ่มใหม่ เบรกชนะ burner; PSM active ห้าม burner ส่วน recovery เปิดได้เมื่อหัวใกล้แนวบิน
- กล้องถอยและตามแนวไหลระหว่าง PSM, FOV ตอบความเร็ว/burner; ไอน้ำปีก เส้นทางปลายปีก และเปลวเครื่องยนต์อ่าน simulation หัวฉีด F-22 แสดง pitch assist จาก rates โหมดลด motion ปิดเอฟเฟกต์กล้อง/ไอน้ำและ damping
- บทฝึก 1–6: กล้อง, คุมสามแกนและผ่านวง, เบรก, สะสมเลี้ยว High-G 90°, ฟื้นความเร็วจากต่ำกว่า 60 เป็น ≥90 m/s, PSM หัวแยก ≥70° แล้ว recover สำเร็จ (Cobra หรือ reversal) ทุกบทข้าม/ลองใหม่ได้
- HUD 10 Hz: nose-off-path, path load indicator, burner, maneuver phase/cooldown; Flight Lab เพิ่ม world speed, body rates, path turn, drag deceleration, engine output และ peak/entry/exit ของ PSM
- Presets: Free / Cobra / High-G / Low energy; R reset ไป preset เดิมโดยไม่ต้องออกจากการบิน; เมนูพักมี ×1 / ×0.5 / ×0.25, paused single-step 1/60 s และ export JSON 60 วินาทีจำลองแรก
- `runFlightReplay` ใน `src/game/playground/replay.ts` เล่น normalized command track ที่ export กลับผ่าน runtime แบบ headless; JSON มี schema/profile version, session config, spawn preset, tick rate และแจ้ง truncated เมื่อเกินขีดจำกัด

## ผลตรวจ

- 47 tests ผ่าน รวม P0/P1 regressions, C alone/no autopilot, entry speed/altitude boundaries, all-axis/neutral/opposite-axis control, release/re-arm/budget, burner/brake/High-G, body-frame mouse control, spawn/reset/pause/single-step, ring crossing และ export/replay ตรงกัน
- PSM + burner replay ให้ snapshot ตรงกันที่ 30/60/144 FPS
- Test pilot ใน headless ส่งเฉพาะแกนบังคับเพื่อเลือกเป้าหมายต่างกัน: Cobra กลับทิศเดิม, pitch-led reversal และ yaw-led reversal ออกไปทางตรงข้ามสำเร็จ โดย nose/path แยกกันและ quaternion ไม่มี snap
- จาก 105 m/s: ตัวอย่าง Cobra ที่เชิดแล้วกดหัวลงด้วยคำสั่งผู้เล่น peak ~88°, minimum ~68 m/s; ตัวอย่าง pitch-led 180° peak ~180°, minimum ~52 m/s ก่อนผู้เล่นเร่งกลับ ตัวเลขขึ้นกับ command track ไม่ใช่ค่าท่าสำเร็จรูป
- `npm run build` ผ่าน; มีคำเตือนขนาด Three.js vendor chunk เดิม
- Browser รอบก่อนตรวจ HUD, keyboard flight, R reset, slow motion และ pause ของ P2 แล้ว; เวอร์ชัน manual ล่าสุดตรวจข้อความไทย/โซนความเร็วและแตะ C แล้วไม่เล่นท่าสำเร็จรูป, เมนูที่ 390×844 ไม่ล้นแนวนอน (คืน viewport แล้ว) การทำ Cobra/reversal ล่าสุดยืนยันด้วย headless tests ยังต้อง playtest การกดค้าง/เมาส์ด้วยมือ

## ขอบเขตและสิ่งที่ยังต้อง playtest

นี่เป็น arcade control envelope ไม่ใช่โมเดล aerodynamic stall เต็มรูปแบบ ค่า G เป็น magnitude ของ path acceleration รวม baseline 1 G ไม่ใช่ signed physiological G; nose-off-path รวม yaw จึงไม่ใช่ signed aerodynamic AoA ทั้งสองลำยังใช้ F-22 gameplay profile ทดลองเดียวกัน การบาลานซ์/capability รายลำเป็น P3

ความเท่/จังหวะกล้องยังต้องเล่นด้วยมือและปรับตาม feedback ผู้ใช้ คลิป YouTube ที่ให้มาเปิดผ่าน web fetch ไม่สำเร็จ จึงไม่ได้อ้างว่าท่าที่ทำตรงกับคลิปทุกจังหวะ เสียง, rear/free-look, rebinding, live profile override/import UI, combat และ ปุ่มท่าสำเร็จรูปไม่ได้เพิ่มในรอบนี้ Replay runner เป็น dev API; ใน UI มี export อย่างเดียว
