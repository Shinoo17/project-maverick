# 16 — Multiplayer: ทำท้ายสุด

[กลับ Master Plan](../../MASTER_PLAN.md) · P7 หลัง Offline release gate · เอกสารนี้เป็นขอบเขตเตรียมไว้ ไม่ใช่งาน backend ปัจจุบัน

## ขอบเขตแรก

พิสูจน์ **1v1 private room** ก่อน: create/join ด้วย room code, เลือกเครื่อง/loadout, ready, match, results และ rematch เมื่อผ่าน latency/performance จึงเพิ่ม 2v2 ไม่ตั้งเป้า 16 คนเพียงเพราะเอกสารเก่าเคยกล่าวไว้ ยังไม่ทำ ranked, global matchmaking, account progression, voice chat หรือ host migration

## สิ่งที่เตรียมตอน Offline

| ทำตั้งแต่ P0–P6 | รอ P7 |
|---|---|
| Headless simulation, stable entity/event ids | Server process, room directory, transport |
| PilotCommand ที่ไม่ผูก device | Input batching/acks, latency handling |
| Serializable snapshots + content version | Prediction/reconciliation/interpolation buffer |
| Runtime/renderer ownership แยก | Authentication/session tokens/rate limits |
| Collision data ไม่ต้องพึ่ง GLB renderer | Server deployment และ load tests |

LocalSessionHost ทำหน้าที่รับ command/step world/publish snapshot ใช้ interface ตรงไปตรงมา ก่อนมี online อย่าใส่ network-shaped promises ในทุกฟังก์ชัน core ภายหลังเพิ่ม RemoteSessionHost ที่ implementation ต่างกันใน platform boundary

## Authority

Server เป็นเจ้าของ flight state ที่ใช้ตัดสินเกม, lock, ammo, damage, hit, score, spawn และ clock Client ส่ง intent เท่านั้น ห้ามรับ client `position`, `hp`, `hitTarget` เป็นคำตัดสินจริง

Client ทำนายการบินตนเองเพื่อให้ input ตอบทันทีและแสดง muzzle/launch preview ได้ แต่ damage/hit confirm รอ server ทุก event มี stable id กันเอฟเฟกต์/คะแนนซ้ำเมื่อ reconcile การเปลี่ยน aircraft/loadout ทำก่อน spawn ผ่าน room rules ไม่เปลี่ยน stat ระหว่าง match จาก local settings

## Transport และข้อความ

ข้อเสนอเริ่มด้วย Node runtime + WebSocket เพื่อให้แชร์ TypeScript core ได้ง่าย ต้องตรวจเวอร์ชันและ API จริงตอน P7 ไม่ล็อก library/provider วันนี้ WebSocket มี ordered delivery จึงต้องทดสอบอาการ head-of-line delay; ถ้าไม่ผ่าน latency gate จึงพิจารณาทางเลือก transport

```ts
type ClientMessage =
  | { type: 'join'; protocolVersion: number; contentHash: string; roomCode: string }
  | { type: 'ready'; aircraftId: string; loadoutId: string }
  | { type: 'input'; sequence: number; commands: PilotCommand[] }
  | { type: 'leave' };

interface ServerSnapshot {
  type: 'snapshot';
  tick: number;
  acknowledgedSequence: number;
  entities: AircraftNetworkState[];
  projectiles: ProjectileNetworkState[];
  match: MatchNetworkState;
  events: GameEvent[];
}
```

Network state ต้องมีสิ่งจำเป็นต่อ simulation replay เช่น target speed, engine spool, maneuver phase/timers/reserve, heat/inventory/lock รวม RNG state ที่จำเป็นและ last processed action ids สำหรับ predicted entity ไม่ส่งแต่ position แล้วหวังว่าจะ reconcile flight ได้ DTO ใช้เลข/arrays ไม่ส่ง Three.js objects หรือ mesh/node references ข้อมูล sensor/ศัตรูส่งเท่าที่กติกาอนุญาต ไม่กระจาย server-only hidden state เพื่อให้ client คาดเดาผลเอง

