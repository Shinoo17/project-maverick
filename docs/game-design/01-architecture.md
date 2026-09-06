# 01 — Architecture และสัญญาระหว่างระบบ

[กลับ Master Plan](../../MASTER_PLAN.md) · ใช้ตั้งแต่ P0 · เป็นเจ้าของโครงสร้างและ game loop

## เป้าหมาย

แยก React UI, Three.js view และกฎเกมให้แก้ได้อิสระ โดยยังอ่านเป็นฟังก์ชันธรรมดาได้ ใช้ TypeScript แบบ strict สำหรับโค้ดใหม่ ไม่จำเป็นต้องสร้าง ECS, dependency-injection container, generic plugin system หรือ monorepo ก่อนมีความจำเป็น

## โครงสร้างที่เสนอ

เป็นโครงสร้างเป้าหมายของแอปใหม่ภายใน workspace นี้ ยังไม่ใช่ไฟล์ที่สร้างแล้ว และไม่บังคับย้าย `example/F22` ทันที

```text
src/
  app/                 App.tsx, routes.tsx, sessionStore.ts
  content/             aircraft/, weapons/, maps/, schemas.ts, validate.ts
  game/
    runtime/           GameRuntime.ts, clock.ts, commands.ts, events.ts
    state/             WorldState.ts, AircraftState.ts, MatchState.ts
    flight/            stepFlight.ts, speed.ts, rates.ts, forces.ts, maneuvers.ts
    combat/            guns.ts, missiles.ts, targeting.ts, damage.ts
    ai/                perceive.ts, decide.ts, steer.ts
    modes/             playground.ts, deathmatch.ts, lifecycle.ts
    world/             collision.ts, bounds.ts, spawn.ts
  input/               devices.ts, bindings.ts, mouseStick.ts, toCommand.ts
  render/              GameScene.tsx, AircraftView.tsx, WorldView.tsx
    aircraft/          modelBindings.ts, animateSurfaces.ts
    cameras/           cameraRig.ts, horizonFrame.ts
    effects/           tracers.ts, exhaust.ts, explosions.ts
  features/            hangar/, playground/, offline/, settings/, results/
  ui/                  components/, hud/, prompts/
  audio/               AudioDirector.ts
  platform/            storage.ts, assetCache.ts, sessionHost.ts
  locales/             th/, en/
tests/                 flight/, combat/, modes/, content/, integration/
public/assets/         aircraft/, weapons/, maps/, audio/
```

`content` เป็นข้อมูล; `game` อ่านข้อมูลและคำนวณ; `render/input/features` พึ่ง `game` ได้ แต่ `game` ห้าม import กลับไปหา React, DOM, loader หรือ network ใช้ Three.js math classes ใน core ได้ในระยะแรก เพราะของเดิมใช้อยู่และรัน headless ได้ แต่ห้ามใส่ Object3D ลง WorldState และต้องแปลง Vector3/Quaternion เป็นตัวเลขก่อน serialize

## State และ command

```ts
type EntityId = string; // ไม่ใช้ชื่อโมเดล; ห้าม reuse id ใน match เดียวกัน
type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

interface PilotCommand {
  tick: number;
  entityId: EntityId;
  pitch: number; roll: number; yaw: number; // -1..1, pilot sense
  speedAdjust: number; // -1..1; bot ก็ต้องใช้ข้อจำกัดเดียวกัน
  airbrake: boolean; afterburner: boolean;
  highG: boolean; psmArm: boolean;
  gunHeld: boolean;
  actions: Array<
    | { id: number; type: 'fire-missile' }
    | { id: number; type: 'countermeasure' }
    | { id: number; type: 'select-target'; targetId: EntityId | null }
    | { id: number; type: 'select-secondary'; slot: number }
  >; // one-shot; ใช้ id กันซ้ำ
}

interface AircraftState {
  id: EntityId; aircraftId: string; teamId: string;
  position: Vec3; orientation: Quat; velocity: Vec3;
  rates: { pitch: number; yaw: number; roll: number }; // rad/s
  targetSpeedMps: number; enginePower: number;
  hp: number; alive: boolean;
  // implementation เพิ่ม maneuver state, inventory, gun heat, lock state
}

type GameEvent =
  | { id: string; tick: number; type: 'weapon-fired'; entityId: EntityId; weaponId: string }
  | { id: string; tick: number; type: 'damage-applied'; targetId: EntityId; sourceId: EntityId | null; amount: number }
  | { id: string; tick: number; type: 'aircraft-destroyed'; entityId: EntityId; sourceId: EntityId | null; cause: 'weapon' | 'terrain' | 'boundary' }
  | { id: string; tick: number; type: 'match-ended'; winnerId: string | null };
```

ตัวอย่างนี้เป็น contract ขั้นต่ำ ไม่ใช่ schema ครบทุก field ใช้ concrete interfaces เมื่อเพิ่มระบบ ไม่ใช้ `Record<string, any>` แทน state ทั้งเกม `CameraCommand` และ `UiAction` แยกจาก PilotCommand เพราะกล้อง/menu ไม่ใช่กฎ simulation

