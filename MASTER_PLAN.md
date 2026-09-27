# Project Maverick — Master Plan

> ฉบับเสนอเพื่อเริ่มพัฒนา · 6 กันยายน 2026 · เอกสารภาษาไทย · เกม React + Three.js
> ชุดนี้เป็นแผนงาน ยังไม่ได้เปลี่ยนโค้ดเกมหรือยืนยันว่าค่าทดลองผ่าน playtest แล้ว
> ปรับ 27 กันยายน 2026: หน้าจอและโหมดตาม [example/Design.html](example/Design.html) — Home, Select Mode, Hangar/Armament แบบ overlay, Campaign และ PVE ห้าโหมด (D14–D17)

## 1. เกมที่เราจะสร้าง

เกมเครื่องบินรบ **Arcade dogfight บน Desktop browser** ที่ใช้เมาส์และคีย์บอร์ด เรียนรู้การบินพื้นฐานได้เร็ว แต่มีพื้นที่ให้ฝึกการรักษาความเร็ว เลี้ยวหลอก ยิงปืน และใช้ maneuver ผู้เล่นเริ่มที่หน้า Home ซึ่งมีเครื่องบินลำที่เลือกเต็มจอ เลือกเครื่องจากโรงเก็บที่ดูโมเดล `.glb` อาวุธ ประวัติ และสมรรถนะในเกมได้ แล้วเลือกเล่น **Campaign** (ภารกิจต่อเนื่องบนแผนที่พื้นที่รบ ปลดล็อกทีละขั้น) หรือ **PVE** กับบอทเป็นทีมในห้าโหมด: Team Deathmatch, Control Point, ชิงธง, Priority Target (ชิงมงกุฎ) และ Flyover (บินผ่านยึดจุด) ส่วน Training/Playground ยังเปิดฝึกได้ตลอด Multiplayer ทำหลัง Offline เล่นสนุกและระบบนิ่งแล้ว

ใช้ความคล่องตัวและความเข้าถึงง่ายของเกมแนว Battlefield เป็นแรงบันดาลใจ ไม่ถือว่าแผนนี้อธิบายกลไกภายในของ Battlefield 6 และไม่พยายามจำลองเครื่องจริงทุกระบบ

หลักสำคัญ:

1. **ยิงกันได้จริง:** บีบช่วงความเร็วในการเคลื่อนที่ให้ระยะยิงปืนมีเวลาเล็ง ใช้เสียง กล้อง และ VFX เสริมความเร็ว
2. **บังคับง่าย แต่มีต้นทุน:** W/S เพิ่ม/ลดความเร็วเป้าหมาย; High-G และ Cobra แลกความเร็วกับโอกาสยิง
3. **แต่ละลำมีเหตุผลให้เลือก:** ไม่มีลำใดเก่งที่สุดทุกด้าน ความรู้จริงแยกจากค่าบาลานซ์ชัดเจน
4. **ระบบเดียวใช้ได้หลายโหมด:** ผู้เล่นและบอทส่งคำสั่งรูปแบบเดียวกัน; UI และโมเดลอ่านผลจาก simulation
5. **โค้ดตรงไปตรงมา:** TypeScript แบบไม่เล่นท่ายาก ฟังก์ชันกับข้อมูล แยกตามหน้าที่ ไม่เริ่มด้วย framework เกมที่สร้างเอง

## 2. ขอบเขตและสมมติฐานที่ใช้วางแผน

