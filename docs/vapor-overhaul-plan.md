# Vapor Effects Overhaul Plan

> แผนปรับ vapor ของเครื่องบินในเกมให้สมจริงขึ้น — ใช้โมเดลฟิสิกส์แบบง่ายขับ effect แทนการเปิด/ปิดตามความเร็ว
> Stack อ้างอิง: React + Three.js · เป็น cosmetic ฝั่ง client ทั้งหมด (ไม่ต้องส่งผ่าน network)
>
> **สถานะ 21 ต.ค. 2026:** Phase 0, 1, 2 และ 5 (vapor cone) ทำแล้วใน `src/render/vapor/`; Phase 3 ใช้เมฆเหนือปีกเดิมที่ขับด้วยโมเดลใหม่ + flicker; Phase 4, 6, 7 ยังไม่ทำ ตัวเลขที่ต่างจากแผนและเหตุผลอยู่ใน [D19](game-design/19-sources-and-decisions.md) และข้อ 10 ด้านล่าง

---

## 1. เป้าหมาย

- **ถูกชนิด ถูกตำแหน่ง** — แยก vapor 4 แบบตามกลไกจริง: LEX/leading-edge vortex, upper-surface fog, wingtip vortex, vapor cone
- **ถูกตัวกระตุ้น** — vortex/fog ขับด้วย **G-load + AoA**, vapor cone ขับด้วย **Mach** (ไม่ใช่ความเร็วอย่างเดียว)
- **ขึ้นกับสภาพแวดล้อม** — แผนที่ชื้น/ทะเลเห็นบ่อย, ทะเลทราย/ที่สูงเห็นน้อยหรือไม่เห็น
- **รายลำ** — รูปแบบ vapor ต่างตาม planform (F/A-18 LEX ชัด, F-22 ตามแนว chine/โคนปีก, Su-57 จาก LEVCON) — ตรงกับแนวคิดเกมที่แต่ละลำทำ PSM ได้ไม่เหมือนกัน

---

## 2. Phase 0 — Audit ของเดิม (ทำก่อน)

ตรวจโค้ด vapor ปัจจุบันเทียบกับอาการที่มักทำให้ "ดูไม่จริง":

- [x] **ใช้ additive blending** → vapor เรืองแสงเหมือนไฟ ควรเป็น normal alpha blend (ละอองน้ำสะท้อนแสง ไม่เปล่งแสง)
- [x] **Trigger จากความเร็ว** → ควรมาจาก G/AoA (vortex) และ Mach (cone)
- [x] **ค้างนานเหมือนควัน** → vapor จริงระเหยภายในเสี้ยววินาทีเมื่ออากาศกลับสู่ความดันปกติ
- [x] **จุดกำเนิดผิด** → ปล่อยจากปลายปีกอย่างเดียว ทั้งที่ภาพจริงส่วนใหญ่มาจากโคนปีก/LEX
- [x] **ทึบเท่ากันทั้งเส้น** → ขาด noise, ขาดการขยาย/แตกฟุ้ง (vortex burst)
- [x] **ไม่รับแสง** → ไม่มี backlit glow เมื่อหันเข้าหาดวงอาทิตย์
- [x] **ตัดกับผิวเครื่องเป็นเส้นแข็ง** → ขาด soft particle / depth fade
- [x] **สีเทาหม่นเหมือนควันไฟ** → vapor ควรขาวอมฟ้าในเงา, ขาวสว่างเมื่อโดนแดด
- [x] **ปนกับ contrail** → contrail (จากไอเสีย) ควรเกิดเฉพาะที่สูงและหนาวจัด ไม่ใช่ตอนเลี้ยวแรง

**Output** — รายการปัญหาจริงของเกม + ตัดสินใจว่าจะ refactor หรือเขียน `VaporSystem` ใหม่

### ผล audit (21 ต.ค. 2026)

ระบบเดิมคือ `CondensationVolume` (`src/render/vapor/`): pass เต็มจอที่วาด scene ลง MSAA target แล้ว ray march density field ใน space ของเครื่อง มีสองส่วน คือ เส้นแกนตรงจากปลายปีก (wingtip core) และเมฆเหนือ/ใต้ปีก (pressure cloud) pass เดียวกันวาด exhaust ด้วย

