import { useEffect, useRef, useState } from "react";
import { ChevronUp, Circle, Terminal } from "lucide-react";
import type { FeedItem } from "./NotificationCenter.js";
import type { WorkStatsData } from "./WorkStats.js";

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const KIND_TAG: Record<string, { tag: string; color: string }> = {
  "task-complete": { tag: "DONE", color: "text-emerald-400" },
  "command-complete": { tag: "RUN ", color: "text-emerald-400" },
  "command-failed": { tag: "FAIL", color: "text-red-400" },
  "approval-waiting": { tag: "GATE", color: "text-amber-400" },
  "agent-error": { tag: "ERR ", color: "text-red-400" },
  info: { tag: "INFO", color: "text-sky-400" },
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * A bottom lane, half status bar and half console.
 *
 * Collapsed it is a single line — connection, what the agent is doing right now,
 * and a running tally — always in view under whatever tab is open. Expanded it
 * is a colorised, timestamped log of everything the machines have reported, so
 * the app reads like a system you are operating rather than a chat window.
 */
export function ActivityLane({
  events,
  working,
  activity,
  stats,
  connectedCount,
  totalCount,
}: {
  events: FeedItem[];
  working: boolean;
  activity: string;
  stats: WorkStatsData;
  connectedCount: number;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Events arrive newest-first; show oldest-first in the log and pin to bottom.
  const ordered = [...events].slice(0, 200).reverse();

  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, events]);

  const totalTokens = stats.tokensIn + stats.tokensOut + stats.tokensCached;

  return (
    <div className="shrink-0 border-t bg-[#0a0a0b] font-mono text-[11px]">
      {open && (
        <div ref={logRef} className="max-h-52 overflow-y-auto px-3 py-2">
          {ordered.length === 0 ? (
            <div className="text-muted-foreground/60">no activity yet — the log fills as the machines report in.</div>
          ) : (
            ordered.map(({ notification, host }) => {
              const meta = KIND_TAG[notification.kind] ?? KIND_TAG.info!;
              return (
                <div key={notification.id} className="flex gap-2 whitespace-nowrap leading-relaxed">
                  <span className="text-muted-foreground/50">{clock(notification.at)}</span>
                  <span className={meta.color}>{meta.tag}</span>
                  <span className="truncate text-foreground/90">
                    {notification.title}
                    {notification.body ? <span className="text-muted-foreground"> — {notification.body}</span> : null}
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground/40">{host}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* The always-visible status line. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-1 text-left hover:bg-white/5"
      >
        <span className="flex items-center gap-1.5">
          <Circle
            className={`h-2 w-2 ${connectedCount > 0 ? "fill-emerald-400 text-emerald-400" : "fill-muted-foreground text-muted-foreground"}`}
          />
          <span className="text-muted-foreground">
            {connectedCount}/{totalCount}
          </span>
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {working ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              <span className="truncate text-amber-300/90">{activity}</span>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground/70">
              <Terminal className="h-3 w-3" /> idle
            </span>
          )}
        </span>

        <span className="hidden shrink-0 items-center gap-3 text-muted-foreground sm:flex">
          <span title="Agent turns">{stats.turns} turns</span>
          <span title="Tokens processed">{compact(totalTokens)} tok</span>
          <span title="Spent" className="text-emerald-400/80">
            ${stats.costUsd < 0.01 ? stats.costUsd.toFixed(3) : stats.costUsd.toFixed(2)}
          </span>
        </span>

        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
