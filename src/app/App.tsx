import { useEffect } from 'react'
import { Plane } from 'lucide-react'
import { AppRoutes, routeClass, routes, useRoute } from './routes'
import { selectLocale, useSessionSettings } from './sessionStore'
import { getTranslations } from '../locales'
import { aircraft } from '../content/aircraft'
import { validateAircraft } from '../content/validate'

validateAircraft(aircraft)

export function App() {
  const { locale } = useSessionSettings()
  const route = useRoute()
  const text = getTranslations(locale)
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  return <div className={`app-shell${routeClass[route] ? ` ${routeClass[route]}` : ''}`}>
    <header className="topbar">
      <a className="brand" href={routes.home} aria-label="Maverick"><Plane size={25} strokeWidth={1.4} /><span>MAVERICK</span></a>
      <div className="header-end"><span className="studio-label">AIRCRAFT STUDIO</span><div className="locale-switch" role="group" aria-label={text.language}>
        <button aria-pressed={locale === 'th'} onClick={() => selectLocale('th')}>TH</button>
        <button aria-pressed={locale === 'en'} onClick={() => selectLocale('en')}>EN</button>
      </div></div>
    </header>
    <AppRoutes />
  </div>
}
