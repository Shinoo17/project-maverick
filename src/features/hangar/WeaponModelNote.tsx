/*
Centre of the Armament screen: says what the 3D stage is showing.
The weapon models themselves are drawn by the menu scene; this overlay covers
the cases without one. A weapon with no model file, or a model that failed to
load, gets a dashed NO MODEL box. When weapon images exist, NoModelBox is the
one place to swap the box for a picture.
*/
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { useSessionSettings } from '../../app/sessionStore'
import type { WeaponDefinition, WeaponModelStatus } from '../../content/weapons'

/** 'none' = the weapon has no model file at all. */
type ModelState = WeaponModelStatus | 'none'

function modelState(weapon: WeaponDefinition, statuses: Record<string, WeaponModelStatus>): ModelState {
  return weapon.model ? statuses[weapon.id] ?? 'loading' : 'none'
}

interface WeaponModelNoteProps {
  /** Weapons on screen: one, or all of them. */
  weapons: WeaponDefinition[]
  statuses: Record<string, WeaponModelStatus>
  onRetry: () => void
}

export function WeaponModelNote({ weapons, statuses, onRetry }: WeaponModelNoteProps) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const states = weapons.map(weapon => ({ weapon, state: modelState(weapon, statuses) }))
  const shown = states.filter(item => item.state === 'ready')
  const loading = states.some(item => item.state === 'loading')
  const failed = states.some(item => item.state === 'missing')
  const withoutModel = states.filter(item => item.state === 'none' || item.state === 'missing')

  return <div className="armament-stage" aria-live="polite">
    {shown.length > 0 && <p className="menu-placeholder armament-stage-tag">
      {shown.map(item => item.weapon.name[locale]).join(' · ')} · {t('armamentModel3d')}
    </p>}
    {loading && <p className="armament-stage-status" role="status">{t('armamentModelLoading')}</p>}
    {failed && <p className="armament-stage-status" role="alert">
      {t('armamentModelFailed')}
      <button type="button" className="menu-link" onClick={onRetry}><RotateCcw size={14} aria-hidden="true" />{t('retry')}</button>
    </p>}

    {weapons.length === 1 && withoutModel.length === 1 && <NoModelBox large />}
    {weapons.length > 1 && withoutModel.length > 0 && <div className="armament-no-model-list">
      {withoutModel.map(({ weapon }) => <NoModelBox key={weapon.id} name={weapon.name[locale]} />)}
    </div>}
  </div>
}

/** Stand-in for a missing model. Later this can show a weapon image instead. */
function NoModelBox({ name, large = false }: { name?: string; large?: boolean }) {
  const { t } = useTranslation()
  return <div className={`armament-no-model${large ? ' is-large' : ''}`}>
    <strong>{name ? `${name} · ${t('armamentNoModel')}` : t('armamentNoModel')}</strong>
    {large && <small>{t('armamentImagePending')}</small>}
  </div>
}
