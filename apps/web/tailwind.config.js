import desktop from "../desktop/tailwind.config.js";

/**
 * The web app renders the Desktop's components, so Tailwind must scan the
 * Desktop source (plus this app's own shell) to emit the classes they use.
 * The theme is inherited wholesale from the Desktop config.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  ...desktop,
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../desktop/src/**/*.{ts,tsx}"],
};