| ข้อ | ผล | หมายเหตุ |
|---|---|---|
| Additive blending | **ผ่าน** | ผสมด้วย optical depth (`exp(-τ)`) ไม่บวกแสง |
| Trigger จากความเร็ว | **แก้แล้ว** | เดิมคูณ `smoothstep(speed)` เป็นตัวหลัก; ตอนนี้ใช้ ΔT จาก G/AoA/Mach (ข้อ 3) ความเร็วใช้แค่ตัดตอนอากาศเกือบนิ่ง |
| ค้างนาน | **แก้แล้ว** | release เดิม 0.45 s → 0.12 s; attack 0.07 s แยกต่อ effect |
| จุดกำเนิดผิด | **แก้แล้ว** | เดิมมีแค่ปลายปีก + เมฆ; เพิ่ม LEX/chine vortex จากพิกัดที่วัดจาก GLB |
| ทึบเท่ากัน / ไม่มี burst | **แก้แล้ว** | LEX มี noise เลื่อนตามแกน + burst ตาม AoA |
| ไม่รับแสง | บางส่วน | มี forward glow `pow(dot(ray, sun), 6)` แต่ยังไม่ใช่ HG (Phase 6) |
| ตัดผิวเครื่องแข็ง | **ผ่าน** | ray หยุดที่ `sceneDepth` ของ MSAA target ตัวเครื่องบังได้นุ่ม |
| สีเทาหม่น | **ผ่าน** | ขาวเป็นกลาง + ฟ้าในเงาของเมฆ |
| ปนกับ contrail | **ผ่าน** | ไม่มีระบบ contrail; เส้นปลายปีกเป็น vortex ไม่ใช่ไอเสีย |

**ตัดสินใจ: refactor ไม่เขียน `VaporSystem` ใหม่** effect ใหม่เป็น density field ใน ray march เดิม ไม่ใช้ tube mesh + `NormalBlending` ตามข้อ 4–5 เพราะ pass เดิมเป็นเจ้าของ MSAA resolve, depth และ exhaust อยู่แล้ว ได้ soft edge และการบังฟรี และ doc 22 วางแผน pipeline ต่อจาก pass นี้ ส่วนเส้นปลายปีกแบบตรงตามลมสัมพัทธ์ (ไม่ใช่ ribbon ใน world space) เป็นการออกแบบเดิมที่ตั้งใจไว้ Phase 4 จึงยังเปิดให้ตัดสินใจ

---

## 3. โมเดลฟิสิกส์แบบง่าย (หัวใจของแผน)

ใช้หลักเดียวกันทุก effect: **ประเมินว่าอากาศเฉพาะจุดเย็นลงกี่องศา (ΔT) แล้วเทียบกับระยะห่างจากจุดน้ำค้าง (D)**

### 3.1 สภาพแวดล้อม (ต่อแผนที่)

```ts
interface MapAtmosphere {
  seaLevelTempC: number;   // เช่น 30 (ทะเลเขตร้อน), 5 (หิมะ), 38 (ทะเลทราย)
  seaLevelRH: number;      // 0–100
  sunDir: Vector3;
}
```

- **อุณหภูมิตามความสูง** — `T(h) = T0 − 6.5·h_km` (ISA lapse rate)
- **จุดน้ำค้างที่ผิวพื้น** — Magnus: `γ = ln(RH/100) + a·T/(b+T)`, `Td = b·γ/(a − γ)` โดย `a = 17.62`, `b = 243.12 °C`
- **จุดน้ำค้างตามความสูง** — ประมาณ `Td(h) = Td0 − 2·h_km`
- **Dew-point depression** — `D = T − Td` (ยิ่งน้อยยิ่งเกิด vapor ง่าย)
- **ปริมาณน้ำ** — `W = clamp(e_sat(Td) / e_sat(25 °C), 0.15, 1)` อากาศเย็น/แห้งมีน้ำน้อย → vapor บางลงแม้จะควบแน่น

### 3.2 Cooling ต่อ effect

ใช้ข้อเท็จจริงที่ว่า `q·CL = n·(W/S)` → ความแรงของ vortex/การดูดบนปีก **แปรตาม G × wing loading**

