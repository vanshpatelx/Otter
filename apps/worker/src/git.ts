import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitFileChange, GitStatus } from "@ai-workspace/protocol";

const run = promisify(execFile);

/** Cap git output so a monster diff can't blow up a message. */
const MAX_DIFF_BYTES = 512 * 1024;

/**
 * Read-and-review layer over a workspace's git repository.
 *
 * The whole point of watching an agent work is being able to see what it
 * changed and decide what to keep — so the Desktop needs status, per-file
 * diffs, staging, and commit. Everything shells out to the real `git` with
 * `-C <cwd>` and `--` path separators (no shell, no interpolation), and every
 * client-supplied path is checked to stay inside the workspace before it is
 * handed to git.
 */

/** Reject anything that could escape the workspace root before it reaches git. */
function safeRelPath(path: string): string {
  const p = path.replace(/^\.\//, "").trim();
  if (p === "" || p.startsWith("/") || p.startsWith("~") || p.split("/").includes("..")) {
    throw new Error(`unsafe path: ${path}`);
  }
  return p;
}

/** Map a two-char porcelain-v1 code to a human status + where the change sits. */
function classify(x: string, y: string): { status: GitFileChange["status"]; staged: boolean; unstaged: boolean } {
  if (x === "?" && y === "?") return { status: "untracked", staged: false, unstaged: true };
  if (x === "U" || y === "U" || (x === "D" && y === "D") || (x === "A" && y === "A"))
    return { status: "conflicted", staged: false, unstaged: true };
  const code = (c: string): GitFileChange["status"] =>
    c === "A" ? "added" : c === "D" ? "deleted" : c === "R" ? "renamed" : "modified";
  const staged = x !== " " && x !== "?";
  const unstaged = y !== " " && y !== "?";
  // Prefer the side that actually has a change for the label.
  const status = staged ? code(x) : code(y);
  return { status, staged, unstaged };
}

export class GitRepo {
  constructor(private readonly cwd: string) {}

  private git(args: string[]) {
    return run("git", ["-C", this.cwd, ...args], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
  }

  /** Working-tree status: branch, ahead/behind, and every changed file. */
  async status(): Promise<GitStatus> {
    let branch: string | null = null;
    let ahead = 0;
    let behind = 0;
    let raw: string;
    try {
      // -z NUL-separates entries so filenames with spaces/newlines are safe.
      const { stdout } = await this.git(["status", "--porcelain=v1", "--branch", "-z"]);
      raw = stdout;
    } catch {
      return { isRepo: false, branch: null, ahead: 0, behind: 0, files: [], clean: true };
    }

    const parts = raw.split("\0");
    const files: GitFileChange[] = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry) continue;
      if (entry.startsWith("##")) {
        // Branch header: "## main...origin/main [ahead 1, behind 2]"
        const header = entry.slice(2).trim();
        branch = header.split(/\.\.\.|\s/)[0] || null;
        const a = header.match(/ahead (\d+)/);
        const b = header.match(/behind (\d+)/);
        if (a) ahead = Number(a[1]);
        if (b) behind = Number(b[1]);
        continue;
      }
      const x = entry[0]!;
      const y = entry[1]!;
      const path = entry.slice(3);
      const { status, staged, unstaged } = classify(x, y);
      // A rename carries the old name as the next NUL field; skip it.
      if (x === "R" || y === "R") i++;
      files.push({ path, status, staged, unstaged });
    }
    return { isRepo: true, branch, ahead, behind, files, clean: files.length === 0 };
  }

  /** Unified diff for one file. `staged` reads the index; otherwise the tree. */
  async diff(path: string, staged: boolean): Promise<string> {
    const rel = safeRelPath(path);
    try {
      const args = staged
        ? ["diff", "--cached", "--", rel]
        : ["diff", "--", rel];
      let { stdout } = await this.git(args);
      // Untracked files show nothing in a plain diff; synthesise one so the
      // reviewer sees the new content as additions.
      if (!stdout.trim() && !staged) {
        try {
          await this.git(["diff", "--no-index", "--", "/dev/null", rel]);
        } catch (e) {
          // --no-index exits 1 when files differ, but still prints the diff.
          stdout = (e as { stdout?: string }).stdout ?? stdout;
        }
      }
      return stdout.slice(0, MAX_DIFF_BYTES);
    } catch (e) {
      // A diff can exit non-zero yet still be meaningful (e.g. --no-index).
      const out = (e as { stdout?: string }).stdout;
      if (out) return out.slice(0, MAX_DIFF_BYTES);
      throw e;
    }
  }

  async stage(path: string): Promise<void> {
    await this.git(["add", "--", safeRelPath(path)]);
  }

  async unstage(path: string): Promise<void> {
    // reset -- restores the index entry from HEAD without touching the tree.
    await this.git(["reset", "-q", "HEAD", "--", safeRelPath(path)]);
  }

  async stageAll(): Promise<void> {
    await this.git(["add", "-A"]);
  }

  /** Commit whatever is staged. Returns git's summary, or throws its stderr. */
  async commit(message: string): Promise<string> {
    const msg = message.trim();
    if (!msg) throw new Error("commit message is empty");
    try {
      const { stdout } = await this.git(["commit", "-m", msg]);
      return stdout.trim();
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string };
      throw new Error((err.stderr || err.stdout || "commit failed").trim());
    }
  }
}
