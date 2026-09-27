/*
PVE game modes shown on Select Mode and PVE Setup.
Rules and default limits come from docs/game-design/09-offline.md. They are
experimental values; no mode runs yet (TDM arrives in P4, the rest in P5b).
*/
import type { LocalizedText } from '../schemas'

export type PveModeId = 'tdm' | 'control-point' | 'ctf' | 'priority-target' | 'flyover'
export type Difficulty = 'easy' | 'normal' | 'hard'

export interface PveModeDefinition {
  id: PveModeId
  /** Full name, e.g. on the PVE Setup list. */
  name: LocalizedText
  /** Short chip label on Select Mode. */
  short: LocalizedText
  /** One line that says how a team wins. */
  summary: LocalizedText
  timeLimitMinutes: number
  /** Score limit with its unit. TDM scales with team size, see `scoreLimitText`. */
  scoreLimit: LocalizedText
}

export const pveModes: readonly PveModeDefinition[] = [
  {
    id: 'tdm',
    name: { en: 'Team Deathmatch', th: 'Team Deathmatch' },
    short: { en: 'TDM', th: 'TDM' },
    summary: { en: 'Shoot down enemy aircraft. First team to the kill limit wins.', th: 'ยิงเครื่องศัตรูให้ตก ทีมที่ถึงจำนวน kill ก่อนชนะ' },
    timeLimitMinutes: 5,
    scoreLimit: { en: '10 kills per pilot', th: '10 kill ต่อนักบิน' },
  },
  {
    id: 'control-point',
    name: { en: 'Control Point', th: 'Control Point' },
    short: { en: 'Control Point', th: 'Control Point' },
    summary: { en: 'Hold points A, B and C. Each held point scores over time.', th: 'ยึดจุด A, B, C ไว้ จุดที่ถือได้คะแนนตามเวลา' },
    timeLimitMinutes: 10,
    scoreLimit: { en: '100 points', th: '100 คะแนน' },
  },
  {
    id: 'ctf',
    name: { en: 'Capture the Flag', th: 'ชิงธง' },
    short: { en: 'Capture the Flag', th: 'ชิงธง' },
    summary: { en: 'Fly through the enemy flag zone, then bring the flag home.', th: 'บินผ่านโซนธงศัตรู แล้วนำธงกลับฐานตัวเอง' },
    timeLimitMinutes: 10,
    scoreLimit: { en: '3 captures', th: '3 ครั้ง' },
  },
  {
    id: 'priority-target',
    name: { en: 'Priority Target', th: 'Priority Target' },
    short: { en: 'Priority Target', th: 'Priority Target' },
    summary: { en: 'Grab the crown and keep it. Holding it scores every second.', th: 'เก็บมงกุฎแล้วรักษาไว้ ถือไว้ได้แต้มทุกวินาที' },
    timeLimitMinutes: 8,
    scoreLimit: { en: '100 points', th: '100 แต้ม' },
  },
  {
    id: 'flyover',
    name: { en: 'Flyover', th: 'Flyover' },
    short: { en: 'Flyover', th: 'Flyover' },
    summary: { en: 'Fly through rings to capture them. Hold more rings to score.', th: 'บินผ่านวงแหวนเพื่อยึด ทีมที่ถือมากกว่าได้แต้ม' },
    timeLimitMinutes: 10,
    scoreLimit: { en: '300 points', th: '300 แต้ม' },
  },
]

export function getPveMode(id: PveModeId): PveModeDefinition {
  const mode = pveModes.find(item => item.id === id)
  if (!mode) throw new Error(`pveMode: unknown id "${id}"`)
  return mode
}

export function isPveModeId(value: unknown): value is PveModeId {
  return pveModes.some(mode => mode.id === value)
}

/** Aircraft per team. 2v2 is the current performance budget (docs 09 and 17). */
export const teamSizeRange = { min: 1, max: 2 } as const

export interface DifficultyDefinition {
  id: Difficulty
  label: LocalizedText
  reaction: string
  note: LocalizedText
}

/** Bot reaction times and behaviour from docs/game-design/08-bots.md. */
export const difficulties: readonly DifficultyDefinition[] = [
  { id: 'easy', label: { en: 'Easy', th: 'ง่าย' }, reaction: '0.7–1.0 s', note: { en: 'Slow reactions, short bursts, no post-stall moves.', th: 'ตอบสนองช้า ยิงเป็นชุดสั้น ไม่ใช้ท่า post-stall' } },
  { id: 'normal', label: { en: 'Normal', th: 'ปกติ' }, reaction: '0.3–0.5 s', note: { en: 'Manages energy, drops flares after a warning, switches between chase and extend.', th: 'รักษาพลังงาน ปล่อย flare หลังได้ยินเตือน สลับระหว่างไล่และหนี' } },
  { id: 'hard', label: { en: 'Hard', th: 'ยาก' }, reaction: '0.15–0.25 s', note: { en: 'Picks High-G and PSM when the cost is worth it. Same aircraft limits as you.', th: 'เลือกใช้ High-G และ PSM เมื่อคุ้ม ใช้ขีดจำกัดเครื่องเดียวกับคุณ' } },
]

export function isDifficulty(value: unknown): value is Difficulty {
  return difficulties.some(item => item.id === value)
}
