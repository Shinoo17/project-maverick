# 09 — Offline Mode: PVE และ Match Lifecycle

[กลับ Master Plan](../../MASTER_PLAN.md) · P4–P5b · พึ่ง runtime, bots, combat และ world · หน้าจอ setup อยู่ใน [20](20-game-shell.md), Campaign อยู่ใน [21](21-campaign.md)

## โหมด PVE

PVE คือการเล่นเป็นทีมกับบอทบนเครื่องเดียว ไม่ต้องมี server มีห้าโหมด (ปรับตามคำขอผู้ใช้ 27 ก.ย. 2026 แทน 1v1/FFA เดิม; เพิ่ม Priority Target และ Flyover ในวันเดียวกัน):

| Id | ชื่อที่แสดง | ชนะด้วย | เริ่มใน |
|---|---|---|---|
| `tdm` | Team Deathmatch | kill ของทีมถึง score limit หรือมากกว่าเมื่อหมดเวลา | P4 (1v1 guns-only) → P5 (ทีม) |
| `control-point` | Control Point | คะแนนจากการยึดจุดถึง limit ก่อน | P5b |
| `ctf` | ชิงธง (Capture the Flag) | นำธงศัตรูกลับฐานครบจำนวนก่อน | P5b |
| `priority-target` | Priority Target | ถือมงกุฎได้ 1 แต้มต่อวินาที ถึง score limit ก่อน หรือมากกว่าเมื่อหมดเวลา (เสมอต่อเวลา 2 นาที) | P5b |
| `flyover` | Flyover | บินผ่านจุดเพื่อยึด ทีมที่ถือจุดมากกว่าได้แต้มต่อเนื่อง ถึง limit ก่อน | P5b |

ทุกโหมดเป็นแบบสองทีม ทีมผู้เล่นมีผู้เล่นหนึ่งคนกับ ally bots ขนาดทีมเริ่มที่ `1v1` ถึง `2v2` (รวม 4 ลำ ตาม performance budget เดิมใน 17) เป้าถัดไปคือ `4v4` เมื่อ benchmark 8 ลำผ่าน TDM แบบ 1v1 ทำหน้าที่เป็น duel จึงไม่มีโหมด Duel หรือ FFA แยก

ตั้งค่าก่อนเริ่ม: mode, aircraft, map, team size, difficulty, weapons, time limit และ score limit มี preset “เริ่มเร็ว” ต่อโหมดเพื่อไม่ให้มือใหม่ต้องเข้าใจทุกค่า Friendly fire ปิดในทุกโหมด PVE ตาม 07

## Session config และ lifecycle

```ts
interface SessionConfig {
  mode: 'playground' | 'pve' | 'campaign';
  mapId: string;
  playerAircraftId: string;
  seed: number;
  pve?: {
    gameMode: 'tdm' | 'control-point' | 'ctf' | 'priority-target' | 'flyover';
    teamSize: number;               // ต่อทีม รวมผู้เล่น
    allies: BotSlot[];              // teamSize - 1
    enemies: BotSlot[];             // teamSize
    difficulty: 'easy' | 'normal' | 'hard';
    weapons: 'guns-only' | 'guns-ir';
    timeLimitSeconds: number;
    scoreLimit: number;             // ความหมายตาม gameMode
  };
  campaign?: { operationId: string; missionId: string };  // ค่าอื่นมาจาก MissionDefinition (21)
}

interface BotSlot { callsign: string; aircraftId: string; difficulty: 'easy' | 'normal' | 'hard' }
```

```text
Configure → Loading → Countdown → Playing → Results → Rematch / Setup / Home
                                 ↕ Paused (local only)
```

Match baseline ทดลองของ TDM คือ 5 นาทีหรือ 10 kills ของทีมอย่างใดถึงก่อน ค่าของโหมดอื่นอยู่ในหัวข้อของโหมดนั้น Countdown 3 s และยังไม่ยอมรับ weapon fire; clock ใช้ simulation tick ไม่ `Date.now()` เสมอ ถ้า score เท่ากันเมื่อหมดเวลาเป็น draw ไม่เปิด overtime ที่ไม่ประกาศไว้ Priority Target เป็นโหมดเดียวที่ประกาศ overtime ในกติกา

ภายใน Playing aircraft lifecycle เป็น `alive → destroyed → respawn-wait → alive` การตายไม่จบทั้ง session และไม่ reload scene

## กติการายโหมด

