import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch, hostname } from "node:os";

/**
 * Crash reporting for the Worker — local always, remote only if you ask.
 *
 * A Worker runs unattended for days; when it falls over, the useful evidence
 * (the stack, what it was doing) is gone the moment the terminal scrolls. So a
 * crash always leaves a dump on disk under `<home>/crashes/`, which is private
 * and costs nothing.
 *
 * Sending anything off the machine is strictly opt-in: only when the user
 * enabled crash reporting AND an `OTTER_CRASH_DSN` endpoint is configured does
 * a redacted report get POSTed. Reports carry no environment, no file contents,
 * and no user text — just the error, and home directories in the stack are
 * rewritten to `~` so paths don't leak a username.
 */

/** Rewrite the user's home directory to `~` so stacks don't leak a username. */
export function redactHome(text: string): string {
  const home = homedir();
  if (!home) return text;
  // Escape regex metachars in the home path before using it as a pattern.
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "g"), "~");
}

export interface CrashReport {
  workerId: string;
  version: string;
  at: number;
  origin: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  error: { name: string; message: string; stack: string };
}

/** Build a minimal, redacted report from an error. Pure — easy to test. */
export function buildCrashReport(
  error: unknown,
  meta: { workerId: string; version: string; origin: string; at: number },
): CrashReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    workerId: meta.workerId,
    version: meta.version,
    at: meta.at,
    origin: meta.origin,
    platform: platform(),
    arch: arch(),
    nodeVersion: process.version,
    error: {
      name: err.name,
      message: redactHome(err.message),
      stack: redactHome(err.stack ?? ""),
    },
  };
}

export interface CrashReporterOptions {
  /** Directory to write local dumps under (a `crashes/` subdir is created). */
  homeDir: string;
  workerId: string;
  version: string;
  /** The user opted in to sending reports off the machine. */
  optedIn: boolean;
  /** Remote endpoint; without one, nothing is ever sent even if opted in. */
  dsn?: string;
  /** Injectable for tests; defaults to a fetch POST. */
  now?: () => number;
}

export class CrashReporter {
  private readonly crashDir: string;
  constructor(private readonly opts: CrashReporterOptions) {
    this.crashDir = join(opts.homeDir, "crashes");
  }

  /** True only when a report may actually leave the machine. */
  get willSend(): boolean {
    return this.opts.optedIn && Boolean(this.opts.dsn);
  }

  /**
   * Record a crash: always write a local dump, and POST a redacted report when
   * (and only when) sending is enabled. Never throws — a reporter that fails
   * must not mask the crash it's reporting.
   */
  async report(error: unknown, origin: string): Promise<CrashReport | null> {
    const at = this.opts.now?.() ?? Date.now();
    const report = buildCrashReport(error, {
      workerId: this.opts.workerId,
      version: this.opts.version,
      origin,
      at,
    });

    try {
      mkdirSync(this.crashDir, { recursive: true });
      writeFileSync(join(this.crashDir, `${at}.json`), JSON.stringify(report, null, 2), "utf8");
    } catch {
      // A read-only home shouldn't turn a crash into two crashes.
    }

    if (this.willSend) {
      try {
        await fetch(this.opts.dsn!, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(4000),
        });
      } catch {
        // Best-effort — the local dump is the source of truth.
      }
    }
    return report;
  }

  /**
   * Hook process-level crash handlers. An uncaught exception leaves the process
   * in an undefined state, so we record and then exit; an unhandled rejection
   * is recorded but left to Node's own policy.
   */
  install(): void {
    process.on("uncaughtException", (err) => {
      void this.report(err, "uncaughtException").finally(() => process.exit(1));
    });
    process.on("unhandledRejection", (reason) => {
      void this.report(reason, "unhandledRejection");
    });
  }
}

/** Where the crash-reporting toggle and endpoint come from. */
export function crashReportingEnv(): { dsn?: string } {
  const dsn = process.env.OTTER_CRASH_DSN?.trim();
  return dsn ? { dsn } : {};
}

/** The Worker's machine label, handy for humans reading a dump. */
export function machineLabel(): string {
  return hostname();
}
