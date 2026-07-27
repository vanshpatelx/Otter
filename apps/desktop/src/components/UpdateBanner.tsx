import { useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { checkForUpdate, type UpdateInfo } from "../lib/updates.js";

const DISMISS_KEY = "otter.updateDismissed";

/**
 * A quiet "a new Otter is out" banner.
 *
 * The app can't silently self-install (ad-hoc signing), so the honest move is
 * to notice a newer release and offer the download. Checks once on mount,
 * stays out of the way otherwise, and remembers a dismissal per-version so it
 * doesn't nag about a release you've already decided to skip.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    // __APP_VERSION__ is injected by Vite from package.json at build time.
    const current = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
    checkForUpdate(current).then((info) => {
      if (cancelled || !info) return;
      if (localStorage.getItem(DISMISS_KEY) === info.latest) return; // already skipped
      setUpdate(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, update.latest);
    setUpdate(null);
  };

  return (
    <div className="flex items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-emerald-400" />
      <span className="text-foreground/90">
        Otter <span className="font-semibold">{update.latest}</span> is available
        <span className="text-muted-foreground"> (you're on {update.current})</span>.
      </span>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="rounded-md bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-500"
      >
        Download
      </a>
      <button
        onClick={dismiss}
        className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        title="Skip this version"
        aria-label="Dismiss update notice"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
