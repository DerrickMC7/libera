import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Track } from "../types/track";
import { useCacheStore } from "../store/cacheStore";
import { listen } from "@tauri-apps/api/event";

export const PAGE_SIZE = 100;

export function useTracksCount(search: string = "") {
  return useQuery({
    queryKey: ["tracks-count", search],
    queryFn: () => invoke<number>("get_tracks_count", { query: search }),
    staleTime: 1000 * 60 * 5,
  });
}

export function useTracksPage(search: string, offset: number, enabled = true) {
  return useQuery({
    queryKey: ["tracks-page", search, offset],
    queryFn: () =>
      invoke<Track[]>("get_tracks_page", {
        query: search,
        limit: PAGE_SIZE,
        offset,
      }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

export function useScanFolder() {
  const queryClient = useQueryClient();
  const { startProcessing, setProgress, finishProcessing } = useCacheStore();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      // Step 1: get current track count to determine if first time
      const currentCount = await invoke<number>("get_tracks_count", { query: "" });
      const isFirstTime = currentCount === 0;

      // Step 2: scan folder
      const tracks = await invoke<Track[]>("scan_folder", { path: folderPath });

      // Step 3: save to database
      const saved = await invoke<number>("save_tracks", { tracks });

      // Step 4: find tracks without cached artwork
      const allPaths = tracks.map((t) => t.path);
      const uncachedPaths = await invoke<string[]>("get_uncached_tracks", {
        trackPaths: allPaths,
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
        invoke("precache_artwork", { trackPaths: uncachedPaths }).catch(console.error);
      }

      return { tracks, saved };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tracks-count"] });
    },
  });
}