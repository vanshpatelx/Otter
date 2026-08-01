import { useEffect, useState } from "react";
import { TerminalSquare, X, RefreshCw } from "lucide-react";
import type { TerminalSession } from "@ai-workspace/protocol";
import type { WorkersApi } from "../lib/useWorkers.js";
import { TerminalPanel } from "./TerminalPanel.js";

/**
 * Every terminal running on a machine, in one place.
 *
 * Terminals outlive the tab that opened them, so a machine accumulates live
 * shells — a dev server here, a long build there — with no single place to see
 * them. This is that place: it lists them all, machine-wide, and attaches to
 * any one live (scrollback and all), even when the workspace it belongs to
 * isn't open. Reattaching leaves the process running; the ✕ in the list is the
 * only thing that kills it.
 */
export function RunningTerminals({
  open,
  onClose,
  url,
  hostname,
  terminal,
  connected,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  hostname: string;
  terminal: WorkersApi["terminal"];
  connected: boolean;
}) {
  const [sessions, setSessions] = useState<TerminalSession[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (!connected) return;
    terminal
      .list(url)
      .then((rows) => {
        setSessions(rows);
        setError(null);
        // Keep the selection if it's still alive; otherwise pick the first.
        setSelected((cur) => (cur && rows.some((r) => r.id === cur) ? cur : (rows[0]?.id ?? null)));
      })
      .catch((e: Error) => setError(e.message));
  };

  // Refresh on open, and poll while open so exits/new shells show up live.
  useEffect(() => {
    if (!open) return;
    setSessions(null);
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url, connected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const kill = (id: string) => {
    terminal.kill(url, id);
    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    setSelected((cur) => (cur === id ? null : cur));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[6vh]" onClick={onClose}>
      <div
        className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: the machine's terminals. */}
        <div className="flex w-72 shrink-0 flex-col border-r">
          <div className="flex items-center gap-2 border-b px-3 py-3">
            <TerminalSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Running terminals</span>
            <button
              onClick={refresh}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{hostname}</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {error ? (
              <div className="px-2 py-6 text-center text-xs text-red-400">{error}</div>
            ) : sessions === null ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">Loading…</div>
            ) : sessions.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                No terminals running on this machine.
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                    s.id === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{basename(s.cwd)}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {idle(s.lastActivity)} · {s.cols}×{s.rows}
                    </span>
                    {s.tmux && (
                      <span
                        className="block truncate font-mono text-[10px] text-emerald-400/80"
                        title="Attach this exact session on the worker machine"
                      >
                        tmux attach -t {s.tmux}
                      </span>
                    )}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      kill(s.id);
                    }}
                    className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-red-500/20 group-hover:opacity-60"
                    title="Kill this terminal"
                    aria-label="Kill terminal"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: the selected terminal, live. */}
        <div className="min-w-0 flex-1 bg-[#0a0a0b]">
          {selected ? (
            <div className="h-full p-2">
              <TerminalPanel
                key={selected}
                url={url}
                workspaceId=""
                terminalId={selected}
                terminal={terminal}
                connected={connected}
                active
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a terminal to attach.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path || "shell";
}

function idle(lastActivity: number): string {
  const secs = Math.max(0, Math.round((Date.now() - lastActivity) / 1000));
  if (secs < 5) return "active now";
  if (secs < 60) return `idle ${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `idle ${mins}m`;
  return `idle ${Math.round(mins / 60)}h`;
}
