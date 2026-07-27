import { describe, it, expect } from "vitest";
import {
  addTab,
  collapsePane,
  killTerminal,
  showTab,
  splitPane,
  type PaneState,
  MAX_PANES,
} from "./terminalPanes.js";

const start = (ids: string[], panes = [ids[0]!], focused = ids[0] ?? null): PaneState => ({ ids, panes, focused });

describe("terminal panes", () => {
  it("shows a single tab, collapsing any split", () => {
    const s = showTab(start(["a", "b", "c"], ["a", "b"]), "c");
    expect(s.panes).toEqual(["c"]);
    expect(s.focused).toBe("c");
  });

  it("adds a new tab and switches to it", () => {
    const s = addTab(start(["a"]), "b");
    expect(s.ids).toEqual(["a", "b"]);
    expect(s.panes).toEqual(["b"]);
    expect(s.focused).toBe("b");
  });

  it("splits a fresh terminal beside the visible one", () => {
    const s = splitPane(start(["a"]), "b");
    expect(s.ids).toEqual(["a", "b"]);
    expect(s.panes).toEqual(["a", "b"]);
    expect(s.focused).toBe("b");
  });

  it("won't split past MAX_PANES", () => {
    let s = start(["a"]);
    s = splitPane(s, "b");
    s = splitPane(s, "c");
    expect(s.panes).toHaveLength(MAX_PANES);
    const capped = splitPane(s, "d");
    expect(capped).toBe(s); // unchanged
    expect(capped.ids).not.toContain("d");
  });

  it("collapses a pane but keeps the terminal as a tab", () => {
    const s = collapsePane(start(["a", "b"], ["a", "b"], "b"), "b");
    expect(s.panes).toEqual(["a"]);
    expect(s.ids).toEqual(["a", "b"]); // still exists
    expect(s.focused).toBe("a"); // refocused off the removed pane
  });

  it("never collapses the last visible pane", () => {
    const s0 = start(["a"], ["a"], "a");
    expect(collapsePane(s0, "a")).toBe(s0);
  });

  it("kills a background tab without disturbing the view", () => {
    const s = killTerminal(start(["a", "b", "c"], ["a"], "a"), "c", () => "fresh");
    expect(s.ids).toEqual(["a", "b"]);
    expect(s.panes).toEqual(["a"]);
    expect(s.focused).toBe("a");
  });

  it("falls back to the newest tab when the only visible pane is killed", () => {
    const s = killTerminal(start(["a", "b"], ["a"], "a"), "a", () => "fresh");
    expect(s.ids).toEqual(["b"]);
    expect(s.panes).toEqual(["b"]);
    expect(s.focused).toBe("b");
  });

  it("keeps the other split pane when one of two is killed", () => {
    const s = killTerminal(start(["a", "b"], ["a", "b"], "a"), "a", () => "fresh");
    expect(s.panes).toEqual(["b"]);
    expect(s.focused).toBe("b");
  });

  it("spawns a fresh terminal when the last one is killed (never empty)", () => {
    const s = killTerminal(start(["a"], ["a"], "a"), "a", () => "fresh-1");
    expect(s.ids).toEqual(["fresh-1"]);
    expect(s.panes).toEqual(["fresh-1"]);
    expect(s.focused).toBe("fresh-1");
  });
});
