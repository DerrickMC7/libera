import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "../lib/queryClient";

export interface MetadataFetchState {
  isRunning: boolean;
  completed: number;
  total: number;
  updated: number;
  current: string;
  doneMessage: string | null;
  logPath: string | null;
}

const IDLE: MetadataFetchState = {
  isRunning: false,
  completed: 0,
  total: 0,
  updated: 0,
  current: "",
  doneMessage: null,
  logPath: null,
};

// Global so the running state and progress survive navigating away from Settings —
// component-local state would reset on unmount and (worse) tear down the event
// listeners, leaving the UI thinking nothing is running.
export const useMetadataFetchStore = create<MetadataFetchState>(() => ({ ...IDLE }));

const IS_DEMO = !("__TAURI_INTERNALS__" in window);
let listenersReady = false;

// Attach the backend progress listeners ONCE for the app's lifetime (never torn
// down), feeding the global store. Idempotent — safe to call from every mount.
export function ensureMetadataFetchListeners() {
  if (listenersReady || IS_DEMO) return;
  listenersReady = true;
  const set = useMetadataFetchStore.setState;

  listen<{ total: number }>("metadata://started", (e) => {
    set({ ...IDLE, isRunning: true, total: e.payload.total });
  });

  listen<{ completed: number; total: number; current: string; updated: number }>(
    "metadata://progress",
    (e) =>
      set({
        isRunning: true,
        completed: e.payload.completed,
        total: e.payload.total,
        current: e.payload.current,
        updated: e.payload.updated,
      }),
  );

  listen<{ total: number; updated: number; log_path: string | null }>("metadata://done", (e) => {
    set({ ...IDLE, doneMessage: `Updated ${e.payload.updated} of ${e.payload.total} tracks`, logPath: e.payload.log_path });
    queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
    queryClient.invalidateQueries({ queryKey: ["tracks-ordered"] });
    queryClient.invalidateQueries({ queryKey: ["track-paths-ordered"] });
    queryClient.invalidateQueries({ queryKey: ["albums"] });
    queryClient.invalidateQueries({ queryKey: ["artists"] });
    queryClient.invalidateQueries({ queryKey: ["genres"] });
    window.dispatchEvent(new CustomEvent("library:track-updated"));
  });

  listen<{ updated: number; log_path: string | null }>("metadata://cancelled", (e) => {
    set({
      ...IDLE,
      doneMessage: e.payload.updated > 0 ? `Cancelled — updated ${e.payload.updated} tracks` : "Cancelled",
      logPath: e.payload.log_path,
    });
  });
}
