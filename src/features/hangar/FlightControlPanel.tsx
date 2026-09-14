import type { CSSProperties, ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, Flame, Gauge, Plane, RotateCcw, RotateCw } from 'lucide-react'
import { useTexts } from '../../locales'
import type { FlightAction, HangarFlightControls } from './useHangarFlight'

function HoldButton({ action, controls, active, disabled, children, className = '' }: {
  action: FlightAction; controls: HangarFlightControls; active: boolean; disabled: boolean; children: ReactNode; className?: string
}) {
  const release = () => controls.input(action, false, `pad-${action}`)
  const press = () => controls.input(action, true, `pad-${action}`)
  return <button type="button" disabled={disabled} aria-pressed={active} className={`${className}${active ? ' is-active' : ''}`}
    onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); press() }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) press() } }}
    onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); release() } }}
    onClick={event => { if (event.detail === 0) { press(); requestAnimationFrame(release) } }}>
    {children}
  </button>
}
export function FlightControlPanel({ controls, ready }: { controls: HangarFlightControls; ready: boolean }) {
  const text = useTexts(), { state } = controls
  const buttons = [
    ['yawLeft', text.hangarYawLeft, RotateCcw, state.yaw < 0], ['pitchUp', text.hangarPitchUp, ArrowUp, state.pitch > 0],
    ['yawRight', text.hangarYawRight, RotateCw, state.yaw > 0], ['rollLeft', text.hangarRollLeft, ArrowLeft, state.roll < 0],
    ['rollRight', text.hangarRollRight, ArrowRight, state.roll > 0], ['pitchDown', text.hangarPitchDown, ArrowDown, state.pitch < 0],
  ] as const
  return <section id="hangar-panel-flight" aria-labelledby="hangar-tab-flight" className="hangar-section hangar-flight" role="tabpanel">
    <h2 className="hangar-label"><Plane size={14} />{text.hangarManualFlight}<span className="hangar-count">{ready ? 'LIVE' : text.loading}</span></h2>
    <div className="hangar-flight-pad">
      {buttons.map(([action, label, Icon, active]) => <HoldButton key={action} action={action} controls={controls} active={active} disabled={!ready} className={`flight-pad-${action}`}><Icon size={17} strokeWidth={1.7} /><span>{label}</span></HoldButton>)}
      <button type="button" disabled={!ready} className="flight-pad-level" onClick={controls.level}><Crosshair size={18} strokeWidth={1.7} /><span>{text.hangarLevel}</span></button>
    </div>
    <dl className="hangar-flight-readings">{(['pitch', 'roll', 'yaw'] as const).map(axis => <div key={axis}><dt>{axis}</dt><dd>{state[axis] * 100}</dd></div>)}</dl>
    {/* The throttle rail is painted by the track element, not the input: the scale is the
        value the fill reads, so the bar and the thumb cannot drift apart. */}
    <div className={`hangar-thrust${state.afterburner ? ' is-afterburner' : ''}`} style={{ '--hangar-throttle-scale': state.throttle } as CSSProperties}>
      <label htmlFor="hangar-throttle"><Gauge size={12} />{text.hangarThrust}<output>{Math.round(state.throttle * 100)}%</output></label>
      <div className="hangar-throttle-row">
        <HoldButton action="decelerate" controls={controls} active={false} disabled={!ready}>S</HoldButton>
        <div className="hangar-throttle-track">
          <input id="hangar-throttle" type="range" min={0} max={100} step={1} disabled={!ready} value={Math.round(state.throttle * 100)} onChange={event => controls.throttle(Number(event.target.value) / 100)} />
        </div>
        <HoldButton action="accelerate" controls={controls} active={false} disabled={!ready}>W</HoldButton>
      </div>
      <HoldButton action="burner" controls={controls} active={state.afterburner} disabled={!ready} className="hangar-afterburner"><Flame size={15} strokeWidth={1.8} /><span>{text.hangarAfterburner}</span><small>{state.afterburner ? text.hangarHeld : text.hangarHold}</small></HoldButton>
    </div>
    <p className="hangar-control-hint">{text.hangarFlightHint}</p>
  </section>
}
