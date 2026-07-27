# Otter Mobile

Otter on a phone — an Expo React Native companion to the desktop.

It pairs with a workstation over the same WebSocket protocol the desktop uses
(`@ai-workspace/protocol`), and focuses on what you need away from the desk:

- **Approvals** — the reason it exists. Agent actions that need a decision show
  as big Approve / Reject cards, with a badge on the tab so you never miss one.
- **Chat** — pick a workspace and talk to its agent; tool calls fold into compact
  rows so the reply stays readable on a small screen.
- **Activity** — the machine's event feed.

## Develop

```sh
pnpm start          # Expo dev server
pnpm web            # run in a browser (react-native-web)
pnpm typecheck      # tsc --noEmit
pnpm export:web     # static web build via Metro
```

Open the dev server in **Expo Go** on a device, or press `w` for the web build.
Pair with a running Worker: its `ws://…` address and the code from
`aiw worker status`.

## Notes

- The protocol types come from `@ai-workspace/protocol` via `import type`, so
  they are erased at build time — Metro bundles no workspace code, only the app.
- The workspace pins `dedupe-peer-dependents=false` (root `.npmrc`) so this app's
  React 19 and the desktop's React 18 coexist without their `@types/react`
  clashing.
