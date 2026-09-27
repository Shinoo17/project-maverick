/*
Full-screen placeholder for the map preview: the play-area boundary, both
team spawns and the objective markers of the chosen mode. Positions are
schematic (percent of the screen), not real map coordinates.
*/
import { useTranslation } from 'react-i18next'
import { useSessionSettings } from '../../app/sessionStore'
import type { MapDefinition } from '../../content/maps'
import type { PveModeId } from '../../content/pve/modes'

type Marker = { label: string; x: number; y: number }

/** Where each mode's objectives sit on the schematic preview. */
const objectiveMarkers: Record<PveModeId, Marker[]> = {
  tdm: [],
  'control-point': [{ label: 'A', x: 42, y: 40 }, { label: 'B', x: 50, y: 56 }, { label: 'C', x: 58, y: 44 }],
  ctf: [{ label: '⚑', x: 39, y: 62 }, { label: '⚑', x: 61, y: 38 }],
  'priority-target': [{ label: '♛', x: 50, y: 50 }],
  flyover: [{ label: 'A', x: 44, y: 36 }, { label: 'B', x: 50, y: 62 }, { label: 'C', x: 57, y: 50 }],
}

export function MapPreview({ map, modeId }: { map: MapDefinition; modeId: PveModeId }) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  return <div className="pve-map menu-backdrop" aria-hidden="true">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <ellipse className="pve-boundary" cx="50" cy="54" rx="23" ry="26" />
      <ellipse className="pve-inner" cx="50" cy="54" rx="17" ry="18.5" />
      <path className="pve-inner" d="M50 27 V81 M26 54 H74" />
    </svg>
    <span className="pve-spawn is-ally" style={{ left: '39%', top: '62%' }}>{t('pveAllies')}</span>
    <span className="pve-spawn is-enemy" style={{ left: '61%', top: '46%' }}>{t('pveEnemies')}</span>
    {objectiveMarkers[modeId].map((marker, index) => <span key={index} className="pve-objective"
      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}>{marker.label}</span>)}
    <span className="menu-placeholder pve-map-note">{map.name[locale]} · {t('pveMapPending')}</span>
  </div>
}
