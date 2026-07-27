import { spawn, type IPty } from "node-pty";
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

  constructor(
    private handlers: TerminalHandlers,
    private now: () => number = () => Date.now(),
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

    let pty: IPty;
    try {
      pty = spawn(defaultShell(), [], {
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
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Explicitly end a terminal — the only thing besides shutdown that does. */
  close(terminalId: string): void {
    const live = this.terms.get(terminalId);
    if (!live) return;
    this.terms.delete(terminalId);
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
