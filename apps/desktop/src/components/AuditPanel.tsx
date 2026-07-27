import { useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  TerminalSquare,
  ShieldCheck,
  ShieldX,
  FolderOpen,
  FolderClosed,
  Play,
  Square,
  Plus,
  LogIn,
  History,
} from "lucide-react";
import type { AuditEntry, AuditKind } from "@ai-workspace/protocol";

/**
 * A window onto the Worker's durable audit trail.
 *
 * The live feed forgets everything the moment a tab closes; this reads the
 * machine's on-disk record instead, so "what ran here, and did I approve it?"
 * has an answer long after the fact. Grouped by day, filterable by kind, and
 * loud about approvals — the one row type where the answer mattered.
 */
export function AuditPanel({
  open,
  onClose,
  hostname,
  fetchAudit,
}: {
  open: boolean;
  onClose: () => void;
  hostname: string;
  fetchAudit: (opts: { limit?: number; kinds?: AuditKind[] }) => Promise<AuditEntry[]>;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "approvals" | "commands" | "chat">("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    fetchAudit({ limit: 500 })
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchAudit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shown = useMemo(() => {
    if (!entries) return [];
    if (filter === "all") return entries;
    if (filter === "approvals")
      return entries.filter((e) => e.kind === "approval-requested" || e.kind === "approval-resolved");
    if (filter === "commands") return entries.filter((e) => e.kind === "command");
    return entries.filter((e) => e.kind === "chat");
  }, [entries, filter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[8vh]" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Audit log</span>
          <span className="text-xs text-muted-foreground">· {hostname}</span>
          <div className="ml-auto flex gap-1">
            {(["all", "approvals", "commands", "chat"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-xs capitalize ${
                  filter === f ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto p-1.5">
          {error ? (
            <div className="px-3 py-8 text-center text-sm text-red-400">Couldn't load the audit log: {error}</div>
          ) : entries === null ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing recorded yet.</div>
          ) : (
            groupByDay(shown).map(([day, rows]) => (
              <div key={day}>
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {day}
                </div>
                {rows.map((e, i) => (
                  <Row key={`${e.ts}-${i}`} entry={e} />
                ))}
              </div>
            ))
          )}
        </div>

        <div className="border-t px-4 py-1.5 text-[10px] text-muted-foreground">
          Durable on-disk record · newest first · esc to close
        </div>
      </div>
    </div>
  );
}

function Row({ entry }: { entry: AuditEntry }) {
  const { Icon, tint } = decorate(entry);
  return (
    <div className="flex items-start gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-accent/40">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tint}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{entry.summary}</div>
        {entry.detail && entry.detail !== entry.summary && (
          <div className="truncate font-mono text-[11px] text-muted-foreground">{entry.detail}</div>
        )}
      </div>
      <span className="shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground">{clock(entry.ts)}</span>
    </div>
  );
}

function decorate(e: AuditEntry): { Icon: typeof MessageSquare; tint: string } {
  switch (e.kind) {
    case "chat":
      return { Icon: MessageSquare, tint: "text-violet-400" };
    case "command":
      return { Icon: TerminalSquare, tint: "text-cyan-400" };
    case "approval-requested":
      return { Icon: ShieldCheck, tint: "text-amber-400" };
    case "approval-resolved":
      return e.approved
        ? { Icon: ShieldCheck, tint: "text-emerald-400" }
        : { Icon: ShieldX, tint: "text-red-400" };
    case "workspace-opened":
      return { Icon: FolderOpen, tint: "text-blue-400" };
    case "workspace-closed":
      return { Icon: FolderClosed, tint: "text-muted-foreground" };
    case "terminal-started":
      return { Icon: Play, tint: "text-cyan-400" };
    case "terminal-exited":
      return { Icon: Square, tint: "text-muted-foreground" };
    case "session-created":
      return { Icon: Plus, tint: "text-emerald-400" };
    case "client-authed":
      return { Icon: LogIn, tint: "text-muted-foreground" };
    default:
      return { Icon: History, tint: "text-muted-foreground" };
  }
}

function groupByDay(entries: AuditEntry[]): [string, AuditEntry[]][] {
  const groups = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const day = dayLabel(e.ts);
    const bucket = groups.get(day);
    if (bucket) bucket.push(e);
    else groups.set(day, [e]);
  }
  return [...groups.entries()];
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
