import { useCallback, useEffect, useState } from "react";
import { Smartphone, Laptop, Monitor, Globe, ShieldX, RefreshCw, Loader2 } from "lucide-react";
import type { DeviceInfo } from "@ai-workspace/protocol";

/**
 * See and revoke the devices paired with a machine — the CLI's `otter sessions`,
 * in the app.
 *
 * Pairing enrolls a device with its own token, so revoking one (a lost phone)
 * locks just that device out, without rotating the code or touching the others.
 * The device you're on is marked, and revoking it asks first — it's the one that
 * logs you out.
 */
export function SessionsPanel({
  open,
  onClose,
  hostname,
  currentId,
  list,
  revoke,
}: {
  open: boolean;
  onClose: () => void;
  hostname: string;
  /** This device's own session id on that machine, to mark it. */
  currentId?: string;
  list: () => Promise<DeviceInfo[]>;
  revoke: (id: string) => Promise<DeviceInfo[]>;
}) {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    list()
      .then(setDevices)
      .catch((e: Error) => setError(e.message));
  }, [list]);

  useEffect(() => {
    if (!open) return;
    setDevices(null);
    refresh();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, refresh, onClose]);

  if (!open) return null;

  const doRevoke = async (d: DeviceInfo) => {
    const isSelf = d.id === currentId;
    const ok = window.confirm(
      isSelf
        ? `Revoke "${d.label}" — this is the device you're using. You'll be disconnected and have to pair again. Continue?`
        : `Revoke "${d.label}"? It will be refused on its next connect and must pair again with the code.`,
    );
    if (!ok) return;
    setBusy(d.id);
    try {
      setDevices(await revoke(d.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[10vh]" onClick={onClose}>
      <div
        className="flex max-h-[74vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Paired devices</span>
          <span className="text-xs text-muted-foreground">· {hostname}</span>
          <button
            onClick={refresh}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-y-auto p-1.5">
          {error ? (
            <div className="px-3 py-8 text-center text-sm text-red-400">{error}</div>
          ) : devices === null ? (
            <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> loading…
            </div>
          ) : devices.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No paired devices. They appear here once they pair with the code.
            </div>
          ) : (
            devices.map((d) => {
              const isSelf = d.id === currentId;
              const Icon = iconFor(d.label);
              return (
                <div key={d.id} className="flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-accent/30">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 truncate text-sm">
                      {d.label}
                      {isSelf && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          this device
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      last seen {ago(d.lastSeenAt)} · paired {ago(d.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => doRevoke(d)}
                    disabled={busy === d.id}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                    title="Revoke this device"
                  >
                    {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldX className="h-3 w-3" />}
                    Revoke
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t px-4 py-1.5 text-[10px] text-muted-foreground">
          Revoking locks out one device without rotating the code · esc to close
        </div>
      </div>
    </div>
  );
}

function iconFor(label: string): typeof Smartphone {
  const l = label.toLowerCase();
  if (l.includes("mobile") || l.includes("phone") || l.includes("iphone") || l.includes("android"))
    return Smartphone;
  if (l.includes("web")) return Globe;
  if (l.includes("desktop") || l.includes("mac") || l.includes("windows") || l.includes("linux")) return Monitor;
  return Laptop;
}

function ago(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
