/*
Controls for the flight briefing/pause menu (FlightPage). They follow the menu overlay
language in DESIGN.md: type on hairlines, cyan marks the selection, no filled panels.

- BriefingChoice: a row of options as native radio buttons, so arrow keys move between
  them. Each option has a name and an optional detail line in mono (heights, speeds).
- BriefingStepper: one value stepped with arrows, for long lists (lessons).
A label's part after " · " ("resets flight") is drawn as a quiet note at the right.
*/
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, type CSSProperties } from 'react'

export interface ChoiceOption<T extends string> { value: T; name: string; detail?: string }

export function BriefingChoice<T extends string>({ label, hint, options, value, disabled, onChange }:
  { label: string; hint?: string; options: readonly ChoiceOption<T>[]; value: T; disabled?: boolean; onChange: (value: T) => void }) {
  const name = useId()
  return <fieldset className="briefing-field" disabled={disabled}>
    <BriefingLabel text={label} as="legend" />
    <div className="briefing-choice" style={{ '--choices': options.length } as CSSProperties}>
      {options.map(option => <label key={option.value} className="briefing-option">
        <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span className="briefing-option-name">{option.name}</span>
        {option.detail && <span className="briefing-option-detail">{option.detail}</span>}
      </label>)}
    </div>
    {hint && <p className="briefing-hint">{hint}</p>}
  </fieldset>
}

export function BriefingStepper({ label, values, index, disabled, previousLabel, nextLabel, onChange }:
  { label: string; values: readonly string[]; index: number; disabled?: boolean; previousLabel: string; nextLabel: string; onChange: (index: number) => void }) {
  const id = useId()
  return <div className="briefing-field" role="group" aria-labelledby={id}>
    <BriefingLabel text={label} id={id} />
    <div className="briefing-stepper">
      <button type="button" disabled={disabled || index === 0} aria-label={previousLabel} onClick={() => onChange(index - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <output aria-live="polite">{values[index]}</output>
      <button type="button" disabled={disabled || index === values.length - 1} aria-label={nextLabel} onClick={() => onChange(index + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
  </div>
}

/** A label, with the part after " · " (e.g. "resets flight") set apart as a quiet note. */
function BriefingLabel({ text, as: Tag = 'span', id }: { text: string; as?: 'span' | 'legend'; id?: string }) {
  const [main, ...note] = text.split(' · ')
  return <Tag className="briefing-label" id={id}><span>{main}</span>{note.length > 0 && <small>{note.join(' · ')}</small>}</Tag>
}
