/*
Player-facing copy for the Hangar Armament screen, per weapon kind.
Facts here are general (how the weapon is guided); anything aircraft- or
variant-specific stays in index.ts. The role line is game advice, not doctrine.
*/
import type { LocalizedText } from '../schemas'
import type { WeaponDefinition, WeaponKind } from './index'

export interface WeaponKindCopy {
  /** Short tag for list rows, e.g. GUN, IR, RADAR. */
  short: LocalizedText
  /** Full kind line above the name, e.g. INFRARED · SHORT RANGE. */
  long: LocalizedText
  /** How the weapon finds its target. */
  guidance: LocalizedText
  /** How to use it in this game, in one or two sentences. */
  role: LocalizedText
}

export const weaponKindCopy: Record<WeaponKind, WeaponKindCopy> = {
  gun: {
    short: { en: 'Gun', th: 'ปืน' },
    long: { en: 'Cannon · Close range', th: 'ปืนใหญ่อากาศ · ระยะประชิด' },
    guidance: { en: 'None · lead sight', th: 'ไม่มี · ศูนย์เล็งนำ' },
    role: {
      en: 'Close-range backup. Lead the target and fire short bursts once the sight settles.',
      th: 'อาวุธสำรองระยะประชิด ยิงนำเป้าเป็นชุดสั้น ๆ เมื่อศูนย์เล็งนิ่ง',
    },
  },
  ir: {
    short: { en: 'IR', th: 'IR' },
    long: { en: 'Infrared · Short range', th: 'อินฟราเรด · ระยะใกล้' },
    guidance: { en: 'Infrared homing', th: 'นำวิถีด้วยความร้อน' },
    role: {
      en: 'Heat seeker for the turning fight. Point the nose, wait for the lock tone, then fire.',
      th: 'มิสไซล์ตามความร้อนสำหรับการเลี้ยวต่อสู้ หันหัวเข้าหาเป้า รอเสียงล็อก แล้วยิง',
    },
  },
  radar: {
    short: { en: 'Radar', th: 'เรดาร์' },
    long: { en: 'Radar · Medium range', th: 'เรดาร์ · ระยะกลาง' },
    guidance: { en: 'Active radar homing', th: 'นำวิถีด้วยเรดาร์แบบแอคทีฟ' },
    role: {
      en: 'Opens the fight from long range. Fire first, then turn away to keep your energy.',
      th: 'เปิดฉากจากระยะไกล ยิงก่อนแล้วเลี้ยวออกเพื่อรักษาพลังงาน',
    },
  },
}

/** Physical size shown in the facts row: calibre for guns, length for missiles. */
export function weaponSize(weapon: WeaponDefinition): string {
  if (weapon.calibreMm) return `${weapon.calibreMm} mm`
  if (weapon.model) return `${weapon.model.length.toFixed(2)} m`
  return '—'
}
