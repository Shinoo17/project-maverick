/*
Weapon bay doors, drawn only. A bay snaps open when a missile leaves it (missile-launched) and
closes a moment after the last one; the simulation never waits for the doors (missiles.ts).
Timed by the simulation clock, so pause freezes them.

The F-22 model carries one open clip per bay: side bays (AIM-9) and main bays (AIM-120), left
and right. A hardpoint left of the centreline (body −Z) opens the left bay. The Su-57 model has
no bay clips, so its doors stay shut.
*/
import { AnimationMixer, LoopOnce, type AnimationAction, type AnimationClip, type Object3D } from 'three'
import { getAircraft } from '../../content/aircraft'
import { prepareAnimations } from './animationStages'

/** Seconds to open, held open after the last launch, and to close. */
const OPEN = 0.12, HOLD = 1.2, CLOSE = 0.6
const bayClips: Record<string, Record<string, [left: string, right: string]>> = {
  f22: {
    'side-bays': ['WeaponBay_Side_L_Open', 'WeaponBay_Side_R_Open'],
    'main-bays': ['WeaponBay_Main_L_Open', 'WeaponBay_Main_R_Open'],
  },
}

export type BayDoors = ReturnType<typeof createBayDoors>
/** The bay doors of `model` (a flight model, buildFlightModel), or null when it has none. */
export function createBayDoors(model: Object3D, clips: AnimationClip[], aircraftId: string) {
  const bays = bayClips[getAircraft(aircraftId).presentationId]
  if (!bays) return null
  const names = new Set(Object.values(bays).flat())
  const mixer = new AnimationMixer(model)
  const actions = new Map<string, AnimationAction>()
  for (const clip of prepareAnimations(model, clips.filter(entry => names.has(entry.name)))) {
    const action = mixer.clipAction(clip)
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play(); action.paused = true
    actions.set(clip.name, action)
  }
  // Each bay stays open until this simulation time.
  const openUntil = new Map<string, number>()
  let last: number | null = null
  return {
    /** A missile left `stationId` from a hardpoint at body `z`, at simulation time `now`. */
    open(stationId: string, z: number, now: number) {
      const clip = bays[stationId]?.[z < 0 ? 0 : 1]
      if (clip && actions.has(clip)) openUntil.set(clip, now + HOLD)
    },
    update(now: number) {
      const dt = last === null ? 0 : Math.max(0, now - last)
      last = now
      for (const [name, action] of actions) {
        const duration = action.getClip().duration
        const opening = (openUntil.get(name) ?? -Infinity) > now
        const target = opening ? duration : 0
        const step = dt * duration / (opening ? OPEN : CLOSE)
        action.time += Math.sign(target - action.time) * Math.min(step, Math.abs(target - action.time))
      }
      mixer.update(0)
    },
    reset() { openUntil.clear(); last = null; actions.forEach(action => { action.time = 0 }); mixer.update(0) },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model) },
  }
}
