# 18 — แยกโค้ดเดิมและ Backlog ที่ลงมือทำต่อได้

[กลับ Master Plan](../../MASTER_PLAN.md) · อ่านก่อนเริ่ม P0 · เป็นแผน ยังไม่ได้ refactor

## สิ่งที่ตรวจพบจาก workspace จริง

แอปตัวอย่างอยู่ใน [example/F22](../../example/F22/README.md) เป็น JavaScript + React + R3F + Vite; package.json ระบุ React `^19.1.1`, Three `^0.180.0`, R3F `^9.3.0` และ Drei `^10.7.6` นี่คือ declarations ที่อ่านได้ ไม่ใช่การยืนยัน installed versions

| จุดเดิม | ข้อค้นพบ | แนวทาง |
|---|---|---|
| [FlightAircraft.jsx](../../example/F22/src/features/flight/FlightAircraft.jsx) | 527 บรรทัด รวม simulation clock, model clone, camera, terrain sampling, reset และ VFX | แยก runtime entity owner ออกจาก AircraftView ก่อนเพิ่มหลายลำ |
| [FlightRangeRoute.jsx](../../example/F22/src/routes/FlightRangeRoute.jsx) | 610 บรรทัด มี route/session/settings/pointer flow | ให้ route ประกอบหน้า; ย้าย settings/input context/session host ออก |
| [flight-model/step.js](../../example/F22/src/features/flight/flight-model/step.js) | 1,149 บรรทัด; orientation/velocity แยกแล้ว; fixed step 1/120 | รักษาหลักที่ดี แยก rates/forces/speed/maneuver ทีละ seam |
| [flightInput.js](../../example/F22/src/features/flight/flightInput.js) | W/S ยังเป็น power intent และมี W+S extreme chord | เปลี่ยน semantic contract ให้ตรง target-speed spec ใหม่ ห้ามแค่เปลี่ยน label |
| [chaseCamera.js](../../example/F22/src/features/flight/chaseCamera.js) | 1,155 บรรทัดและมีโมดูลย่อย | ใช้ scenarios เดิมป้องกัน regression ก่อนแยก view/roll policy |
| [aircraft/f22.js](../../example/F22/src/aircraft/f22.js) | 975 บรรทัด รวม tuning, rig mapping และ functions เฉพาะ F-22 | แยก facts/flight/presentation/loadout; numeric content ไม่รับ callbacks |
| [ManeuverBot.jsx](../../example/F22/src/features/flight/ManeuverBot.jsx) | scripted autopilot ผ่าน input เดียวกับผู้เล่น | เก็บแนวคิดไว้เป็น scenario runner; combat AI เพิ่ม perception/tactics ใหม่ |
| [useFlightSession.js](../../example/F22/src/features/flight/useFlightSession.js) | ใช้ refs สำหรับ input/telemetry แล้ว | รักษาการแยก high-frequency state จาก React |
| [SyncedFrameLoop.jsx](../../example/F22/src/three/SyncedFrameLoop.jsx) | มี manual frame loop และ pause redraw | ต้องเลือกเจ้าของ loop เดียวเมื่อเชื่อม runtime ใหม่ |

จำนวนบรรทัดเป็นสัญญาณประกอบ ไม่ใช่เหตุผลให้แตกทุกไฟล์ เป้าจริงคือแยกผู้เขียน state และลด coupling

## วิธีเปลี่ยนที่เสนอ

เก็บตัวอย่างเดิมเป็น behavioral reference และพัฒนาระบบใหม่ในพื้นที่แอปที่เลือกภายใน workspace เดียวกัน ไม่สร้าง sibling repo ตามข้อความในแผนเก่าโดยอัตโนมัติ เลือก path ที่ยังว่างตอนเริ่ม implementation และไม่ทับ code ปัจจุบัน

ใช้ **ย้ายทีละขอบเขตพร้อมปรับพฤติกรรมที่ผู้ใช้ต้องการ** ไม่ copy ไฟล์ยาวทั้งชุดแล้วเพิ่ม combat ทับ และไม่เขียนคณิตศาสตร์ทุกอย่างใหม่เพียงเพื่อให้ไม่มี import จาก Three.js

ก่อนเปลี่ยนพฤติกรรมให้เก็บ baseline scenario/result ที่เดิมทำได้ เช่น camera roll/PSM separation แล้วแยกให้ชัดว่าความต่างใดเป็น regression และความต่างใดตั้งใจเปลี่ยนตาม 02–04

## P0 — Foundation

| Task | ไฟล์/ผลลัพธ์ที่ต้องมี | Acceptance |
|---|---|---|
| FND-01 Baseline | บันทึก package-lock/build/check results และ 3 flight scenarios | รู้ว่าเดิมผ่าน/ล้มเหลวอะไร; ไม่อ้างผลที่ยังไม่รัน |
| FND-02 Contracts | `game/runtime/commands.ts`, `events.ts`, `state/*` | สร้างสอง entity ids และ serialize snapshot round-trip ได้ |
| FND-03 Content | `content/schemas.ts`, `validate.ts`, aircraft baseline | unknown ids/NaN/bad ranges ถูกปฏิเสธพร้อม field path |
| FND-04 Runtime | `GameRuntime.ts`, `clock.ts`, lifecycle | fixed tick + pause/reset/dispose; ไม่มี renderer import |
| FND-05 App shell | routes, sessionStore, locale adapter, settings schema | เปลี่ยนภาษาและกลับหน้าหลักได้ก่อนมี GLB |

