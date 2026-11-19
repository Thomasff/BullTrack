import { answerUpdate, isNewer, latestAppTag } from '../src/application/services/updateCheck';

describe('Update check', () => {
  test('compares versions part by part as numbers', () => {
    expect(isNewer('v0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('v0.1', '0.1.0')).toBe(false);
    expect(isNewer('v0.1.0', '0.2.0')).toBe(false);
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true);
  });

  test('takes the newest app release and skips model releases, drafts and pre-releases', () => {
    const releases = [
      { tag_name: 'model-v2', draft: false, prerelease: false },
      { tag_name: 'v0.4.0', draft: true, prerelease: false },
      { tag_name: 'v0.3.0', draft: false, prerelease: true },
      { tag_name: 'v0.2.0', draft: false, prerelease: false },
      { tag_name: 'v0.10.0', draft: false, prerelease: false },
      { tag_name: 'v0.1.0', draft: false, prerelease: false },
    ];
    expect(latestAppTag(releases)).toBe('v0.10.0');
    expect(latestAppTag([{ tag_name: 'model-v1' }])).toBeNull();
    expect(latestAppTag({ message: 'Not Found' })).toBeNull();
  });

  test('answers with the release page when there is a newer version', async () => {
    const answer = await answerUpdate('0.1.0', async () => [
      { tag_name: 'v0.2.0', draft: false, prerelease: false },
    ]);
    expect(answer).toEqual({
      kind: 'newer',
      version: 'v0.2.0',
      page: 'https://github.com/Thomasff/BullTrack/releases/tag/v0.2.0',
    });
  });

  test('answers up to date or failed', async () => {
    const current = [{ tag_name: 'v0.1.0', draft: false, prerelease: false }];
    expect(await answerUpdate('0.1.0', async () => current)).toEqual({ kind: 'upToDate' });
    expect(await answerUpdate('0.1.0', async () => null)).toEqual({ kind: 'failed' });
    expect(
      await answerUpdate('0.1.0', async () => {
        throw new Error('offline');
      }),
    ).toEqual({ kind: 'failed' });
  });
});
