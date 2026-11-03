import { I18nManager } from 'react-native';
import type { AppLanguage } from '.';

// Chinese on a Chinese phone (simplified or traditional), English for every other language.
export const getSystemLanguage = (): AppLanguage => {
  const locale = I18nManager.getConstants().localeIdentifier ?? '';
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};