FND-02/03 ทำก่อนนำ flight state เข้า runtime; FND-04 gate ต้องผ่านก่อนต่อ view หลายลำ ไม่สร้าง server package ใน phase นี้

## P1 — เครื่องหนึ่งลำที่บังคับง่าย

มี implementation baseline แล้ว: ดู [Phase 1 flight slice](../phase-1-flight-slice.md) สำหรับไฟล์เจ้าของงานและผลตรวจ ตารางด้านล่างเป็น acceptance เป้าหมาย โดย flight feel และ release QA ยังต้อง playtest

| Task | ผลลัพธ์ | Acceptance |
|---|---|---|
| FLT-01 | Flat map + canonical axes + safe spawn | scale/forward/pitch/yaw/roll sign ตรงกันทั้ง sim และ GLB |
| FLT-02 | `speed.ts`, target-speed state และ thrust controller | W/S มีความหมายใหม่จริง; brake priority; release behavior ผ่าน |
| FLT-03 | rates/forces/integrator แยกหน้าที่ | nose/path แยก; energy/recovery; no NaN ที่ low speed |
| FLT-04 | input adapters + presets + pointer lifecycle | keyboard/mouse, blur/unlock, conflicts ผ่าน |
| FLT-05 | AircraftView + CameraRig + HUD snapshot | view ไม่ step simulation; camera mode ไม่เปลี่ยน flight outcome |
| FLT-06 | F-22 rig/asset manifest ขั้นต้น | control surfaces/exhaust อ่านผล state; multiple clones อิสระ |

จบ phase ด้วยฉากเล็กที่เล่นได้ ไม่รอ UI โรงเก็บเต็มรูปแบบ หาก flight feel ยังไม่ดีให้ใช้ Playground ปรับก่อนทำ effects เพิ่ม

## P2 — Maneuver และ Playground

ทำตามลำดับ: telemetry/scenario runner → Airbrake + burner → High-G → PSM gates/recovery/cooldown → Cobra nose/path detection → tutorial 1–6 → input/camera settings persist

ส่งมอบ scenario JSON และผล measured speed loss/recovery ของ normal turn, High-G, Cobra แต่ละอย่าง ห้ามทำ detection สำเร็จจาก animation name ต้องอ่าน trajectory จริง

## P3 — Hangar และ Content

เพิ่ม aircraft registry/UI → facts/game tabs → loadout presets/hardpoints → flight/hangar asset variants → profile ที่สอง → comparison benchmarks → aircraft ที่สามเมื่อ asset พร้อม

Gate: ออกจาก Hangar ด้วย aircraftId/loadoutId แล้ว inventory/flight profile ตรงกัน เพิ่มลำที่ใช้กลไกเดิมโดยไม่เพิ่ม branch ใน core ถ้าใช้ proxy ให้ระบุ dev-only; ไม่ถือว่าลำ production เสร็จ

## P4 — Gun duel ก่อน Missile

Swept collision/world queries → bullet sim + heat → damage/death events → target drone → basic combat bot → match timer/score/respawn → results/rematch → playtest firing windows

Gate: 1v1 guns-only จบ match ได้; ไม่มี tunneling/death ซ้ำ; speed/weapon geometry ให้จังหวะเล็ง จากนั้นเท่านั้นจึงเพิ่ม missile หากติดเรื่อง flight feel ให้กลับแก้ 03 โดยบันทึกก่อน/หลัง

## P5 — Offline combat

IR target selection/lock → missile guidance/arming/proximity → flare decoys → warning HUD/audio → bot evade/extend/recover → difficulty → bot count/FFA options → full-session checks

Gate: guns+IR มี counterplay, pause/resume ถูกต้อง และเล่นจบเมื่อ network ถูกตัดหลัง asset โหลดครบ

## P6 — Offline release

เติม roster สามลำและตรวจ facts → สนาม dogfight/collision QA → cross-aircraft balance → complete localization/rebinding/accessibility → audio/VFX budgets → long-session/resource tests → release checklist ใน 17

Radar missile เป็น optional extension หลัง IR; ถ้าไม่พร้อมให้ disabled combat slot และแสดง knowledge-only ใน viewer ไม่ทำระบบครึ่งหนึ่งที่ผู้เล่นเลือกใช้แล้วไม่มี countermeasure

## P7 — Multiplayer

ทำงานตาม 16 หลัง P6 ผ่านเท่านั้น: server core/validation → 1v1 snapshot/input → prediction/reconcile → lobby/lifecycle → latency/security/load tests → พิจารณา 2v2

## วิธีแบ่งงานให้โค้ดไม่กลับมาเละ

หนึ่งงานควรมีพฤติกรรมที่ตรวจได้หนึ่งเรื่อง พร้อมชื่อ owner ของ state, input/output contract, test ที่จำเป็น และเอกสารที่ต้องอัปเดต ไม่รวม “refactor flight + missile + bot + camera polish” ใน change เดียว

ก่อนปิดงานตรวจว่า: มีผู้เขียน state คนเดียวหรือไม่, มีเลข tuning ที่ควรอยู่ profile หรือไม่, มีชื่อ aircraft/mesh หลุดเข้า core หรือไม่, reset/dispose ครบหรือไม่, และ doc เจ้าของกฎตรงกับ implementation หรือไม่

เมื่อ helper มีผู้ใช้คนเดียวให้คงใกล้ระบบนั้นก่อน หากไฟล์เริ่มยาวเพราะหลายหน้าที่ให้แยกตามหน้าที่ ไม่แก้ด้วย global event bus ที่ส่ง string messages โดยไม่มี schema
