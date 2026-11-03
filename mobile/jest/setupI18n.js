/* eslint-env jest */
// Tests read the Chinese text, whatever language the test machine reports.
jest.mock('../src/i18n/systemLanguage', () => ({ getSystemLanguage: () => 'zh' }));
