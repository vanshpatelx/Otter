/**
 * Push notifications for the mobile app.
 *
 * The whole reason Otter has a phone app is clearing agent gates while you're
 * away from the desk — but that only works if the phone actually buzzes. A
 * WebSocket can't wake a backgrounded app; a real push can. So a paired phone
 * registers its Expo push token with the Worker, and when an approval is
 * raised the Worker asks Expo's push service to deliver it.
 *
 * Expo's service is a thin relay to APNs/FCM, so the Worker needs no Apple or
 * Google credentials of its own — only the per-device token the app hands it.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** An Expo push token looks like ExponentPushToken[xxxxxxxx]. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && /^ExponentPushToken\[.+\]$/.test(token.trim());
}

export interface PushMessage {
  title: string;
  body: string;
  /** Arbitrary payload delivered to the app, e.g. the approval id. */
  data?: Record<string, unknown>;
}

/**
 * Remembers which phones want to be notified. Tokens are validated on the way
 * in and de-duplicated, so a phone re-pairing doesn't get double-buzzed.
 */
export class PushRegistry {
  private readonly set = new Set<string>();

  register(token: string): boolean {
    if (!isExpoPushToken(token)) return false;
    this.set.add(token.trim());
    return true;
  }

  unregister(token: string): void {
    this.set.delete(token.trim());
  }

  tokens(): string[] {
    return [...this.set];
  }

  get size(): number {
    return this.set.size;
  }
}

/**
 * Deliver a push to every token via Expo. Best-effort and never throws: a
 * failed push must not break the approval flow it's announcing. Tokens Expo
 * reports as dead are handed back so the caller can drop them.
 *
 * `endpoint` and `fetchImpl` are injectable for tests.
 */
export async function sendExpoPush(
  tokens: string[],
  message: PushMessage,
  opts: { endpoint?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ sent: number; invalidTokens: string[] }> {
  const valid = tokens.filter(isExpoPushToken);
  if (valid.length === 0) return { sent: 0, invalidTokens: [] };

  // OTTER_EXPO_PUSH_ENDPOINT lets a proxy (or a test) redirect Expo delivery.
  const endpoint = opts.endpoint ?? process.env.OTTER_EXPO_PUSH_ENDPOINT ?? EXPO_PUSH_ENDPOINT;
  const doFetch = opts.fetchImpl ?? fetch;

  const messages = valid.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    sound: "default",
    priority: "high",
    ...(message.data ? { data: message.data } : {}),
  }));

  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { sent: 0, invalidTokens: [] };

    // Expo replies with a ticket per message; a DeviceNotRegistered error means
    // the token is dead and should be dropped.
    const invalidTokens: string[] = [];
    try {
      const body = (await res.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
      const tickets = body?.data ?? [];
      tickets.forEach((t, i) => {
        if (t?.status === "error" && t.details?.error === "DeviceNotRegistered" && valid[i]) {
          invalidTokens.push(valid[i]);
        }
      });
    } catch {
      // A non-JSON success body is fine — the messages were accepted.
    }
    return { sent: valid.length - invalidTokens.length, invalidTokens };
  } catch {
    return { sent: 0, invalidTokens: [] };
  }
}
