/**
 * Pure state machine behind the terminal tabs + splits.
 *
 * The visual side (fitting an xterm to its box) is xterm's job; the part that
 * actually holds bugs is the bookkeeping — which terminals exist, which are
 * shown side by side right now, and what stays visible when you kill the pane
 * you were looking at. Keeping it as pure functions makes those transitions
 * testable without a browser.
 */

export interface PaneState {
  /** Every terminal that exists, in tab order. */
  ids: string[];
  /** Terminals shown right now, side by side. Always a subset of `ids`, length ≥ 1 while any exist. */
  panes: string[];
  /** The pane with keyboard focus (for the highlight + fit-on-show). */
  focused: string | null;
}

export const MAX_PANES = 3;

/** Show one tab on its own, collapsing any split. */
export function showTab(state: PaneState, id: string): PaneState {
  return { ...state, panes: [id], focused: id };
}

/** Add a brand-new terminal in its own tab and switch to it. */
export function addTab(state: PaneState, id: string): PaneState {
  return { ids: [...state.ids, id], panes: [id], focused: id };
}

/** Open a fresh terminal beside the visible ones — up to MAX_PANES. */
export function splitPane(state: PaneState, id: string, max = MAX_PANES): PaneState {
  if (state.panes.length >= max) return state;
  return { ids: [...state.ids, id], panes: [...state.panes, id], focused: id };
}

/** Drop a pane from the split without killing it — it remains a tab. */
export function collapsePane(state: PaneState, id: string): PaneState {
  if (!state.panes.includes(id)) return state;
  const panes = state.panes.filter((x) => x !== id);
  // Never collapse to nothing; a single pane stays put.
  if (panes.length === 0) return state;
  const focused = state.focused === id ? (panes[panes.length - 1] ?? null) : state.focused;
  return { ...state, panes, focused };
}

/**
 * Kill a terminal for good. Removes it everywhere; if it was the last one,
 * a fresh id (from `freshId`) takes its place so the view is never empty; if it
 * was the only visible pane, the newest surviving tab is shown instead.
 */
export function killTerminal(state: PaneState, id: string, freshId: () => string): PaneState {
  const ids = state.ids.filter((x) => x !== id);
  if (ids.length === 0) {
    const fresh = freshId();
    return { ids: [fresh], panes: [fresh], focused: fresh };
  }
  let panes = state.panes.filter((x) => x !== id);
  let focused = state.focused === id ? null : state.focused;
  if (panes.length === 0) {
    // The visible pane was killed — fall back to the newest surviving tab.
    const fallback = ids[ids.length - 1]!;
    panes = [fallback];
    focused = fallback;
  } else if (focused === null) {
    focused = panes[panes.length - 1] ?? null;
  }
  return { ids, panes, focused };
}