| Effect | ΔT (ค่าเริ่ม ต้อง tune) | เงื่อนไขเพิ่ม |
|---|---|---|
| **LEX / leading-edge vortex** | `K_lex · n · (WS / WS_ref) · smoothstep(8°, 20°, α)` · `K_lex ≈ 4 K/G` | ต้องมี AoA |
| **Upper-surface fog** | `K_wing · n · (WS / WS_ref)` · `K_wing ≈ 2.5 K/G` | กระพริบมากกว่า, อยู่ติดผิว |
| **Wingtip vortex** | `K_tip · n · (WS / WS_ref)` · `K_tip ≈ 2 K/G` | เส้นบาง, เด่นตอนบินช้า CL สูง |
| **Vapor cone** | isentropic: `ΔT = T0/(1+0.2·M∞²)·[...]` ใช้ `M_local = M∞ + δ` (δ ≈ 0.2 ที่ canopy) | เฉพาะ `M_local > 1` |

- **`WS_ref`** — wing loading อ้างอิง (เช่น 380 kg/m²) ให้ลำที่ปีกหนักแรงกดสูงเกิด vapor ง่ายกว่า
- **Vapor cone** — คำนวณ `T_static` จาก `T0 = T∞·(1 + 0.2·M∞²)` แล้ว `T_local = T0 / (1 + 0.2·M_local²)` → `ΔT = T∞ − T_local`

### 3.3 จาก ΔT เป็นความเข้ม

```ts
const band = 4; // K — ช่วงนุ่มของการเริ่มควบแน่น
const condense = smoothstep(D, D + band, dT);
const target = condense * W;
// attack เร็ว release เร็วกว่าเล็กน้อย — vapor จริงหายไวมาก
intensity = damp(intensity, target, target > intensity ? 14 : 8, dt);
```

- **ตัวอย่างความรู้สึก** — แผนที่ทะเล 30 °C, RH 80% → D ≈ 3.8 K → LEX vortex โผล่ที่ ~1.5–2 G ถ้า AoA พอ, ชัดเต็มที่ ~4 G
- **ทะเลทราย 38 °C, RH 15%** → D ≈ 30 K → แทบไม่เห็น ยกเว้น vapor cone ช่วง transonic ต่ำ

---

## 4. รายละเอียดการ render ต่อ effect

### 4.1 LEX / leading-edge vortex (ลำดับความสำคัญสูงสุด — คือ "เส้นข้างลำตัว")

- **Geometry** — tube mesh ใน local space ของเครื่อง ตาม spline ของแกน vortex: เริ่มที่ยอด LEX → เลียบลำตัวเหนือปีก → ลอยขึ้น/ออกนอกเล็กน้อยไปทางท้าย
- **รัศมี** — เล็กที่จุดเริ่ม แล้วขยายตามระยะ (cone ยาว)
- **Vortex burst** — ตำแหน่ง burst ตามแนวเส้น `s_burst = lerp(1.2, 0.0, smoothstep(20°, 40°, α))`
  - ก่อน burst: เส้นแน่น บิดเกลียว
  - หลัง burst: รัศมีขยาย ×3–4, density แตกเป็นก้อนด้วย noise, opacity ลด
  - α > 45° (PSM): burst ที่จุดเริ่ม → กลายเป็นหมอกก้อนใหญ่ปกคลุมปีก
- **Wake ใน world space** — ปล่อย ribbon สั้นๆ จากปลายเส้น (อายุ 0.3–0.8 s) ให้เห็นเส้นค้างหลังเครื่องเวลาเลี้ยว
- **Shader**
  - noise 3D scroll ไปตามแกนด้วยความเร็วอิงความเร็วอากาศ + หมุนเกลียวรอบแกน
  - opacity ของ tube: `pow(abs(dot(N, V)), 1.5)` → กลางทึบ ขอบจาง (ทางมองผ่านกลางท่อยาวกว่า)
  - fade ทั้งหัวและท้ายเส้น

### 4.2 Upper-surface fog

- **Geometry** — offset shell ของผิวบนปีก (ยกขึ้น 2–5 cm ใน scale เกม) หรือ quad ตาม planform
- **Mask ตามคอร์ด** — เริ่มที่ ~10% chord, เต็มที่ ~25%, หายที่ ~60% (pressure recovery)
- **ช่วง transonic** — ขอบท้ายคมเป็นเส้นตรงขนานกับ trailing edge (ตำแหน่ง shock บนปีก)
- **Flicker** — noise เร็ว 8–15 Hz amplitude ~15% เพราะสภาพจริงไม่เสถียร

