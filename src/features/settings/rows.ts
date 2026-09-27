/*
What the Settings page shows: tabs → sections → rows, built from the saved settings.
Each row knows how to read its value, change it, tell whether it differs from the default
and reset itself. The panel only draws rows and routes keys to them, so a new setting is
one entry here plus its locale strings.

Pending rows (a system that does not exist yet) stay visible with a reason instead of
being hidden (docs 20).
*/
import type { TFunction } from 'i18next'
import {
  selectCallsign, selectCamera, selectCameraFov, selectControls, selectDisplay, selectGraphics, selectKeyboard, selectLocale,
} from '../../app/sessionStore'
import { cameraFovRange, cameraRollOptions, defaultCameraSettings, horizonStyleDisabled, horizonStyleOptions } from '../../game/camera/cameraSettings'
import { defaultKeyboardSettings, sameBindings, type KeyboardSettings } from '../../game/input/keyBindings'
import { defaultMouseSettings } from '../../game/input/mouseStick'
import type { Translation } from '../../locales/en'
import { defaultDisplaySettings, uiScaleRange, type Settings } from '../../platform/storage'
import {
  defaultGraphicsSettings, effectQualities, frameRateLimits, graphicsPreset, presetValues, qualityPresets, renderScales,
} from '../../render/graphicsSettings'

export type TextKey = keyof Translation
export type SettingsTabId = 'keyboard' | 'controller' | 'camera' | 'graphics' | 'audio' | 'interface'
export const settingsTabIds: readonly SettingsTabId[] = ['keyboard', 'controller', 'camera', 'graphics', 'audio', 'interface']

interface RowBase {
  id: string
  label: string
  detail: string
  /** Why the row cannot be changed right now, or null. */
  disabled: string | null
  /** False for rows with no default (language, callsign). */
  modified: boolean
  reset?: () => void
}
export interface ChoiceRow<T = unknown> extends RowBase {
  kind: 'choice'
  options: { value: T; label: string }[]
  /** Index of the current value in `options`, or -1 when it matches none (Custom). */
  index: number
  /** Shown instead of the option label, e.g. "Custom" or "Default". */
  valueLabel?: string
  set: (value: T) => void
}
export interface SliderRow extends RowBase {
  kind: 'slider'
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  set: (value: number) => void
}
export interface TextRow extends RowBase { kind: 'text'; value: string; maxLength: number; set: (value: string) => void }
export interface PageRow extends RowBase { kind: 'page'; page: 'bindings'; valueLabel: string }
export interface PendingRow extends RowBase { kind: 'pending' }
export type SettingsRow = ChoiceRow | SliderRow | TextRow | PageRow | PendingRow

export interface SettingsSection { title: string; rows: SettingsRow[] }
export interface SettingsTab { id: SettingsTabId; label: string; pending: string | null; sections: SettingsSection[] }

/** Choice rows are built through this so option values keep their type. */
function choice<T>(row: Omit<ChoiceRow<T>, 'kind' | 'index'> & { value: T }): ChoiceRow {
  const { value, ...rest } = row
  return { kind: 'choice', ...rest, index: row.options.findIndex(option => option.value === value) } as ChoiceRow
}
const onOff = (t: TFunction) => [{ value: false, label: t('settingsOff') }, { value: true, label: t('settingsOn') }]
const noReason = null