| เรื่อง | ข้อเสนอเริ่มต้น |
|---|---|
| เทคโนโลยี | React + TypeScript + Vite + Three.js ผ่าน React Three Fiber ซึ่งตัวอย่างใช้อยู่แล้ว |
| เครื่องบิน | F-22 เป็นลำทดลองแรก; เป้าหมาย Offline release มี F-22, Su-57, F/A-18E Super Hornet |
| คำว่า F18 | เลือก F/A-18E เป็น baseline ที่ชัดเจน ไม่ปนกับ F/A-18C หรือ F/A-18F |
| ภาษา | ไทย `th` และอังกฤษ `en` ตั้งแต่ foundation |
| อุปกรณ์ | Mouse + Keyboard และ Keyboard-only; gamepad/mobile เลื่อนออกไป |
| การเริ่มบิน | เกิดกลางอากาศ ไม่ต้องทำ taxi, takeoff, landing หรือ cockpit ที่กดสวิตช์ได้ใน MVP |
| Offline | Local simulation ไม่มี backend หลังโหลด asset ที่จำเป็นแล้ว; การเปิดเว็บใหม่โดยไม่มีเน็ตต้องเพิ่ม cache/PWA ภายหลัง |
| Multiplayer | ออกแบบขอบเขตไว้ก่อน; ทำ server/rooms/network จริงท้ายสุด เริ่มพิสูจน์ 1v1 ก่อนเพิ่มจำนวนผู้เล่น |
| โหมด | Campaign (operation แรก 6 missions), PVE ทีม: Team Deathmatch / Control Point / ชิงธง / Priority Target / Flyover, Training; ไม่มี FFA แยก |
| ขนาดทีม PVE | 1v1 ถึง 2v2 ก่อน (4 ลำ) เป้า 4v4 เมื่อ benchmark ผ่าน; ทีมผู้เล่นเติมด้วย ally bots |
| โลก | สนามฝึกเรียบก่อน ต่อด้วย map PVE ที่มีฐาน/จุดยึด และ maps ของ Campaign ตามลำดับ phase |
| การปลดล็อก | เลือกทุกเครื่องที่พร้อมเล่นได้เลย; Campaign ปลดล็อกเฉพาะ mission ตามลำดับ requires ไม่ทำ economy, grind หรือ unlock เครื่อง |
| หน้าจอ | overlay บน 3D scene ไม่มี panel ตาม [DESIGN.md](DESIGN.md) และภาพใน [example/Design.html](example/Design.html) |

นี่เป็นข้อเสนอใหม่ตามคำขอปัจจุบัน ไม่สืบทอดชื่อเกมใหม่ ที่ตั้ง repo หรือคำตอบของผู้ใช้ที่ถูกบันทึกไว้ในเอกสารเก่าโดยอัตโนมัติ ยังไม่สร้างโปรเจกต์ข้างเคียงหรือย้ายไฟล์ต้นฉบับ

## 3. อ่านและแก้เอกสารอย่างไร

Master นี้เป็นเจ้าของขอบเขต ลำดับงาน และเงื่อนไขส่งมอบ ส่วนรายละเอียดมีเจ้าของเพียงไฟล์เดียว:

| เอกสาร | เป็นเจ้าของเรื่อง |
|---|---|
| [01 Architecture](docs/game-design/01-architecture.md) | โครงสร้างโค้ด, state, command, event, game loop |
| [02 Controls](docs/game-design/02-controls.md) | ปุ่มหลัก, mouse/keyboard, rebinding, input conflicts |
| [03 Flight & Speed](docs/game-design/03-flight-and-speed.md) | แบบจำลองบิน, W/S, ความเร็วและหน่วย, energy |
| [04 Maneuvers](docs/game-design/04-maneuvers.md) | High-G, Airbrake, Cobra, PSM, thrust vectoring |
| [05 Aircraft](docs/game-design/05-aircraft.md) | ข้อมูลรายลำ, ความแตกต่าง, บาลานซ์, facts |
| [06 Hangar](docs/game-design/06-hangar.md) | เลือกเครื่อง, ดู 3D, stat bars, หน้า Armament, ความรู้ |
| [07 Weapons & Damage](docs/game-design/07-weapons-and-damage.md) | ปืน, missile, lock, countermeasure, hit, kill |
| [08 Bots](docs/game-design/08-bots.md) | AI pilot, perception, difficulty |
| [09 Offline](docs/game-design/09-offline.md) | โหมด PVE (TDM / Control Point / ชิงธง / Priority Target / Flyover), match lifecycle, scoring, spawn, pause |
| [10 Playground](docs/game-design/10-playground.md) | ฝึกบิน, tutorial, flight lab, tuning workflow |
| [11 Cameras](docs/game-design/11-cameras.md) | horizon lock, aircraft-follow, free look, transitions |
| [12 HUD & Feedback](docs/game-design/12-hud-and-feedback.md) | HUD, menus, accessibility, เสียงและ VFX |
| [13 Assets](docs/game-design/13-assets.md) | GLB pipeline, rig, load, cache, resource lifecycle |
| [14 World](docs/game-design/14-world.md) | หน่วยโลก, terrain, collision, ขอบสนาม |
| [15 Localization & Settings](docs/game-design/15-localization-and-settings.md) | สองภาษา, save schema, settings migration |
| [16 Multiplayer](docs/game-design/16-multiplayer.md) | server authority, commands/snapshots, prediction |
| [17 Quality & Balance](docs/game-design/17-quality-and-balance.md) | acceptance tests, performance, playtest |
| [18 Migration & Backlog](docs/game-design/18-migration-and-backlog.md) | วิเคราะห์โค้ดเดิม, งานเรียงลำดับ, จุดหยุดตรวจ |
| [19 Sources & Decisions](docs/game-design/19-sources-and-decisions.md) | แหล่งข้อมูล, ข้อเสนอที่ต่างจากเอกสารเก่า, decision log |
| [20 Game Shell](docs/game-design/20-game-shell.md) | Home, Select Mode, PVE Setup, Settings, การนำทาง, menu scene ร่วม |
| [21 Campaign](docs/game-design/21-campaign.md) | operation, missions, requires DAG, objectives, progress |

