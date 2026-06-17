import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { useMetadataFetchStore, ensureMetadataFetchListeners } from "../store/metadataFetchStore";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

export function useMetadataFetch() {
  const state = useMetadataFetchStore();

  // Listeners live for the app's lifetime (set up once), so progress keeps updating
  // while this hook is unmounted and is still correct when Settings is reopened.
  useEffect(() => { ensureMetadataFetchListeners(); }, []);

  async function run(command: "fetch_missing_metadata" | "fetch_missing_genres") {
    if (IS_DEMO || useMetadataFetchStore.getState().isRunning) return;
    useMetadataFetchStore.setState({
      isRunning: true, completed: 0, total: 0, updated: 0, current: "", doneMessage: null, logPath: null,
    });
    try {
      await invoke(command);
    } catch (e) {
      console.error(`${command} failed:`, e);
      // The backend rejects a duplicate run; in that case keep showing the live
      // progress of the run that's already going rather than flashing an error.
      if (!/already running/i.test(String(e))) {
        useMetadataFetchStore.setState({ isRunning: false, doneMessage: "Failed — check your connection" });
      }
    }
  }

  // Full pass: fills missing year + genre. Genre-only pass: just genres, and only
  // over tracks whose genre is missing — faster, and won't touch years.
  const start = () => run("fetch_missing_metadata");
  const startGenres = () => run("fetch_missing_genres");

  async function cancel() {
    if (!useMetadataFetchStore.getState().isRunning) return;
    await invoke("cancel_metadata_fetch").catch(console.error);
  }

  async function openReport() {
    const { logPath } = useMetadataFetchStore.getState();
    if (!logPath) return;
    try {
      await openPath(logPath);
    } catch (e) {
      console.error("openPath failed, falling back to shell open:", e);
      await invoke("open_path_with_shell", { path: logPath }).catch(console.error);
    }
  }

  const percent = state.total > 0 ? Math.round((state.completed / state.total) * 100) : 0;

  return { ...state, percent, start, startGenres, cancel, openReport };
}
