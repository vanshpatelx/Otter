import type { StreamEvent } from "./streaming.js";
import { StreamingCliAdapter, pickString } from "./streaming.js";

/**
 * OpenAI's Codex CLI, driven non-interactively:
 *
 *   codex exec --json [resume <thread-id>] "<prompt>"
 *
 * `codex exec --json` streams thread events as JSON lines. The exact schema has
 * shifted across releases, so the parser reads defensively: it recognises the
 * documented `thread.started` / `item.completed` events and also falls back to
 * common field names, so a minor format change degrades to "still shows text"
 * rather than "shows nothing".
 *
 * Note: verified structurally and against recorded sample output; a live run
 * needs the `codex` CLI installed and authenticated.
 */
export function parseCodexEvent(obj: unknown): StreamEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const e = obj as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : "";

  // Thread lifecycle carries the id we resume from next turn.
  const sessionId = pickString(e, ["thread_id", "threadId", "session_id", "sessionId", "conversation_id"]);
  if (type === "thread.started" || type === "session.created") {
    return sessionId ? { sessionId } : null;
  }

  if (type === "error") {
    return { error: pickString(e, ["message", "error"]) ?? "codex reported an error" };
  }

  // Completed items are the substance: assistant messages, reasoning, commands.
  const item = (e.item ?? e) as Record<string, unknown>;
  const itemType = pickString(item, ["type"]) ?? "";
  const text = pickString(item, ["text", "message", "content", "delta"]);

  if (/reasoning|thinking/i.test(itemType)) {
    return text ? { reasoning: text, ...(sessionId ? { sessionId } : {}) } : null;
  }
  if (/command|tool|exec/i.test(itemType)) {
    const target = pickString(item, ["command", "cmd", "input", "name"]) ?? "";
    return {
      tool: { id: pickString(item, ["id", "call_id"]) ?? "", name: itemType, target },
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (/message|assistant|agent|output|response/i.test(itemType) || (text && !itemType)) {
    return text ? { delta: text, ...(sessionId ? { sessionId } : {}) } : null;
  }
  return sessionId ? { sessionId } : null;
}

export function codexAdapter(binary = "codex"): StreamingCliAdapter {
  return new StreamingCliAdapter({
    kind: "codex-cli",
    binary,
    buildArgs: (prompt, resume) =>
      resume ? ["exec", "--json", "resume", resume, prompt] : ["exec", "--json", prompt],
    parseEvent: parseCodexEvent,
  });
}
