import { useCallback, useEffect, useRef, useState } from "react";
import { History, FolderOpen, MessageSquare, ChevronRight, RefreshCw } from "lucide-react";
import type { DiscoveredProject, DiscoveredSession } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

/** A past conversation, resumable in one click. */
function SessionRow({ session, onClick }: { session: DiscoveredSession; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ml-4 flex w-[calc(100%-1rem)] items-start gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent/50"
      title="Resume this conversation"
    >
      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400/70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px]">
          {session.title ?? session.firstPrompt ?? "Untitled conversation"}
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {session.messageCount}
          {session.truncated ? "+" : ""} messages · {ago(session.updatedAt)}
        </span>
      </span>
    </button>
  );
}

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

/**
 * Projects the agent has worked in before, read from its own history.
 *
 * These are conversations that already exist on the machine — many started in
 * a terminal, outside this app. Opening one restores the project *and* lets a
 * past conversation be resumed with its full context intact.
 */
export function RecentProjects({
  connected,
  openPaths,
  machineName,
  onDiscover,
  onOpenProject,
  onResumeSession,
}: {
  connected: boolean;
  /** Paths already open, so they aren't offered twice. */
  openPaths: string[];
  /** Which machine these belong to — shown only when more than one is paired. */
  machineName?: string;
  onDiscover: () => Promise<DiscoveredProject[]>;
  onOpenProject: (path: string) => Promise<void>;
  onResumeSession: (path: string, session: DiscoveredSession) => Promise<void>;
}) {
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Held in a ref so scanning does not depend on the callback's identity.
   *
   * Callers pass this as an inline arrow, which is a new function on every
   * render of the parent. Depending on it directly made the scan effect re-fire
   * on every render — and since scanning sets state, that render caused the next
   * one. A disk walk of every past project ran several times a second, on every
   * keystroke and every streamed chat token.
   */
  const discoverRef = useRef(onDiscover);
  useEffect(() => {
    discoverRef.current = onDiscover;
  });

  const scan = useCallback(async () => {
    if (!connected) return;
    setBusy(true);
    setError(null);
    try {
      setProjects(await discoverRef.current());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [connected]);

  // Scans when the connection comes up, and when the user asks — not on render.
  useEffect(() => {
    void scan();
  }, [scan]);

  const unopened = projects.filter((p) => !openPaths.includes(p.path));
  if (!connected) return null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Recent projects</span>
        {machineName && (
          <span className="max-w-[120px] truncate text-[10px] text-muted-foreground" title={machineName}>
            · {machineName}
          </span>
        )}
        {unopened.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {unopened.length}
          </Badge>
        )}
        <Button
          size="icon"
          variant="ghost"
          className={unopened.length > 0 ? "h-6 w-6" : "ml-auto h-6 w-6"}
          onClick={() => void scan()}
          title="Rescan"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && <p className="px-3 py-2 text-[11px] text-destructive">{error}</p>}

      {unopened.length === 0 && !busy && !error ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No past projects or sessions found on this machine.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto p-1.5">
          {unopened.map((project) => {
            // Newest conversation first, shown inline; the rest fold behind it.
            const sessions = [...project.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
            const [latest, ...rest] = sessions;
            const isOpen = expanded === project.path;
            return (
              <div key={project.path} className="mb-0.5">
                {/* The project itself — clicking the name opens a fresh session. */}
                <button
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent/50"
                  onClick={() => void onOpenProject(project.path)}
                  title={`Open ${project.path} in a new session`}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  <span className="truncate text-xs font-medium">{project.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {ago(project.updatedAt)}
                  </span>
                </button>

                {/* Its conversations, resumable in one click — surfaced by default
                    rather than hidden behind an expander, since reopening an old
                    session is the whole reason they are listed. */}
                {latest && (
                  <SessionRow
                    session={latest}
                    onClick={() => void onResumeSession(project.path, latest)}
                  />
                )}
                {isOpen &&
                  rest.map((session) => (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      onClick={() => void onResumeSession(project.path, session)}
                    />
                  ))}
                {rest.length > 0 && (
                  <button
                    onClick={() => setExpanded(isOpen ? null : project.path)}
                    className="ml-6 flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    {isOpen ? "fewer" : `${rest.length} more conversation${rest.length > 1 ? "s" : ""}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
