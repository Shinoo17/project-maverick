import { AnimationClip, AnimationMixer, LoopOnce, PropertyBinding, type KeyframeTrack, type Object3D, type Interpolant } from 'three'

export interface Stage { id: string; duration: number }

function hasMotion(track: KeyframeTrack) {
  const size = track.getValueSize()
  for (let offset = size; offset < track.values.length; offset += size) {
    if (track.name.endsWith('.quaternion')) {
      let dot = 0, firstLength = 0, nextLength = 0
      for (let i = 0; i < size; i++) {
        dot += track.values[i] * track.values[offset + i]
        firstLength += track.values[i] ** 2
        nextLength += track.values[offset + i] ** 2
      }
      if (1 - Math.abs(dot / Math.sqrt(firstLength * nextLength)) > 1e-8) return true
    } else {
      for (let i = 0; i < size; i++) if (Math.abs(track.values[offset + i] - track.values[i]) > 1e-5) return true
    }
  }
  return false
}

// The export contains rest-pose tracks shared across clips. Establish frame zero
// before binding, then remove static tracks so independent mechanisms don't blend.
export function prepareAnimations(model: Object3D, clips: AnimationClip[]) {
  const applied = new Set<string>()
  for (const clip of clips) for (const track of clip.tracks) {
    if (applied.has(track.name)) continue
    // Three's runtime binding methods are installed dynamically and omitted by @types/three.
    const binding = PropertyBinding.create(model, track.name) as unknown as { setValue(values: ArrayLike<number>, offset: number): void; unbind(): void }
    const interpolant = (track as KeyframeTrack & { createInterpolant(): Interpolant }).createInterpolant()
    binding.setValue(interpolant.evaluate(0), 0)
    binding.unbind()
    applied.add(track.name)
  }
  model.updateMatrixWorld(true)
  return clips.map((clip) => new AnimationClip(clip.name, clip.duration, clip.tracks.filter(hasMotion).map((track) => track.clone()), clip.blendMode))
}

export class AnimationStages {
  private mixer: AnimationMixer
  private actions
  readonly stages: Stage[]

  constructor(private model: Object3D, clips: AnimationClip[]) {
    this.mixer = new AnimationMixer(model)
    this.actions = clips.map((clip) => {
      const action = this.mixer.clipAction(clip)
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
      action.paused = true
      return action
    })
    this.stages = clips.map((clip) => ({ id: clip.name, duration: clip.duration }))
    this.mixer.update(0)
  }

  // Explicit playhead movement reverses from the current pose, including after an
  // endpoint or a rapid toggle. Mixer alone owns the model's animated transforms.
  update(delta: number, targets: Record<string, boolean>, playing: boolean, speed: number) {
    let moving = false
    for (const action of this.actions) {
      const duration = action.getClip().duration
      const target = targets[action.getClip().name] ? duration : 0
      if (playing && Math.abs(target - action.time) > 1e-6) {
        const step = Math.min(Math.max(delta, 0), 0.05) * speed
        action.time += Math.sign(target - action.time) * Math.min(step, Math.abs(target - action.time))
        moving ||= Math.abs(target - action.time) > 1e-6
      }
    }
    this.mixer.update(0)
    return moving
  }

  reset() { this.actions.forEach((action) => { action.time = 0 }); this.mixer.update(0) }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model) }
}