### 4.3 Wingtip vortex

- **World-space ribbon** — เก็บ history ตำแหน่งปลายปีก (และปลาย flap ถ้ามี) 40–80 จุด, อายุ 0.5–1.5 s
- **รูปทรง** — บางมาก, ขยายช้าๆ, บิดเกลียวเล็กน้อย, จางจากปลาย
- **Camera-facing** — billboard ribbon หรือ tube 6 เหลี่ยมเมื่อกล้องใกล้

### 4.4 Vapor cone / shock collar

- **Geometry** — ปลอก revolve รอบลำตัว 1–2 ชั้น (canopy, ปีก) ใน local space
- **ขอบหน้านุ่ม ขอบหลังคม** — ขอบหลังเป็นระนาบเอียงตามมุม shock; ขอบหน้า fade ด้วย noise
- **ขยับตาม Mach** — ขอบหลังเลื่อนไปท้ายเมื่อ Mach เพิ่ม: `s_shock = smoothstep(0.85, 1.05, M∞)`; หายเมื่อ M∞ > ~1.08
- **สมมาตรบน–ล่าง** — ต่างจาก vortex ที่อยู่ด้านแรงยก
- **ผูกกับเสียง (optional)** — ไม่ต้องผูกกับ sonic boom เพราะของจริงไม่ได้หมายถึง Mach 1 พอดี

### 4.5 อื่นๆ (ทำทีหลัง)

- **Contrail** — แยกระบบ, จากไอเสีย, เฉพาะ `T(h) < −39 °C` และ RH สูงพอ, อายุนาน (หลายวินาที–นาที)
- **Inlet ground vortex** — บนรันเวย์ตอน run-up เครื่องยนต์ (เหมาะกับ Playground / หน้า Hangar)

---

## 5. Shading ร่วม (ทุก effect)

- **Blending** — `NormalBlending`, `depthWrite: false`, `transparent: true`, `renderOrder` หลังตัวเครื่อง
- **Lighting แบบถูก**
  - base = `mix(skyAmbient, sunColor * lambert, 0.6)`
  - **Forward scattering** — Henyey-Greenstein `g ≈ 0.6`: สว่างจัดเมื่อกล้องมองสวนดวงอาทิตย์ (backlit glow คือจุดที่ทำให้ดูจริงที่สุด)
  - เงาของตัวเครื่องทับ vapor (optional, high preset)
- **สี** — ขาวอมฟ้า `#e8eef5` ในเงา, ขาวอุ่นเมื่อโดนแดด; ห้ามเทาเข้ม
- **Soft edge** — depth fade กับ depth buffer ของฉาก ป้องกันเส้นตัดแข็งที่ผิวเครื่อง
- **Distance fade/LOD** — ไกลกว่า ~800 m ลด segment, ไกลกว่า ~2 km ปิด wake

---

## 6. สถาปัตยกรรมโค้ด

ที่ทำจริง (refactor ตามผล audit):

```
src/render/vapor/
├─ atmosphere.ts          // T(h), RH(h), Td, D, W, speed of sound; flatRangeAtmosphere
├─ vaporModel.ts          // ΔT ต่อ effect → target intensity, burst, shock (pure, test ได้)
├─ conditions.ts          // AircraftState → VaporConditions (AoA, G, Mach จากความเร็ว HUD, D, W)
├─ profile.ts             // ต่อลำ: wingtip, wing sheet, LEX path, cone shape, wing loading
├─ CondensationVolume.ts  // smoothing ต่อ effect, uniforms, preset, render pass
├─ shaders.ts             // composite: wingtip cores + LEX + cone + เมฆ + exhaust
├─ vortexShader.ts        // density field ของ LEX vortex และ vapor cone
└─ cloudShader.ts         // เมฆเหนือ/ใต้ปีก (upper-surface fog)
vapor-preview.html        // debug panel: slider อากาศ/การบิน + ตัวเลข D, ΔT, intensity + scenario ข้อ 8
tests/vapor.test.ts
```

