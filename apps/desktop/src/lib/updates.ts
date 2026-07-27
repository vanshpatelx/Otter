/**
 * Update checking for the Desktop.
 *
 * The app ships as an ad-hoc-signed DMG, so silent electron-updater installs
 * aren't reliable — but telling someone "a new Otter is out, here's the
 * download" is, and it's what actually keeps installs current. This module is
 * that check: ask GitHub for the latest release, compare it to the running
 * version, and hand back a download link when there's something newer.
 *
 * The comparison and release-picking are pure so they can be tested without a
 * network; only `checkForUpdate` reaches out, and it takes an injectable fetch.
 */

const RELEASES_API = "https://api.github.com/repos/vanshpatelx/Otter/releases";
const RELEASES_PAGE = "https://github.com/vanshpatelx/Otter/releases/latest";

export interface UpdateInfo {
  current: string;
  latest: string;
  url: string;
  notes: string;
}

/** Split a semver-ish string into numeric parts, ignoring a leading `v`. */
function parts(version: string): number[] {
  const core = version.replace(/^v/, "").split("-")[0] ?? "0"; // drop any prerelease suffix
  return core.split(".").map((n) => Number(n) || 0);
}

/** True when `latest` is a strictly higher version than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
  const a = parts(current);
  const b = parts(latest);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

/** The newest non-draft, non-prerelease release, or null if there are none. */
export function pickLatestRelease(releases: GitHubRelease[]): GitHubRelease | null {
  const stable = releases.filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === "string");
  if (stable.length === 0) return null;
  return stable.reduce((best, r) => (isNewerVersion(best.tag_name!, r.tag_name!) ? r : best));
}

/**
 * Check whether a newer stable release exists. Returns null when up to date,
 * when running an unstamped dev build (0.0.0), or when the check fails — a
 * background update check must never surface an error to the user.
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  // Dev builds carry no real version; there's nothing meaningful to compare.
  if (!currentVersion || currentVersion === "0.0.0") return null;
  try {
    const res = await fetchImpl(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) return null;
    const latest = pickLatestRelease(releases);
    if (!latest?.tag_name) return null;
    if (!isNewerVersion(currentVersion, latest.tag_name)) return null;
    return {
      current: currentVersion,
      latest: latest.tag_name.replace(/^v/, ""),
      url: latest.html_url ?? RELEASES_PAGE,
      notes: (latest.body ?? "").slice(0, 500),
    };
  } catch {
    return null;
  }
}
