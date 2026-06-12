import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@tauri-apps/api/core": resolve(__dirname, "./src/lib/tauri-shim.ts"),
      "@tauri-apps/api/event": resolve(__dirname, "./src/lib/tauri-event-shim.ts"),
      "@tauri-apps/api/window": resolve(__dirname, "./src/lib/tauri-window-shim.ts"),
      "@tauri-apps/api/webviewWindow": resolve(__dirname, "./src/lib/tauri-webview-shim.ts"),
      "@tauri-apps/plugin-dialog": resolve(__dirname, "./src/lib/tauri-dialog-shim.ts"),
      "@tauri-apps/plugin-opener": resolve(__dirname, "./src/lib/tauri-opener-shim.ts"),
    },
  },
});
