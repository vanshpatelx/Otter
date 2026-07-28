import { useState } from "react";
import { shouldWarnMixedContent } from "./mixedContent.js";

/**
 * The one thing that behaves differently in a hosted browser than in the
 * Desktop shell: an https page cannot open a plain `ws://` socket to a LAN
 * worker (browsers block it as mixed content). Loopback is exempt, and
 * `wss://` is fine — so this only bites when the app is served over https AND
 * the worker is a bare ws:// address on the network.
 *
 * Rather than let connections fail silently with a cryptic console error, this
 * explains the situation up front and points at the two real fixes. Dismissible,
 * and only ever shown when it actually applies.
 */
export function MixedContentNotice() {
  const [dismissed, setDismissed] = useState(false);

  const isHttps = typeof location !== "undefined" && shouldWarnMixedContent(location.protocol);
  if (!isHttps || dismissed) return null;

  return (
    <div
      style={{
        background: "rgba(251, 191, 36, 0.12)",
        borderBottom: "1px solid rgba(251, 191, 36, 0.35)",
        color: "#e5e5e7",
        font: "12px/1.5 system-ui, sans-serif",
        padding: "8px 14px",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
      }}
    >
      <span aria-hidden style={{ color: "#fbbf24" }}>⚠</span>
      <span style={{ flex: 1 }}>
        This page is served over <b>https</b>, so it can only reach workers at{" "}
        <code>wss://</code> (a relay with TLS) or on <code>localhost</code>. A plain{" "}
        <code>ws://</code> address on your network will be blocked by the browser. Fixes: point the
        worker at a <b>TLS relay</b> and pair with its <code>wss://…/client?id=…</code> address, or
        run this app over plain http on your LAN.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "#9b9ba3",
          cursor: "pointer",
          fontSize: "14px",
          lineHeight: 1,
          padding: "0 2px",
        }}
      >
        ×
      </button>
    </div>
  );
}
