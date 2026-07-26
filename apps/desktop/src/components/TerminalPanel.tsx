import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { WorkersApi } from "../lib/useWorkers.js";

interface Props {
  url: string;
  /** The PTY is spawned in this workspace's directory. */
  workspaceId: string;
  terminalId: string;
  terminal: WorkersApi["terminal"];
  connected: boolean;
  /** False when another tab covers this terminal — a hidden xterm can't fit. */
  active?: boolean;
}

/**
 * Live PTY view.
 *
 * xterm owns its own DOM and buffer, so terminal bytes never pass through
 * React state — the socket writes straight into the emulator. React only
 * mounts/unmounts it and forwards resizes. Several of these live at once behind
 * the terminal tabs; the inactive ones are hidden rather than torn down, so
 * their sessions and scrollback survive a tab switch.
 */
export function TerminalPanel({
  url,
  workspaceId,
  terminalId,
  terminal,
  connected,
  active = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current || !connected) return;

    const term = new XTerm({
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: "#0a0a0b",
        foreground: "#e5e5e7",
        cursor: "#e5e5e7",
        selectionBackground: "#33333a",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Worker -> terminal
    const unsubscribe = terminal.subscribe((id, data) => {
      if (id === terminalId) term.write(data);
    });

    // Terminal -> worker
    const onData = term.onData((data) => terminal.input(url, terminalId, data));

    terminal.start(url, workspaceId, terminalId, term.cols, term.rows);

    const onResize = () => {
      fit.fit();
      terminal.resize(url, terminalId, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      onData.dispose();
      unsubscribe();
      terminal.close(url, terminalId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [url, workspaceId, terminalId, terminal, connected]);

  // A hidden terminal measures as zero, so re-fit and focus once it's on screen.
  useEffect(() => {
    if (!active || !termRef.current) return;
    const raf = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
      if (termRef.current) {
        terminal.resize(url, terminalId, termRef.current.cols, termRef.current.rows);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [active, url, terminalId, terminal]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to open a terminal.
      </div>
    );
  }

  return <div ref={hostRef} className="h-full w-full overflow-hidden" data-testid="terminal" />;
}
