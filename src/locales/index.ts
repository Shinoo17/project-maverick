import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { en, type Translation } from './en'
import { th } from './th'
import { loadSettings } from '../platform/storage'
export const translations = { en, th }
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, th: { translation: th } },
  lng: loadSettings().locale, fallbackLng: 'en', supportedLngs: ['th', 'en'],
  interpolation: { escapeValue: false }, initAsync: false,
})
// Existing panel/clip-label API remains typed, with all strings resolved by i18next.
export function useTexts(): Translation {
  const { t } = useTranslation()
  return Object.fromEntries(Object.keys(en).map(key => [key, t(key as keyof Translation)])) as Translation
}
export default i18n

declare module 'i18next' {
  interface CustomTypeOptions { defaultNS: 'translation'; resources: { translation: typeof en } }
}