export function buildSettingsTabs(s: Settings, t: TFunction): SettingsTab[] {
  const mouseOff = s.keyboard.preset === 'keyboard' ? t('settingsNeedsMouse') : noReason
  const m = s.controls, dm = defaultMouseSettings
  const g = s.graphics, dg = defaultGraphicsSettings
  const preset = graphicsPreset(g)
  const pending = (id: string, label: TextKey, reason: TextKey): PendingRow =>
    ({ kind: 'pending', id, label: t(label), detail: t(reason), disabled: t(reason), modified: false })
  const effectOptions = effectQualities.map(value => ({ value, label: t(`settingsQuality_${value}` as const) }))

  return [
    {
      id: 'keyboard', label: t('settingsTabKeyboard'), pending: null, sections: [
        { title: t('settingsSectionInput'), rows: [
          choice({ id: 'preset', label: t('inputPreset'), detail: t('settingsPresetDetail'), disabled: noReason,
            options: [{ value: 'mouse', label: t('mousePreset') }, { value: 'keyboard', label: t('keyboardPreset') }],
            value: s.keyboard.preset, modified: s.keyboard.preset !== defaultKeyboardSettings.preset,
            set: preset => selectKeyboard({ preset: preset as 'mouse' | 'keyboard' }), reset: () => selectKeyboard({ preset: defaultKeyboardSettings.preset }) }),
        ] },
        { title: t('settingsSectionMouse'), rows: [
          choice({ id: 'mouseMode', label: t('mouseMode'), detail: t(m.mode === 'relative' ? 'mouseHintRelative' : 'mouseHint'), disabled: mouseOff,
            options: [{ value: 'relative', label: t('mouseModeRelative') }, { value: 'stick', label: t('mouseModeStick') }],
            value: m.mode, modified: m.mode !== dm.mode, set: mode => selectControls({ mode: mode as typeof m.mode }), reset: () => selectControls({ mode: dm.mode }) }),
          choice({ id: 'frame', label: t('controlFrame'), detail: t('settingsFrameDetail'), disabled: mouseOff,
            options: [{ value: 'body', label: t('controlFrameBody') }, { value: 'horizon', label: t('controlFrameHorizon') }],
            value: m.frame, modified: m.frame !== dm.frame, set: frame => selectControls({ frame: frame as typeof m.frame }), reset: () => selectControls({ frame: dm.frame }) }),
          choice({ id: 'xAxis', label: t('mouseXAxis'), detail: t('settingsXAxisDetail'), disabled: mouseOff,
            options: [{ value: 'roll', label: t('mouseXRoll') }, { value: 'yaw', label: t('mouseXYaw') }],
            value: m.xAxis, modified: m.xAxis !== dm.xAxis, set: xAxis => selectControls({ xAxis: xAxis as typeof m.xAxis }), reset: () => selectControls({ xAxis: dm.xAxis }) }),
          { kind: 'slider', id: 'sensitivity', label: t('mouseSensitivity'), detail: t('settingsSensitivityDetail'), disabled: mouseOff,
            value: m.sensitivity, min: 0.5, max: 2, step: 0.1, format: value => `${value.toFixed(1)}×`,
            modified: m.sensitivity !== dm.sensitivity, set: sensitivity => selectControls({ sensitivity: Math.round(sensitivity * 10) / 10 }), reset: () => selectControls({ sensitivity: dm.sensitivity }) },
          choice({ id: 'invert', label: t('invertPitch'), detail: t('settingsInvertDetail'), disabled: mouseOff, options: onOff(t),
            value: m.invertPitch, modified: m.invertPitch !== dm.invertPitch, set: on => selectControls({ invertPitch: on as boolean }), reset: () => selectControls({ invertPitch: dm.invertPitch }) }),
        ] },
        { title: t('settingsSectionBindings'), rows: [
          { kind: 'page', id: 'bindings', page: 'bindings', label: t('settingsBindings'), detail: t('settingsBindingsDetail'), disabled: noReason,
            valueLabel: t(sameBindings(s.keyboard.bindings, defaultKeyboardSettings.bindings) ? 'settingsDefault' : 'settingsCustom'),
            modified: !sameBindings(s.keyboard.bindings, defaultKeyboardSettings.bindings), reset: () => selectKeyboard({ bindings: defaultKeyboardSettings.bindings }) },
          ...(['afterburner', 'airbrake'] as const).map(action => choice({
            id: `${action}Mode`, label: t(`settingsPressMode_${action}` as const), detail: t('settingsPressModeDetail'), disabled: noReason,
            options: [{ value: 'hold', label: t('settingsHold') }, { value: 'toggle', label: t('settingsToggle') }],
            value: s.keyboard[action], modified: s.keyboard[action] !== defaultKeyboardSettings[action],
            set: mode => selectKeyboard({ [action]: mode } as Partial<KeyboardSettings>), reset: () => selectKeyboard({ [action]: defaultKeyboardSettings[action] }) })),
        ] },
      ],
    },
    {
      id: 'controller', label: t('settingsTabController'), pending: t('settingsControllerPending'), sections: [
        { title: t('settingsSectionController'), rows: [
          pending('deadzone', 'settingsDeadzone', 'settingsControllerPending'),
          pending('curve', 'settingsCurve', 'settingsControllerPending'),
          pending('padPitch', 'settingsPadPitch', 'settingsControllerPending'),
          pending('padRoll', 'settingsPadRoll', 'settingsControllerPending'),
          pending('padInvert', 'invertPitch', 'settingsControllerPending'),
          pending('vibration', 'settingsVibration', 'settingsControllerPending'),
          pending('padLayout', 'settingsPadLayout', 'settingsControllerPending'),
          pending('prompts', 'settingsPrompts', 'settingsControllerPending'),
        ] },
      ],
    },
    {
      id: 'camera', label: t('settingsTabCamera'), pending: null, sections: [
        { title: t('settingsSectionChase'), rows: [
          choice({ id: 'roll', label: t('cameraRoll'), detail: t(cameraRollOptions.find(o => o.id === s.camera.roll)!.detailKey), disabled: noReason,
            options: cameraRollOptions.map(option => ({ value: option.id, label: t(option.labelKey) })),
            value: s.camera.roll, modified: s.camera.roll !== defaultCameraSettings.roll,
            set: roll => selectCamera({ roll: roll as typeof s.camera.roll }), reset: () => selectCamera({ roll: defaultCameraSettings.roll }) }),
          // Aircraft locked has no roll style: the row shows "Default" and says why.
          choice({ id: 'style', label: t('cameraStyle'),
            detail: t(s.camera.roll === 'horizon' ? horizonStyleOptions.find(o => o.id === s.camera.horizonStyle)!.detailKey : horizonStyleDisabled.detailKey),
            disabled: s.camera.roll === 'horizon' ? noReason : t(horizonStyleDisabled.detailKey),
            valueLabel: s.camera.roll === 'horizon' ? undefined : t(horizonStyleDisabled.labelKey),
            options: horizonStyleOptions.map(option => ({ value: option.id, label: t(option.labelKey) })),
            value: s.camera.horizonStyle, modified: s.camera.roll === 'horizon' && s.camera.horizonStyle !== defaultCameraSettings.horizonStyle,
            set: style => selectCamera({ horizonStyle: style as typeof s.camera.horizonStyle }), reset: () => selectCamera({ horizonStyle: defaultCameraSettings.horizonStyle }) }),
          { kind: 'slider', id: 'fov', label: t('settingsFov'), detail: t('settingsFovDetail'), disabled: noReason,
            value: s.cameraFov, min: cameraFovRange.min, max: cameraFovRange.max, step: cameraFovRange.step, format: value => `${value}°`,
            modified: s.cameraFov !== cameraFovRange.default, set: selectCameraFov, reset: () => selectCameraFov(cameraFovRange.default) },
        ] },
      ],
    },
    {
      id: 'graphics', label: t('settingsTabGraphics'), pending: null, sections: [
        { title: t('settingsSectionQuality'), rows: [
          choice({ id: 'quality', label: t('settingsQualityPreset'), detail: t('settingsQualityPresetDetail'), disabled: noReason,
            options: qualityPresets.map(value => ({ value, label: t(`settingsQuality_${value}` as const) })),
            value: preset, valueLabel: preset === 'custom' ? t('settingsCustom') : undefined, modified: preset !== 'high',
            set: value => selectGraphics(presetValues[value as keyof typeof presetValues]), reset: () => selectGraphics(presetValues.high) }),
          choice({ id: 'renderScale', label: t('settingsRenderScale'), detail: t('settingsRenderScaleDetail'), disabled: noReason,
            options: renderScales.map(value => ({ value, label: value === 'auto' ? t('settingsAuto') : `${value.toFixed(1)}×` })),
            value: g.renderScale, modified: g.renderScale !== dg.renderScale, set: renderScale => selectGraphics({ renderScale: renderScale as typeof g.renderScale }), reset: () => selectGraphics({ renderScale: dg.renderScale }) }),
          choice({ id: 'antialias', label: t('settingsAntialias'), detail: t('settingsAntialiasDetail'), disabled: noReason, options: onOff(t),
            value: g.antialias, modified: g.antialias !== dg.antialias, set: on => selectGraphics({ antialias: on as boolean }), reset: () => selectGraphics({ antialias: dg.antialias }) }),
        ] },
        { title: t('settingsSectionEffects'), rows: [
          choice({ id: 'exhaust', label: t('settingsExhaust'), detail: t('settingsExhaustDetail'), disabled: noReason, options: effectOptions,
            value: g.exhaust, modified: g.exhaust !== dg.exhaust, set: exhaust => selectGraphics({ exhaust: exhaust as typeof g.exhaust }), reset: () => selectGraphics({ exhaust: dg.exhaust }) }),
          choice({ id: 'vapor', label: t('settingsVapor'), detail: t('settingsVaporDetail'), disabled: noReason, options: effectOptions,
            value: g.vapor, modified: g.vapor !== dg.vapor, set: vapor => selectGraphics({ vapor: vapor as typeof g.vapor }), reset: () => selectGraphics({ vapor: dg.vapor }) }),
        ] },
        { title: t('settingsSectionPerformance'), rows: [
          choice({ id: 'frameRate', label: t('settingsFrameRate'), detail: t('settingsFrameRateDetail'), disabled: noReason,
            options: frameRateLimits.map(value => ({ value, label: value === 'unlimited' ? t('settingsUnlimited') : `${value} FPS` })),
            value: g.frameRate, modified: g.frameRate !== dg.frameRate, set: frameRate => selectGraphics({ frameRate: frameRate as typeof g.frameRate }), reset: () => selectGraphics({ frameRate: dg.frameRate }) }),
          choice({ id: 'showFps', label: t('settingsShowFps'), detail: t('settingsShowFpsDetail'), disabled: noReason, options: onOff(t),
            value: g.showFps, modified: g.showFps !== dg.showFps, set: on => selectGraphics({ showFps: on as boolean }), reset: () => selectGraphics({ showFps: dg.showFps }) }),
        ] },
      ],
    },
    {
      id: 'audio', label: t('settingsTabAudio'), pending: t('settingsAudioPending'), sections: [
        { title: t('settingsSectionVolume'), rows: [
          pending('master', 'settingsVolumeMaster', 'settingsAudioPending'),
          pending('engine', 'settingsVolumeEngine', 'settingsAudioPending'),
          pending('ui', 'settingsVolumeUi', 'settingsAudioPending'),
        ] },
      ],
    },
    {
      id: 'interface', label: t('settingsTabInterface'), pending: null, sections: [
        { title: t('settingsSectionGeneral'), rows: [
          choice({ id: 'language', label: t('language'), detail: t('settingsLanguageDetail'), disabled: noReason,
            options: [{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }],
            value: s.locale, modified: false, set: locale => selectLocale(locale as 'th' | 'en') }),
          { kind: 'text', id: 'callsign', label: t('settingsCallsign'), detail: t('settingsCallsignDetail'), disabled: noReason,
            value: s.callsign, maxLength: 16, modified: false, set: selectCallsign },
        ] },
        { title: t('settingsSectionAccessibility'), rows: [
          { kind: 'slider', id: 'uiScale', label: t('settingsUiScale'), detail: t('settingsUiScaleDetail'), disabled: noReason,
            value: s.display.uiScale, min: uiScaleRange.min, max: uiScaleRange.max, step: uiScaleRange.step, format: value => `${value}%`,
            modified: s.display.uiScale !== defaultDisplaySettings.uiScale, set: uiScale => selectDisplay({ uiScale }), reset: () => selectDisplay({ uiScale: defaultDisplaySettings.uiScale }) },
          choice({ id: 'reducedMotion', label: t('settingsReducedMotion'), detail: t('settingsReducedMotionDetail'), disabled: noReason,
            options: [{ value: 'auto', label: t('settingsAutoSystem') }, { value: 'on', label: t('settingsOn') }, { value: 'off', label: t('settingsOff') }],
            value: s.display.reducedMotion, modified: s.display.reducedMotion !== defaultDisplaySettings.reducedMotion,
            set: reducedMotion => selectDisplay({ reducedMotion: reducedMotion as 'auto' | 'on' | 'off' }), reset: () => selectDisplay({ reducedMotion: defaultDisplaySettings.reducedMotion }) }),
        ] },
      ],
    },
  ]
}

/** Every row of a tab in display order (the order ↑ ↓ walks). */
export function tabRows(tab: SettingsTab): SettingsRow[] {
  return tab.sections.flatMap(section => section.rows)
}

/** The option a ← or → press selects, or null at the end of the list. Custom (-1) steps into the list. */
export function stepChoice(row: ChoiceRow, direction: -1 | 1): number | null {
  if (row.index < 0) return direction > 0 ? 0 : row.options.length - 1
  const next = row.index + direction
  return next >= 0 && next < row.options.length ? next : null
}

/** A slider value one step along, kept on the step grid and inside the range. */
export function stepSlider(row: SliderRow, direction: -1 | 1): number {
  const steps = Math.round((row.value - row.min) / row.step) + direction
  return Math.min(row.max, Math.max(row.min, Math.round((row.min + steps * row.step) * 1000) / 1000))
}
