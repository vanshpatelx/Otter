import { useRef, useState } from "react";
import { TerminalSquare, Plus, X } from "lucide-react";
import type { WorkersApi } from "../lib/useWorkers.js";
import { TerminalPanel } from "./TerminalPanel.js";

/**
 * Several terminals behind tabs, VS Code style.
 *
 * One shell was rarely enough — you run a dev server in one and poke around in
 * another. Each tab is a real PTY on the workstation; switching hides rather
 * than kills, so a long-running process keeps going in the background and its
 * scrollback is still there when you come back.
 */
export function TerminalTabs({
  url,
  workspaceId,
  terminal,
  connected,
}: {
  url: string;
  workspaceId: string;
  terminal: WorkersApi["terminal"];
  connected: boolean;
}) {
  const counter = useRef(1);
  const [ids, setIds] = useState<string[]>([`term-${workspaceId}-1`]);
  const [activeId, setActiveId] = useState(`term-${workspaceId}-1`);

  const add = () => {
    counter.current += 1;
    const id = `term-${workspaceId}-${counter.current}`;
    setIds((prev) => [...prev, id]);
    setActiveId(id);
  };

  const close = (id: string) => {
    setIds((prev) => {
      const next = prev.filter((x) => x !== id);
      if (next.length === 0) {
        // Never leave the panel empty — closing the last one opens a fresh shell.
        counter.current += 1;
        const fresh = `term-${workspaceId}-${counter.current}`;
        setActiveId(fresh);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[next.length - 1]!);
      return next;
    });
  };

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
                close(id);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              aria-label={`Close shell ${i + 1}`}
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