ตัวเลขทุกค่าในหัวข้อนี้เป็น **ค่าทดลอง** ต้องปรับจาก playtest (17)

### Team Deathmatch (`tdm`)

- Kill ศัตรูได้ +1 ให้ทีม คะแนนรายบุคคลเก็บแยกเพื่อแสดงใน results
- ถึง score limit ก่อนชนะ หมดเวลาแล้วคะแนนเท่ากันคือเสมอ
- ค่าเริ่มต้น: 5 นาที, score limit `10 × teamSize` ปรับได้ใน setup

### Control Point (`control-point`)

- Map มีจุดยึดสามจุด (A/B/C) แต่ละจุดเป็นทรงกระบอก รัศมีทดลอง 800 m และมีเพดานความสูง 1,500 m เหนือพื้น
- รัศมีต้องใหญ่กว่ารัศมีเลี้ยวของการบินปกติ เพราะเครื่องบินหยุดนิ่งไม่ได้: ที่ 130 m/s และราว 4 g รัศมีเลี้ยวประมาณ v²/(g·√(n²−1)) ≈ 450 m จึงเลือก 800 m ให้วนอยู่ในวงได้พร้อมพื้นที่หลบ
- เพดานบังคับให้การยึดจุดเกิดที่ความสูงต่ำ ซึ่งมีความเสี่ยงจากพื้นและทำให้เกิดการปะทะ
- จุดเป็นกลางใช้ 10 s ในการยึดโดยเครื่องหนึ่งลำ ลำที่เพิ่มในทีมเดียวกันเร่งได้สูงสุด 2 เท่า ถ้ามีทั้งสองทีมอยู่ในจุด (contested) ความคืบหน้าหยุด การยึดจุดของศัตรูต้องทำให้จุดกลับเป็นกลางก่อน
- ทีมได้ 1 คะแนนต่อจุดที่ถือ ทุก 2 s ถึง 100 คะแนนก่อนชนะ kill ไม่ให้คะแนนโหมด แต่เก็บในสถิติ
- เครื่องที่อยู่ใน respawn protection ไม่นับเป็นผู้ยึดจุด
- ค่าเริ่มต้น: 10 นาที หมดเวลาแล้วทีมที่คะแนนมากกว่าชนะ

### ชิงธง (`ctf`)

- แต่ละทีมมีฐานพร้อมธงหนึ่งผืน โซนธงเป็นทรงกระบอก รัศมีทดลอง 250 m และต้องบินผ่านต่ำกว่า 300 m เหนือพื้น
- เก็บธงศัตรูโดยบินเข้าโซนธงศัตรูภายใต้เพดาน ไม่ต้องหยุดหรือลงจอด
- เครื่องที่ถือธงถูกแสดงตำแหน่งให้ทุกคนเห็นตลอด ใช้ PSM ไม่ได้ขณะถือธง (ข้อเสนอเพื่อไม่ให้ถือธงแล้วหมุนหนีได้ง่าย)
- นำธงกลับเข้าโซนธงของทีมตัวเองขณะที่ธงของทีมอยู่ที่ฐาน ได้ 1 capture
- ผู้ถือธงถูกยิงตกหรือชน ธงตกค้างที่ตำแหน่งนั้น 20 s ศัตรูของธงบินผ่านเพื่อเก็บต่อได้ ทีมเจ้าของธงบินผ่านเพื่อคืนธงกลับฐานทันที หมดเวลาแล้วธงกลับฐานเอง
- ครบ 3 capture ก่อนชนะ หมดเวลาแล้ว capture เท่ากันคือเสมอ
- เครื่องที่อยู่ใน respawn protection เก็บธงไม่ได้
- ค่าเริ่มต้น: 10 นาที

### Priority Target (`priority-target`)

แนว “ชิงมงกุฎ” ทั้งสองทีมแย่งเป้าหมายชิ้นเดียว

