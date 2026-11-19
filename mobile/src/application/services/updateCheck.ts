import { PROJECT_URL } from './feedback';

// What "Check for updates" comes back with. Only a tap asks GitHub; nothing checks on its own.
// A newer release is answered with its page, not its APK: the page says what changed, and the
// browser handles a slow or broken download far better than the app would.
export type UpdateAnswer =
  | { kind: 'upToDate' }
  | { kind: 'newer'; version: string; page: string }
  // No network, GitHub unreachable, or no app release to compare with.
  | { kind: 'failed' };

// The list, not releases/latest: the repository also publishes model releases (model-v1), and
// whichever release is newest would be "latest" there.
const RELEASES_API = 'https://api.github.com/repos/Thomasff/BullTrack/releases?per_page=20';

// Ten seconds, because GitHub from mainland China is often slow rather than down.
const TIMEOUT_MS = 10_000;

interface ReleaseItem {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

// The newest app release's tag (v0.2.0 and so on), skipping drafts, pre-releases and model releases.
export const latestAppTag = (releases: unknown): string | null => {
  if (!Array.isArray(releases)) {
    return null;
  }
  const versions = releases
    .filter(
      (item: ReleaseItem) =>
        typeof item?.tag_name === 'string' &&
        /^v\d/.test(item.tag_name) &&
        !item.draft &&
        !item.prerelease,
    )
    .map((item: ReleaseItem) => item.tag_name as string);
  return versions.reduce<string | null>(
    (best, tag) => (best === null || isNewer(tag, best) ? tag : best),
    null,
  );
};

// Whether latest is a later version than current, part by part as numbers: as text 0.10.0 sorts
// before 0.9.0. A missing part is 0, so v0.3 is 0.3.0.
export const isNewer = (latest: string, current: string) => {
  const parts = (name: string) =>
    name
      .trim()
      .replace(/^v/, '')
      .split('.')
      .map(part => Number.parseInt(part, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x > y;
    }
  }
  return false;
};

// Asks fetchReleases for the release list and compares the newest app release with current.
// fetchReleases resolves to the parsed body, or null for anything but a plain success.
export const answerUpdate = async (
  current: string,
  fetchReleases: () => Promise<unknown>,
): Promise<UpdateAnswer> => {
  const body = await fetchReleases().catch(() => null);
  const tag = body === null ? null : latestAppTag(body);
  if (tag === null) {
    return { kind: 'failed' };
  }
  if (!isNewer(tag, current)) {
    return { kind: 'upToDate' };
  }
  return { kind: 'newer', version: tag, page: `${PROJECT_URL}/releases/tag/${tag}` };
};

// The real fetchReleases: one GET that gives up after TIMEOUT_MS.
export const fetchReleasesFromGitHub = async (): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } finally {
    clearTimeout(timer);
  }
};
