import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh } from './locales/zh';
import { en } from './locales/en';
import { getSystemLanguage } from './systemLanguage';

export type AppLanguage = 'zh' | 'en';
// What the player picked in settings; 'system' follows the phone's language.
export type LanguageChoice = 'system' | AppLanguage;

export const resolveLanguage = (choice: LanguageChoice): AppLanguage =>
  choice === 'system' ? getSystemLanguage() : choice;

i18next.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: getSystemLanguage(),
  fallbackLng: 'zh',
  // React already escapes text, and the app shows no HTML.
  interpolation: { escapeValue: false },
  initAsync: false,
});

export const i18n = i18next;

// For code outside React components; components use useTranslation so they redraw on a switch.
export const t = i18next.t;

export const currentLanguage = (): AppLanguage => (i18next.language === 'en' ? 'en' : 'zh');

// Matches keep the mode label they were saved with; it is only shown for a mode this app no longer knows.
export const modeDisplayName = (mode: string, savedLabel: string | null): string => {
  const key = `modes.names.${mode}`;
  return i18next.exists(key)
    ? t(key as `modes.names.${keyof typeof zh.modes.names}`)
    : savedLabel ?? mode;
};

export const changeLanguage =(choice: LanguageChoice) => i18next.changeLanguage(resolveLanguage(choice));