Server ตรวจ finite axes/ranges, packet size, action cadence, sequence/tick windows, entity ownership, capability/loadout legality และ one-shot action ids ถ้า contentHash/protocolVersion ไม่ตรง ปฏิเสธ join พร้อมข้อความอัปเดต client ไม่ปล่อยเล่นด้วย flight profile คนละชุด

## Rates และ prediction ที่เสนอให้ benchmark

- Server world 60 Hz, flight substeps 120 Hz ตาม 01; client สร้าง input ที่ 60 Hz และส่งเป็น batch 30 ครั้ง/s เริ่มต้น
- Snapshot 20 Hz; rendering interpolate aircraft อื่นด้วย buffer ทดลอง 100 ms แล้ว tune จาก jitter จริง
- Local prediction ใช้ ticked input history; เมื่อ snapshot มา apply authoritative state และ replay เฉพาะ command ที่ยังไม่ ack
- Correct authoritative simulation state ทันที แต่ smooth visual offset ในช่วงสั้น ๆ; error ใหญ่/respawn ให้ snap พร้อม transition ที่อธิบายได้
- Bullets/missiles ใช้ server projectile world; client แสดง predicted visual โดยจับคู่ id แล้วแทนด้วย authoritative object

ตัวเลขเหล่านี้เป็น budget ทดลอง ไม่รับประกัน cross-platform bitwise determinism จากการใช้ JavaScript/Three math จึงใช้ authoritative snapshots และ reconciliation ไม่ใช้ deterministic peer lockstep เป็นฐาน

## Hit validation และ latency

เริ่มด้วย server-tick projectile collision ไม่มี client-claimed hits แล้ววัดความรู้สึกที่ RTT ต่างกัน หากต้องเพิ่ม lag compensation ให้กำหนด bounded history ทดลองสูงสุด 150 ms และระบบ catch-up projectile ที่ตรวจทั้ง target/terrain ตามเวลา ไม่ rewind เฉพาะ target ปัจจุบันแบบให้กระสุนทะลุกำแพง

อย่ารวม hitscan rewind เข้ากับ finite projectile โดยไม่มีสเปกเวลา เอกสารนี้ยังไม่เลือก algorithm lag compensation สุดท้าย; เป็น decision gate จาก 1v1 test ก่อนขยายจำนวนผู้เล่น ผู้เล่นหน่วงสูงไม่ควรได้ยิงย้อนหลังไม่จำกัด

## Connection และ lifecycle

```text
Disconnected → Connecting → Lobby → Ready → InMatch → Results
                        ↘ Rejected      ↘ Reconnecting / Disconnected
```

Input หายเกิน 250 ms ให้ neutral axes/stop firing และคง speed target ตาม flight rules ไม่ยิงค้างจาก packet เก่า เกิน 10 s ถือว่าหลุด match; reconnect เป็น spectator ก่อนแล้วกลับ respawn ที่ server อนุญาต ไม่เชื่อ state ที่ client ส่งกลับมา

เปิด pause menu online ไม่หยุดโลก ให้ปล่อย input และแสดงว่าเกมยังดำเนินอยู่ Server room cleanup เมื่อไม่มีผู้เล่น/หมด grace, timers ใช้ monotonic server clock และไม่ขึ้นกับ browser visibility

## งานและ exit gate

1. Headless server run world + protocol validator พร้อม client สองตัวบนเครื่องเดียว
2. 1v1 authority + commands/snapshots + prediction/reconcile
3. Lobby/ready/loadout/version check และ disconnect/rejoin flow
4. ทดสอบ RTT 0/50/100/150 ms, jitter 20–50 ms, loss simulation และ background tab
5. ตรวจ forged hits, duplicate actions, impossible speed commands, cooldown bypass และ oversized packets
6. ผ่านเมื่อไม่มี hit/score ซ้ำ, local control ยังใช้ได้ที่เป้า RTT 100 ms, server tick cost อยู่ใน budget แล้วจึงเพิ่ม 2v2

จำนวนห้อง/ผู้เล่นสูงสุดและ hosting ตัดสินจาก benchmark และทรัพยากรที่มีตอน P7 ไม่อ้างขีดความสามารถจากแผนเพียงอย่างเดียว
