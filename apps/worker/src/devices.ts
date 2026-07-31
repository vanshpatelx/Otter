import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Per-device sessions — revocable access without rotating the pairing code.
 *
 * The pairing code is the owner secret: it enrolls a new device. But once a
 * phone or laptop has paired, it shouldn't have to resend that shared secret on
 * every connect, and losing it shouldn't mean re-pairing every other device. So
 * enrolling issues each device its own long-lived token; the device uses that
 * token thereafter, and you can revoke one device (a lost phone) from the CLI
 * without touching the code or any other device.
 *
 * Sessions are keyed by the client's stable install id, so re-pairing the same
 * device refreshes its session rather than piling up duplicates.
 */
export interface DeviceSession {
  /** Short public id, safe to show in the CLI. */
  id: string;
  /** Secret bearer token the device presents to authenticate. Never printed. */
  token: string;
  /** The client's stable install id (dedupe key). */
  clientId: string;
  /** Human label, e.g. "Vansh's iPhone". */
  label: string;
  createdAt: number;
  lastSeenAt: number;
}

/** What the CLI shows — everything except the secret token. */
export type DeviceInfo = Omit<DeviceSession, "token">;

function newToken(): string {
  return `otds_${randomBytes(24).toString("hex")}`;
}
function newId(): string {
  return `d_${randomBytes(4).toString("hex")}`;
}

export class DeviceRegistry {
  private readonly file: string;
  private sessions: DeviceSession[] = [];

  constructor(
    homeDir: string,
    private now: () => number = () => Date.now(),
  ) {
    this.file = join(homeDir, "devices.json");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(parsed)) this.sessions = parsed;
    } catch {
      this.sessions = []; // a corrupt file just means everyone re-pairs
    }
  }

  private save(): void {
    try {
      mkdirSync(join(this.file, ".."), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.sessions, null, 2), "utf8");
    } catch {
      /* best-effort — a read-only home just loses persistence */
    }
  }

  /**
   * Enroll (or refresh) a device after it authenticated with the pairing code.
   * Idempotent per clientId: the same install keeps its token instead of
   * accumulating sessions. Returns the session, token included, to hand back.
   */
  enroll(clientId: string, label: string): DeviceSession {
    const existing = this.sessions.find((s) => s.clientId === clientId);
    if (existing) {
      existing.label = label || existing.label;
      existing.lastSeenAt = this.now();
      this.save();
      return existing;
    }
    const session: DeviceSession = {
      id: newId(),
      token: newToken(),
      clientId,
      label: label || "device",
      createdAt: this.now(),
      lastSeenAt: this.now(),
    };
    this.sessions.push(session);
    this.save();
    return session;
  }

  /**
   * Return the session for a bearer token, or null.
   *
   * Reloads from disk first so a revoke issued by the `otter sessions` CLI
   * (a separate process writing the same file) takes effect on the running
   * Worker immediately — a revoked device is refused on its next connect, no
   * restart required. Auth happens only on connect, so the extra read is cheap.
   */
  authenticate(token: string): DeviceSession | null {
    if (!token) return null;
    this.load();
    return this.sessions.find((s) => s.token === token) ?? null;
  }

  /** Mark a session as just-seen (on a successful token auth). */
  touch(id: string): void {
    const s = this.sessions.find((x) => x.id === id);
    if (s) {
      s.lastSeenAt = this.now();
      this.save();
    }
  }

  /** All devices, newest first, without their secret tokens. */
  list(): DeviceInfo[] {
    return [...this.sessions]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(({ token: _t, ...info }) => info);
  }

  /** Revoke one device by its public id. Returns true if it existed. */
  revoke(id: string): boolean {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.id !== id);
    const removed = this.sessions.length < before;
    if (removed) this.save();
    return removed;
  }

  /** Revoke every device — forces all of them to re-pair with the code. */
  revokeAll(): number {
    const n = this.sessions.length;
    this.sessions = [];
    this.save();
    return n;
  }

  get size(): number {
    return this.sessions.length;
  }
}