### 6.1 Config รายลำ

```ts
interface VaporRig {
  wingLoading: number;              // kg/m²
  lex?: { apex: Vec3; path: Vec3[]; radius: [number, number] }[];   // ซ้าย/ขวา
  wingFog: { mesh: string; chordStart: number; chordEnd: number };
  tips: Vec3[];                     // ปลายปีก + ปลาย flap
  cones: { station: number; radius: number }[];
  alphaOnset: number;               // AoA ที่ vortex เริ่มเกิด (deg)
}
```

ทำแล้วเฉพาะลำที่มีในเกม (F-22, Su-57) ใน `profile.ts` (`lexPaths`, `coneShapes`, `vaporRigs`) wing loading ใช้น้ำหนักรบ: F-22 335, Su-57 317 kg/m², `WS_ref` = 350

- **F-22** — ไม่มี LEX แยก ใช้ vortex จาก chine/ขอบหน้าปีกโคน, vapor เกาะ leading edge + ผิวบนช่วงโคน
- **Su-57** — vortex จาก LEVCON ตรงโคนปีก
- **F/A-18 / F-16** — LEX/strake vortex เด่นมาก (ตรงกับภาพอ้างอิง)

### 6.2 Data flow

```
FlightState (α, n, Mach, h, q) + MapAtmosphere
        → vaporModel (ΔT, intensity ต่อ effect)
        → uniforms ของแต่ละ effect (intensity, s_burst, s_shock, time)
```

- **Mach** — อ่านจากความเร็ว HUD (arcade km/h ÷ 3.6) ไม่ใช่ m/s ของ simulation ซึ่งสูงสุดแค่ราว M 0.76 (D19)
- **Multiplayer** — คำนวณจาก state ที่ replicate อยู่แล้ว (α, n, Mach) ไม่ต้องส่งข้อมูล vapor เพิ่ม · ยังไม่ทำ: `CondensationVolume` วาด vapor ได้ลำเดียว (ลำผู้เล่น) บอทและลำอื่นต้องรองรับหลายลำก่อน
- **Bot** — ใช้ระบบเดียวกัน ทำให้มองเห็นศัตรูเลี้ยวแรงจาก vapor ได้ (ช่วย readability ของ dogfight ด้วย)

### 6.3 Graphics presets

| Preset | LEX | Wing fog | Tip trail | Cone | Soft edge | HG scattering |
|---|---|---|---|---|---|---|
| Low | tube ไม่มี wake | ปิด | 20 จุด | ปิด | ปิด | ปิด |
| Medium | + wake สั้น | เปิด | 40 จุด | เปิด | ปิด | เปิด |
| High | + wake ยาว, burst noise ละเอียด | เปิด | 80 จุด | เปิด | เปิด | เปิด |

ในเกม setting Vapor มีแค่ Off / Low / High (preset Low ของเกมปิด vapor) จึงใช้: Vapor **Low** ≈ Medium ในตาราง (LEX 16 samples, wake 3.5 m, cone เปิด) และ **High** ≈ High (LEX 28 samples, wake 7 m) ไม่เพิ่มค่า setting ใหม่ เพื่อไม่ต้องแก้ save schema

---

## 7. ลำดับงาน

