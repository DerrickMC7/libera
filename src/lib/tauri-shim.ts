import { mockInvoke } from "../demo/data";

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return mockInvoke<T>(command, args);
}

// In demo mode, track paths are root-relative URLs served by Vite from public/.
export function convertFileSrc(filePath: string): string {
  return filePath;
}
