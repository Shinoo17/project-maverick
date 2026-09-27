import type { Translation } from '../../locales/en'

const clipKeys: Record<string, keyof Translation> = {
  Canopy_Open: 'canopy', LandingGear_Deploy: 'gear', Tailhook_Deploy: 'tailhook', Aero_Demo: 'aero',
  FlareDispenser_L_Open: 'flareLeft', FlareDispenser_R_Open: 'flareRight',
  WeaponBay_Main_L_Open: 'mainLeft', WeaponBay_Main_R_Open: 'mainRight',
  WeaponBay_Side_L_Open: 'sideLeft', WeaponBay_Side_R_Open: 'sideRight',
}
export function clipLabel(name: string, text: Translation) {
  return clipKeys[name] ? text[clipKeys[name]] : name.replace(/[_-]/g, ' ')
}
export const clipOrder = ['Canopy_Open', 'LandingGear_Deploy', 'Tailhook_Deploy', 'WeaponBay_Main_L_Open', 'WeaponBay_Main_R_Open', 'WeaponBay_Side_L_Open', 'WeaponBay_Side_R_Open', 'FlareDispenser_L_Open', 'FlareDispenser_R_Open', 'Aero_Demo']
