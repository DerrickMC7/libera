// Shim for @tauri-apps/api/window in non-Tauri (browser demo) environments
export function getCurrentWindow() {
  return { label: "main", close: async () => {}, startDragging: async () => {} };
}
