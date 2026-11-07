import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 7800, npm start) and Vite on VITE_PORT (default 7801). /api is proxied, so the browser only ever
// talks to one origin (same-origin writes). 7801 is a dev-only default; Vite moves to a free port if it is busy.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7800}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 7801, strictPort: false, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
