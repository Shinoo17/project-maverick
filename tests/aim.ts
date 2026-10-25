import { Quaternion, Vector3 } from 'three'
import type { GameRuntime } from '../src/game/runtime/GameRuntime'
import { neutralCommand, type PilotCommand } from '../src/game/runtime/commands'
import { getAircraft } from '../src/content/aircraft'
import { gunStation } from '../src/content/weapons'

// Points the gun line at the still drone, allowing for drop, and fires only while on target between 700 and 150 m.
const elevation = gunStation(getAircraft('f22')).elevationDeg! * Math.PI / 180
export function aimAtDrone(runtime: GameRuntime) {
  return (tick: number, entityId: string): PilotCommand => {
    const [me, drone] = runtime.snapshot().aircraft
    const sight = new Vector3(drone.position.x - me.position.x, drone.position.y - me.position.y, drone.position.z - me.position.z)
    const range = sight.length()
    sight.y += 9.81 * (range / gunStation(getAircraft('f22')).profile.muzzleSpeed) ** 2 / 2
    sight.normalize()
    const { x, y, z, w } = me.orientation
    const gunLine = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 0, 1), elevation).applyQuaternion(new Quaternion(x, y, z, w))
    const error = Math.asin(sight.y) - Math.asin(gunLine.y)
    return { ...neutralCommand(tick, entityId), pitch: Math.max(-1, Math.min(1, error * 5)), gunHeld: range < 700 && range > 150 && Math.abs(error) < 0.003 }
  }
}
