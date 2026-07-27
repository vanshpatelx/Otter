import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

// The release workflow stamps apps/desktop/package.json from the git tag before
// building, so the bundled version matches the shipped app; dev builds read 0.0.0.
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
).version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  // shadcn/ai-elements components import via "@/", so mirror that here
  // and in tsconfig paths.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173 },
  // Relative base so the built renderer works both when served over HTTP
  // (`otter ui`) and when loaded from file:// inside the Electron shell.
  base: "./",
  build: { outDir: "dist" },
});
