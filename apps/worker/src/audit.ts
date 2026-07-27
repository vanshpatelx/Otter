import { mkdirSync, appendFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AuditEntry, AuditKind } from "@ai-workspace/protocol";

/**
 * A durable record of everything the Worker did.
 *
 * The live activity feed is ephemeral — it lives in a Desktop's memory and is
 * gone when the tab closes. But "what did the agent run on my machine last
 * Tuesday, and did I approve it?" is a question that outlives any session. The
 * audit log is the answer: an append-only firehose to disk that survives
 * restarts, so approvals, commands, and chats leave a trail you can go back to.
 *
 * One JSONL file per day under `<home>/audit/` keeps writes to a single append
 * and makes retention a matter of deleting old files. Reads walk the newest
 * files backwards until the requested count is met, so a "last 200 events"
 * query never loads a year of history.
 */
export class AuditLog {
  private readonly dir: string;

  constructor(homeDir: string) {
    this.dir = join(homeDir, "audit");
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      // A read-only home is not fatal — the Worker still runs, just without a
      // trail. record() degrades to a no-op rather than crashing a turn.
    }
  }

  /** The file a given timestamp belongs in, named by its UTC date. */
  private fileFor(ts: number): string {
    const day = new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
    return join(this.dir, `${day}.jsonl`);
  }

  /**
   * Append one event. Failures are swallowed on purpose: an audit write must
   * never be the reason a chat turn or approval fails to complete.
   */
  record(kind: AuditKind, summary: string, extra?: Partial<Omit<AuditEntry, "ts" | "kind" | "summary">>): void {
    const entry: AuditEntry = { ts: Date.now(), kind, summary, ...extra };
    try {
      appendFileSync(this.fileFor(entry.ts), JSON.stringify(entry) + "\n", "utf8");
    } catch {
      /* best-effort */
    }
  }

  /**
   * The most recent entries, newest first. Walks daily files from today
   * backwards, stopping as soon as `limit` matching entries are collected so
   * old history is never fully parsed for a small query.
   */
  query(opts: { limit?: number; kinds?: AuditKind[]; workspaceId?: string } = {}): AuditEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 2000);
    const kinds = opts.kinds && opts.kinds.length ? new Set(opts.kinds) : null;
    if (!existsSync(this.dir)) return [];

    let files: string[];
    try {
      files = readdirSync(this.dir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .reverse(); // newest day first
    } catch {
      return [];
    }

    const out: AuditEntry[] = [];
    for (const file of files) {
      let lines: string[];
      try {
        lines = readFileSync(join(this.dir, file), "utf8").split("\n");
      } catch {
        continue;
      }
      // Within a file, later lines are newer — walk them backwards too.
      for (let i = lines.length - 1; i >= 0; i--) {
        const raw = lines[i];
        if (!raw) continue;
        let entry: AuditEntry;
        try {
          entry = JSON.parse(raw) as AuditEntry;
        } catch {
          continue;
        }
        if (kinds && !kinds.has(entry.kind)) continue;
        if (opts.workspaceId && entry.workspaceId !== opts.workspaceId) continue;
        out.push(entry);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
}
