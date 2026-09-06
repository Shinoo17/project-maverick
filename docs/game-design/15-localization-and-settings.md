# 15 — Localization, Settings และ Local Save

[กลับ Master Plan](../../MASTER_PLAN.md) · P0 เป็นต้นไป · ขั้นต่ำไทยและอังกฤษ

## ขอบเขตภาษา

ครอบคลุมเมนู โรงเก็บ facts/game stats HUD prompts tutorial settings errors results และชื่อโหมด Stable ids, aircraft model names และ technical debug fields ไม่ต้องแปลทุกอย่าง แต่ต้องมีคำอธิบายไทยในหน้าที่ผู้เล่นใช้จริง

ค่าเริ่มต้นเลือก `th` หาก browser language เป็นไทย มิฉะนั้น `en`; ผู้เล่นเปลี่ยนได้และเก็บ preference ไม่สลับกลับตาม browser ทุกครั้งที่เข้าเกม

## โครงสร้างข้อความ

Implementation P1 ใช้ `i18next` + `react-i18next` ผ่าน `initReactI18next` และ `useTranslation` ที่ `src/locales/index.ts` เก็บข้อความใน typed `en.ts` / `th.ts` namespace เดียวก่อน ขอบเขต namespace แยกตามตัวอย่างด้านล่างเมื่อข้อความโต ไม่ส่ง translation dependency เข้า game core

```text
locales/
  th/ common.json, hangar.json, flight.json, combat.json, tutorial.json, aircraft.json
  en/ common.json, hangar.json, flight.json, combat.json, tutorial.json, aircraft.json
```

ตัวอย่าง key เดียวกัน:

```json
{
  "flight.speed.target": "ความเร็วเป้าหมาย",
  "flight.psm.speedTooHigh": "ลดความเร็วให้ต่ำกว่า {speed}",
  "tutorial.speed.increase": "กด {binding} เพื่อเพิ่มความเร็วเป้าหมาย"
}
```

ใช้ translation adapter `t(key, params)` พร้อม typed key validation ให้เปลี่ยน library ได้โดยไม่กระจาย API ทั่ว game core ข้อความเต็มประโยคอยู่ใน locale ไม่ต่อคำ `t('press') + key + t('to')` เพราะลำดับภาษาไม่เหมือนกัน Plural/number/unit formatting ใช้ locale-aware API และตรวจไทย/อังกฤษทั้งคู่

`binding` ต้อง resolve จาก user binding ปัจจุบัน ไม่ hardcode W ใน tutorial แปล unit labels และใช้ตัวเลขที่กวาดอ่านง่าย HUD หน่วยความเร็วใช้ conversion กลางจาก 03 ไม่ให้แต่ละ locale คำนวณเอง

Missing translation fallback เป็น en ใน release และ log key ใน dev; CI/check ต้อง fail สำหรับ missing critical UI keys ไม่ให้ fallback กลบงานแปลที่ยังไม่เสร็จ

## Settings ownership

```ts
interface LocalPreferences {
  schemaVersion: number;
  locale: 'th' | 'en';
  controls: { presetId: string; bindingVersion: number; bindings: SavedBinding[]; sensitivity: number; invertPitch: boolean };
  camera: { view: string; rollMode: string; fov: number; shakeScale: number; dynamicFovScale: number };
  audio: { master: number; engine: number; weapons: number; ui: number };
  graphics: { quality: 'low' | 'medium' | 'high'; renderScale: number };
  accessibility: { uiScale: number; reducedMotion: boolean };
  lastSelection: { aircraftId: string; loadoutId: string; mapId: string };
}
```

นี่เป็น shape ขั้นต่ำ; SavedBinding อ้าง schema ใน input layer เก็บเลข version, validate enum/range/finite numbers และ migrate ผ่าน pure functions `v1 → v2` ห้าม overwrite custom binding เงียบ ๆ ถ้า migration ทำไม่ได้ให้ backup raw value แล้วใช้ defaults พร้อม notice

## Storage

ใช้ localStorage สำหรับ settings/last selection ขนาดเล็ก และ IndexedDB เฉพาะ replay/scenario/log ขนาดใหญ่เมื่อมีจริง เขียน settings แบบ debounce ไม่ทุก frame ไม่เก็บ runtime state, GLB หรือ access tokens ลง preferences

แยก `gameplaySettings` ที่เซิร์ฟเวอร์/โหมดกำหนดจาก `userPreferences`: ผู้เล่นปรับ damage/PSM limit ใน settings ปกติไม่ได้ Flight lab overrides เป็น dev/session data เท่านั้น

ถ้า quota เต็ม/JSON เสีย/storage ถูกปิด ให้เล่นต่อด้วย in-memory preferences และแจ้งว่าไม่บันทึก ไม่ crash เมื่อเปิดแอป ปุ่ม reset settings มี scope ชัด เช่น เฉพาะ controls หรือทุก preferences ไม่ลบ asset cache/ผลเกมโดยไม่เกี่ยวข้อง

## งานและเกณฑ์ผ่าน

1. สร้าง translation/store adapter ใน P0 และใส่ key ตั้งแต่หน้าจอแรก
2. Schema + defaults + validation + migration ก่อนทำ rebind UI
3. ต่อ live settings sensitivity/volume/locale และ settings ที่ apply รอบถัดไป
4. ตรวจ key parity, placeholder parity, long text/Thai glyphs และ persisted setting reload
5. ทดสอบข้อมูลเก่า/เสีย/เกิน range, storage denied และสลับภาษา OS ระหว่างบินว่าปุ่มตำแหน่งเดิมยังใช้ได้
