// Shim for @tauri-apps/api/webviewWindow in non-Tauri (browser demo) environments
export class WebviewWindow {
  constructor(_label: string, _options?: Record<string, unknown>) {}
  static async getByLabel(_label: string): Promise<null> { return null; }
  async setFocus(): Promise<void> {}
  async close(): Promise<void> {}
}
