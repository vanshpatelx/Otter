import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, RefreshCw, Check, Plus, Minus, FileQuestion, GitCommit, Loader2 } from "lucide-react";
import type { GitFileChange, GitStatus } from "@ai-workspace/protocol";
import type { WorkersApi } from "../lib/useWorkers.js";

/**
 * See what the agent changed, and decide what to keep.
 *
 * The whole reason to watch an agent work is to review its edits — so this is
 * the review surface: the workspace's changed files on the left, the selected
 * file's unified diff on the right, one-click staging, and a commit box. It
 * talks to the real git on the Worker; nothing here reimplements version
 * control, it just drives it.
 */
export function GitPanel({
  url,
  workspaceId,
  git,
  connected,
}: {
  url: string;
  workspaceId: string;
  git: WorkersApi["git"];
  connected: boolean;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!connected) return;
    git
      .status(url, workspaceId)
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [git, url, workspaceId, connected]);

  useEffect(() => {
    setStatus(null);
    setSelected(null);
    setDiff(null);
    refresh();
  }, [refresh]);

  // Load the diff whenever the selection changes.
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiff(null);
    git
      .diff(url, workspaceId, selected.path, selected.staged)
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setDiff(`Couldn't load diff: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, git, url, workspaceId]);

  const { staged, unstaged } = useMemo(() => split(status?.files ?? []), [status]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!message.trim()) return;
    await act(async () => {
      await git.commit(url, workspaceId, message);
      setMessage("");
      setSelected(null);
    });
  };

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to review changes.
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <GitBranch className="h-5 w-5" />
        This workspace isn't a git repository.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left: changed files, grouped by staged / unstaged. */}
      <div className="flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{status?.branch ?? "—"}</span>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="text-[10px] text-muted-foreground">
              {status.ahead > 0 && `↑${status.ahead}`} {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
          <button
            onClick={refresh}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === null ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : status.clean ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nothing to commit — working tree clean.
            </div>
          ) : (
            <>
              <FileGroup
                title="Staged"
                files={staged}
                selected={selected}
                stagedGroup
                onSelect={(f) => setSelected({ path: f.path, staged: true })}
                onToggle={(f) => act(() => git.stage(url, workspaceId, f.path, false))}
              />
              <FileGroup
                title="Changes"
                files={unstaged}
                selected={selected}
                stagedGroup={false}
                onSelect={(f) => setSelected({ path: f.path, staged: false })}
                onToggle={(f) => act(() => git.stage(url, workspaceId, f.path, true))}
              />
            </>
          )}
        </div>

        {/* Commit box. */}
        <div className="border-t p-2">
          {staged.length > 0 && (
            <div className="mb-1.5 text-[10px] text-muted-foreground">
              {staged.length} file{staged.length === 1 ? "" : "s"} staged
            </div>
          )}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message"
            rows={2}
            className="w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => act(() => git.stageAll(url, workspaceId))}
              disabled={busy || status?.clean}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 disabled:opacity-40"
            >
              Stage all
            </button>
            <button
              onClick={commit}
              disabled={busy || !message.trim() || staged.length === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommit className="h-3 w-3" />}
              Commit
            </button>
          </div>
          {error && <div className="mt-1.5 text-[11px] text-red-400">{error}</div>}
        </div>
      </div>

      {/* Right: the selected file's diff. */}
      <div className="min-w-0 flex-1 overflow-auto bg-[#0a0a0b]">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a file to see its diff.
          </div>
        ) : diff === null ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> loading diff…
          </div>
        ) : (
          <DiffView diff={diff} path={selected.path} />
        )}
      </div>
    </div>
  );
}

function FileGroup({
  title,
  files,
  selected,
  stagedGroup,
  onSelect,
  onToggle,
}: {
  title: string;
  files: GitFileChange[];
  selected: { path: string; staged: boolean } | null;
  stagedGroup: boolean;
  onSelect: (f: GitFileChange) => void;
  onToggle: (f: GitFileChange) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div>
      <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} · {files.length}
      </div>
      {files.map((f) => {
        const isSel = selected?.path === f.path && selected.staged === stagedGroup;
        return (
          <div
            key={f.path}
            onClick={() => onSelect(f)}
            className={`group flex cursor-pointer items-center gap-2 px-3 py-1 text-xs ${
              isSel ? "bg-accent text-accent-foreground" : "hover:bg-accent/40"
            }`}
          >
            <StatusMark status={f.status} />
            <span className="min-w-0 flex-1 truncate" title={f.path}>
              {f.path}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle(f);
              }}
              className="shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-70"
              title={stagedGroup ? "Unstage" : "Stage"}
              aria-label={stagedGroup ? "Unstage" : "Stage"}
            >
              {stagedGroup ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StatusMark({ status }: { status: GitFileChange["status"] }) {
  const map: Record<GitFileChange["status"], { ch: string; cls: string; Icon?: typeof Check }> = {
    modified: { ch: "M", cls: "text-amber-400" },
    added: { ch: "A", cls: "text-emerald-400" },
    deleted: { ch: "D", cls: "text-red-400" },
    renamed: { ch: "R", cls: "text-blue-400" },
    untracked: { ch: "U", cls: "text-muted-foreground", Icon: FileQuestion },
    conflicted: { ch: "!", cls: "text-red-500" },
  };
  const m = map[status];
  return (
    <span className={`w-3 shrink-0 text-center font-mono text-[11px] font-bold ${m.cls}`} title={status}>
      {m.ch}
    </span>
  );
}

/** Colour a unified diff line-by-line. */
function DiffView({ diff, path }: { diff: string; path: string }) {
  if (!diff.trim()) {
    return <div className="p-4 text-sm text-muted-foreground">No textual changes (binary file or mode change).</div>;
  }
  const lines = diff.split("\n");
  return (
    <pre className="min-w-full p-3 font-mono text-[11.5px] leading-[1.5]">
      <div className="mb-2 select-none text-xs text-muted-foreground">{path}</div>
      {lines.map((line, i) => {
        let cls = "text-foreground/80";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "text-muted-foreground";
        else if (line.startsWith("@@")) cls = "text-cyan-400";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-muted-foreground/60";
        else if (line.startsWith("+")) cls = "bg-emerald-500/10 text-emerald-300";
        else if (line.startsWith("-")) cls = "bg-red-500/10 text-red-300";
        return (
          <div key={i} className={`whitespace-pre ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function split(files: GitFileChange[]): { staged: GitFileChange[]; unstaged: GitFileChange[] } {
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  for (const f of files) {
    if (f.staged) staged.push(f);
    if (f.unstaged) unstaged.push(f);
  }
  return { staged, unstaged };
}
