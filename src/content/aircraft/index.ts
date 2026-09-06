import type { AircraftDefinition } from '../schemas'

export const aircraft: readonly AircraftDefinition[] = [
  {
    id: 'f22', designation: 'F-22', name: 'Raptor', modelFile: 'F22_compact.glb',
    role: { th: 'เครื่องบินขับไล่ครองอากาศ · ตรวจจับยาก + ซูเปอร์ครูซ', en: 'Air superiority fighter · Stealth and supercruise' },
    rotation: [0, 0, 0], removeNodes: ['MLG_Bay_Fitting_01', 'MLG_Bay_Fitting_02'],
    description: { th: 'สำรวจตัวเครื่องและกลไกที่เคลื่อนไหวได้จากโมเดลจริง', en: 'Explore the airframe and its animated mechanical systems.' },
  },
  {
    id: 'su57', designation: 'Su-57', name: 'Felon', modelFile: 'SU57_compact.glb',
    role: { th: 'เครื่องบินขับไล่อเนกประสงค์ · คล่องตัวสูง + เวกเตอร์แรงขับ', en: 'Multirole fighter · High agility and thrust vectoring' },
    rotation: [0, Math.PI / 2, 0],
    // Export-only nozzle backup is enormous and far outside the airframe. The
    // source also contains both static gear/probe variants; show the stowed set.
    removeNodes: ['Nozzles_ORIG_backup', 'Gear_down', 'Probe_on', 'Prototype_su57_antenna_ng'],
    description: { th: 'สำรวจรูปทรงและรายละเอียดของเครื่องบินจากทุกมุม', en: 'Explore the aircraft’s shape and surface details from every angle.' },
  },
]

export function getAircraft(id: string): AircraftDefinition {
  const entry = aircraft.find((item) => item.id === id)
  if (!entry) throw new Error(`aircraftId: unknown id "${id}"`)
  return entry
}

export function modelUrl(entry: AircraftDefinition) {
  return `${import.meta.env.BASE_URL}assets/aircraft/${entry.modelFile}`
}
