import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "./audit.js";

describe("AuditLog", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aiw-audit-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("persists entries and returns them newest first", () => {
    const audit = new AuditLog(home);
    audit.record("chat", "first");
    audit.record("command", "second");
    audit.record("approval-resolved", "third", { approved: true });

    const entries = audit.query();
    expect(entries.map((e) => e.summary)).toEqual(["third", "second", "first"]);
    expect(entries[0]!.kind).toBe("approval-resolved");
    expect(entries[0]!.approved).toBe(true);
    expect(entries[0]!.ts).toBeGreaterThan(0);
  });

  it("survives a fresh instance reading the same directory", () => {
    new AuditLog(home).record("command", "npm install");
    const reread = new AuditLog(home).query();
    expect(reread).toHaveLength(1);
    expect(reread[0]!.summary).toBe("npm install");
  });

  it("filters by kind", () => {
    const audit = new AuditLog(home);
    audit.record("chat", "hi");
    audit.record("command", "ls");
    audit.record("command", "pwd");

    const commands = audit.query({ kinds: ["command"] });
    expect(commands).toHaveLength(2);
    expect(commands.every((e) => e.kind === "command")).toBe(true);
  });

  it("filters by workspace", () => {
    const audit = new AuditLog(home);
    audit.record("chat", "a", { workspaceId: "w1" });
    audit.record("chat", "b", { workspaceId: "w2" });
    expect(audit.query({ workspaceId: "w1" }).map((e) => e.summary)).toEqual(["a"]);
  });

  it("honours the limit and caps it", () => {
    const audit = new AuditLog(home);
    for (let i = 0; i < 10; i++) audit.record("chat", `m${i}`);
    expect(audit.query({ limit: 3 })).toHaveLength(3);
    // Newest first: m9, m8, m7
    expect(audit.query({ limit: 3 }).map((e) => e.summary)).toEqual(["m9", "m8", "m7"]);
  });

  it("writes a daily-named file", () => {
    const audit = new AuditLog(home);
    audit.record("chat", "hello");
    const day = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(home, "audit", `${day}.jsonl`))).toBe(true);
  });

  it("returns nothing before any writes", () => {
    expect(new AuditLog(home).query()).toEqual([]);
  });
});
