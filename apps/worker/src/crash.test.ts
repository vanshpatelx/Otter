import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { CrashReporter, buildCrashReport, redactHome } from "./crash.js";

describe("redactHome", () => {
  it("rewrites the home directory to ~", () => {
    const stack = `Error: boom\n    at ${join(homedir(), "code", "x.ts")}:1:1`;
    const out = redactHome(stack);
    expect(out).not.toContain(homedir());
    expect(out).toContain("~/code/x.ts");
  });
});

describe("buildCrashReport", () => {
  it("captures a redacted, minimal report", () => {
    const err = new Error(`failed near ${join(homedir(), "secret")}`);
    const r = buildCrashReport(err, { workerId: "w1", version: "3", origin: "uncaughtException", at: 123 });
    expect(r.workerId).toBe("w1");
    expect(r.origin).toBe("uncaughtException");
    expect(r.error.name).toBe("Error");
    expect(r.error.message).toContain("~/secret");
    expect(r.error.message).not.toContain(homedir());
    // No environment or user content is carried.
    expect(JSON.stringify(r)).not.toContain("PATH");
  });

  it("coerces a non-Error throw", () => {
    const r = buildCrashReport("string boom", { workerId: "w", version: "1", origin: "x", at: 1 });
    expect(r.error.message).toBe("string boom");
  });
});

describe("CrashReporter", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aiw-crash-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("always writes a local dump", async () => {
    const r = new CrashReporter({ homeDir: home, workerId: "w1", version: "1", optedIn: false, now: () => 42 });
    await r.report(new Error("local only"), "test");
    const dumps = readdirSync(join(home, "crashes"));
    expect(dumps).toContain("42.json");
    const saved = JSON.parse(readFileSync(join(home, "crashes", "42.json"), "utf8"));
    expect(saved.error.message).toBe("local only");
  });

  it("does not send when opted out, even with a DSN", async () => {
    const r = new CrashReporter({ homeDir: home, workerId: "w", version: "1", optedIn: false, dsn: "http://x" });
    expect(r.willSend).toBe(false);
  });

  it("does not send when opted in but no DSN is set", async () => {
    const r = new CrashReporter({ homeDir: home, workerId: "w", version: "1", optedIn: true });
    expect(r.willSend).toBe(false);
    // Still writes locally.
    await r.report(new Error("x"), "test");
    expect(existsSync(join(home, "crashes"))).toBe(true);
  });

  it("POSTs a redacted report only when opted in AND a DSN is set", async () => {
    const received: any[] = [];
    const server = await listen((body) => received.push(body));
    const dsn = `http://127.0.0.1:${(server.address() as any).port}/ingest`;
    try {
      const r = new CrashReporter({ homeDir: home, workerId: "w9", version: "7", optedIn: true, dsn, now: () => 5 });
      expect(r.willSend).toBe(true);
      await r.report(new Error(`boom at ${join(homedir(), "p")}`), "uncaughtException");

      expect(received).toHaveLength(1);
      expect(received[0].workerId).toBe("w9");
      expect(received[0].origin).toBe("uncaughtException");
      // Sent payload is redacted too.
      expect(received[0].error.message).toContain("~/p");
      expect(JSON.stringify(received[0])).not.toContain(homedir());
    } finally {
      server.close();
    }
  });

  it("swallows a send failure (local dump still written)", async () => {
    // Nothing is listening on this port — the POST will fail.
    const r = new CrashReporter({
      homeDir: home,
      workerId: "w",
      version: "1",
      optedIn: true,
      dsn: "http://127.0.0.1:1/nope",
      now: () => 8,
    });
    await expect(r.report(new Error("x"), "test")).resolves.toBeTruthy();
    expect(existsSync(join(home, "crashes", "8.json"))).toBe(true);
  });
});

/** Spin up a throwaway HTTP server that hands each JSON body to `onBody`. */
function listen(onBody: (body: unknown) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          onBody(JSON.parse(data));
        } catch {
          onBody(null);
        }
        res.writeHead(200);
        res.end("ok");
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
