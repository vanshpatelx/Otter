import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceRegistry } from "./devices.js";

describe("DeviceRegistry", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "otter-dev-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("enrolls a device and issues a token", () => {
    const r = new DeviceRegistry(home);
    const s = r.enroll("client-a", "Phone");
    expect(s.token).toMatch(/^otds_/);
    expect(s.id).toMatch(/^d_/);
    expect(s.label).toBe("Phone");
    expect(r.authenticate(s.token)?.id).toBe(s.id);
  });

  it("is idempotent per clientId (re-pairing keeps one session)", () => {
    const r = new DeviceRegistry(home);
    const first = r.enroll("client-a", "Phone");
    const again = r.enroll("client-a", "Phone renamed");
    expect(again.id).toBe(first.id);
    expect(again.token).toBe(first.token); // same token, not a new one
    expect(again.label).toBe("Phone renamed");
    expect(r.size).toBe(1);
  });

  it("treats different clientIds as different devices", () => {
    const r = new DeviceRegistry(home);
    r.enroll("client-a", "Phone");
    r.enroll("client-b", "Laptop");
    expect(r.size).toBe(2);
  });

  it("rejects an unknown or empty token", () => {
    const r = new DeviceRegistry(home);
    r.enroll("client-a", "Phone");
    expect(r.authenticate("nope")).toBeNull();
    expect(r.authenticate("")).toBeNull();
  });

  it("never exposes tokens in list()", () => {
    const r = new DeviceRegistry(home);
    r.enroll("client-a", "Phone");
    const list = r.list();
    expect(list).toHaveLength(1);
    expect((list[0] as any).token).toBeUndefined();
    expect(list[0]!.label).toBe("Phone");
  });

  it("revokes a device so its token stops working", () => {
    const r = new DeviceRegistry(home);
    const s = r.enroll("client-a", "Phone");
    expect(r.revoke(s.id)).toBe(true);
    expect(r.authenticate(s.token)).toBeNull();
    expect(r.revoke(s.id)).toBe(false); // already gone
  });

  it("revoke-all clears every device", () => {
    const r = new DeviceRegistry(home);
    r.enroll("a", "A");
    r.enroll("b", "B");
    expect(r.revokeAll()).toBe(2);
    expect(r.size).toBe(0);
  });

  it("persists across instances (survives a restart)", () => {
    const s = new DeviceRegistry(home).enroll("client-a", "Phone");
    const reread = new DeviceRegistry(home);
    expect(reread.authenticate(s.token)?.label).toBe("Phone");
  });

  it("honours a revoke made by another process (live reload on authenticate)", () => {
    const worker = new DeviceRegistry(home);
    const s = worker.enroll("client-a", "Phone");
    expect(worker.authenticate(s.token)).not.toBeNull();

    // A separate process (the `otter sessions` CLI) revokes it.
    const cli = new DeviceRegistry(home);
    cli.revoke(s.id);

    // The running worker refuses it on the next auth, without a restart.
    expect(worker.authenticate(s.token)).toBeNull();
  });
});
