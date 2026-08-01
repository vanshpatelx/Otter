import { describe, it, expect } from "vitest";
import { tmuxSessionName, buildSpawnSpec } from "./terminals.js";

describe("tmuxSessionName", () => {
  it("prefixes and sanitises unsafe characters (tmux forbids . : space)", () => {
    expect(tmuxSessionName("term-ws_abc-1")).toBe("otter-term-ws_abc-1");
    expect(tmuxSessionName("a.b:c d")).toBe("otter-a_b_c_d");
  });
});

describe("buildSpawnSpec", () => {
  const base = { shell: "/bin/zsh", sessionName: "otter-term-1", cols: 80, rows: 24 };

  it("spawns a plain shell when there's no tmux", () => {
    expect(buildSpawnSpec({ ...base, tmuxBin: null })).toEqual({ file: "/bin/zsh", args: [] });
  });

  it("wraps in an attach-or-create tmux session when tmux is present", () => {
    const spec = buildSpawnSpec({ ...base, tmuxBin: "/opt/homebrew/bin/tmux" });
    expect(spec.file).toBe("/opt/homebrew/bin/tmux");
    // new-session -A = attach if the named session exists, else create it.
    expect(spec.args).toEqual([
      "-u",
      "new-session",
      "-A",
      "-s",
      "otter-term-1",
      "-x",
      "80",
      "-y",
      "24",
    ]);
  });

  it("clamps tiny sizes to a floor of 2", () => {
    const spec = buildSpawnSpec({ ...base, cols: 0, rows: 1, tmuxBin: "tmux" });
    expect(spec.args).toContain("2");
    expect(spec.args[spec.args.indexOf("-x") + 1]).toBe("2");
    expect(spec.args[spec.args.indexOf("-y") + 1]).toBe("2");
  });
});
