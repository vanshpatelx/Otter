#!/usr/bin/env node
import {
  configExists,
  configPath,
  loadConfig,
  type KeepAwakePolicy,
  type TransportKind,
} from "./config.js";
import { agentLabel } from "./agents.js";
import { runInit, type InitOptions } from "./init.js";
import { startWorker } from "./server.js";
import { serveUi, uiDir, uiDirExists } from "./ui.js";
import { installService, serviceStatus, uninstallService } from "./service.js";
import { CrashReporter, crashReportingEnv } from "./crash.js";
import {
  generateCert,
  writeCert,
  readCert,
  tlsConfigured,
  certPaths,
  fingerprint,
  localAddresses,
} from "./tls.js";
import { rmSync } from "node:fs";
import { DeviceRegistry } from "./devices.js";
import { configDir } from "./config.js";
import { PROTOCOL_VERSION } from "@ai-workspace/protocol";
import { log } from "./log.js";

/** Parse `--flag value` and boolean `--flag` pairs from args. */
function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function initOptionsFromFlags(flags: Record<string, string | boolean>): InitOptions {
  const opts: InitOptions = {};
  if (flags.yes === true || flags.y === true) opts.yes = true;
  if (typeof flags.port === "string") opts.port = Number(flags.port);
  if (typeof flags.transport === "string") opts.transport = flags.transport as TransportKind;
  if (typeof flags["keep-awake"] === "string") opts.keepAwake = flags["keep-awake"] as KeepAwakePolicy;
  if (typeof flags.relay === "string") opts.relayUrl = flags.relay;
  return opts;
}

/**
 * `otter` command-line entrypoint.
 *
 *   otter worker init     interactive setup wizard
 *   otter worker start     launch the transport server
 *   otter worker status    show config + whether it's set up
 *   otter help
 */

const HELP = `Otter CLI

Usage:
  otter worker init      Configure this machine as a Worker
                         --yes                 unattended (defaults + detected agents)
                         --port <n>            transport port (default 4501)
                         --transport <kind>    tailscale|wireguard|local|ssh
                         --keep-awake <policy> while-active|always|off
  otter worker start     Start the Worker (transport server + keep-awake)
                         --host <addr>       bind address (default 127.0.0.1;
                                             use 0.0.0.0 or a Tailscale IP for remote devices)
                         --shared-terminals  back app terminals with tmux so the same
                                             session is attachable on this machine (needs tmux)
  otter worker status    Show this Worker's configuration
  otter ui [--port n]    Serve the Desktop UI (default http://127.0.0.1:5180)

  otter service install    Run the Worker at login and restart it if it exits
  otter service uninstall  Remove the background service
  otter service status     Show whether the service is installed and running

  otter cert             Generate a self-signed cert; the Worker then serves wss:// only
  otter cert status      Show TLS state + the cert fingerprint to trust
  otter cert regenerate  Re-issue the cert (re-trust it on every client)
  otter cert remove      Delete the cert and go back to plain ws://

  otter sessions         List the devices paired with this Worker
  otter sessions revoke <id>   Revoke one device (a lost phone) — no code rotation
  otter sessions revoke-all    Revoke every device; all must pair again

  otter help             Show this help

Docs: https://github.com/vanshpatelx/Otter`;

