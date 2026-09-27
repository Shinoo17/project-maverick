/*
Top-level switch: menu screens share MenuLayout (and its 3D scene), the flight
page owns the whole window, and the old aircraft studio keeps its own top bar.
*/
import { lazy, Suspense, useEffect } from 'react'
import { Plane } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isMenuRoute, routes, useRoute } from './routes'
import { selectLocale, useSessionSettings } from './sessionStore'
import { aircraft } from '../content/aircraft'
import { firstOperation } from '../content/campaign/firstOperation'
import { validateOperation } from '../content/campaign/validateOperation'
import { validateAircraft } from '../content/validate'
import { MenuLayout } from '../features/menu/MenuLayout'

validateAircraft(aircraft)
validateOperation(firstOperation)

// Flight and the studio are loaded only when opened.
const FlightPage = lazy(() => import('../features/flight/FlightPage').then(module => ({ default: module.FlightPage })))
const StudioPage = lazy(() => import('../features/studio/HangarPage').then(module => ({ default: module.HangarPage })))

export function App() {
  const { locale } = useSessionSettings()
  const route = useRoute()
  const { t } = useTranslation()
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  if (isMenuRoute(route)) return <div className="app-shell is-menu"><MenuLayout route={route} /></div>

  return <div className={`app-shell ${route === 'flight' ? 'is-flight' : 'is-hangar'}`}>
    {route === 'studio' && <header className="topbar">
      <a className="brand" href={routes.home} aria-label="Maverick"><Plane size={25} strokeWidth={1.4} /><span>MAVERICK</span></a>
      <div className="header-end"><span className="studio-label">{t('hangar')}</span><div className="locale-switch" role="group" aria-label={t('language')}>
        <button aria-pressed={locale === 'th'} onClick={() => selectLocale('th')}>TH</button>
        <button aria-pressed={locale === 'en'} onClick={() => selectLocale('en')}>EN</button>
      </div></div>
    </header>}
    <Suspense fallback={<p role="status">{t('flightLoading')}</p>}>
      {route === 'flight' ? <FlightPage /> : <StudioPage />}
    </Suspense>
  </div>
}