## ผู้เป็นเจ้าของข้อมูล

| ข้อมูล | ผู้เขียน | ผู้อ่าน |
|---|---|---|
| keyboard/mouse raw state | input adapter | command builder |
| position, velocity, attitude, energy | flight step | collision, combat, view, HUD |
| hp, ammo, lock | combat step | mode, view, HUD |
| spawn, death timer, score, match state | mode/lifecycle | runtime, UI |
| camera pose | camera rig | renderer |
| settings, selection, locale | app/settings store | input, render, UI |

การ spawn เป็นคำสั่ง lifecycle ที่ initialize flight state ได้; ห้าม `AircraftView` ย้ายเครื่องกลับจุดเกิดเอง ทุก event มี id ใช้ซ้ำได้ในการ reconcile โดยไม่เล่นเสียง/เพิ่มคะแนนซ้ำ

## Game loop เดียว

ข้อเสนอใหม่ใช้ world tick **60 Hz** และ flight integration **สอง substeps ต่อ tick** จึงรักษาขั้นการบิน 120 Hz ของตัวอย่างไว้โดยให้ combat/rules อยู่ที่ 60 Hz:

1. อ่าน/ตรวจ command ของ tick นี้ ใช้ one-shot แต่ละ id ครั้งเดียว
2. AI perception/decision ทำ 10 Hz แบบกระจาย tick; steering เขียน command ทุก world tick
3. จำลองการบินสองครั้งที่ `dt = 1/120`; เก็บ previous/current transform
4. ตรวจ aircraft/terrain collision และ apply death ที่เกิดจากเส้นทางเคลื่อนที่
5. targeting, weapon spawn และ projectile movement; swept collision สำหรับวัตถุเร็ว
6. apply damage แล้วให้ mode รับ destruction เพื่อนับคะแนน/ตั้ง respawn
7. publish events และ snapshot; renderer interpolate โดยไม่แก้ authoritative state

Runtime ใช้ accumulator, clamp incoming frame delta ที่ 100 ms และไม่เกิน 6 world ticks ต่อ render frame เมื่อเกิน budget ให้บันทึก dropped-time metric และทิ้งส่วนเกินเฉพาะ local session; online client ต้อง resync กับ server ไม่ชะลอโลก server ตาม render FPS เมื่อ pause local ให้ล้าง accumulator และ input ก่อนกลับมา ห้าม catch up เวลาที่ซ่อนแท็บ

ยึดหลักแยก simulation timestep ออกจาก render timestep และมีขีดจำกัดการ catch-up ตาม [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/); จำนวน Hz ข้างต้นเป็นข้อเสนอเฉพาะเกมนี้

## React และ lifecycle

Runtime เก็บ state ที่เปลี่ยนถี่ใน object/ref ภายนอก React; UI รับ snapshot ผ่าน store subscription เช่น `useSyncExternalStore` ที่คืน snapshot เดิมจนกว่าจะ publish ใหม่ HUD ตัวเลขประมาณ 10–20 Hz ส่วน reticle/transform อัปเดตใน render loop ไม่กระจาย `setState` ทุก aircraft ทุก frame การเปลี่ยน ref ไม่กระตุ้น React render ตาม [React useRef](https://react.dev/reference/react/useRef)

มี `createSession(config)`, `start()`, `pause()`, `resume()`, `dispose()` ที่ชัดเจน dispose ถอด event listeners, pointer lock, audio และคืน asset handles ให้ cache ต้องทน React Strict Mode setup/cleanup ซ้ำได้ และมีเจ้าของ animation loop เดียว อย่าเพิ่ม `requestAnimationFrame` อีกตัวทับ R3F/SyncedFrameLoop เดิม

## ลำดับลงมือและเกณฑ์ผ่าน

1. สร้าง command/state/event contracts และ headless world ที่มีสอง aircraft ids
2. ย้าย owner ของ clock/reset ออกจาก component แล้วต่อ `AircraftView` ที่อ่าน snapshot
3. ต่อ input adapter กับ runtime; จากนั้นต่อ bot adapter โดยไม่เปลี่ยน flight API
4. เพิ่ม lifecycle tests: mount/unmount สลับโหมด 20 ครั้งไม่มี loop/listener เพิ่ม; destruction event ครั้งเดียวต่อ entity
5. ใช้ input sequence เดียวกันที่ render 30/60/144 FPS แล้วผล headless เท่ากันภายใน tolerance ใน 17

เมื่อมี consumer ตัวที่สองจึงค่อยแยก helper ร่วม หลีกเลี่ยงไฟล์ `utils.ts` ที่รวมทุกเรื่อง และหลีกเลี่ยงแตกไฟล์หนึ่งฟังก์ชันสั้น ๆ โดยไม่มีขอบเขตที่ช่วยอ่าน