async function cmdStart(opts: { host?: string; sharedTerminals?: boolean } = {}): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error("No Worker config found. Run `otter worker init` first.");
    process.exitCode = 1;
    return;
  }
  // Record crashes before anything else, so a failure during startup is caught.
  // Local dumps always; a redacted report leaves the machine only when the user
  // opted in AND an OTTER_CRASH_DSN is set.
  const reporter = new CrashReporter({
    homeDir: configDir(),
    workerId: config.workerId,
    version: String(PROTOCOL_VERSION),
    optedIn: config.crashReporting === true,
    ...crashReportingEnv(),
  });
  reporter.install();
  if (reporter.willSend) log.info("crash reporting on (redacted reports → OTTER_CRASH_DSN)");

  const worker = startWorker(config, { host: opts.host, sharedTerminals: opts.sharedTerminals });

  let shuttingDown = false;
  const shutdown = () => {
    // A second Ctrl+C means "I'm done waiting" — exit immediately.
    if (shuttingDown) {
      log.warn("force quit");
      process.exit(1);
    }
    shuttingDown = true;
    log.shutdown();

    // Never hang: if graceful cleanup stalls (a stuck PTY, a socket that
    // won't drain), exit anyway rather than leaving the user pressing Ctrl+C.
    const force = setTimeout(() => {
      log.warn("cleanup timed out, exiting");
      process.exit(1);
    }, 3000);
    force.unref();

    void worker
      .stop()
      .catch(() => {})
      .then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function cmdStatus(): void {
  if (!configExists()) {
    console.log("Worker: not configured. Run `otter worker init`.");
    return;
  }
  const config = loadConfig();
  if (!config) {
    console.log(`Worker: config at ${configPath()} is unreadable/corrupt. Re-run \`otter worker init\`.`);
    return;
  }
  console.log("Worker: configured");
  console.log(`  config:      ${configPath()}`);
  console.log(`  id:          ${config.workerId}`);
  console.log(`  port:        ${config.port}`);
  console.log(`  transport:   ${config.transport}`);
  console.log(`  keepAwake:   ${config.keepAwake}`);
  console.log(`  agents:      ${config.agents.map(agentLabel).join(", ") || "none"}`);
  console.log(`  pairing:     ${config.pairingCode}`);
  const crash = config.crashReporting
    ? crashReportingEnv().dsn
      ? "on (sending to OTTER_CRASH_DSN)"
      : "on (no OTTER_CRASH_DSN set — local dumps only)"
    : "off (local dumps only)";
  console.log(`  crashReport: ${crash}`);
  if (tlsConfigured(configDir())) {
    const cert = readCert(configDir());
    console.log(`  tls:         on — wss:// only`);
    if (cert) console.log(`  fingerprint: ${fingerprint(cert.cert)}`);
  } else {
    console.log(`  tls:         off — ws:// (run \`otter cert\` to enable wss://)`);
  }
}

/** The wss:// addresses a client can pair with, one per name/IP the cert covers. */
function pairableUrls(port: number): string[] {
  const { dns, ips } = localAddresses();
  return [...dns, ...ips].map((h) => `wss://${h.includes(":") ? `[${h}]` : h}:${port}`);
}

function cmdCert(sub: string | undefined): void {
  const home = configDir();
  const paths = certPaths(home);

  if (sub === "status" || sub === "show") {
    if (!tlsConfigured(home)) {
      console.log("TLS: off (Worker serves plain ws://). Run `otter cert` to enable wss://.");
      return;
    }
    const cert = readCert(home);
    console.log("TLS: on — the Worker serves wss:// only.");
    console.log(`  cert:        ${paths.certFile}`);
    if (cert) console.log(`  fingerprint: ${fingerprint(cert.cert)}`);
    console.log("  Clients trust this self-signed cert by its fingerprint (like an SSH host key).");
    return;
  }

  if (sub === "remove" || sub === "off") {
    if (!tlsConfigured(home)) {
      console.log("TLS is already off.");
      return;
    }
    rmSync(paths.certFile, { force: true });
    rmSync(paths.keyFile, { force: true });
    console.log("Removed the TLS certificate. The Worker will serve plain ws:// on next start.");
    return;
  }

  // Default (`otter cert` / `otter cert generate`): make a fresh self-signed cert.
  if (tlsConfigured(home) && sub !== "generate" && sub !== "regenerate" && sub !== "force") {
    console.log("A TLS certificate already exists — the Worker serves wss://.");
    console.log(`  fingerprint: ${fingerprint(readCert(home)!.cert)}`);
    console.log("  Re-issue it with `otter cert regenerate` (re-trust it on every client afterwards).");
    return;
  }

  const cert = generateCert();
  writeCert(home, cert);
  const port = loadConfig()?.port ?? 4501;
  console.log("Generated a self-signed TLS certificate. The Worker now serves wss:// only.");
  console.log(`  cert:        ${paths.certFile}`);
  console.log(`  fingerprint: ${fingerprint(cert.cert)}`);
  console.log("\n  Pair the app with one of these secure addresses:");
  for (const url of pairableUrls(port)) console.log(`    ${url}`);
  console.log("\n  Restart the Worker to pick up the certificate:  otter worker start");
}

function ago(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** `otter sessions …` — list and revoke the devices paired with this Worker. */
function cmdSessions(sub: string | undefined, rest: string[]): void {
  const devices = new DeviceRegistry(configDir());

  if (sub === "revoke") {
    const id = rest[0];
    if (!id) {
      console.error("Usage: otter sessions revoke <device-id>   (see `otter sessions`)");
      process.exitCode = 1;
      return;
    }
    console.log(
      devices.revoke(id)
        ? `Revoked ${id}. That device is refused on its next connect; it can pair again with the code.`
        : `No device with id ${id}. Run \`otter sessions\` to list them.`,
    );
    return;
  }

  if (sub === "revoke-all") {
    const n = devices.revokeAll();
    console.log(`Revoked ${n} device${n === 1 ? "" : "s"}. Every client must pair again with the code.`);
    return;
  }

  // Default: list.
  const list = devices.list();
  if (list.length === 0) {
    console.log("No paired devices yet. Devices appear here once they pair with the code.");
    return;
  }
  console.log(`Paired devices (${list.length}):\n`);
  for (const d of list) {
    console.log(`  ${d.id}  ${d.label}`);
    console.log(`      last seen ${ago(d.lastSeenAt)} · paired ${ago(d.createdAt)}`);
  }
  console.log(`\n  Revoke one:  otter sessions revoke <id>`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [group, sub] = argv;
  const flags = parseFlags(argv.slice(2));

  if (group === "help" || group === "--help" || group === "-h" || !group) {
    console.log(HELP);
    return;
  }

  if (group === "ui") {
    if (!uiDirExists()) {
      console.error(`Desktop UI build not found at ${uiDir()}`);
      console.error("Build it first:  pnpm --filter @ai-workspace/desktop build");
      process.exitCode = 1;
      return;
    }
    const uiFlags = parseFlags(argv.slice(1));
    serveUi(typeof uiFlags.port === "string" ? Number(uiFlags.port) : 5180);
    return;
  }

  if (group === "service") {
    try {
      switch (sub) {
        case "install": {
          if (!configExists()) {
            console.error("No Worker config found. Run `otter worker init` first.");
            process.exitCode = 1;
            return;
          }
          const path = await installService(process.cwd());
          console.log("Worker service installed and started.");
          console.log(`  plist:  ${path}`);
          console.log("  It now starts at login and restarts if it exits.");
          console.log("  Check it with:  otter service status");
          return;
        }
        case "uninstall":
          await uninstallService();
          console.log("Worker service stopped and removed.");
          return;
        case "status": {
          const status = await serviceStatus();
          console.log(`Service: ${status.installed ? "installed" : "not installed"}`);
          console.log(`  running: ${status.running ? `yes (pid ${status.pid})` : "no"}`);
          console.log(`  plist:   ${status.plist}`);
          console.log(`  logs:    ${status.logs}`);
          return;
        }
        default:
          console.error(`Unknown service command: ${sub ?? "(none)"}\n`);
          console.log(HELP);
          process.exitCode = 1;
          return;
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
      return;
    }
  }

  if (group === "cert") {
    cmdCert(sub);
    return;
  }

  if (group === "sessions") {
    cmdSessions(sub, argv.slice(2));
    return;
  }

  if (group === "worker") {
    switch (sub) {
      case "init":
        await runInit(initOptionsFromFlags(flags));
        return;
      case "start":
        await cmdStart({
          host: typeof flags.host === "string" ? flags.host : undefined,
          sharedTerminals: flags["shared-terminals"] === true,
        });
        return;
      case "status":
        cmdStatus();
        return;
      default:
        console.error(`Unknown worker command: ${sub ?? "(none)"}\n`);
        console.log(HELP);
        process.exitCode = 1;
        return;
    }
  }

  console.error(`Unknown command: ${group}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

void main();
