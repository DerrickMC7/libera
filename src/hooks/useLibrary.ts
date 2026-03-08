import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Track } from "../types/track";

// Fetches all tracks stored in the database
export function useLibrary() {
  return useQuery({
    queryKey: ["tracks"],
    queryFn: async () => {
      const tracks = await invoke<Track[]>("get_tracks");
      return tracks;
    },
  });
}

// Scans a folder and saves the results to the database
export function useScanFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      // Step 1: scan the folder and get tracks
      const tracks = await invoke<Track[]>("scan_folder", { path: folderPath });
      // Step 2: save them to the database
      const saved = await invoke<number>("save_tracks", { tracks });
      return { tracks, saved };
    },
    // After a successful scan, refresh the library automatically
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tracks"] });
    },
  });
}