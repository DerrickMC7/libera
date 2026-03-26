import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Track } from "../types/track";

export const PAGE_SIZE = 100;

// Returns total track count for a given search query
export function useTracksCount(search: string = "") {
  return useQuery({
    queryKey: ["tracks-count", search],
    queryFn: () => invoke<number>("get_tracks_count", { query: search }),
    staleTime: 1000 * 60 * 5,
  });
}

// Fetches a specific page by offset — each page is cached independently
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

// Scans a folder and saves the results to the database
export function useScanFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      const tracks = await invoke<Track[]>("scan_folder", { path: folderPath });
      const saved = await invoke<number>("save_tracks", { tracks });
      return { tracks, saved };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tracks-count"] });
    },
  });
}