import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { useQueryClient } from "@tanstack/react-query";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

interface MetadataFetchState {
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

export function useMetadataFetch() {
  const [state, setState] = useState<MetadataFetchState>(IDLE);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (IS_DEMO) return;
    const unlistens: Array<() => void> = [];

    listen<{ total: number }>("metadata://started", (e) => {
      setState({ isRunning: true, completed: 0, total: e.payload.total, updated: 0, current: "", doneMessage: null, logPath: null });
    }).then((u) => unlistens.push(u));

    listen<{ completed: number; total: number; current: string; updated: number }>(
      "metadata://progress",
      (e) => setState((s) => ({ ...s, completed: e.payload.completed, current: e.payload.current, updated: e.payload.updated })),
    ).then((u) => unlistens.push(u));

    listen<{ total: number; updated: number; log_path: string | null }>("metadata://done", (e) => {
      setState({ ...IDLE, doneMessage: `Updated ${e.payload.updated} of ${e.payload.total} tracks`, logPath: e.payload.log_path });
      queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
    }).then((u) => unlistens.push(u));

    listen<{ updated: number; log_path: string | null }>("metadata://cancelled", (e) => {
      setState((s) => ({
        ...IDLE,
        doneMessage: e.payload.updated > 0 ? `Cancelled — updated ${e.payload.updated} tracks` : "Cancelled",
        logPath: e.payload.log_path,
      }));
    }).then((u) => unlistens.push(u));

    return () => unlistens.forEach((u) => u());
  }, []);

  async function start() {
    if (IS_DEMO || state.isRunning) return;
    setState({ ...IDLE, isRunning: true });
    try {
      await invoke("fetch_missing_metadata");
    } catch (e) {
      console.error("fetch_missing_metadata failed:", e);
      setState({ ...IDLE, doneMessage: "Failed — check your connection" });
    }
  }

  async function cancel() {
    if (!state.isRunning) return;
    await invoke("cancel_metadata_fetch").catch(console.error);
  }

  async function openReport() {
    if (!state.logPath) return;
    try {
      await openPath(state.logPath);
    } catch (e) {
      console.error("openPath failed, falling back to shell open:", e);
      await invoke("open_path_with_shell", { path: state.logPath }).catch(console.error);
    }
  }

  const percent = state.total > 0 ? Math.round((state.completed / state.total) * 100) : 0;

  return { ...state, percent, start, cancel, openReport };
}
