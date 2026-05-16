import { mockInvoke } from "../demo/data";

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return mockInvoke<T>(command, args);
}

// In demo mode, track.path is already a web URL — return it unchanged.
export function convertFileSrc(filePath: string): string {
  return filePath;
}
