import { FEEDBACK_EMAIL, feedbackMailto } from '../src/application/services/feedback';

describe('Feedback email', () => {
  test('fills the address, subject and device line', () => {
    const url = feedbackMailto('BullTrack 反馈', 'BullTrack 0.1.0 · Xiaomi 23127PN0CC · Android 15');
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?subject=`)).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(query.get('subject')).toBe('BullTrack 反馈');
    expect(query.get('body')).toBe('\n\n\n---\nBullTrack 0.1.0 · Xiaomi 23127PN0CC · Android 15');
  });
});
