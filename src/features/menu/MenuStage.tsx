/*
Wraps the menu 3D scene with everything around it: the WebGL check, loading
and error messages, and retry. Screens never touch the scene directly; they
only tell MenuLayout which aircraft to show and which camera shot to use.
*/
import { lazy, Suspense, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleSlash, RotateCcw } from 'lucide-react'
import type { AircraftDefinition } from '../../content/schemas'
import { modelUrl } from '../../content/aircraft'
import { supportsWebGL2 } from '../../platform/webgl'
import { retryAircraftAsset } from '../../render/aircraft/assetLoader'
import type { MenuShot } from '../../render/menu/MenuScene'
import { SceneBoundary } from '../../ui/components/SceneBoundary'
import { usePageVisible, useReducedMotion } from './hooks'

const MenuScene = lazy(() => import('../../render/menu/MenuScene'))

interface MenuStageProps {
  aircraft: AircraftDefinition
  shot: MenuShot
  hidden: boolean
  resetViewId: number
}

export function MenuStage({ aircraft, shot, hidden, resetViewId }: MenuStageProps) {
  const { t } = useTranslation()
  const [webgl] = useState(supportsWebGL2)
  const reducedMotion = useReducedMotion()
  const pageVisible = usePageVisible()
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [retryId, setRetryId] = useState(0)

  const onReady = useCallback(() => setLoadedId(aircraft.id), [aircraft.id])
  const onError = useCallback(() => setFailedId(aircraft.id), [aircraft.id])
  function retry() {
    retryAircraftAsset(modelUrl(aircraft))
    setFailedId(null)
    setRetryId(value => value + 1)
  }

  const failed = failedId === aircraft.id
  const loading = webgl && !failed && loadedId !== aircraft.id
  const turntable = shot === 'home' && !hidden && pageVisible && !reducedMotion

  return <div className="menu-stage" data-hidden={hidden || undefined}>
    {webgl && <SceneBoundary key={retryId} fallback={null} onError={onError}>
      <Suspense fallback={null}>
        <MenuScene aircraft={aircraft} shot={shot} paused={hidden} turntable={turntable} reducedMotion={reducedMotion}
          resetViewId={resetViewId} retryId={retryId} onReady={onReady} onError={onError} />
      </Suspense>
    </SceneBoundary>}

    {!hidden && <div className="menu-stage-status">
      {!webgl && <p role="alert"><CircleSlash size={16} aria-hidden="true" />{t('unsupported')}</p>}
      {loading && <p role="status">{t('sceneLoading', { name: `${aircraft.designation} ${aircraft.name}` })}</p>}
      {failed && <p role="alert">
        <CircleSlash size={16} aria-hidden="true" />{t('error')}
        <button type="button" className="menu-link" onClick={retry}><RotateCcw size={14} aria-hidden="true" />{t('retry')}</button>
      </p>}
    </div>}
  </div>
}