เมื่อแก้ปุ่มให้แก้ 02; เมื่อแก้ความเร็วให้แก้ 03 และ profile ในโค้ด ไม่คัดลอกตารางซ้ำทุกโหมด ถ้าเอกสารเก่าขัดกัน ให้ใช้ชุดนี้สำหรับงานใหม่และบันทึกเหตุผลใน 19 ค่าตัวเลขทั้งหมดที่ระบุว่า “ทดลอง” เป็น gameplay tuning ไม่ใช่ข้อเท็จจริงทางการบิน

## 4. ภาพรวมระบบ

```mermaid
flowchart TD
  HOME[Home] --> H[Hangar / Armament: เลือก aircraft พร้อมอาวุธเต็มความจุ]
  HOME --> MODE[Select Mode]
  MODE --> CM[Campaign Map: mission ตาม requires]
  MODE --> PV[PVE Setup: TDM / Control Point / ชิงธง / Priority Target / Flyover]
  MODE --> TR[Training]
  H -.->|aircraftId| C[Session config]
  CM --> C
  PV --> C
  TR --> C
  C --> P[Playground]
  C --> O[Offline: PVE / Campaign]
  C --> M[Multiplayer: ทำท้ายสุด]
  I[Keyboard / Mouse] --> CMD[PilotCommand]
  B[Bot pilot] --> CMD
  CMD --> SIM[Simulation: Flight / Combat / World / Rules]
  P --> SIM
  O --> SIM
  M --> SIM
  SIM --> S[State และ Events]
  S --> V[Three.js: aircraft / world / VFX]
  S --> U[React: HUD / menus / results]
  S --> A[Audio]
```

ทุกเครื่องมี entity ของตัวเอง แต่มี **ตัวขับเวลา simulation เพียงตัวเดียวต่อ session** Camera ไม่มีสิทธิ์หมุนเครื่องบิน; GLB animation ไม่มีสิทธิ์ตัดสินว่ากระสุนโดน; component ไม่ตัดสิน respawn

## 5. Roadmap และจุดตัดสินใจ

สถานะ implementation 7 ก.ย. 2026: P0/P1 และ P2 Playground baseline อยู่ในแอปรากแล้ว ดู [P2 ผลส่งมอบและข้อจำกัด](docs/phase-2-playground.md) สำหรับ manual PSM/Cobra/180° reversal, High-G, burner และบทฝึก; flight feel ยังรอ playtest ด้วยมือ ดู [Roadmap/ผลส่งมอบ Phase 1](docs/phase-1-flight-slice.md) สำหรับงานที่ทำจริง การตรวจ และ gate ที่ยังต้อง playtest ข้อความแผนในส่วนอื่นยังเป็นเป้าหมายของเกมเต็ม

สถานะ 14 ก.ย. 2026: เริ่ม P3 profile/armament foundation แล้ว — Flight/Weapons อ่านข้อมูลรายลำ, ติดตั้งอาวุธเต็มความจุอัตโนมัติใน session และเอา branch ตามชื่อเครื่องออกจาก core; facts/LOD/weapon geometry ยังไม่ครบ ดู [P3 implementation](docs/phase-3-aircraft-loadouts.md)

สถานะ 27 ก.ย. 2026: ปรับ roadmap ตาม Design example โดยแทรก P3b game shell, P5b PVE objective modes และ P5c Campaign ไม่เปลี่ยนเลข phase เดิม (D14) เลข P ของ Master แยกจาก Phase ของงาน PSM ใน `docs/psm-*` งาน PSM ที่ค้าง (Phase 8 personality tuning, MR3+) พักไว้ได้โดยไม่บล็อก P3b