- Map มีมงกุฎหนึ่งชิ้น เกิดที่จุดเกิดมงกุฎจุดใดจุดหนึ่งที่ map ประกาศ มงกุฎลอยอยู่กลางอากาศ เก็บโดยบินผ่านทรงกลมรัศมีทดลอง 200 m รอบมงกุฎ ไม่ต้องหยุด
- ระหว่างที่มีคนในทีมถือมงกุฎ ทีมนั้นได้ **1 แต้มต่อวินาที** นับจาก simulation tick สะสมเป็นเวลาถือรวมของทีม แล้วคิดแต้มเป็นจำนวนวินาทีเต็ม เพื่อไม่ให้เศษวินาทีหายเมื่อมงกุฎเปลี่ยนมือ
- **ถือได้ไม่เกิน 30 s ต่อครั้ง** ครบแล้วมงกุฎ reset: ออกจากผู้ถือและไปเกิดใหม่ที่จุดเกิดมงกุฎ ข้อเสนอ: เลือกจุดเกิดที่ไม่ใช่จุดเดิม และผู้ถือคนล่าสุดเก็บซ้ำไม่ได้ 10 s เพื่อไม่ให้ถือต่อทันที
- **ผู้ถือตาย** (ถูกยิง, ชน, ออกนอกสนาม) มงกุฎตกค้างที่ตำแหน่งนั้น 20 s ใครก็เก็บได้ทั้งสองทีม ครบ 20 s แล้วไม่มีคนเก็บให้ reset ที่จุดเกิด ถ้าตำแหน่งที่ตกต่ำกว่าพื้นที่ปลอดภัย ให้ยกมงกุฎขึ้นเป็นอย่างน้อย 150 m เหนือพื้น มงกุฎที่ตกค้างไม่ให้แต้มใคร
- ผู้ถือถูกแสดงตำแหน่งให้ทุกคนเห็นตลอด พร้อมเวลาถือที่เหลือ; ใช้ PSM ได้ตามปกติ
- เครื่องที่อยู่ใน respawn protection เก็บมงกุฎไม่ได้
- ถึง score limit ก่อนชนะ หมดเวลาแล้วทีมที่แต้มมากกว่าชนะ **ถ้าแต้มเท่ากันต่อเวลา 2 นาที** ระหว่างต่อเวลายังใช้ score limit เดิม ครบต่อเวลาแล้วแต้มยังเท่ากันเป็นเสมอ (ข้อเสนอ; ไม่ต่อเวลาซ้ำ)
- ค่าเริ่มต้น: 8 นาที, score limit 100 แต้ม (ต้องถือสำเร็จอย่างน้อย 4 ครั้งเพราะเพดาน 30 s)

### Flyover (`flyover`)

คล้าย Control Point แต่ **แค่บินผ่านก็ยึดได้** ไม่ต้องวนเฝ้าพื้นที่

- Map มีจุดสามจุด (A/B/C) แต่ละจุดเป็นทรงกลมรัศมีทดลอง 300 m วางที่ความสูงต่างกันได้ แสดงเป็นวงแหวนในโลก 3D
- เครื่องที่บินเข้าจุดยึดจุดนั้นให้ทีมทันที เจ้าของจุดเปลี่ยนเมื่อศัตรูบินผ่าน ถ้าทั้งสองทีมเข้าจุดใน tick เดียวกัน เจ้าของไม่เปลี่ยน
- ข้อเสนอกันการสลับเจ้าของรัว ๆ: จุดที่เพิ่งถูกยึดล็อก 5 s ก่อนยึดกลับได้ (ที่ 130 m/s การบินผ่านทรงกลม 600 m ใช้เวลาราว 5 s อยู่แล้ว)
- **ทีมที่ถือจุดมากกว่าได้แต้มต่อเนื่อง** 1 แต้มต่อวินาที ทีมที่ถือน้อยกว่าไม่ได้แต้ม ถ้าถือเท่ากัน (เช่น 1–1 และอีกจุดเป็นกลาง) ไม่มีใครได้แต้ม ข้อเสนอ: ถือครบทั้ง 3 จุดได้ 2 แต้มต่อวินาที
- จุดเริ่มเกมเป็นกลางทั้งหมด เครื่องที่อยู่ใน respawn protection ยึดไม่ได้
- ถึง score limit ก่อนชนะ หมดเวลาแล้วแต้มเท่ากันเป็นเสมอ
- ค่าเริ่มต้น: 10 นาที, score limit 300 แต้ม

ความต่างจาก Control Point: Control Point ต้องอยู่ในโซนต่อเนื่อง, มี contested และให้แต้มทุกจุดที่ถือ ส่วน Flyover ยึดทันทีเมื่อบินผ่าน และให้แต้มเฉพาะทีมที่ถือจุดมากกว่า จึงเน้นการบินวนรอบจุดและตัดเส้นทางศัตรูแทนการเฝ้า

