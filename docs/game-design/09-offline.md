# 09 — Offline Mode และ Match Lifecycle

[กลับ Master Plan](../../MASTER_PLAN.md) · P4–P6 · พึ่ง runtime, bots, combat และ world

## โหมดที่ทำก่อน

**Dogfight vs Bots** เริ่มจาก 1v1; หลังเล่นครบ loop แล้วเพิ่ม free-for-all รวมสูงสุด 4 ลำใน Offline MVP จำนวนนี้เป็นเป้าทดลองตาม performance ไม่ใช่ข้อจำกัดถาวร Team Deathmatch เป็น extension หลัง FFA นิ่ง; zone capture/CTF/campaign ไม่อยู่ใน release แรก

ตั้งค่าก่อนเริ่ม: aircraft, loadout, map, bot count, difficulty, guns-only หรือ guns+IR, time limit และ score limit ใช้ preset “เริ่มเร็ว” ลดการตั้งค่าที่มือใหม่ต้องเข้าใจ

## Session config และ lifecycle

```ts
interface SessionConfig {
  mode: 'playground' | 'offline-dogfight';
  mapId: string;
  playerAircraftId: string;
  loadoutId: string;
  seed: number;
  rules: {
    botCount: number;
    difficulty: 'easy' | 'normal' | 'hard';
    weapons: 'guns-only' | 'guns-ir';
    timeLimitSeconds: number;
    scoreLimit: number;
  };
}
```

```text
Configure → Loading → Countdown → Playing → Results → Rematch / Hangar
                                 ↕ Paused (local only)
```

Match baseline ทดลอง 5 นาทีหรือ 10 kills อย่างใดถึงก่อน Countdown 3 s และยังไม่ยอมรับ weapon fire; clock ใช้ simulation tick ไม่ `Date.now()` เสมอ ถ้า score เท่ากันเมื่อหมดเวลาเป็น draw ไม่เปิด overtime ที่ไม่ประกาศไว้

ภายใน Playing aircraft lifecycle เป็น `alive → destroyed → respawn-wait → alive` การตายไม่จบทั้ง session และไม่ reload scene

## คะแนนและเครดิต

- Enemy kill +1; self crash/ขอบสนามไม่เพิ่มคะแนนตนเอง
- หากถูกศัตรูทำ damage ภายใน 8 s ก่อน crash ให้เครดิต last enemy attacker; ถ้าไม่มีให้เป็น environmental death
- MVP ไม่มี assist score แต่เก็บ damage event เพื่อเพิ่มภายหลังได้
- Destruction ประมวลผลครั้งเดียวต่อ entity life; ตายพร้อมกันนับได้ทั้งคู่
- Kill ถึง limit ใน tick เดียวกันหลายคนให้ตัดสินจากคะแนนสุดท้ายของ batch ถ้าเสมอให้ draw ตาม baseline

## Respawn

หน่วง 3 s หลังตายแล้วเลือก spawn ที่ห่างศัตรูอย่างน้อย 1,500 m และมีแนวบินปลอดภัย ไม่หันหัวเข้าภูเขา หากไม่มี spawn ผ่านทั้งหมดให้เลือกคะแนนความปลอดภัยสูงสุดและใช้ protection 2 s พร้อม visual cue

ช่วง protection ยิงไม่ได้และรับ damage ไม่ได้; กด fire หลังขั้นต่ำ 0.5 s ให้ยุติ protection ก่อนส่ง weapon intent เพื่อป้องกันยิงฟรีตอนไม่รับ damage ใน MVP refill HP/ammo/reserve ทุก respawn และสร้าง id ใหม่ต่อ life; เก็บ playerId แยกเพื่อสะสม score

Respawn reset speed/engine trim/maneuver/lock/heat/input ตามจุดเกิด ไม่เก็บ Z หรือปุ่มยิงที่ค้างก่อนตายไว้ บอทต้องล้าง target ที่ชี้ entity เก่า

## Pause, exit และ Offline จริง

Local pause หยุด physics, bot, match clock, projectile และ audio loops ที่ต้องหยุด เหลือเมนู/กล้อง preview ได้ตามที่ออกแบบ กลับมาเล่นต้อง clear input และใช้ user gesture เข้า pointer lock

ออก match ต้อง dispose runtime แล้วส่งกลับ Hangar โดยเก็บ settings/selection ผล match เก็บ local summary แบบ versioned ไม่เก็บ Three.js objects

Offline ใน release แรกหมายถึง **ไม่ต้องมี server เพื่อเล่น** หลังโหลดแอป/asset แล้ว ทดสอบตัด network ระหว่าง match ยังเล่นจบได้ การ reload ในโหมด airplane ต้องมี app shell + selected assets cache ผ่าน service worker ซึ่งเป็นงานแยกและยังไม่อยู่ P0–P5

## งานและเกณฑ์ผ่าน

1. ทำ lifecycle กับ dummy commands ก่อนต่อ UI
2. ต่อ guns-only 1v1 และ result/rematch ให้ครบ
3. เพิ่ม bots count/difficulty, spawn selection และ pause integration
4. เพิ่ม IR mode หลัง weapon acceptance ผ่าน
5. ทดสอบ death ซ้ำ, simultaneous kills, timer/score จบพร้อมกัน, pause ระหว่าง missile flight, exit ขณะโหลด และ network ถูกตัด

ผ่านเมื่อผู้เล่นเข้า match เล่นจนแพ้/ชนะ/เสมอ แล้ว rematch หรือกลับโรงเก็บได้โดยไม่มี state จากรอบก่อนหลงเหลือ
