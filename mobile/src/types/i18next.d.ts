import 'i18next';
import type { zh } from '../i18n/locales/zh';

// Keys passed to t() are checked against the Chinese resources.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof zh };
  }
}
