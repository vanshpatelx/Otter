# Otter

A local-first desktop application for managing AI-powered development environments running across one or more machines.

Instead of remotely controlling computers, you reconnect to persistent AI workspaces containing active coding agents, local development environments, browser sessions, previews, and project context.

**Privacy-first.** By default, no project data, source code, prompts, files, or AI conversations are uploaded to external servers.

## Core Principles

- Local-first
- Privacy-first
- Zero stored customer data
- Persistent AI workspaces
- Multi-machine support
- AI-native interface
- Works with any AI coding agent

## Architecture

- **Worker** — installed on every Mac/workstation. Launches AI agents, tracks sessions, monitors terminal output, exposes local resources, manages previews, streams updates, handles approvals.
- **Desktop App** — the control center. View workstations, continue conversations, monitor progress, browse files, preview sites, approve actions, open terminals.
- **Connectivity** — direct + encrypted (Tailscale, WireGuard, local network, SSH tunnel). Optional stateless relay for remote access without VPNs.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/vanshpatelx/Otter/main/install.sh | bash
```

Then:

```bash
otter worker init      # configure this machine (transport, keep-awake, agents)
otter worker start     # run the Worker
otter ui               # serve the Desktop UI at http://127.0.0.1:5180
```

Pair the UI with the code from `otter worker status`. Requires Node 20+ and git.

To keep the Worker running across logins and reboots (macOS):

```bash
otter service install     # starts at login, restarts if it exits
otter service status
otter service uninstall
```

### Desktop app

Download the `.dmg` from [Releases](https://github.com/vanshpatelx/Otter/releases)
and drag it to Applications.

The build is ad-hoc signed rather than notarized (that needs a paid Apple
developer account), so macOS will not open it on the first try. Right-click
the app and choose **Open**, then confirm.

If macOS instead claims the app **"is damaged and can't be opened"**, that is
Gatekeeper's message for a quarantined app it will not verify — the download
is fine. Clear the quarantine flag and open it:

```bash
xattr -cr "/Applications/Otter.app"
open "/Applications/Otter.app"
```

> Releases before `v0.1.2` shipped an invalid signature and always showed the
> "damaged" message; upgrade, or use the command above.

To build it yourself:

```bash
pnpm -r build
pnpm --filter @ai-workspace/desktop dist:mac   # -> apps/desktop/release/*.dmg
```

## Run it (dev)

```bash
pnpm install
pnpm -r build

pnpm --filter @ai-workspace/worker cli worker init --yes
pnpm --filter @ai-workspace/worker start          # terminal 1
pnpm --filter @ai-workspace/desktop dev            # terminal 2 -> localhost:5173
```

The dashboard shows the Worker, and the chat panel drives a real Claude Code
agent (if `claude` is on your PATH). Sensitive actions — the agent's own
included — are gated by the Approval Center. `VITE_WORKER_URL` overrides the
Worker address for the UI.

> Workspace packages resolve from `dist/`, so run `pnpm build:packages`
> after changing `packages/*`.

## Editing: full VS Code

The **Code** tab is a complete VS Code, not a cut-down editor — real extensions,
IntelliSense, an integrated terminal, and debugging. It runs on the Worker (as
[code-server](https://github.com/coder/code-server), a build of Code-OSS) and is
framed in the app through the same pairing-gated proxy the previews use, so it
works over Tailscale or a relay and never exposes an open IDE on the network.

The server binary (~180MB) downloads to the Worker on first use and is cached
under `~/.ai-workspace/vscode`; the Code tab shows the download progress, then
starts in seconds thereafter. Because the workbench runs remotely, it needs the
Worker reachable and does not work offline — that is the deliberate trade for
having the whole editor rather than a text box.

## Mobile companion

`apps/mobile` is an Expo React Native app — Otter on a phone. It speaks the same
wire protocol as the desktop over WebSocket, so it pairs with a workstation the
same way (its address plus the code from `otter worker status`) and gives you the
things that matter away from the desk: **approve or reject agent actions**, chat
with an agent, and watch the activity feed. Approvals are the point — a gate can
be cleared from your pocket.

```sh
cd apps/mobile
pnpm start          # Expo dev server — open in Expo Go, or press w for web
```

It runs on iOS, Android, and the web (via react-native-web). The pairing code is
kept in the device keychain on a phone, and the app reconnects on its own as the
network comes and goes.

## Devices & revocation

Pairing with the code enrolls a device and issues it a **per-device session
token**; the app stores that and stops using the shared code, so each phone or
laptop has its own credential. List and revoke them from the Worker:

```bash
otter sessions                 # every paired device, with when it last connected
otter sessions revoke <id>     # lock out a lost phone — refused on its next connect
otter sessions revoke-all      # force everything to pair again
```

Revoking one device doesn't touch the code or any other device, and takes effect
on the running Worker immediately. For encryption in transit, turn on TLS
(`otter cert`, [docs/TLS.md](docs/TLS.md)) so the Worker serves `wss://` only.

## Remote access

Direct transports (Tailscale, WireGuard, LAN, SSH tunnel) need no extra
infrastructure and are genuinely end-to-end — prefer them.

If you cannot connect directly, an optional [relay](docs/RELAY.md) forwards
frames between a Desktop and a Worker and stores nothing. Note that it can
currently *read* traffic in transit, so run your own — the trust model is
documented in full in [docs/RELAY.md](docs/RELAY.md).

## License

See [LICENSE](LICENSE). Non-commercial use only; commercial use requires prior written permission.