| Phase | งาน | Acceptance | สถานะ |
|---|---|---|---|
| 0 | Audit ของเดิม (ข้อ 2) | มีรายการปัญหา + ตัดสินใจ refactor/rewrite | ทำแล้ว: refactor |
| 1 | `atmosphere.ts` + `vaporModel.ts` + debug panel ใน Playground (แสดง α, n, M, D, ΔT, intensity + slider override) | unit test ค่า Td/ΔT ผ่าน, ดูตัวเลขเปลี่ยนตามการบินได้ | ทำแล้ว; debug panel อยู่ใน `vapor-preview.html` ไม่ใช่ Playground |
| 2 | LEX vortex + burst + wake | เลี้ยว 4–6 G บนแผนที่ทะเล เห็นเส้นจากโคนปีก; cobra เห็น burst เป็นหมอกก้อน | ทำแล้ว; ดูใน preview ทั้งสองลำ; ตรวจกับ `stepFlight` ว่าดึงเต็มที่ในเกมเห็น LEX (ยังไม่ได้ดูในฉากบินจริง) |
| 3 | Upper-surface fog | ดึง G สูง เห็นหมอกบางเกาะผิวบนปีก กระพริบ | บางส่วน: เมฆเดิม + โมเดลใหม่ + flicker 9/13 Hz ±15%; ยังไม่ทำ chord mask/ขอบ shock |
| 4 | Wingtip ribbons | เลี้ยวช้า AoA สูง เห็นเส้นบางจากปลายปีกค้างหลังเครื่อง | ยังไม่ทำ (เส้นตรงเดิมขับด้วยโมเดลใหม่) |
| 5 | Vapor cone | dive ผ่าน M 0.9–1.05 ระดับต่ำ เห็น cone ขอบหลังคมขยับตาม Mach แล้วหาย | ทำแล้ว; ดูใน preview |
| 6 | Lighting, soft edge, LOD, presets | High ≤ 0.5 ms GPU/ลำ ที่ใกล้กล้อง; Low ไม่กระทบ fps เป้าหมาย | ยังไม่ทำ; ยังไม่ได้วัด GPU time |
| 7 | Tuning เทียบภาพอ้างอิง (ข้อ 8) | ผ่าน test scenarios ครบ | ยังไม่ทำ; ตัวเลขข้อ 8 มี unit test แล้ว |

---

## 8. Test scenarios

- **Sustained turn** — 6 G, 700 km/h, ระดับน้ำทะเล, แผนที่ทะเล → LEX ชัด, wing fog, tip trail
- **PSM (cobra / Pugachev)** — α > 60° → burst ที่ apex, หมอกก้อนใหญ่ แล้วหายเร็วเมื่อกด nose ลง
- **Transonic pass** — M 0.95 ระดับต่ำ → cone ชัด; M 1.15 → cone หาย
- **ที่สูง 10 km** — ไม่มี aerodynamic vapor (D มาก, W น้อย); มีแต่ contrail ถ้าเปิดระบบนั้น
- **แผนที่ทะเลทราย** — vapor หายาก ต้องดึง G สูงมากถึงจะโผล่จางๆ
- **Backlit** — กล้องหันหาดวงอาทิตย์ → vapor สว่างจัดขอบเรือง
- **Multiplayer** — ศัตรูที่เลี้ยวแรงมี vapor ตรงกับที่เห็นในเครื่องตัวเอง

---

## 9. Anti-patterns (ห้าม)

- **ห้าม additive** สำหรับ vapor
- **ห้ามผูกกับความเร็วอย่างเดียว**
- **ห้ามอายุยาวแบบควัน** (ยกเว้น contrail)
- **ห้ามใช้ texture ควันไฟสีเทา**
- **ห้าม vapor cone = ตัวบอก Mach 1** — ของจริงเกิดได้ตั้งแต่ high subsonic
- **ห้ามวาง vortex ผิดด้าน** — vortex/fog อยู่ด้านแรงยก (ผิวบนปีกเมื่อดึง G บวก)
---

## 10. ค่าที่ใช้จริงต่างจากแผน

ตัวเลขข้อ 3 เป็นค่าเริ่ม เมื่อลองกับ flat-range (26 °C, RH 82%, เกิดที่ 400 m) บางค่าขัดกับเป้าหมายของแผนเอง จึงปรับดังนี้ (D19):

| แผน | ใช้จริง | เหตุผล |
|---|---|---|
| `Td(h) = Td0 − 2·h_km` | RH ลดครึ่งหนึ่งจาก 300 m ถึง 7 km แล้วคำนวณ Td ด้วย Magnus | สูตรเดิมกับ lapse 6.5 K/km ทำให้อากาศอิ่มตัวที่ราว 700 m เครื่องจะบินอยู่ในเมฆ |
| `W = clamp(ratio, 0.15, 1)` | `W = min(1, √ratio)` | ขั้นต่ำ 0.15 ทำให้ยังเห็น LEX ที่ 10 km; ราก √ ทำให้อากาศเย็นชื้น (แผนที่หิมะ) ยังเห็นได้ |
| `K_wing ≈ 2.5 K/G` | 1.5 | 2.5 K ที่ 1 G ใกล้ D ≈ 3.3 K จนหมอกโผล่ตอนบินตรง |
| `δ ≈ 0.2` (local Mach) | 0.12 | 0.2 ทำให้ cone ขึ้นทุกครั้งที่บินเต็ม cruise top speed (M 0.87) ซึ่งขัดข้อ 9 |
| `WS_ref` 380 | 350 | ให้สองลำในเกมอยู่ราว 0.9–1.0 |
| Mach จากความเร็ว | Mach จากความเร็ว HUD | ความเร็ว simulation ไม่ถึงช่วง transonic |

