import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

// apps/web is a thin deploy shell around the SAME renderer the Desktop uses —
// it aliases straight into ../desktop/src rather than copying ~40 components.
const desktopSrc = fileURLToPath(new URL("../desktop/src", import.meta.url));

// The Desktop's update banner reads a Vite-injected version; provide it here
// too so the shared App builds. The web app has its own release cadence, so it
// reports its own package version.
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
).version as string;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The Desktop components import shadcn/ai-elements via "@/…".
      "@": desktopSrc,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  server: {
    port: 5174,
    // Dev server needs to read the shared renderer that lives outside this root.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  // Absolute base: Vercel serves from the domain root.
  base: "/",
  build: { outDir: "dist" },
});
