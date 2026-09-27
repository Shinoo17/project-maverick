# 21 — Campaign: Operation, Missions และ Progress

[กลับ Master Plan](../../MASTER_PLAN.md) · UI ใน P3b, เล่นได้ใน P5c · อ้างอิงภาพ 3a · Campaign map ใน [example/Design.html](../../example/Design.html) · พึ่ง 07, 08, 09, 14, 20

## Campaign คืออะไร

Campaign คือ **operation** ที่มี mission หลายภารกิจในพื้นที่รบเดียว แต่ละ mission กำหนด map, เครื่องบิน, อาวุธ, ศัตรู และเป้าหมายเอง ผู้เล่นปลดล็อก mission ถัดไปด้วยการผ่าน mission ที่เป็นเงื่อนไขก่อน เช่น ต้องบุกฐานแนวหน้าก่อนไปบุกฐานหลัก

ไม่มี economy, XP, การซื้อ หรือ unlock เครื่องบินจาก Campaign เครื่องบินทุกลำที่พร้อมยังเลือกได้ใน PVE และ Training ตาม Master Plan

## หน้าจอ Campaign Map

ภาพอ้างอิง 3a:

- พื้นหลังเป็นแผนที่พื้นที่รบแบบ 2D (satellite/topographic ที่ลดสี) pan/zoom ได้ มีเส้น FRONT LINE และแบ่ง FRIENDLY / HOSTILE TERRITORY
- Mission เป็นกล่องบนแผนที่ แสดง code, status และชื่อ เช่น `M03 · AVAILABLE · FORWARD AIRBASE`
- เส้นประเชื่อมจาก mission ที่เป็นเงื่อนไขไปยัง mission ที่ต้องรอ legend ในภาพมีสามแบบ: Must be cleared first, Available, Locked แผนนี้เพิ่ม Planned
- หัวจอ: `MODE · CAMPAIGN`, ชื่อ operation และ PROGRESS เช่น `2 / 6`
- รายละเอียด mission ที่เลือก: code, status, ชื่อเต็ม, objective, ภาพ map ย่อ และแถว MAP / AIRCRAFT / ARMAMENT / THREATS / REQUIRES
- ปุ่มหลักเปลี่ยนตามสถานะ: `LAUNCH` (available), `REPLAY` (complete), `REQUIRES M03 + M04` (locked และกดไม่ได้), `PLANNED` (planned และกดไม่ได้)

| Status | รูปแบบ | ความหมาย |
|---|---|---|
| COMPLETE | เส้นขอบบาง สีรอง | ผ่านแล้ว เล่นซ้ำได้ |
| AVAILABLE | เส้นขอบ accent | เงื่อนไขครบ เล่นได้ |
| LOCKED | เส้นขอบประ สีจาง | เงื่อนไขยังไม่ครบ อ่านรายละเอียดได้แต่เริ่มไม่ได้ |
| PLANNED | เส้นขอบประ สีจาง พร้อมป้าย PLANNED | ระบบที่ mission ต้องใช้ยังไม่มีในเกม เริ่มไม่ได้และบอกว่าขาดอะไร (เช่น การโจมตีภาคพื้น) |

Mission ที่ locked ยังเลือกดูรายละเอียดได้ เพื่อให้ผู้เล่นรู้ว่าต้องทำอะไรก่อน สถานะต้องมีทั้งรูปแบบเส้น ข้อความ และสี ไม่ใช้สีอย่างเดียว

## Data

