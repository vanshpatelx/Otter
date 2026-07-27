import type { StreamEvent } from "./streaming.js";
import { StreamingCliAdapter, pickString } from "./streaming.js";

/**
 * Google's Gemini CLI, driven non-interactively:
 *
 *   gemini --output-format json --prompt "<prompt>"
 *
 * Gemini's JSON output is less rigid than Codex's, so the parser is
 * correspondingly tolerant: it pulls assistant text from whichever of the
 * common fields is present (`response`, `text`, `content`, `output`), reads a
 * session id when one is offered, and recognises tool/function calls. Anything
 * it doesn't understand is ignored rather than dropped as an error, and the
 * driver treats non-JSON lines as plain text — so a plain-prose fallback still
 * streams.
 *
 * Note: verified structurally and against recorded sample output; a live run
 * needs the `gemini` CLI installed and authenticated.
 */
export function parseGeminiEvent(obj: unknown): StreamEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const e = obj as Record<string, unknown>;
  const type = pickString(e, ["type", "kind", "event"]) ?? "";

  const sessionId = pickString(e, ["session_id", "sessionId", "conversation_id", "conversationId"]);

  if (/error/i.test(type)) {
    return { error: pickString(e, ["message", "error", "text"]) ?? "gemini reported an error" };
  }

  // Tool / function calls.
  if (/tool|function|command/i.test(type)) {
    const fn = (e.functionCall ?? e.tool ?? e) as Record<string, unknown>;
    const name = pickString(fn, ["name", "tool"]) ?? "tool";
    const target = pickString(fn, ["command", "input", "args", "target"]) ?? "";
    return { tool: { id: pickString(fn, ["id", "callId"]) ?? "", name, target }, ...(sessionId ? { sessionId } : {}) };
  }

  if (/thought|reasoning/i.test(type)) {
    const r = pickString(e, ["text", "thought", "content"]);
    return r ? { reasoning: r, ...(sessionId ? { sessionId } : {}) } : sessionId ? { sessionId } : null;
  }

  // Assistant text: Gemini nests it under a few shapes across versions.
  const nestedResponse = (e.response ?? e.candidate ?? e.message) as Record<string, unknown> | undefined;
  const delta =
    pickString(e, ["response", "text", "content", "output", "delta"]) ??
    pickString(nestedResponse, ["text", "content", "output"]);

  if (delta) return { delta, ...(sessionId ? { sessionId } : {}) };
  return sessionId ? { sessionId } : null;
}

export function geminiAdapter(binary = "gemini"): StreamingCliAdapter {
  return new StreamingCliAdapter({
    kind: "gemini-cli",
    binary,
    // Gemini has no first-class resume flag in headless mode; each turn is
    // fresh at the CLI level. The Worker's own transcript is the durable thread.
    buildArgs: (prompt) => ["--output-format", "json", "--prompt", prompt],
    parseEvent: parseGeminiEvent,
  });
}
