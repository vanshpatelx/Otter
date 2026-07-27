import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { startWorker, type RunningWorker } from "./server.js";
import type { WorkerConfig } from "./config.js";
import type { ClientMessage, ServerMessage } from "@ai-workspace/protocol";

/**
 * Drives a real Worker over a real socket. Unit tests cover the pieces; this
 * covers the thing users actually hit — authentication, and whether a
 * workspace really confines what a client can reach.
 */
const PORT = 4977;
const CODE = "AIW-TEST-CODE";

let worker: RunningWorker;
let projectA: string;
let projectB: string;
let home: string;
let projectBase: string;
/** Snapshot of the user's real workspace store, to prove we never touch it. */
let realHomeBefore: string | null = null;

/** Connect, optionally authenticate, and collect messages. */
function client(token?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const received: ServerMessage[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    socket.on("open", () => {
      if (token !== undefined) {
        socket.send(JSON.stringify({ type: "hello", clientId: "test", token } as ClientMessage));
      }
      resolve();
    });
    socket.on("error", reject);
  });
  socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));

  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  const waitFor = async <T extends ServerMessage["type"]>(type: T, ms = 4000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const hit = received.find((m) => m.type === type);
      if (hit) return hit as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${type}; got ${received.map((m) => m.type).join(",")}`);
  };
  return { socket, received, ready, send, waitFor, close: () => socket.close() };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "aiw-int-"));
  projectBase = mkdtempSync(join(tmpdir(), "aiw-int-proj-"));
  projectA = join(projectBase, "alpha");
  projectB = join(projectBase, "beta");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  writeFileSync(join(projectA, "ALPHA.md"), "alpha\n");
  writeFileSync(join(projectB, "BETA.md"), "beta\n");

  const realStore = join(homedir(), ".ai-workspace", "workspaces.json");
  realHomeBefore = existsSync(realStore) ? readFileSync(realStore, "utf8") : null;

  process.env.AIW_HOME = home;
  const config: WorkerConfig = {
    workerId: "w_test",
    port: PORT,
    transport: "local",
    keepAwake: "off",
    agents: [],
    pairingCode: CODE,
    createdAt: new Date(0).toISOString(),
  };
  worker = startWorker(config);
  await new Promise((r) => setTimeout(r, 300));
});

afterAll(async () => {
  await worker.stop();
  // Both must go: leaving the projects behind kept them "existing", so a
  // registry that prunes missing directories would still list them.
  rmSync(home, { recursive: true, force: true });
  rmSync(projectBase, { recursive: true, force: true });
  delete process.env.AIW_HOME;
});

describe("authentication", () => {
  it("accepts the pairing code", async () => {
    const c = client(CODE);
    await c.ready;
    expect((await c.waitFor("auth.result")).ok).toBe(true);
    c.close();
  });

  it("rejects a wrong pairing code", async () => {
    const c = client("AIW-WRONG-CODE");
    await c.ready;
    const result = await c.waitFor("auth.result");
    expect(result.ok).toBe(false);
    c.close();
  });

  it("sends no workspace state before authentication", async () => {
    const c = client(); // never says hello
    await c.ready;
    await new Promise((r) => setTimeout(r, 600));
    expect(c.received.filter((m) => m.type === "workspaces")).toHaveLength(0);
    expect(c.received.filter((m) => m.type === "machine")).toHaveLength(0);
    c.close();
  });

  it("refuses actions from an unauthenticated client", async () => {
    const c = client();
    await c.ready;
    c.send({ type: "fs.list", requestId: "r1", workspaceId: "anything", path: "" });
    const result = await c.waitFor("auth.result");
    expect(result.ok).toBe(false);
    c.close();
  });
});

describe("workspaces over the wire", () => {
  it("opens a workspace and reports it", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "w1", path: projectA });
    const opened = await c.waitFor("workspace.opened");
    expect(opened.workspace.path).toBe(projectA);
    expect(opened.workspace.name).toBe("alpha");
    c.close();
  });

  it("reports an error for a path that does not exist", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "w2", path: "/nope/not/here" });
    expect((await c.waitFor("workspace.error")).message).toMatch(/no such directory/i);
    c.close();
  });

  it("confines file listing to the workspace that was opened", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");

    c.send({ type: "workspace.open", requestId: "wa", path: projectA });
    const a = await c.waitFor("workspace.opened");
    c.send({ type: "fs.list", requestId: "la", workspaceId: a.workspace.workspaceId, path: "" });
    const listing = await c.waitFor("fs.listing");

    const names = listing.entries.map((e) => e.name);
    expect(names).toContain("ALPHA.md");
    // The other project is open on the same Worker but must not leak in.
    expect(names).not.toContain("BETA.md");
    c.close();
  });

  it("refuses to escape a workspace root over the wire", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "wb", path: projectA });
    const a = await c.waitFor("workspace.opened");

    c.send({
      type: "fs.read",
      requestId: "rr",
      workspaceId: a.workspace.workspaceId,
      path: "../../../../etc/passwd",
    });
    expect((await c.waitFor("fs.error")).message).toBeTruthy();
    c.close();
  });

  it("refuses operations against an unknown workspace", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "fs.list", requestId: "lx", workspaceId: "ws_bogus", path: "" });
    expect((await c.waitFor("fs.error")).message).toMatch(/unknown workspace/i);
    c.close();
  });

  it("creates independent sessions within a workspace", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "wc", path: projectB });
    const b = await c.waitFor("workspace.opened");

    c.send({ type: "session.create", requestId: "s1", workspaceId: b.workspace.workspaceId });
    const created = await c.waitFor("session.created");
    expect(created.sessionId).toBeTruthy();
    expect(created.workspaceId).toBe(b.workspace.workspaceId);
    c.close();
  });
});

describe("commands", () => {
  it("runs a safe command in the workspace directory", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "wd", path: projectA });
    const a = await c.waitFor("workspace.opened");

    c.send({
      type: "command.run",
      workspaceId: a.workspace.workspaceId,
      commandId: "c1",
      command: "pwd",
    });
    const result = await c.waitFor("command.result", 8000);
    expect(result.approved).toBe(true);
    expect(result.output).toContain("alpha");
    c.close();
  });

  it("holds a dangerous command for approval instead of running it", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "we", path: projectA });
    const a = await c.waitFor("workspace.opened");

    c.send({
      type: "command.run",
      workspaceId: a.workspace.workspaceId,
      commandId: "c2",
      command: "rm -rf ALPHA.md",
    });
    // An approval request must appear, and no result until it is answered.
    const request = await c.waitFor("approval.request", 6000);
    expect(request.request.kind).toBe("file-delete");
    expect(c.received.find((m) => m.type === "command.result")).toBeUndefined();

    c.send({ type: "approval.resolve", requestId: request.request.id, approved: false });
    const result = await c.waitFor("command.result", 6000);
    expect(result.approved).toBe(false);
    c.close();
  });
});

describe("git review over the wire", () => {
  let repoDir: string;
  let repoWsId: string;

  beforeAll(async () => {
    // A real git repo with one commit, opened as a workspace.
    repoDir = mkdtempSync(join(tmpdir(), "aiw-int-git-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", repoDir, ...args], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@otter.dev");
    git("config", "user.name", "Otter Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.txt"), "line one\n");
    git("add", "-A");
    git("commit", "-q", "-m", "initial");

    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "git-open", path: repoDir });
    repoWsId = (await c.waitFor("workspace.opened")).workspace.workspaceId;
    c.close();
  });

  afterAll(() => rmSync(repoDir, { recursive: true, force: true }));

  it("reports status, diffs, stages, and commits — end to end", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");

    // Modify a tracked file on disk, then ask for status.
    writeFileSync(join(repoDir, "app.txt"), "line one changed\n");
    c.send({ type: "git.status", requestId: "g1", workspaceId: repoWsId });
    const s1 = await c.waitFor("git.status.result");
    expect(s1.status.isRepo).toBe(true);
    expect(s1.status.branch).toBe("main");
    const changed = s1.status.files.find((f) => f.path === "app.txt");
    expect(changed?.status).toBe("modified");
    expect(changed?.unstaged).toBe(true);

    // Diff shows the edit.
    c.send({ type: "git.diff", requestId: "g2", workspaceId: repoWsId, path: "app.txt", staged: false });
    const d = await c.waitFor("git.diff.result");
    expect(d.diff).toContain("+line one changed");

    // Stage it, then commit.
    c.send({ type: "git.stage", requestId: "g3", workspaceId: repoWsId, path: "app.txt", staged: true });
    const ok1 = await c.waitFor("git.ok");
    expect(ok1.ok).toBe(true);

    c.send({ type: "git.commit", requestId: "g4", workspaceId: repoWsId, message: "change line one" });
    const ok2 = await c.waitFor("git.ok");
    expect(ok2.ok).toBe(true);
    c.close();

    // Back to clean — checked on a fresh client so no earlier (dirty)
    // git.status.result lingers in the buffer (waitFor matches by type).
    const c2 = client(CODE);
    await c2.ready;
    await c2.waitFor("auth.result");
    c2.send({ type: "git.status", requestId: "g5", workspaceId: repoWsId });
    const s5 = await c2.waitFor("git.status.result");
    expect(s5.status.files).toEqual([]);
    expect(s5.status.clean).toBe(true);
    c2.close();
  });

  it("rejects a path escaping the workspace", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "git.diff", requestId: "gx", workspaceId: repoWsId, path: "../../../etc/passwd", staged: false });
    // A rejected diff comes back empty rather than leaking anything.
    expect((await c.waitFor("git.diff.result")).diff).toBe("");
    c.close();
  });
});

describe("audit trail over the wire", () => {
  it("records real events to disk and serves them back, newest first", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");

    // Drive a couple of auditable actions through the live socket.
    c.send({ type: "workspace.open", requestId: "au-open", path: projectA });
    const ws = await c.waitFor("workspace.opened");
    c.send({ type: "session.create", requestId: "au-sess", workspaceId: ws.workspace.workspaceId });
    await c.waitFor("session.created");

    c.send({ type: "audit.query", requestId: "au-q", limit: 50 });
    const res = await c.waitFor("audit.entries");
    const kinds = res.entries.map((e) => e.kind);

    // The events we just triggered are all present.
    expect(kinds).toContain("client-authed");
    expect(kinds).toContain("workspace-opened");
    expect(kinds).toContain("session-created");
    // Newest first: the session we just made outranks the auth from before it.
    expect(kinds.indexOf("session-created")).toBeLessThan(kinds.indexOf("client-authed"));

    // And it is durable — the JSONL file exists on disk under AIW_HOME.
    const day = new Date().toISOString().slice(0, 10);
    expect(existsSync(join(home, "audit", `${day}.jsonl`))).toBe(true);
    c.close();
  });

  it("filters the trail by kind", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "audit.query", requestId: "au-f", kinds: ["workspace-opened"] });
    const res = await c.waitFor("audit.entries");
    expect(res.entries.length).toBeGreaterThan(0);
    expect(res.entries.every((e) => e.kind === "workspace-opened")).toBe(true);
    c.close();
  });
});

describe("state isolation", () => {
  it("writes its state inside AIW_HOME", () => {
    expect(existsSync(join(home, "workspaces.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "workspaces.json"), "utf8")).length).toBeGreaterThan(0);
  });

  // Regression: config paths were resolved at import time, so a Worker started
  // after AIW_HOME was set still wrote to the user's real ~/.ai-workspace —
  // which filled their sidebar with this test's fixture projects.
  it("leaves the user's real workspace store untouched", () => {
    const realStore = join(homedir(), ".ai-workspace", "workspaces.json");
    const after = existsSync(realStore) ? readFileSync(realStore, "utf8") : null;
    expect(after).toEqual(realHomeBefore);
  });
});