สถานะ implementation 27 ก.ย. 2026 (P3b ส่วนแรก): Home, Select Mode, Hangar (overlay บน menu scene ร่วม), Campaign Map แบบ mock (operation แรก M01–M06, สถานะคำนวณจาก progress) และ PVE Setup (ห้าโหมด, สาม maps: Flat Training Range พร้อม/Mountains/Coastal PLANNED) อยู่ใน `src/features/{menu,home,mode,hangar,campaign,pve}` ยังไม่มี: Armament/อาวุธในหน้าเมนู, Settings screen, mission runtime; START/PLAY เปิดได้เฉพาะ free flight บน Flat Training Range โรงเก็บเดิมย้ายไป `#/studio` (ไม่มีลิงก์จากเมนู)

ไม่กำหนดวันที่เสร็จจากการเดา ก่อนเริ่มแต่ละ phase ให้แตกงานใน 18 และประเมินจากความเร็วทำงานจริง จบ phase เมื่อผ่าน gate ไม่ใช่เมื่อมี UI ให้เห็นเท่านั้น

| Phase | ผลงานที่เล่น/ตรวจได้ | Dependencies | Exit gate |
|---|---|---|---|
| P0 Foundation | runtime กลาง, content schema, ภาษา, session, บันทึก baseline เดิม | ไม่มี | เปิด headless world ได้; mount/unmount ไม่สร้าง loop ซ้ำ |
| P1 Flight slice | F-22 บินในสนามเรียบ, W/S, pitch/yaw/roll, กล้องสอง roll modes | P0 | ควบคุมได้ทั้งสอง input presets; 30/60/144 FPS ไม่เปลี่ยนผลบิน |
| P2 Playground & maneuver | ฝึก Airbrake, High-G, Cobra, telemetry, recovery | P1 | nose/path แยกกันจริง; ใช้ท่าแล้วมี cost; มือใหม่กลับมาบินปกติได้ |
| P3 Hangar & aircraft | โรงเก็บ, facts/game tabs, อาวุธเต็มความจุ, profile อย่างน้อยสองลำ | P1–P2 + asset pipeline | เพิ่ม profile โดยไม่เพิ่มเงื่อนไขชื่อเครื่องใน flight core |
| P3b Game shell | Home, Select Mode, Hangar/Armament แบบ overlay, PVE Setup, Campaign Map (ข้อมูล+progress), Settings กราฟิก/กล้อง | P3; ทำขนานกับ P4 ได้ | เดิน Home → Mode → Setup → Flight → กลับได้ครบด้วยคีย์บอร์ด; menu scene ไม่โหลด GLB ซ้ำ; ตัวเลือกที่ยังไม่พร้อมบอกเหตุผล; settings v1→v2 migration ผ่าน |
| P4 Gun duel | ปืน, damage, respawn, บอทไล่/หนีหนึ่งตัว เป็น Team Deathmatch 1v1 | P2; ใช้ F-22 mirror ได้ | เล่น TDM 1v1 guns-only ครบหนึ่ง match; มีเวลาเล็งและยิงได้ |
| P5 Offline combat | missile IR, lock, flares, bot tactics, results, TDM แบบทีมพร้อม ally bots | P4 | ยิง/หลบ/แพ้/ชนะ/เริ่มใหม่ได้ครบใน TDM 2v2; ไม่ต้องเรียก backend |
| P5b PVE objective modes | Control Point, ชิงธง, Priority Target, Flyover, objective HUD, bot roles, map PVE ที่มีฐาน/จุดยึด | P5 + P3b | ทั้งห้าโหมด PVE เล่นจบและ rematch ได้; บอทฝ่ายเราทำ objective ได้ |
| P5c Campaign | mission runtime, objectives, เป้าภาคพื้น/tanker, maps ของ operation | P5 + P3b; destroy-ground รอ D16 | operation แรกเล่นครบตาม requires DAG; progress คงอยู่หลัง reload |
| P6 Offline release | สามลำ, PVE ห้าโหมด, Campaign operation แรก, settings สองภาษา, polish/performance | P3b + P5b + P5c | checklist ใน 17 ผ่าน; aircraft แต่ละลำมี counterplay |
| P7 Multiplayer | server 1v1 → rooms → 2v2 หาก benchmark ผ่าน | **P6 เท่านั้น** | server ตัดสิน hit/score, latency tests ผ่าน, version mismatch จัดการได้ |

เริ่ม combat ด้วย F-22 mirror ได้หาก Su-57/F/A-18E asset ยังไม่พร้อม แต่ P6 จะไม่ถือว่าครบ roster จนมีโมเดลและ rig ผ่านการตรวจ หากต้องการเพิ่ม radar missile ให้ทำหลัง IR loop ผ่าน ภายใน P6 หรืออัปเดตหลัง Offline release โดยไม่บล็อกปืน/IR

