/*
What the player chooses about the combat bot: how sharp it is and what it may shoot.
Plain data with no imports, so content schemas and the menus can read it without
pulling in the bot itself (botPilot.ts).
*/
export const botDifficulties = ['easy', 'normal', 'hard'] as const
export type BotDifficulty = typeof botDifficulties[number]

/** 'none': unarmed, it only evades. 'gun' / 'missile': that weapon only. 'full': both. */
export const botLoadouts = ['none', 'gun', 'missile', 'full'] as const
export type BotLoadout = typeof botLoadouts[number]

export interface BotSetup { difficulty: BotDifficulty; loadout: BotLoadout }
export const defaultBotSetup: Readonly<BotSetup> = { difficulty: 'normal', loadout: 'full' }

export const isBotDifficulty = (value: unknown): value is BotDifficulty => (botDifficulties as readonly unknown[]).includes(value)
export const isBotLoadout = (value: unknown): value is BotLoadout => (botLoadouts as readonly unknown[]).includes(value)
export const botHasGun = (loadout: BotLoadout) => loadout === 'gun' || loadout === 'full'
export const botHasMissiles = (loadout: BotLoadout) => loadout === 'missile' || loadout === 'full'
