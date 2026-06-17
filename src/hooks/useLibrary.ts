import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Track } from "../types/track";
import { useCacheStore } from "../store/cacheStore";
import { useToastStore } from "../store/toastStore";
import { listen } from "@tauri-apps/api/event";

export const PAGE_SIZE = 100;

export function useTracksCount(search: string = "") {
  return useQuery({
    queryKey: ["tracks-count", search],
    queryFn: () => invoke<number>("get_tracks_count", { query: search }),
    staleTime: 1000 * 60 * 5,
  });
}

export function useTracksPage(search: string, offset: number, enabled = true, sortBy = "artist") {
  return useQuery({
    queryKey: ["tracks-page", search, offset, sortBy],
    queryFn: () =>
      invoke<Track[]>("get_tracks_page", {
        query: search,
        limit: PAGE_SIZE,
        offset,
        sortBy,
      }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

export function useScanFolder() {
  const queryClient = useQueryClient();
  const { startProcessing, setProgress, finishProcessing } = useCacheStore();
  const { show: showToast } = useToastStore();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      // Step 1: get current track count to determine if first time
      const currentCount = await invoke<number>("get_tracks_count", { query: "" });
      const isFirstTime = currentCount === 0;

      // Step 2+3: scan AND persist in a single backend call (avoids serializing
      // the full track list across the IPC bridge twice for large libraries).
      const { saved, paths } = await invoke<{ saved: number; paths: string[] }>(
        "scan_and_save_folder",
        { path: folderPath },
      );

      // Step 4: find tracks without cached artwork
      const uncachedPaths = await invoke<string[]>("get_uncached_tracks", {
        trackPaths: paths,
      });

      if (uncachedPaths.length > 0) {
        // Start progress UI
        startProcessing(uncachedPaths.length, isFirstTime);

        // Listen for progress events
        const unlisten = await listen<{
          completed: number;
          total: number;
          current_path: string;
        }>("artwork://progress", (event) => {
          setProgress(event.payload.completed, event.payload.total, event.payload.current_path);
        });

        const unlistenDone = await listen("artwork://done", () => {
          finishProcessing();
          unlisten();
          unlistenDone();
        });

        // Start pre-caching in background (don't await — runs async)
        invoke("precache_artwork", { trackPaths: uncachedPaths }).catch((e) => {
          finishProcessing();
          showToast("Artwork caching failed — " + String(e).slice(0, 60));
        });
      }

      return { saved, paths };
    },
    onSuccess: () => {
      // A scan can add tracks, albums, artists and genres — refresh every view
      // that derives from the tracks table, not just the tracks list itself.
      [
        "tracks-page",
        "tracks-count",
        "tracks-ordered",
        "track-paths-ordered",
        "albums",
        "artists",
        "genres",
        "genre-stats",
        "genre-cooccurrence",
        "library-stats",
      ].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    },
    onError: (e: unknown) => {
      showToast("Scan failed — " + String(e).slice(0, 80));
    },
  });
}