```ts
interface OperationDefinition {
  id: string;
  name: LocalizedText;
  theatreImageId: string;
  missions: MissionDefinition[];
}

interface MissionDefinition {
  id: string;                 // 'm03-forward-airbase'
  code: string;               // 'M03'
  title: LocalizedText;
  briefing: LocalizedText;
  mapPosition: [number, number]; // ตำแหน่งกล่องบนภาพ theatre (0–1)
  requires: string[];         // mission ids ที่ต้อง COMPLETE ทั้งหมด
  mapId: string;
  aircraft: { kind: 'assigned'; aircraftId: string } | { kind: 'pilot-choice' };
  weapons: 'guns-only' | 'guns-ir' | 'all-implemented';  // อาวุธยังติดเต็มความจุเสมอ; ค่านี้จำกัดชนิดที่เปิดยิงได้ ('all-implemented' = ทุกชนิดที่ implement แล้ว ไม่รวม radar missile จนกว่า D09 จะเปิด)
  allies: BotSlot[];
  objectives: MissionObjective[];
  failConditions: MissionFailCondition[];
  timeLimitSeconds: number | null;
  availability: 'ready' | 'planned';  // 'planned' = ระบบที่ mission ต้องใช้ยังไม่มี
}

type MissionObjective =
  | { kind: 'destroy-air'; groupId: string; count: number }
  | { kind: 'destroy-ground'; targetIds: string[] }
  | { kind: 'protect'; entityIds: string[]; untilEvent: 'exit-zone' | 'time' }
  | { kind: 'survive'; seconds: number };
```

Mission เป็น PLANNED เมื่อ `availability` เป็น `'planned'` หรือมี objective kind ที่ runtime ยังไม่รองรับ ตรวจก่อนสถานะอื่นเสมอ Mission ที่ requires อ้างถึง mission PLANNED จึงยัง LOCKED ต่อไป

Content validation ต้องปฏิเสธ `requires` ที่อ้าง id ไม่มีจริง, `requires` ที่วนกลับเป็นวงจร, operation ที่ไม่มี mission เริ่มต้น (`requires: []`) และ map/aircraft/weapon ids ที่ไม่มี Mission status คำนวณจาก progress ไม่เก็บเป็นค่าตายตัวในข้อมูล

`mapPosition` เป็นตำแหน่งบนภาพ theatre สำหรับ UI เท่านั้น ไม่เกี่ยวกับพิกัดโลกของ map ที่ใช้บิน

## Progress

```ts
interface CampaignProgress {
  schemaVersion: 1;
  operations: Record<string, {
    completed: Record<string, { firstClearedAt: string; bestTimeSeconds: number | null }>;
    lastSelectedMissionId: string | null;
  }>;
}
```

เก็บใน localStorage แยก key จาก settings (15) validate ทุกครั้งที่อ่าน ถ้า mission id หายจาก content ให้ข้ามไปโดยไม่ลบข้อมูลที่เหลือ Reset progress เป็นคำสั่งแยกที่ต้องยืนยัน ไม่อยู่ในปุ่ม reset settings

ลำดับการคำนวณสถานะ: PLANNED (ระบบไม่พร้อม) → COMPLETE (อยู่ใน `completed`) → AVAILABLE (ทุก id ใน `requires` อยู่ใน `completed`) → LOCKED การเล่นซ้ำ mission ที่ผ่านแล้วไม่ทำให้สถานะถอยกลับ

## Mission lifecycle

ใช้ lifecycle เดียวกับ 09: Configure → Loading → Countdown → Playing → Results ต่างกันที่ Configure มาจาก MissionDefinition และ Results แสดงผล objective แทนคะแนนทีม

- Mission สำเร็จเมื่อ objectives ทั้งหมดสำเร็จ; ล้มเหลวเมื่อ fail condition ใด ๆ เกิดขึ้น เช่น เครื่องผู้เล่นถูกยิงตก, tanker ถูกทำลาย หรือหมดเวลา
- Campaign MVP **ไม่มี respawn ของผู้เล่น** ถูกยิงตกคือ mission failed แล้วเลือก Retry หรือกลับแผนที่ (ข้อเสนอ ดู D16 ใน 19)
- ผล Results: สถานะแต่ละ objective, เวลา, kills และ mission ที่เพิ่งปลดล็อก
- ออกกลาง mission ไม่นับเป็นผ่านและไม่บันทึก progress

## Objective types และสิ่งที่ต้องมีเพิ่ม

