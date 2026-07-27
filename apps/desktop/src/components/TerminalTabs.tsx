import { useEffect, useRef, useState } from "react";
import { TerminalSquare, Plus, X, Loader2, Columns2 } from "lucide-react";
import type { WorkersApi } from "../lib/useWorkers.js";
import { TerminalPanel } from "./TerminalPanel.js";
import {
  MAX_PANES,
  addTab,
  collapsePane,
  killTerminal,
  showTab,
  splitPane,
  type PaneState,
} from "../lib/terminalPanes.js";

/**
 * Several terminals behind tabs, VS Code style — and they outlive the tab, and
 * they split.
 *
 * Terminals run on the Worker, not in this window, so a dev server or a build
 * keeps going when the tab closes, the workspace changes, or the app quits.
 * Opening this view lists what is already running in the project's directory and
 * reattaches to it — scrollback and all — rather than starting from scratch.
 *
 * Any tab can be split into side-by-side panes (a server in one, logs in the
 * next) — handy when you want to watch two things at once. Switching a tab
 * hides it; only the ✕ actually kills the process.
 */
export function TerminalTabs({
  url,
  workspaceId,
  workspacePath,
  terminal,
  connected,
}: {
  url: string;
  workspaceId: string;
  /** The project directory — how running terminals are matched to this project. */
  workspacePath: string;
  terminal: WorkersApi["terminal"];
  connected: boolean;
}) {
  const counter = useRef(0);
  const [state, setState] = useState<PaneState>({ ids: [], panes: [], focused: null });
  const [ready, setReady] = useState(false);
  const { ids, panes, focused } = state;

  const freshId = () => {
    counter.current += 1;
    return `term-${workspaceId}-${counter.current}`;
  };

  // On open, reattach to whatever is already running in this project's
  // directory; if nothing is, start one fresh.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const openFresh = () => {
      counter.current = 0;
      const id = freshId();
      setState({ ids: [id], panes: [id], focused: id });
      setReady(true);
    };
    terminal
      .list(url)
      .then((sessions) => {
        if (cancelled) return;
        const mine = sessions.filter((s) => s.cwd === workspacePath).map((s) => s.id);
        if (mine.length === 0) {
          openFresh();
          return;
        }
        // Seed the counter past any id we minted for this workspace before.
        const prefix = `term-${workspaceId}-`;
        for (const id of mine) {
          if (id.startsWith(prefix)) {
            const n = Number(id.slice(prefix.length));
            if (Number.isFinite(n)) counter.current = Math.max(counter.current, n);
          }
        }
        setState({ ids: mine, panes: [mine[0]!], focused: mine[0]! });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) openFresh();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, workspaceId, workspacePath, connected]);

  /** Show a tab on its own (collapse any split). */
  const show = (id: string) => setState((s) => showTab(s, id));

  /** New terminal in its own tab. */
  const add = () => setState((s) => addTab(s, freshId()));

  /** Split: open a fresh terminal beside the ones already visible. */
  const split = () => setState((s) => splitPane(s, freshId()));

  /** Remove a pane from the split without killing it — it stays a tab. */
  const closePane = (id: string) => setState((s) => collapsePane(s, id));

  const kill = (id: string) => {
    terminal.kill(url, id);
    setState((s) => killTerminal(s, id, freshId));
  };
  const setFocused = (id: string) => setState((s) => ({ ...s, focused: id }));

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to open a terminal.
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> attaching to running terminals…
      </div>
    );
  }

  const shellNumber = (id: string) => ids.indexOf(id) + 1;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b bg-[#0a0a0b] px-2 py-1">
        {ids.map((id) => (
          <div
            key={id}
            onClick={() => show(id)}
            className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
              panes.includes(id) ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <TerminalSquare className="h-3 w-3" />
            <span>shell {shellNumber(id)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                kill(id);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              title="Kill this terminal"
              aria-label={`Kill shell ${shellNumber(id)}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={add}
          title="New terminal"
          aria-label="New terminal"
          className="ml-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={split}
          disabled={panes.length >= MAX_PANES}
          title="Split terminal"
          aria-label="Split terminal"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-30"
        >
          <Columns2 className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto shrink-0 pr-1 text-[10px] text-muted-foreground/60">
          runs on the workstation · survives closing
        </span>
      </div>

      <div className="min-h-0 flex-1 bg-[#0a0a0b] p-2">
        {/* Render every terminal so hidden ones keep their session and scrollback;
            only the panes in the current split are laid out and visible. */}
        <div className="flex h-full gap-2">
          {ids.map((id) => {
            const visible = panes.includes(id);
            const isSplit = panes.length > 1;
            return (
              <div
                key={id}
                onMouseDown={() => visible && setFocused(id)}
                className={
                  visible
                    ? `relative min-w-0 flex-1 ${
                        isSplit
                          ? `rounded border ${focused === id ? "border-primary/60" : "border-border/40"}`
                          : ""
                      }`
                    : "hidden"
                }
              >
                {visible && isSplit && (
                  <button
                    onClick={() => closePane(id)}
                    title="Close this pane (keeps the terminal running)"
                    aria-label="Close pane"
                    className="absolute right-1 top-1 z-10 rounded bg-black/40 p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                <TerminalPanel
                  url={url}
                  workspaceId={workspaceId}
                  terminalId={id}
                  terminal={terminal}
                  connected={connected}
                  active={visible && (focused === id || panes.length === 1)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
