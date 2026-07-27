import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "./git.js";

/** A throwaway git repo with an initial commit and deterministic identity. */
function initRepo(dir: string) {
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@otter.dev");
  git("config", "user.name", "Otter Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "hello\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  return git;
}

describe("GitRepo", () => {
  let dir: string;
  let git: (...args: string[]) => Buffer;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aiw-git-"));
    git = initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a clean repo with its branch", async () => {
    const status = await new GitRepo(dir).status();
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.clean).toBe(true);
    expect(status.files).toHaveLength(0);
  });

  it("returns isRepo:false outside a git repo", async () => {
    const bare = mkdtempSync(join(tmpdir(), "aiw-nogit-"));
    const status = await new GitRepo(bare).status();
    expect(status.isRepo).toBe(false);
    rmSync(bare, { recursive: true, force: true });
  });

  it("sees a modified file as unstaged", async () => {
    writeFileSync(join(dir, "README.md"), "hello world\n");
    const status = await new GitRepo(dir).status();
    const readme = status.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.status).toBe("modified");
    expect(readme!.unstaged).toBe(true);
    expect(readme!.staged).toBe(false);
    expect(status.clean).toBe(false);
  });

  it("sees a new file as untracked", async () => {
    writeFileSync(join(dir, "new.txt"), "fresh\n");
    const status = await new GitRepo(dir).status();
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.status).toBe("untracked");
    expect(f?.unstaged).toBe(true);
  });

  it("stages and unstages a file", async () => {
    writeFileSync(join(dir, "README.md"), "changed\n");
    const repo = new GitRepo(dir);

    await repo.stage("README.md");
    let f = (await repo.status()).files.find((x) => x.path === "README.md");
    expect(f?.staged).toBe(true);

    await repo.unstage("README.md");
    f = (await repo.status()).files.find((x) => x.path === "README.md");
    expect(f?.staged).toBe(false);
    expect(f?.unstaged).toBe(true);
  });

  it("produces a unified diff for a modified file", async () => {
    writeFileSync(join(dir, "README.md"), "hello world\n");
    const diff = await new GitRepo(dir).diff("README.md", false);
    expect(diff).toContain("--- a/README.md");
    expect(diff).toContain("+hello world");
    expect(diff).toContain("-hello");
  });

  it("synthesises a diff for an untracked file", async () => {
    writeFileSync(join(dir, "new.txt"), "brand new line\n");
    const diff = await new GitRepo(dir).diff("new.txt", false);
    expect(diff).toContain("brand new line");
  });

  it("commits staged changes and comes back clean", async () => {
    writeFileSync(join(dir, "README.md"), "committed change\n");
    const repo = new GitRepo(dir);
    await repo.stage("README.md");
    const summary = await repo.commit("update readme");
    expect(summary).toMatch(/update readme/);
    expect((await repo.status()).clean).toBe(true);
  });

  it("refuses an empty commit message", async () => {
    await expect(new GitRepo(dir).commit("   ")).rejects.toThrow(/empty/);
  });

  it("rejects a path that escapes the workspace", async () => {
    await expect(new GitRepo(dir).diff("../../../etc/passwd", false)).rejects.toThrow(/unsafe path/);
    await expect(new GitRepo(dir).stage("/etc/passwd")).rejects.toThrow(/unsafe path/);
  });
});
