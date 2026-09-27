import type { AircraftDefinition } from '../schemas'

export const aircraft: readonly AircraftDefinition[] = [
  {
    id: 'f22', flightProfileId: 'raptor-energy', presentationId: 'f22', weaponStationProfileId: 'f22',
    designation: 'F-22', name: 'Raptor', modelFile: 'F22_compact.glb',
    role: { th: 'เครื่องบินขับไล่ครองอากาศ · ตรวจจับยาก + ซูเปอร์ครูซ', en: 'Air superiority fighter · Stealth and supercruise' },
    rotation: [0, 0, 0], removeNodes: ['MLG_Bay_Fitting_01', 'MLG_Bay_Fitting_02'],
    description: { th: 'สำรวจตัวเครื่องและกลไกที่เคลื่อนไหวได้จากโมเดลจริง', en: 'Explore the airframe and its animated mechanical systems.' },
    hangar: {
      gameRole: { en: 'Air superiority', th: 'ครองอากาศ' },
      playStyle: { en: 'Energy fighter', th: 'เน้นพลังงาน' },
      tip: { en: 'Wins with speed, altitude and the first shot. Keep energy high and avoid long turning fights.', th: 'ชนะด้วยความเร็ว ความสูง และการยิงก่อน รักษาพลังงานให้สูงและเลี่ยงการเลี้ยวไล่กันนาน ๆ' },
      history: { en: 'Lockheed Martin F-22 Raptor. First flight 1997, USAF service from 2005. Fifth-generation fighter built around stealth, supercruise and 2D thrust vectoring.', th: 'Lockheed Martin F-22 Raptor บินครั้งแรกปี 1997 เข้าประจำการกองทัพอากาศสหรัฐฯ ปี 2005 เครื่องบินขับไล่ยุคที่ 5 ที่ออกแบบรอบความสามารถตรวจจับยาก ซูเปอร์ครูซ และเวกเตอร์แรงขับ 2 มิติ' },
    },
  },
  {
    id: 'su57', flightProfileId: 'felon-agility', presentationId: 'su57', weaponStationProfileId: 'su57',
    designation: 'Su-57', name: 'Felon', modelFile: 'SU57_compact.glb',
    role: { th: 'เครื่องบินขับไล่อเนกประสงค์ · คล่องตัวสูง + เวกเตอร์แรงขับ', en: 'Multirole fighter · High agility and thrust vectoring' },
    rotation: [0, Math.PI / 2, 0],
    // Export-only nozzle backup is enormous and far outside the airframe. The
    // source also contains both static gear/probe variants; show the stowed set.
    removeNodes: ['Nozzles_ORIG_backup', 'Gear_down', 'Probe_on', 'Prototype_su57_antenna_ng'],
    description: { th: 'สำรวจรูปทรงและรายละเอียดของเครื่องบินจากทุกมุม', en: 'Explore the aircraft’s shape and surface details from every angle.' },
    hangar: {
      gameRole: { en: 'Multirole', th: 'อเนกประสงค์' },
      playStyle: { en: 'Agility fighter', th: 'เน้นความคล่องตัว' },
      tip: { en: 'Wins close. 3D thrust vectoring and strong post-stall control let it point the nose where others cannot.', th: 'ชนะในระยะใกล้ เวกเตอร์แรงขับ 3 มิติและการควบคุมหลังสภาวะร่วงหล่นทำให้หันหัวไปในมุมที่ลำอื่นทำไม่ได้' },
      history: { en: 'Sukhoi Su-57 (NATO: Felon). First flight 2010, Russian service from 2020. Twin-engine fifth-generation multirole fighter with canted 3D thrust vectoring.', th: 'Sukhoi Su-57 (ชื่อ NATO: Felon) บินครั้งแรกปี 2010 เข้าประจำการรัสเซียปี 2020 เครื่องบินขับไล่อเนกประสงค์ยุคที่ 5 สองเครื่องยนต์ พร้อมเวกเตอร์แรงขับ 3 มิติแบบเอียง' },
    },
  },
]

/** Validation variant reuses the Raptor assets, and is excluded from the hangar roster. */
export const validationAircraft: readonly AircraftDefinition[] = [{
  ...aircraft[0], playgroundOnly: true, id: 'f22-notvc', flightProfileId: 'raptor-notvc', name: 'Raptor (no TVC)',
}]
export const playgroundAircraft = [...aircraft, ...validationAircraft]

export function getAircraft(id: string): AircraftDefinition {
  const entry = aircraft.find((item) => item.id === id) ?? validationAircraft.find((item) => item.id === id)
  if (!entry) throw new Error(`aircraftId: unknown id "${id}"`)
  return entry
}

export function modelUrl(entry: AircraftDefinition) {
  return `${import.meta.env.BASE_URL}assets/aircraft/${entry.modelFile}`
}
