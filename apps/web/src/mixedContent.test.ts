import { describe, it, expect } from "vitest";
import { shouldWarnMixedContent, willBeBlocked } from "./mixedContent.js";

describe("shouldWarnMixedContent", () => {
  it("warns only on https pages", () => {
    expect(shouldWarnMixedContent("https:")).toBe(true);
    expect(shouldWarnMixedContent("http:")).toBe(false);
    expect(shouldWarnMixedContent("file:")).toBe(false);
  });
});

describe("willBeBlocked", () => {
  it("blocks ws:// to a LAN host from an https page", () => {
    expect(willBeBlocked("https:", "ws://192.168.1.10:4501")).toBe(true);
    expect(willBeBlocked("https:", "ws://mac-mini.local:4501")).toBe(true);
  });

  it("allows loopback ws:// even on https (browser-exempt)", () => {
    expect(willBeBlocked("https:", "ws://localhost:4501")).toBe(false);
    expect(willBeBlocked("https:", "ws://127.0.0.1:4501")).toBe(false);
  });

  it("allows wss:// from https", () => {
    expect(willBeBlocked("https:", "wss://relay.example.com:8787/client?id=w1")).toBe(false);
  });

  it("never blocks from an http page", () => {
    expect(willBeBlocked("http:", "ws://192.168.1.10:4501")).toBe(false);
  });
});
