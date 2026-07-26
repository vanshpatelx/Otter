import { useEffect, useRef, useState } from "react";
import { ShieldAlert, Check, X, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { ApprovalRequest, WorkerNotification } from "@ai-workspace/protocol";
import { Button } from "./ui/button.js";

export interface ApprovalToast {
  approval: ApprovalRequest;
  url: string;
  host: string;
}
export interface NoticeToast {
  notification: WorkerNotification;
  host: string;
}

const LEVEL_ICON = {
  info: Info,
  warn: AlertTriangle,
  error: AlertTriangle,
} as const;

const LEVEL_ACCENT = {
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-red-400",
} as const;

/**
 * Floating notifications, pinned to a corner above every tab.
 *
 * Approvals used to be reachable only from the sidebar's Approval Center — easy
 * to miss while looking at the editor or a terminal. These surface wherever you
 * are: an approval floats with Approve/Reject on it so it can be cleared without
 * navigating anywhere, and a finished turn pops a toast that fades on its own.
 * The point is speed — see it, act, keep working.
 */
export function ToastStack({
  approvals,
  notices,
  onResolve,
}: {
  approvals: ApprovalToast[];
  notices: NoticeToast[];
  onResolve: (url: string, id: string, approved: boolean) => void;
}) {
  // Notices are ephemeral: show each one once as it arrives, then let it fade.
  const [activeNotices, setActiveNotices] = useState<NoticeToast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    // On first mount, treat everything already present as history — don't blast
    // a stack of old toasts on load.
    if (!primed.current) {
      notices.forEach((n) => seen.current.add(n.notification.id));
      primed.current = true;
      return;
    }
    const fresh = notices.filter(
      (n) =>
        !seen.current.has(n.notification.id) &&
        // Approvals get their own actionable toast — skip the plain notice.
        n.notification.kind !== "approval-waiting",
    );
    if (fresh.length === 0) return;
    fresh.forEach((n) => seen.current.add(n.notification.id));
    setActiveNotices((prev) => [...fresh, ...prev].slice(0, 4));
    // Errors linger; the rest clear themselves.
    fresh.forEach((n) => {
      if (n.notification.level === "error") return;
      setTimeout(() => {
        setActiveNotices((prev) => prev.filter((x) => x.notification.id !== n.notification.id));
      }, 6000);
    });
  }, [notices]);

  const dismiss = (id: string) =>
    setActiveNotices((prev) => prev.filter((x) => x.notification.id !== id));

  if (approvals.length === 0 && activeNotices.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
      {/* Approvals first — they need action, so they sit on top and persist. */}
      {approvals.map(({ approval, url, host }) => (
        <div
          key={approval.id}
          className="pointer-events-auto animate-in slide-in-from-right-4 rounded-lg border border-amber-500/40 bg-card shadow-xl"
        >
          <div className="flex items-start gap-2 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Approval needed</p>
              <p className="truncate text-[11px] text-muted-foreground" title={approval.summary}>
                {approval.summary}
              </p>
              <code className="mt-1 block truncate rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title={approval.details}>
                {approval.details}
              </code>
              <p className="mt-1 text-[10px] text-muted-foreground">{host}</p>
            </div>
          </div>
          <div className="flex gap-1.5 border-t p-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 flex-1 text-[11px] text-red-400 hover:text-red-300"
              onClick={() => onResolve(url, approval.id, false)}
            >
              <X className="h-3 w-3" /> Reject
            </Button>
            <Button
              size="sm"
              className="h-7 flex-1 bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
              onClick={() => onResolve(url, approval.id, true)}
            >
              <Check className="h-3 w-3" /> Approve
            </Button>
          </div>
        </div>
      ))}

      {activeNotices.map(({ notification, host }) => {
        const Icon =
          notification.kind === "task-complete" || notification.kind === "command-complete"
            ? CheckCircle2
            : LEVEL_ICON[notification.level];
        const accent =
          notification.kind === "task-complete" || notification.kind === "command-complete"
            ? "text-emerald-400"
            : LEVEL_ACCENT[notification.level];
        return (
          <div
            key={notification.id}
            className="pointer-events-auto flex animate-in slide-in-from-right-4 items-start gap-2 rounded-lg border bg-card p-3 shadow-xl"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${accent}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{notification.title}</p>
              {notification.body && (
                <p className="truncate text-[11px] text-muted-foreground">{notification.body}</p>
              )}
              <p className="mt-0.5 text-[10px] text-muted-foreground">{host}</p>
            </div>
            <button
              className="shrink-0 text-muted-foreground/60 hover:text-foreground"
              onClick={() => dismiss(notification.id)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
