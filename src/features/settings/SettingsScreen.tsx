/*
Settings as a menu screen (#/settings), opened from Home or the Hangar.
The camera swings to a side view with the aircraft on the right (MenuCamera
'settings' shot); the panel floats on the left. Back returns to the opener.
*/
import { useTranslation } from 'react-i18next'
import { navigate, settingsReturnRoute } from '../../app/routes'
import { SettingsPanel } from './SettingsPanel'

const backLabels = { home: 'navHome', hangar: 'navHangar' } as const

export function SettingsScreen() {
  const { t } = useTranslation()
  const from = settingsReturnRoute()
  const label = t(from === 'hangar' ? backLabels.hangar : backLabels.home)
  return <div className="settings-screen menu-overlay">
    <SettingsPanel backLabel={label} onBack={() => navigate(from)} />
  </div>
}
