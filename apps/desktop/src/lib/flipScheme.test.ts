import { describe, it, expect } from "vitest";
import { flipScheme } from "./useWorkers.js";

describe("flipScheme", () => {
  it("upgrades ws:// to wss:// (worker turned on TLS)", () => {
    expect(flipScheme("ws://127.0.0.1:4501")).toBe("wss://127.0.0.1:4501");
    expect(flipScheme("ws://mac-mini.local:4501")).toBe("wss://mac-mini.local:4501");
  });

  it("downgrades wss:// to ws:// (worker turned off TLS)", () => {
    expect(flipScheme("wss://127.0.0.1:4501")).toBe("ws://127.0.0.1:4501");
  });

  it("returns null for a non-ws scheme", () => {
    expect(flipScheme("https://example.com")).toBeNull();
    expect(flipScheme("127.0.0.1:4501")).toBeNull();
  });
});