**AoA ของ vortex มาจากแรงยก:** flight model แบบ arcade ดึงเต็มที่ได้ 12 G ที่ α จริงแค่ราว 4° ถ้าใช้ α ตรง ๆ LEX จะไม่ขึ้นเลยในเกม จึงใช้ α ที่แรงยกต้องการ `α_lift = n·(W/S)·g / (q·CLα)` (CLα 0.075/° , q จากความเร็ว HUD และความหนาแน่น ISA) หรือ α จริงถ้ามากกว่า (PSM) ส่วนทิศเส้นปลายปีกและด้านของเมฆยังใช้ α จริง ผล: ดึงเต็มที่ที่ความเร็วเกิดเห็น LEX ทั้งสองลำ, ดึงครึ่งเดียว (~6.8 G ที่ 860 km/h) เห็นแค่หมอกบนปีก มี test ที่ขับด้วย `stepFlight` จริงใน `vapor.test.ts`

LEX ใช้ `smoothstep(alphaOnset, alphaOnset + 12°, α)` ต่อลำ (F-22 8°, Su-57 7°) แทน 8°–20° ตายตัว

**LEX แบบเบาเกาะผิว (21 ต.ค. 2026 ตามภาพอ้างอิงของผู้ใช้):** ไม่มี wake ต่อท้าย ไม่ยกแกนตาม α รัศมี 0.07→0.22 m ความทึบลดราว 3 เท่า และจางหายช่วงครึ่งหลังของโคนปีก แกนเป็น polyline 6 จุดต่อลำที่ bake จากผิวบนจริงของ GLB ด้วย `scripts/measure-vapor-paths.mjs` (ยิง ray ลงผิว + ยก 0.12 m, Z เปลี่ยนช้าให้ขนานลำตัว) เครื่องใหม่: เพิ่ม x/z/lift ใน script แล้ววางผลลง `lexPaths` ใน `profile.ts`

**Vapor cone แบบ one-shot (21 ต.ค. 2026 ตามผู้ใช้ อิงภาพ Battlefield และแนว Ace Combat):** รูปทรงเป็นม่าน haze กว้างรอบตัวเครื่อง (รัศมี 1.2 → 9 m เกินปลายปีก) ความหนาแน่นลดแบบ gaussian ออกด้านนอก ขอบหน้าและขอบหลังนุ่ม noise เป็นปื้นช้า ๆ สองชั้น ไม่มีเส้นแนวรัศมี สีเทาอมฟ้าหม่นกว่า vortex และบางจนเห็นเครื่องกับพื้นหลังทะลุ cone ไม่ค้างและไม่วาบเป็นจังหวะ แต่เล่นครั้งเดียว 0.9 s (ขึ้น 0.08 s, ค้างสั้น ๆ, จางหาย) ขณะเล่นขอบ shock เลื่อนไปท้ายเล็กน้อย `ConeTrigger` ใน `vaporModel.ts` ยิงเมื่อ:
- เร่งผ่าน M 0.93 (ราว 1,160 km/h HUD ที่สนามฝึก) ยิงใหม่ได้ต่อเมื่อช้าลงต่ำกว่า M 0.88 ก่อน
- ดึงเกิน 4 G ขณะ M 0.85–1.05 ยิงใหม่ได้ต่อเมื่อผ่อนต่ำกว่า 2.5 G ก่อน; local Mach บวก 0.01 ต่อ G ที่เกิน 1 (แรงยกเร่งอากาศบนปีก) ดึงแรงที่ cruise top speed จึงเห็น cone
- สองทางใช้ cooldown ร่วม 1 s; ความชื้นยังเป็นตัวกำหนดว่าเห็นหรือไม่และเข้มแค่ไหน
