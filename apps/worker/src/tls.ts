import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hostname, networkInterfaces } from "node:os";
import { X509Certificate } from "node:crypto";
import selfsigned from "selfsigned";

/**
 * TLS for the Worker.
 *
 * By default the Worker speaks plain ws://, which is fine on loopback but sends
 * the pairing handshake and every command in the clear over a network. Running
 * `otter cert` generates a self-signed certificate here; once it exists the
 * Worker serves wss:// and https:// only — nothing unencrypted.
 *
 * The certificate covers localhost, 127.0.0.1, the machine's hostname, and its
 * LAN IPs, so it's valid for whatever address a client actually dials. Because
 * it is self-signed, clients verify it by its SHA-256 fingerprint (printed on
 * start) rather than a public CA — trust the fingerprint once, like an SSH host
 * key.
 */

export interface CertPaths {
  dir: string;
  certFile: string;
  keyFile: string;
}

export function certPaths(homeDir: string): CertPaths {
  const dir = join(homeDir, "tls");
  return { dir, certFile: join(dir, "cert.pem"), keyFile: join(dir, "key.pem") };
}

/** TLS is "configured" once both the cert and its key exist on disk. */
export function tlsConfigured(homeDir: string): boolean {
  const { certFile, keyFile } = certPaths(homeDir);
  return existsSync(certFile) && existsSync(keyFile);
}

/** Every address this machine can be reached at, for the cert's SANs. */
export function localAddresses(): { dns: string[]; ips: string[] } {
  const dns = new Set<string>(["localhost"]);
  const ips = new Set<string>(["127.0.0.1", "::1"]);
  const host = hostname();
  if (host) {
    dns.add(host);
    // macOS advertises the machine on the LAN as "<host>.local".
    if (!host.endsWith(".local")) dns.add(`${host}.local`);
  }
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.address) ips.add(a.address);
    }
  }
  return { dns: [...dns], ips: [...ips] };
}

export interface Cert {
  cert: string;
  key: string;
}

/**
 * Generate a self-signed cert + key (PEM), valid for this machine's names and
 * IPs. `days` defaults to a long life since rotating means re-trusting the
 * fingerprint on every client.
 */
export function generateCert(opts: { days?: number; addresses?: { dns: string[]; ips: string[] } } = {}): Cert {
  const { dns, ips } = opts.addresses ?? localAddresses();
  const altNames = [
    ...dns.map((value) => ({ type: 2, value })), // type 2 = DNS
    ...ips.map((ip) => ({ type: 7, ip })), // type 7 = IP
  ];
  const pems = selfsigned.generate([{ name: "commonName", value: dns[0] ?? "localhost" }], {
    days: opts.days ?? 3650,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });
  return { cert: pems.cert, key: pems.private };
}

/** Persist a cert; the private key is written owner-read-only. */
export function writeCert(homeDir: string, cert: Cert): CertPaths {
  const paths = certPaths(homeDir);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.certFile, cert.cert, "utf8");
  writeFileSync(paths.keyFile, cert.key, { encoding: "utf8", mode: 0o600 });
  return paths;
}

/** Load the stored cert, or null if TLS isn't set up. */
export function readCert(homeDir: string): Cert | null {
  if (!tlsConfigured(homeDir)) return null;
  const { certFile, keyFile } = certPaths(homeDir);
  try {
    return { cert: readFileSync(certFile, "utf8"), key: readFileSync(keyFile, "utf8") };
  } catch {
    return null;
  }
}

/**
 * SHA-256 fingerprint of a certificate, colon-separated uppercase hex — the
 * value a client pins to trust this exact self-signed cert.
 */
export function fingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}