| Objective | ต้องมีอะไรในเกม | เล่นได้เมื่อ |
|---|---|---|
| destroy-air (intercept, air superiority) | combat + บอทจาก P4/P5 | หลัง P5 |
| survive | timer ใน mode rules | หลัง P5 |
| destroy-ground (radar site, เครื่องบินจอด) | entity ภาคพื้นแบบ static ที่มี HP และ collider, วิธีโจมตีภาคพื้น | P5c |
| protect (tanker escort) | entity เครื่องบินฝ่ายเราที่บินตาม waypoint, บอทศัตรูที่เลือกเป้าเป็น tanker | P5c |

**วิธีโจมตีเป้าภาคพื้นยังต้องตัดสินใจ** อาวุธในรายการตอนนี้มีแค่ปืน, IR missile และ radar missile ไม่มีอาวุธโจมตีภาคพื้น ตัวเลือกคือ: ยิงด้วยปืนอย่างเดียว, ให้ IR missile lock เป้าภาคพื้นบางชนิดได้ หรือเพิ่มอาวุธโจมตีภาคพื้นเป็น content ใหม่ ดู D16 ใน 19 จนกว่าจะตัดสิน mission แบบ destroy-ground เป็น PLANNED

Tanker และเป้าภาคพื้นต้องมีโมเดลตาม 13 ถ้าโมเดลยังไม่พร้อมใช้ proxy ได้เฉพาะ dev

## Operation ตัวอย่างจาก mockup

| Code | ชื่อ | Map | Objective | เครื่อง | Requires |
|---|---|---|---|---|---|
| M01 | Border Patrol | Flat Training Range | ยิงเครื่องบินศัตรู 2 ลำที่รุกล้ำชายแดน | F-22 | — |
| M02 | Forward Radar Site | Coastal Ridge | ทำลายเรดาร์เตือนภัยและเครื่องที่คุ้มกัน | F-22 | M01 |
| M03 | Forward Airbase | Frontier Valley | เคลียร์การคุ้มกันทางอากาศ แล้วทำลายเครื่องบินที่จอดอยู่ | Su-57 (กำหนด) | M02 |
| M04 | Tanker Escort | Open Sea | คุ้ม tanker สองลำจนออกจากเขตรบ | F-22 (กำหนด) | M02 |
| M05 | Main Airbase | Main Base Plateau | ทำลายระบบป้องกันฐานหลัก | เลือกเอง | M03 + M04 |
| M06 | Capital Airspace | Capital Airspace | ชิงความเหนือกว่าทางอากาศเหนือเมืองหลวง | เลือกเอง | M05 |

ชื่อ map นอกจาก Flat Training Range ยังเป็นตัวแทน จำนวน map ใหม่ที่ต้องสร้างเป็นต้นทุนหลักของ Campaign; mission หลายอันใช้ map ร่วมกันได้โดยเปลี่ยน spawn และ objective ตัวเลขศัตรูและความยากในตารางเป็นค่าทดลอง

หลัง P5 เล่นได้แค่ M01 เพราะ M02 เป็น destroy-ground และทุก mission ถัดไปต่อจาก M02 ใน DAG M06 ใช้แค่ destroy-air แต่ต้องผ่าน M05 ก่อน ถ้าต้องการทดสอบ M06 ก่อนให้ใช้ dev-only unlock ไม่เปลี่ยน requires ใน content

## งานและเกณฑ์ผ่าน

1. Schema + validation + ตัวอย่าง operation ใน content (P3b)
2. Campaign Map UI: กล่อง mission, เส้นประ requires, รายละเอียด, สถานะ planned/locked/available/complete (P3b)
3. Progress save/load/migration และ unlock logic พร้อม unit tests (P3b)
4. Mission runtime: objectives, fail conditions, results สำหรับ destroy-air/survive; M01 เล่นได้ (หลัง P5)
5. เป้าภาคพื้น, protect/tanker และ map ใหม่ (P5c)

ผ่านเมื่อเล่น operation ครบตั้งแต่ M01 ถึง M06 ได้ในลำดับที่ DAG อนุญาต mission ที่ยังไม่ปลดล็อกเริ่มไม่ได้ progress ถูกบันทึกหลัง reload และ content ที่มี requires วนหรืออ้าง id ผิดไม่ผ่าน validation
