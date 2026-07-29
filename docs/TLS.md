# Encrypting the Worker (WSS / HTTPS)

By default a Worker speaks **plain `ws://`**. That's fine on `localhost`, but on a
network it sends the pairing handshake and every command in the clear. Turning on
TLS makes the Worker serve **`wss://` only** — encrypted end to end.

## Turn it on

```bash
otter cert            # generate a self-signed certificate for this machine
otter worker start    # the Worker now serves wss:// (and refuses plain ws://)
```

`otter cert` prints the addresses you can pair with and a **fingerprint**:

```
Generated a self-signed TLS certificate. The Worker now serves wss:// only.
  fingerprint: 86:D8:16:7D:2A:60:…:60:05
  Pair the app with one of these secure addresses:
    wss://mac-mini.local:4501
    wss://192.168.1.42:4501
    wss://127.0.0.1:4501
```

Check it any time with `otter cert status` (or `otter worker status`).

## How trust works

The certificate is **self-signed** — no public authority vouches for it, because
none can vouch for a Mac mini on your LAN. So clients trust it by its **SHA-256
fingerprint**, exactly like an SSH host key: verify the fingerprint once, and
you're pinned to that Worker. The pairing code is still required on top, so even
a trusted transport won't do anything without it.

Once a cert exists the Worker is **`wss://`-only** — a plain `ws://` client is
refused at the TLS handshake, not after connecting. Remove it with
`otter cert remove` to go back to `ws://`.

## Client support

| Client | Self-signed `wss://` |
|---|---|
| **Desktop app** | ✅ Automatic. It trusts the Worker's cert (pairing code is the auth). |
| **CLI (`otter ui`)** | ✅ Served over loopback; connects to `wss://` Workers. |
| **Web app (browser)** | ⚠️ One-time trust — see below. |
| **Mobile** | ⚠️ iOS/Android reject unknown CAs; needs the cert trusted on the device. |

### Web app: trust the cert once

A browser won't open a `wss://` socket to an untrusted cert, and — unlike visiting
a web page — there's no inline "proceed anyway" for a socket. The one-time fix:

1. In the same browser, visit **`https://<worker-host>:<port>`** (e.g.
   `https://192.168.1.42:4501`).
2. Accept the certificate warning ("proceed to site").
3. That origin is now trusted, so the web app's `wss://` connection to it works.

If you'd rather not do this per device, front the Worker with a **TLS relay** on a
real domain (see [RELAY.md](./RELAY.md)) — a browser-trusted cert, zero per-device
setup, and it also solves reaching Workers over the internet.

## Rotating

`otter cert regenerate` issues a fresh cert (and a new fingerprint) — you'll
re-trust it on every client afterwards, so only do it if the key may be exposed.
