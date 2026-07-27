import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  run: () => void;
}

/**
 * A ⌘K command palette over the whole app.
 *
 * Everything reachable in one keystroke and a few letters: switch tabs, jump to
 * a workspace or machine, resume a past agent session, or add a machine. It is
 * the search box the app didn't have — as the number of machines, projects and
 * old conversations grows, hunting for them in the sidebar stops scaling.
 */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    const list = needle
      ? items.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(needle))
      : items;
    return list.slice(0, 60);
  }, [query, items]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
    }
  }, [open]);

  useEffect(() => {
    if (sel >= filtered.length) setSel(Math.max(0, filtered.length - 1));
  }, [filtered.length, sel]);

  // Keep the highlighted row in view as you arrow through.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const choose = (i: number) => {
    const item = filtered[i];
    if (item) {
      item.run();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(sel);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Jump to a workspace, machine, session, or action…"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</div>
          ) : (
            filtered.map((item, i) => {
              const showGroup = i === 0 || filtered[i - 1]!.group !== item.group;
              const Icon = item.icon;
              return (
                <div key={item.id}>
                  {showGroup && (
                    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {item.group}
                    </div>
                  )}
                  <button
                    data-idx={i}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => choose(i)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${
                      i === sel ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    }`}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate text-sm">{item.label}</span>
                    {item.hint && (
                      <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">{item.hint}</span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
