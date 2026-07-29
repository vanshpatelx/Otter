import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import { WebSocket } from "ws";
import { TransportServer } from "@ai-workspace/transport";
import {
  generateCert,
  writeCert,
  readCert,
  tlsConfigured,
  certPaths,
  fingerprint,
  localAddresses,
} from "./tls.js";

describe("tls: certificate generation", () => {
  it("generates a self-signed cert + key covering localhost and 127.0.0.1", () => {
    const { cert, key } = generateCert({ addresses: { dns: ["localhost"], ips: ["127.0.0.1"] } });
    expect(cert).toMatch(/BEGIN CERTIFICATE/);
    expect(key).toMatch(/BEGIN (RSA )?PRIVATE KEY/);
    const x = new X509Certificate(cert);
    // SANs must include the names/IPs clients will dial, or TLS verification fails.
    expect(x.subjectAltName).toContain("DNS:localhost");
    expect(x.subjectAltName).toContain("IP Address:127.0.0.1");
  });

  it("includes this machine's real addresses by default", () => {
    const { dns, ips } = localAddresses();
    expect(dns).toContain("localhost");
    expect(ips).toContain("127.0.0.1");
    const x = new X509Certificate(generateCert().cert);
    expect(x.subjectAltName).toContain("DNS:localhost");
  });

  it("computes a stable SHA-256 fingerprint", () => {
    const { cert } = generateCert();
    const fp = fingerprint(cert);
    expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/); // 32 colon-separated hex bytes
    expect(fingerprint(cert)).toBe(fp); // stable for the same cert
  });
});

describe("tls: on-disk store", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "otter-tls-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("starts off (no cert = plain ws)", () => {
    expect(tlsConfigured(home)).toBe(false);
    expect(readCert(home)).toBeNull();
  });

  it("writes, reports configured, and reads back", () => {
    const cert = generateCert();
    writeCert(home, cert);
    expect(tlsConfigured(home)).toBe(true);
    const back = readCert(home);
    expect(back?.cert).toBe(cert.cert);
    expect(back?.key).toBe(cert.key);
    expect(existsSync(certPaths(home).certFile)).toBe(true);
  });

  it("writes the private key owner-read-only", () => {
    writeCert(home, generateCert());
    const mode = statSync(certPaths(home).keyFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("tls: real wss handshake through TransportServer", () => {
  const PORT = 4611;
  let server: TransportServer;
  let cert: { cert: string; key: string };

  beforeEach(async () => {
    cert = generateCert({ addresses: { dns: ["localhost"], ips: ["127.0.0.1"] } });
    server = new TransportServer(
      { port: PORT, tls: cert },
      {
        onMessage(conn, msg) {
          if (msg.type === "hello") conn.send({ type: "auth.result", ok: msg.token === "ok" });
        },
      },
    );
    expect(server.secure).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
  });

  afterEach(async () => {
    await server.close();
  });

  it("accepts a wss client that trusts the cert and round-trips a message", async () => {
    const messages: any[] = [];
    const sock = new WebSocket(`wss://127.0.0.1:${PORT}`, { ca: cert.cert });
    await new Promise<void>((resolve, reject) => {
      sock.on("open", () => {
        sock.send(JSON.stringify({ type: "hello", clientId: "t", token: "ok" }));
      });
      sock.on("message", (raw) => {
        messages.push(JSON.parse(raw.toString()));
        resolve();
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
    expect(messages[0]).toEqual({ type: "auth.result", ok: true });
    sock.close();
  });

  it("rejects a plain ws:// client (TLS is enforced)", async () => {
    const connected = await new Promise<boolean>((resolve) => {
      const sock = new WebSocket(`ws://127.0.0.1:${PORT}`);
      sock.on("open", () => resolve(true));
      sock.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });
    expect(connected).toBe(false);
  });

  it("rejects a wss client that does not trust the cert", async () => {
    const connected = await new Promise<boolean>((resolve) => {
      const sock = new WebSocket(`wss://127.0.0.1:${PORT}`); // no ca
      sock.on("open", () => resolve(true));
      sock.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 2000);
    });
    expect(connected).toBe(false);
  });
});
