# Otter — Web

The Otter UI as a **deployable web app**, so your team can open it in a browser
instead of installing the desktop build. It is the *same* renderer the Desktop
uses — same views, same pairing flow — reached through a Vite alias into
`../desktop/src`, so there's one UI to maintain, not two.

It keeps Otter's local-first model: **no accounts, no server-side state.** Each
person opens the URL and pairs to *their own* workers with a code, exactly like
the Desktop pairs to a Mac mini. Nothing about the app phones home.

```
browser (this app)  ──ws / wss──►  your Worker (Mac mini, laptop, …)
        pair with the code from `otter worker status`
```

## Develop

```bash
pnpm --filter @ai-workspace/web dev      # http://localhost:5174
```

## Build

```bash
pnpm build:packages
pnpm --filter @ai-workspace/web build    # static SPA in apps/web/dist
```

The output in `dist/` is a plain static bundle — host it anywhere.

## Deploy to Vercel

1. Import the repo in Vercel and set **Root Directory** to `apps/web`.
2. `vercel.json` (already here) wires the rest: it installs from the monorepo
   root with a frozen lockfile, builds the shared packages, then builds the web
   app, and serves `dist/` with SPA fallback routing.

That's it — no environment variables required. Vercel serves it over HTTPS.

### One thing to know about HTTPS and workers

A page served over **https** (which Vercel always is) can only open a **secure**
WebSocket. So from the hosted app you can reach a worker that is:

- on **`localhost`** (browsers exempt loopback), or
- behind a **`wss://` TLS relay** — run the [relay](../../docs/RELAY.md) behind
  TLS and pair with its `wss://…/client?id=<workerId>` address.

A bare **`ws://` LAN address** (e.g. `ws://192.168.1.10:4501`) will be **blocked
by the browser** as mixed content. The app detects this and shows a banner
explaining it. Two ways to use plain `ws://` LAN workers:

- put a TLS relay in front (recommended for remote/team use), or
- serve this app itself over plain **http** on your LAN (then `ws://` is fine),
  e.g. `pnpm --filter @ai-workspace/web preview --host` on an office box.

## What it is / isn't

- **Is:** the full Otter UI, hostable, per-user pairing, zero server state.
- **Isn't:** a multi-tenant SaaS. There are no accounts and no shared worker
  registry — every browser pairs to its own machines, just like the Desktop.
