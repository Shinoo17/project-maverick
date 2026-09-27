/*
ALLIES / ENEMIES columns of PVE Setup. The player is the first ally; the
remaining slots are bots. Clicking a bot's aircraft switches it to the next
aircraft in the roster.
*/
import { useTranslation } from 'react-i18next'
import { Repeat } from 'lucide-react'
import { updatePveSetup, useSessionSettings } from '../../app/sessionStore'
import { aircraft as roster, getAircraft } from '../../content/aircraft'
import type { AircraftDefinition, AircraftId } from '../../content/schemas'
import { difficulties } from '../../content/pve/modes'
import type { PveSetup } from '../../platform/storage'
import { SectionHeading } from '../menu/parts'

interface TeamRosterProps {
  setup: PveSetup
  player: AircraftDefinition
  callsign: string
}

const nextAircraft = (id: AircraftId) => roster[(roster.findIndex(entry => entry.id === id) + 1) % roster.length].id

export function TeamRoster({ setup, player, callsign }: TeamRosterProps) {
  const { t } = useTranslation()
  const { locale } = useSessionSettings()
  const difficulty = difficulties.find(item => item.id === setup.difficulty)!.label[locale]
  const allies = setup.allyAircraft.slice(0, setup.teamSize - 1)
  const enemies = setup.enemyAircraft.slice(0, setup.teamSize)

  function swap(team: 'allyAircraft' | 'enemyAircraft', index: number) {
    const list = [...setup[team]]
    list[index] = nextAircraft(list[index])
    updatePveSetup({ [team]: list })
  }

  return <div className="pve-roster">
    <SectionHeading title={t('pveRoster')} />
    <div className="pve-teams">
      <ul aria-label={t('pveAllies')}>
        <li className="pve-team-title is-ally">{t('pveAllies')}</li>
        <li className="pve-slot"><strong>{callsign}</strong><small>{t('pveYou')}</small><span>{player.designation}</span></li>
        {allies.map((id, index) => <BotSlot key={index} callsign={`ALLY-${index + 1}`} detail={difficulty} aircraftId={id}
          onSwap={() => swap('allyAircraft', index)} />)}
      </ul>
      <ul aria-label={t('pveEnemies')}>
        <li className="pve-team-title is-enemy">{t('pveEnemies')}</li>
        {enemies.map((id, index) => <BotSlot key={index} callsign={`BOT-${index + 1}`} detail={difficulty} aircraftId={id}
          onSwap={() => swap('enemyAircraft', index)} />)}
      </ul>
    </div>
  </div>
}

function BotSlot({ callsign, detail, aircraftId, onSwap }: { callsign: string; detail: string; aircraftId: AircraftId; onSwap: () => void }) {
  const { t } = useTranslation()
  return <li className="pve-slot">
    <strong>{callsign}</strong><small>{detail}</small>
    <button type="button" className="menu-link" onClick={onSwap} aria-label={t('pveSwapAircraft', { name: callsign })}>
      {getAircraft(aircraftId).designation}<Repeat size={13} aria-hidden="true" />
    </button>
  </li>
}
