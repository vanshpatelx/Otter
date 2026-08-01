import { spawn, type IPty } from "node-pty";
import { spawnSync } from "node:child_process";
import { env, platform } from "node:process";

export interface TerminalHandlers {
  onData(terminalId: string, data: string): void;
  onExit(terminalId: string, code: number | null): void;
}

/** A running terminal, as advertised to clients that want to reattach. */
export interface TerminalSession {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivity: number;
  /** The tmux session name, when this terminal is shared (attachable on the host). */
  tmux?: string;
}

/**
 * The tmux session name for a terminal — sanitised, since tmux forbids `.`,
 * `:`, and whitespace in names. Prefixed so `tmux ls` on the host reads clearly.
 */
export function tmuxSessionName(terminalId: string): string {
  return `otter-${terminalId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * What to spawn for a terminal. With a tmux binary, the shell is wrapped in a
 * named tmux session (`new-session -A` = attach-or-create) so the exact same
 * live session can be attached from the host with `tmux attach -t <name>`.
 * Without tmux, it's the plain login shell — pure so it's easy to test.
 */
export function buildSpawnSpec(opts: {
  tmuxBin: string | null;
  shell: string;
  sessionName: string;
  cols: number;
  rows: number;
}): { file: string; args: string[] } {
  const { tmuxBin, shell, sessionName, cols, rows } = opts;
  if (tmuxBin) {
    return {
      file: tmuxBin,
      // -A attach-or-create; -x/-y size a freshly-created session.
      args: ["-u", "new-session", "-A", "-s", sessionName, "-x", String(Math.max(cols, 2)), "-y", String(Math.max(rows, 2))],
    };
  }
  return { file: shell, args: [] };
}

/** Locate the tmux binary on this machine, or null if it isn't installed. */
export function resolveTmux(): string | null {
  if (platform === "win32") return null;
  try {
    const out = spawnSync("/bin/sh", ["-c", "command -v tmux"], { encoding: "utf8" });
    const path = out.stdout?.trim();
    return path ? path : null;
  } catch {
    return null;
  }
}

/** Most recent output kept per terminal, so a reattaching client sees history. */
const SCROLLBACK_BYTES = 64 * 1024;

interface Live {
  pty: IPty;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivity: number;
  /** Trailing output, capped at SCROLLBACK_BYTES. */
  buffer: string;
  /** tmux session name when this terminal is shared, else undefined. */
  tmux?: string;
}

/** The user's login shell, falling back sensibly per platform. */
function defaultShell(): string {
  if (platform === "win32") return env.COMSPEC ?? "powershell.exe";
  return env.SHELL ?? "/bin/zsh";
}

/**
 * Owns the PTY processes backing interactive terminals.
 *
 * Terminals outlive the client that opened them: a dev server or a build keeps
 * running when the Desktop closes its tab, switches workspace, or disconnects
 * entirely, and any client can list what is running and reattach to it. Each
 * terminal keeps a scrollback buffer so a reattach shows what already happened
 * rather than a blank screen. Only an explicit kill (or Worker shutdown) ends a
 * PTY.
 *
 * Note: a terminal is the *user* driving a real shell, so it deliberately
 * bypasses the Approval Center — that gate exists for actions the agent (or a
 * remote command) wants to take, not for keystrokes the operator types.
 * Reaching a terminal at all already requires pairing-code authentication.
 */
export class TerminalManager {
  private readonly terms = new Map<string, Live>();

  /**
   * @param tmuxBin path to tmux to back terminals with shared, host-attachable
   *   sessions, or null (default) to spawn a plain shell.
   */
  constructor(
    private handlers: TerminalHandlers,
    private now: () => number = () => Date.now(),
    private tmuxBin: string | null = null,
  ) {}

  /** Is this terminal already running? */
  has(terminalId: string): boolean {
    return this.terms.has(terminalId);
  }

  /**
   * Start a PTY in a workspace's directory. Returns an error message if the
   * shell could not be spawned. A no-op if the terminal already runs.
   */
  start(terminalId: string, cwd: string, cols: number, rows: number): string | null {
    if (this.terms.has(terminalId)) return null;

    // node-pty only accepts string values; drop any undefined entries.
    const cleanEnv: Record<string, string> = { TERM: "xterm-256color" };
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") cleanEnv[k] = v;

    const sessionName = tmuxSessionName(terminalId);
    const spec = buildSpawnSpec({
      tmuxBin: this.tmuxBin,
      shell: defaultShell(),
      sessionName,
      cols,
      rows,
    });

    let pty: IPty;
    try {
      pty = spawn(spec.file, spec.args, {
        name: "xterm-color",
        cols: Math.max(cols, 2),
        rows: Math.max(rows, 2),
        cwd,
        env: cleanEnv,
      });
    } catch (err) {
      // A shell that won't spawn must not take the Worker down with it.
      return `failed to start terminal: ${(err as Error).message}`;
    }

    const live: Live = {
      pty,
      cwd,
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 2),
      createdAt: this.now(),
      lastActivity: this.now(),
      buffer: "",
      ...(this.tmuxBin ? { tmux: sessionName } : {}),
    };
    this.terms.set(terminalId, live);
    pty.onData((data) => {
      live.lastActivity = this.now();
      live.buffer = (live.buffer + data).slice(-SCROLLBACK_BYTES);
      this.handlers.onData(terminalId, data);
    });
    pty.onExit(({ exitCode }) => {
      this.terms.delete(terminalId);
      this.handlers.onExit(terminalId, exitCode);
    });
    return null;
  }

  write(terminalId: string, data: string): void {
    const live = this.terms.get(terminalId);
    if (!live) return;
    live.lastActivity = this.now();
    live.pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const live = this.terms.get(terminalId);
    if (!live) return;
    try {
      live.pty.resize(Math.max(cols, 2), Math.max(rows, 2));
      live.cols = Math.max(cols, 2);
      live.rows = Math.max(rows, 2);
    } catch {
      // Resizing a PTY that just exited is harmless.
    }
  }

  /** Trailing output for a terminal, for replay on reattach. */
  snapshot(terminalId: string): string {
    return this.terms.get(terminalId)?.buffer ?? "";
  }

  /** The tmux session name for a live terminal, when it's shared. */
  tmuxOf(terminalId: string): string | undefined {
    return this.terms.get(terminalId)?.tmux;
  }

  /** Everything currently running, so a client can show and reattach to it. */
  list(): TerminalSession[] {
    return [...this.terms.entries()]
      .map(([id, l]) => ({
        id,
        cwd: l.cwd,
        cols: l.cols,
        rows: l.rows,
        createdAt: l.createdAt,
        lastActivity: l.lastActivity,
        ...(l.tmux ? { tmux: l.tmux } : {}),
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Explicitly end a terminal — the only thing besides shutdown that does. */
  close(terminalId: string): void {
    const live = this.terms.get(terminalId);
    if (!live) return;
    this.terms.delete(terminalId);
    // Killing the PTY only detaches the tmux client; end the session itself so
    // the shared shell (and its processes) actually stop.
    if (live.tmux && this.tmuxBin) {
      try {
        spawnSync(this.tmuxBin, ["kill-session", "-t", live.tmux]);
      } catch {
        /* best-effort */
      }
    }
    live.pty.kill();
  }

  /** Kill every PTY (Worker shutdown only). */
  closeAll(): void {
    for (const id of [...this.terms.keys()]) this.close(id);
  }

  get count(): number {
    return this.terms.size;
  }
}
