import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const isTauri = !!process.env.TAURI_ENV_TARGET_TRIPLE;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: isTauri
      ? {}
      : {
          "@tauri-apps/api/core": resolve(__dirname, "./src/lib/tauri-shim.ts"),
          "@tauri-apps/api/event": resolve(__dirname, "./src/lib/tauri-event-shim.ts"),
          "@tauri-apps/api/window": resolve(__dirname, "./src/lib/tauri-window-shim.ts"),
          "@tauri-apps/api/webviewWindow": resolve(__dirname, "./src/lib/tauri-webview-shim.ts"),
        },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});