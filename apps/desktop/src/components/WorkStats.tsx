import { useState } from "react";
import { Activity, Zap, Layers, Coins, Clock, Wrench, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface WorkStatsData {
  /** Completed agent turns (rounds that ended with usage). */
  turns: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  durationMs: number;
  /** Tool calls the agent made. */
  tools: number;
  /** Shell commands run from the app. */
  commands: number;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function duration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(0)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function Tile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      <div className="min-w-0">
        <div className="font-mono text-xs font-semibold leading-none">{value}</div>
        <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

/**
 * A live tally of the work done in this session, across every machine.
 *
 * It reads back the accounting the agents already report — turns, tokens, cost,
 * time, tools, commands — and puts a number on it, so the app shows what it has
 * actually been doing rather than leaving it implicit. Empty until the first
 * turn lands, so a fresh session isn't a wall of zeros.
 */
export function WorkStats({ stats, lifetime }: { stats: WorkStatsData; lifetime?: WorkStatsData }) {
  const [allTime, setAllTime] = useState(false);
  const shown = allTime && lifetime ? lifetime : stats;
  // Hide until there's something to show — for all-time that's the lifetime store.
  if (stats.turns === 0 && stats.commands === 0 && (!lifetime || lifetime.turns === 0)) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Activity className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-medium">Activity</span>
        {lifetime && (
          <div className="ml-auto flex rounded-md border p-0.5 text-[10px]">
            {(["session", "all-time"] as const).map((mode) => {
              const on = (mode === "all-time") === allTime;
              return (
                <button
                  key={mode}
                  onClick={() => setAllTime(mode === "all-time")}
                  className={`rounded px-1.5 py-0.5 transition-colors ${on ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        )}
        {!lifetime && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-2">
        <Tile icon={Zap} label="turns" value={String(shown.turns)} accent="text-amber-400" />
        <Tile icon={Wrench} label="tool calls" value={String(shown.tools)} accent="text-violet-400" />
        <Tile
          icon={Layers}
          label="tokens"
          value={compact(shown.tokensIn + shown.tokensOut + shown.tokensCached)}
          accent="text-sky-400"
        />
        <Tile icon={TerminalSquare} label="commands" value={String(shown.commands)} accent="text-cyan-400" />
        <Tile
          icon={Coins}
          label="spent"
          value={shown.costUsd < 0.01 ? `$${shown.costUsd.toFixed(3)}` : `$${shown.costUsd.toFixed(2)}`}
          accent="text-emerald-400"
        />
        <Tile icon={Clock} label="agent time" value={duration(shown.durationMs)} accent="text-rose-400" />
      </div>
    </div>
  );
}
