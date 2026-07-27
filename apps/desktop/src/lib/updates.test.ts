import { describe, it, expect } from "vitest";
import { isNewerVersion, pickLatestRelease, checkForUpdate } from "./updates.js";

describe("isNewerVersion", () => {
  it("compares numerically, not lexically", () => {
    expect(isNewerVersion("1.9.0", "1.10.0")).toBe(true); // 10 > 9
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.2.0", "2.0.0")).toBe(true);
  });

  it("is false for equal or older", () => {
    expect(isNewerVersion("1.1.0", "1.1.0")).toBe(false);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(false);
  });

  it("ignores a leading v and prerelease suffix", () => {
    expect(isNewerVersion("v1.0.0", "v1.1.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.1.0-beta.1")).toBe(true);
  });
});

describe("pickLatestRelease", () => {
  it("picks the highest stable release", () => {
    const r = pickLatestRelease([
      { tag_name: "v1.0.0" },
      { tag_name: "v1.2.0" },
      { tag_name: "v1.1.0" },
    ]);
    expect(r?.tag_name).toBe("v1.2.0");
  });

  it("skips drafts and prereleases", () => {
    const r = pickLatestRelease([
      { tag_name: "v1.1.0" },
      { tag_name: "v2.0.0", prerelease: true },
      { tag_name: "v1.9.0", draft: true },
    ]);
    expect(r?.tag_name).toBe("v1.1.0");
  });

  it("returns null when there are no stable releases", () => {
    expect(pickLatestRelease([{ tag_name: "v1.0.0", prerelease: true }])).toBeNull();
    expect(pickLatestRelease([])).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const fakeFetch = (releases: unknown, ok = true): typeof fetch =>
    (async () => ({ ok, json: async () => releases }) as Response) as unknown as typeof fetch;

  it("returns update info when a newer release exists", async () => {
    const info = await checkForUpdate(
      "1.1.0",
      fakeFetch([{ tag_name: "v1.3.0", html_url: "https://example/r", body: "notes here" }]),
    );
    expect(info).not.toBeNull();
    expect(info!.latest).toBe("1.3.0");
    expect(info!.current).toBe("1.1.0");
    expect(info!.url).toBe("https://example/r");
    expect(info!.notes).toBe("notes here");
  });

  it("returns null when already up to date", async () => {
    expect(await checkForUpdate("2.0.0", fakeFetch([{ tag_name: "v1.9.0" }]))).toBeNull();
  });

  it("returns null for a dev build (0.0.0)", async () => {
    // Should not even hit the network.
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return { ok: true, json: async () => [] } as Response;
    }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.0.0", spyFetch)).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null (never throws) on a failed request", async () => {
    expect(await checkForUpdate("1.0.0", fakeFetch(null, false))).toBeNull();
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await checkForUpdate("1.0.0", throwingFetch)).toBeNull();
  });
});
