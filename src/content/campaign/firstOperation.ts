/*
Mock operation from the Campaign mockup (example/Design.html, 3a) and the table
in docs/game-design/21-campaign.md. Names, threats and map positions are
placeholders until the campaign is designed in P5c.
*/
import type { LocalizedText } from '../schemas'
import type { OperationDefinition } from './types'

const needsGroundAttack: LocalizedText = {
  en: 'Needs ground targets and a ground attack method (decision D16).',
  th: 'ต้องมีเป้าภาคพื้นและวิธีโจมตีภาคพื้นก่อน (รอตัดสิน D16)',
}

export const firstOperation: OperationDefinition = {
  id: 'op-first-light',
  name: { en: 'Operation First Light', th: 'ปฏิบัติการแสงแรก' },
  missions: [
    {
      id: 'm01-border-patrol', code: 'M01', mapPosition: [0.12, 0.8], requires: [],
      title: { en: 'Border Patrol', th: 'ลาดตระเวนชายแดน' },
      briefing: { en: 'Intercept two hostile aircraft probing the border.', th: 'สกัดเครื่องบินศัตรูสองลำที่รุกล้ำชายแดน' },
      mapId: 'flat-range', aircraft: { kind: 'assigned', aircraftId: 'f22' },
      threats: { en: '2 × bandit · Easy', th: 'ศัตรู 2 ลำ · ง่าย' },
      objectives: [{ kind: 'destroy-air', count: 2 }], availability: 'ready',
    },
    {
      id: 'm02-forward-radar', code: 'M02', mapPosition: [0.27, 0.62], requires: ['m01-border-patrol'],
      title: { en: 'Forward Radar Site', th: 'สถานีเรดาร์แนวหน้า' },
      briefing: { en: 'Blind the enemy: destroy the early-warning radar and the fighters guarding it.', th: 'ทำให้ศัตรูตาบอด: ทำลายเรดาร์เตือนภัยและเครื่องบินที่คุ้มกัน' },
      mapId: 'coastal-ridge', aircraft: { kind: 'assigned', aircraftId: 'f22' },
      threats: { en: '3 × bandit · Normal', th: 'ศัตรู 3 ลำ · ปกติ' },
      objectives: [{ kind: 'destroy-ground', targets: 1 }, { kind: 'destroy-air', count: 3 }],
      availability: 'planned', plannedReason: needsGroundAttack,
    },
    {
      id: 'm03-forward-airbase', code: 'M03', mapPosition: [0.43, 0.41], requires: ['m02-forward-radar'],
      title: { en: 'Forward Airbase', th: 'ฐานบินแนวหน้า' },
      briefing: { en: 'Strike the forward airbase. Clear its air cover, then destroy the aircraft on the ramp.', th: 'โจมตีฐานบินแนวหน้า เคลียร์การคุ้มกันทางอากาศ แล้วทำลายเครื่องบินที่จอดอยู่' },
      mapId: 'frontier-valley', aircraft: { kind: 'assigned', aircraftId: 'su57' },
      threats: { en: '4 × bandit · Normal', th: 'ศัตรู 4 ลำ · ปกติ' },
      objectives: [{ kind: 'destroy-air', count: 4 }, { kind: 'destroy-ground', targets: 6 }],
      availability: 'planned', plannedReason: needsGroundAttack,
    },
    {
      id: 'm04-tanker-escort', code: 'M04', mapPosition: [0.44, 0.8], requires: ['m02-forward-radar'],
      title: { en: 'Tanker Escort', th: 'คุ้มกันเครื่องเติมน้ำมัน' },
      briefing: { en: 'Keep two tankers alive until they leave the combat zone.', th: 'คุ้มกันเครื่องเติมน้ำมันสองลำจนออกจากเขตรบ' },
      mapId: 'open-sea', aircraft: { kind: 'assigned', aircraftId: 'f22' },
      threats: { en: 'Waves of 2 · Normal', th: 'ศัตรูมาเป็นระลอก ระลอกละ 2 ลำ · ปกติ' },
      objectives: [{ kind: 'protect', entities: 2 }],
      availability: 'planned', plannedReason: { en: 'Needs friendly tanker aircraft that fly a route.', th: 'ต้องมีเครื่องเติมน้ำมันฝ่ายเราที่บินตามเส้นทางก่อน' },
    },
    {
      id: 'm05-main-airbase', code: 'M05', mapPosition: [0.6, 0.6], requires: ['m03-forward-airbase', 'm04-tanker-escort'],
      title: { en: 'Main Airbase', th: 'ฐานบินหลัก' },
      briefing: { en: 'Break the main airbase defence. Only possible once the forward base is down and supply lines are secure.', th: 'ทำลายระบบป้องกันฐานหลัก ทำได้เมื่อฐานแนวหน้าถูกทำลายและเส้นทางส่งกำลังปลอดภัยแล้ว' },
      mapId: 'main-base-plateau', aircraft: { kind: 'pilot-choice' },
      threats: { en: '4 × bandit · Hard', th: 'ศัตรู 4 ลำ · ยาก' },
      objectives: [{ kind: 'destroy-ground', targets: 4 }],
      availability: 'planned', plannedReason: needsGroundAttack,
    },
    {
      id: 'm06-capital-airspace', code: 'M06', mapPosition: [0.59, 0.26], requires: ['m05-main-airbase'],
      title: { en: 'Capital Airspace', th: 'น่านฟ้าเมืองหลวง' },
      briefing: { en: 'Win air superiority over the capital against the enemy’s best squadron.', th: 'ชิงความเหนือกว่าทางอากาศเหนือเมืองหลวงจากฝูงบินที่เก่งที่สุดของศัตรู' },
      mapId: 'capital-airspace', aircraft: { kind: 'pilot-choice' },
      threats: { en: 'Ace flight · Hard', th: 'ฝูงบินเอซ · ยาก' },
      objectives: [{ kind: 'destroy-air', count: 4 }], availability: 'ready',
    },
  ],
}
