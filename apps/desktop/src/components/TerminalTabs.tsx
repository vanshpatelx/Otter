import { useEffect, useRef, useState } from "react";
import { TerminalSquare, Plus, X, Loader2 } from "lucide-react";
import type { WorkersApi } from "../lib/useWorkers.js";
import { TerminalPanel } from "./TerminalPanel.js";

/**
 * Several terminals behind tabs, VS Code style — and they outlive the tab.
 *
 * Terminals run on the Worker, not in this window, so a dev server or a build
 * keeps going when the tab closes, the workspace changes, or the app quits.
 * Opening this view lists what is already running in the project's directory and
 * reattaches to it — scrollback and all — rather than starting from scratch.
 * Switching a tab hides it; only the ✕ actually kills the process.
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
  const [ids, setIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
      setIds([id]);
      setActiveId(id);
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
        setIds(mine);
        setActiveId(mine[0]!);
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

  const add = () => {
    const id = freshId();
    setIds((prev) => [...prev, id]);
    setActiveId(id);
  };

  const kill = (id: string) => {
    terminal.kill(url, id);
    setIds((prev) => {
      const next = prev.filter((x) => x !== id);
      if (next.length === 0) {
        const fresh = freshId();
        setActiveId(fresh);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1]!);
      return next;
    });
  };

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b bg-[#0a0a0b] px-2 py-1">
        {ids.map((id, i) => (
          <div
            key={id}
            onClick={() => setActiveId(id)}
            className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
              id === activeId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <TerminalSquare className="h-3 w-3" />
            <span>shell {i + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                kill(id);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              title="Kill this terminal"
              aria-label={`Kill shell ${i + 1}`}
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
        <span className="ml-auto shrink-0 pr-1 text-[10px] text-muted-foreground/60">
          runs on the workstation · survives closing
        </span>
      </div>

      <div className="min-h-0 flex-1 bg-[#0a0a0b] p-2">
        {ids.map((id) => (
          <div key={id} className={id === activeId ? "h-full" : "hidden"}>
            <TerminalPanel
              url={url}
              workspaceId={workspaceId}
              terminalId={id}
              terminal={terminal}
              connected={connected}
              active={id === activeId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