Mode rules ต้องแยกเป็นโมดูลของแต่ละโหมดที่อ่าน WorldState และ events เดียวกัน ไม่ใส่ `if (mode === 'ctf')` กระจายใน flight, combat หรือ AI Map ต้องประกาศ objective ของโหมดที่รองรับตาม 14 ถ้า map ไม่มีข้อมูลของโหมด setup จะไม่ให้เลือก

## คะแนนและเครดิต

- Enemy kill +1 ให้ผู้ยิงและทีม (TDM); self crash/ขอบสนามไม่เพิ่มคะแนน
- หากถูกศัตรูทำ damage ภายใน 8 s ก่อน crash ให้เครดิต last enemy attacker; ถ้าไม่มีให้เป็น environmental death
- MVP ไม่มี assist score แต่เก็บ damage event เพื่อเพิ่มภายหลังได้
- Destruction ประมวลผลครั้งเดียวต่อ entity life; ตายพร้อมกันนับได้ทั้งคู่
- Kill ถึง limit ใน tick เดียวกันหลายคนให้ตัดสินจากคะแนนสุดท้ายของ batch ถ้าเสมอให้ draw ตาม baseline

## Respawn

หน่วง 3 s หลังตายแล้วเลือก spawn ในพื้นที่ของทีมตัวเอง ที่ห่างศัตรูอย่างน้อย 1,500 m และมีแนวบินปลอดภัย ไม่หันหัวเข้าภูเขา หากไม่มี spawn ผ่านทั้งหมดให้เลือกคะแนนความปลอดภัยสูงสุดและใช้ protection 2 s พร้อม visual cue

ช่วง protection ยิงไม่ได้และรับ damage ไม่ได้; กด fire หลังขั้นต่ำ 0.5 s ให้ยุติ protection ก่อนส่ง weapon intent เพื่อป้องกันยิงฟรีตอนไม่รับ damage ใน MVP refill HP/ammo/reserve ทุก respawn และสร้าง id ใหม่ต่อ life; เก็บ playerId แยกเพื่อสะสม score

Respawn reset speed/engine trim/maneuver/lock/heat/input ตามจุดเกิด ไม่เก็บ Z หรือปุ่มยิงที่ค้างก่อนตายไว้ บอทต้องล้าง target ที่ชี้ entity เก่า

## Pause, exit และ Offline จริง

Local pause หยุด physics, bot, match clock, projectile และ audio loops ที่ต้องหยุด เหลือเมนู/กล้อง preview ได้ตามที่ออกแบบ กลับมาเล่นต้อง clear input และใช้ user gesture เข้า pointer lock

ออก match ต้อง dispose runtime แล้วส่งกลับหน้าที่มา (PVE Setup, Campaign Map หรือ Home) โดยเก็บ settings/selection ผล match เก็บ local summary แบบ versioned ไม่เก็บ Three.js objects

Offline ใน release แรกหมายถึง **ไม่ต้องมี server เพื่อเล่น** หลังโหลดแอป/asset แล้ว ทดสอบตัด network ระหว่าง match ยังเล่นจบได้ การ reload ในโหมด airplane ต้องมี app shell + selected assets cache ผ่าน service worker ซึ่งเป็นงานแยกและยังไม่อยู่ P0–P5

## งานและเกณฑ์ผ่าน

1. ทำ lifecycle กับ dummy commands ก่อนต่อ UI
2. ต่อ TDM 1v1 guns-only และ result/rematch ให้ครบ (P4)
3. เพิ่ม team size, ally bots, difficulty, team spawn และ pause integration (P5)
4. เพิ่ม IR mode หลัง weapon acceptance ผ่าน (P5)
5. เพิ่ม Control Point, ชิงธง, Priority Target และ Flyover พร้อม objective บน map และ bot roles ตาม 08 (P5b)
6. ทดสอบ death ซ้ำ, simultaneous kills, timer/score จบพร้อมกัน, contested point, ธงตกพร้อมผู้ถือตาย, capture ใน tick เดียวกับหมดเวลา, มงกุฎครบ 30 s ใน tick เดียวกับผู้ถือตาย, เสมอแล้วเข้าต่อเวลา, สองทีมบินเข้าจุด Flyover ใน tick เดียวกัน, pause ระหว่าง missile flight, exit ขณะโหลด และ network ถูกตัด

ผ่านเมื่อผู้เล่นเข้า match ของทั้งห้าโหมด เล่นจนแพ้/ชนะ/เสมอ แล้ว rematch หรือกลับหน้า setup ได้โดยไม่มี state จากรอบก่อนหลงเหลือ
