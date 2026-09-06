import { en } from './en'
import { th } from './th'
import type { Locale } from '../content/schemas'
export const translations = { en, th }
export function getTranslations(locale: Locale) { return translations[locale] }