## 6. Definition of Done ระดับเกม

- เริ่มจาก Home เลือกโหมด เข้าโรงเก็บ เลือกหนึ่งในสามลำ อ่านประวัติ/stat bars/รายละเอียดเชิงลึก ดูอาวุธในหน้า Armament แล้วเริ่มเล่นได้
- PVE เล่นได้ครบห้าโหมด (Team Deathmatch, Control Point, ชิงธง, Priority Target, Flyover) กับ ally/enemy bots
- Campaign operation แรกเล่นตามลำดับ requires และบันทึก progress ได้
- Settings ปรับกราฟิกและมุมกล้องได้ โดย preset กราฟิกลดต้นทุนจริงและกล้องไม่เปลี่ยนผลบิน
- W/S ไม่ใช่ throttle โดยตรง; ไม่ผูกการเปลี่ยนความเร็วกับ FPS
- มีทั้ง normal turn, Airbrake, High-G และ Cobra สำหรับลำที่รองรับ พร้อมวิธี recover
- ยิงปืนและ missile กับบอทได้ มี damage, death, respawn, score และจบ match
- Playground ฝึกได้โดยไม่บังคับให้เข้า match; pause/reset/retry ทำงานครบ
- กล้องล็อคขอบฟ้าและหมุนตามเครื่องไม่เปลี่ยนสมรรถนะหรือคำสั่งบิน
- ไทย/อังกฤษครอบคลุมเส้นทางหลัก การตั้งค่า บทสอน ข้อผิดพลาด และผลการเล่น
- Simulation ทดสอบโดยไม่มี Canvas ได้ และเพิ่มเครื่องบินที่ใช้กลไกเดิมผ่านข้อมูลได้
- Multiplayer ยังไม่ต้องมีใน Offline release แต่ core ไม่อ่าน DOM, React หรือ WebSocket

## 7. ความเสี่ยงที่ต้องพิสูจน์ก่อนขยาย

| ความเสี่ยง | สิ่งที่จะทำให้รู้เร็ว |
|---|---|
| ความเร็วสวยแต่ยิงไม่โดน | P4 gun duel วัด firing window, target visibility, เวลา re-engage |
| Cobra กลายเป็นปุ่มชนะฟรี | วัด nose rotation กับ path rotation และช่วงเสียเปรียบหลังท่า |
| ไล่แก้ค่าสมจริงจน flight model โตไม่หยุด | จำกัด profile เป็นกลุ่มพารามิเตอร์ที่อธิบายได้; ปรับทีละกลุ่มจาก scenario |
| ทุกลำต่างแค่ skin | ใช้ bot script เดียวกันวัด turn, acceleration, PSM cost และ recovery |
| GLB หนักเมื่อมีหลายเครื่อง | ใช้ gameplay LOD ตั้งแต่ P3 และ benchmark หลาย entity ก่อนทำสนามสวย; เปิด 4v4 เฉพาะเมื่อ 8 ลำผ่าน budget |
| Objective mode ไม่เข้ากับเครื่องบินที่หยุดนิ่งไม่ได้ | ทดสอบรัศมีจุดยึด/เพดาน/โซนธงด้วยบอทและ playtest ก่อนทำ map สวย |
| Campaign ต้องใช้ content ใหม่จำนวนมาก | เริ่มจาก M01 ที่ใช้แค่ air combat; mission ที่ระบบยังไม่พร้อมแสดงเป็น PLANNED; ตัดสินวิธีโจมตีภาคพื้น (D16) ก่อนสร้างเป้าภาคพื้นและ maps |
| ข้อความ overlay อ่านยากบนโมเดล | vignette/scrim แบบ gradient และตรวจ contrast บนทุกลำ ไม่ใช้ glow |
| แยกไฟล์แต่ยังพันกัน | ตรวจ dependency และผู้เขียน state; ห้าม renderer เรียก damage/reset โดยตรง |

งานถัดไปที่แนะนำ: P3b game shell และ P4 gun duel ทำขนานกันได้ เพราะ P3b ไม่แตะ simulation เลือกลำดับตามว่าต้องการเห็นหน้าตาเกมก่อน หรือพิสูจน์ความสนุกของการยิงก่อน ดู [backlog ที่ลงมือทำต่อได้](docs/game-design/18-migration-and-backlog.md)
