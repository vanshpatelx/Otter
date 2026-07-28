/**
 * Whether the "https can't reach ws:// workers" warning should show.
 *
 * Browsers block a plain ws:// connection from an https page (mixed content),
 * except to loopback. So the warning is relevant exactly when the page itself
 * is served over https — that's the only case where a user's ws:// LAN address
 * will silently fail. Kept pure so the rule is testable without a DOM.
 */
export function shouldWarnMixedContent(pageProtocol: string): boolean {
  return pageProtocol === "https:";
}

/**
 * Whether a specific worker address will be blocked from the current page.
 * ws:// to a non-loopback host on an https page is the blocked combination.
 */
export function willBeBlocked(pageProtocol: string, workerUrl: string): boolean {
  if (pageProtocol !== "https:") return false;
  const url = workerUrl.trim().toLowerCase();
  if (!url.startsWith("ws://")) return false; // wss:// is fine
  const host = url.slice("ws://".length).split(/[:/?]/)[0] ?? "";
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  return !loopback; // loopback is exempt from mixed-content blocking
}
