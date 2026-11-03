import { Linking, Platform } from 'react-native';
import { SHARE_URL } from '../../domain/share/shareCards';
import { t } from '../../i18n';
import { version } from '../../../package.json';

export const FEEDBACK_EMAIL = 'thomasstt@163.com';
export const PROJECT_URL = `https://${SHARE_URL}`;
export const LICENSE_URL = `${PROJECT_URL}/blob/master/LICENSE`;

// The app version and phone, so a report says what it ran on without asking.
const deviceLine = () => {
  if (Platform.OS !== 'android') {
    return `BullTrack ${version}`;
  }
  const { Manufacturer, Model, Release } = Platform.constants;
  return `BullTrack ${version} · ${Manufacturer} ${Model} · Android ${Release}`;
};

export const feedbackMailto = (subject: string, device: string) =>
  `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    `\n\n\n---\n${device}`,
  )}`;

// Opens the mail app with the address, subject and device filled in; false when there is none.
export const openFeedbackEmail = () =>
  Linking.openURL(feedbackMailto(t('settings.feedbackSubject'), deviceLine()))
    .then(() => true)
    .catch(() => false);

export const openUrl = (url: string) => {
  Linking.openURL(url).catch(() => undefined);
};
