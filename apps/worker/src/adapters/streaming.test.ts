import { describe, it, expect } from "vitest";
import { parseCodexEvent } from "./codex-cli.js";
import { parseGeminiEvent } from "./gemini-cli.js";
import { StreamingCliAdapter, pickString, type StreamEvent } from "./streaming.js";
import type { AgentTurnHandlers } from "./types.js";

describe("pickString", () => {
  it("returns the first present non-empty string field", () => {
    expect(pickString({ a: "", b: "hi", c: "no" }, ["a", "b", "c"])).toBe("hi");
    expect(pickString({ n: 1 }, ["n"])).toBeUndefined();
    expect(pickString(null, ["x"])).toBeUndefined();
  });
});

describe("parseCodexEvent", () => {
  it("reads the thread id from thread.started", () => {
    expect(parseCodexEvent({ type: "thread.started", thread_id: "t_123" })).toEqual({ sessionId: "t_123" });
  });

  it("emits assistant text from a completed message item", () => {
    const e = parseCodexEvent({ type: "item.completed", item: { type: "agent_message", text: "Hello there" } });
    expect(e?.delta).toBe("Hello there");
  });

  it("emits reasoning separately", () => {
    const e = parseCodexEvent({ type: "item.completed", item: { type: "reasoning", text: "let me think" } });
    expect(e?.reasoning).toBe("let me think");
    expect(e?.delta).toBeUndefined();
  });

  it("emits a tool for a command execution", () => {
    const e = parseCodexEvent({
      type: "item.completed",
      item: { type: "command_execution", command: "ls -la", id: "c1" },
    });
    expect(e?.tool).toEqual({ id: "c1", name: "command_execution", target: "ls -la" });
  });

  it("surfaces errors", () => {
    expect(parseCodexEvent({ type: "error", message: "boom" })?.error).toBe("boom");
  });

  it("degrades gracefully on an unknown shape with text", () => {
    // A future/renamed event with a bare text field still shows something.
    expect(parseCodexEvent({ text: "loose text" })?.delta).toBe("loose text");
  });

  it("ignores irrelevant events", () => {
    expect(parseCodexEvent({ type: "token_count", count: 5 })).toEqual(null);
    expect(parseCodexEvent("nope")).toBeNull();
  });
});

describe("parseGeminiEvent", () => {
  it("reads assistant text from a response field", () => {
    expect(parseGeminiEvent({ response: "the answer" })?.delta).toBe("the answer");
  });

  it("reads text nested under a candidate", () => {
    expect(parseGeminiEvent({ candidate: { text: "nested reply" } })?.delta).toBe("nested reply");
  });

  it("captures a session id alongside text", () => {
    const e = parseGeminiEvent({ text: "hi", session_id: "s_9" });
    expect(e).toEqual({ delta: "hi", sessionId: "s_9" });
  });

  it("recognises a function call as a tool", () => {
    const e = parseGeminiEvent({ type: "tool_call", functionCall: { name: "run_shell", command: "pwd", id: "f1" } });
    expect(e?.tool).toEqual({ id: "f1", name: "run_shell", target: "pwd" });
  });

  it("surfaces errors", () => {
    expect(parseGeminiEvent({ type: "error", message: "quota" })?.error).toBe("quota");
  });

  it("ignores empty/irrelevant objects", () => {
    expect(parseGeminiEvent({ type: "stats", tokens: 3 })).toBeNull();
  });
});

/** Collect everything the driver forwards, for asserting end-to-end streaming. */
function recorder() {
  const events: string[] = [];
  const handlers: AgentTurnHandlers = {
    onDelta: (t) => events.push(`delta:${t}`),
    onReasoning: (t) => events.push(`reasoning:${t}`),
    onTool: (id, tool, target) => events.push(`tool:${tool}:${target}`),
    onError: (m) => events.push(`error:${m}`),
  };
  return { events, handlers };
}

describe("StreamingCliAdapter (driver)", () => {
  /** A fake agent CLI: prints the JSONL passed via argv, one line at a time. */
  const fakeSpec = (lines: string[], parse: (o: unknown) => StreamEvent | null) => ({
    kind: "codex-cli" as const,
    binary: process.execPath, // node
    buildArgs: () => [
      "-e",
      `for (const l of ${JSON.stringify(lines)}) process.stdout.write(l + "\\n");`,
    ],
    parseEvent: parse,
  });

  it("spawns a real process, streams JSONL, and forwards normalised events", async () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "t_abc" }),
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "planning" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done." } }),
    ];
    const adapter = new StreamingCliAdapter(fakeSpec(lines, parseCodexEvent));
    const { events, handlers } = recorder();

    const result = await adapter.runTurn({ text: "hi", cwd: process.cwd(), resumeSessionId: null, handlers });

    expect(events).toEqual(["reasoning:planning", "delta:Done."]);
    expect(result.nativeSessionId).toBe("t_abc"); // captured from the stream
  });

  it("treats non-JSON stdout as plain assistant text", async () => {
    const adapter = new StreamingCliAdapter(fakeSpec(["just prose, not json"], parseCodexEvent));
    const { events, handlers } = recorder();
    await adapter.runTurn({ text: "hi", cwd: process.cwd(), resumeSessionId: null, handlers });
    expect(events).toEqual(["delta:just prose, not json"]);
  });

  it("reports a spawn failure as an error, not a crash", async () => {
    const adapter = new StreamingCliAdapter({
      kind: "codex-cli",
      binary: "definitely-not-a-real-binary-xyz",
      buildArgs: () => [],
      parseEvent: parseCodexEvent,
    });
    const { events, handlers } = recorder();
    const result = await adapter.runTurn({ text: "hi", cwd: process.cwd(), resumeSessionId: null, handlers });
    expect(events.some((e) => e.startsWith("error:"))).toBe(true);
    expect(result.nativeSessionId).toBeNull();
  });
});
