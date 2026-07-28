import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The web app IS the Desktop renderer — same App, same components, same
// connection + pairing logic — reached through the "@" alias to ../desktop/src.
import { App } from "@/App.js";
import "@/index.css";
import { MixedContentNotice } from "./MixedContentNotice.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MixedContentNotice />
    <App />
  </StrictMode>,
);
