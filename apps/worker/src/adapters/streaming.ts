import { spawn } from "node:child_process";
import type { AgentKind } from "@ai-workspace/protocol";
import type { AgentAdapter, AgentTurnInput, AgentTurnResult } from "./types.js";

/**
 * The normalised shape every agent event is mapped to before it reaches the
 * Worker's handlers. A parser turns one line of a CLI's output into zero or
 * more of these; the driver below does the spawning and streaming.
 */
export interface StreamEvent {
  /** Assistant text to append to the reply. */
  delta?: string;
  /** The agent's visible reasoning, when it exposes any. */
  reasoning?: string;
  /** A tool/command the agent invoked. */
  tool?: { id: string; name: string; target: string };
  /** The CLI's native conversation/thread id, for --resume next turn. */
  sessionId?: string;
  /** A fatal error the agent reported. */
  error?: string;
}

/** Turns one parsed JSON object from the CLI into a normalised event. */
export type EventParser = (obj: unknown) => StreamEvent | null;

export interface StreamingSpec {
  kind: AgentKind;
  /** Executable name, e.g. "codex" or "gemini". */
  binary: string;
  /** Build argv for a turn. `resume` is the native session id, when resuming. */
  buildArgs: (prompt: string, resume: string | null) => string[];
  /** Map one parsed JSON line to a normalised event (or null to ignore). */
  parseEvent: EventParser;
}

/**
 * A generic driver for any agent CLI that runs a prompt non-interactively and
 * streams JSON lines to stdout.
 *
 * The Worker owns sessions, approvals, and routing; a CLI only has to print its
 * work. This adapter spawns the CLI, splits stdout into lines, hands each JSON
 * line to a per-agent parser, and forwards the normalised events. Lines that
 * aren't JSON are treated as plain assistant text, so even a CLI that streams
 * prose (not JSON) still shows something rather than nothing.
 *
 * Codex and Gemini plug in by supplying a `StreamingSpec`; the Claude adapter
 * stays bespoke because its hook-based approval wiring is Claude-specific.
 */
export class StreamingCliAdapter implements AgentAdapter {
  readonly kind: AgentKind;

  constructor(private readonly spec: StreamingSpec) {
    this.kind = spec.kind;
  }

  runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const { text, cwd, handlers } = input;
    const args = this.spec.buildArgs(text, input.resumeSessionId);

    return new Promise((resolve) => {
      let sessionId: string | null = input.resumeSessionId;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({ nativeSessionId: sessionId });
      };

      let child;
      try {
        child = spawn(this.spec.binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        handlers.onError(`failed to spawn ${this.spec.binary}: ${(err as Error).message}`);
        finish();
        return;
      }

      let buffer = "";
      let stderr = "";

      const consume = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let obj: unknown;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          // Not JSON — treat it as plain assistant text so prose-streaming
          // CLIs aren't silently dropped.
          handlers.onDelta(line);
          return;
        }
        const evt = this.spec.parseEvent(obj);
        if (!evt) return;
        if (evt.sessionId) sessionId = evt.sessionId;
        if (evt.reasoning) handlers.onReasoning?.(evt.reasoning);
        if (evt.delta) handlers.onDelta(evt.delta);
        if (evt.tool) handlers.onTool?.(evt.tool.id, evt.tool.name, evt.tool.target);
        if (evt.error) handlers.onError(evt.error);
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          consume(line);
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        if (!settled) handlers.onError(`${this.spec.binary}: ${err.message}`);
        finish();
      });

      child.on("close", (code) => {
        if (buffer.trim()) consume(buffer);
        if (code !== 0 && !settled) {
          handlers.onError(stderr.trim() || `${this.spec.binary} exited with code ${code}`);
        }
        finish();
      });
    });
  }
}

/** Read the first string property present from a list of candidate keys. */
export function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    if (typeof rec[k] === "string" && rec[k]) return rec[k] as string;
  }
  return undefined;
}
