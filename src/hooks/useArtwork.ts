import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtwork(trackPath: string | undefined) {
  return useQuery({
    queryKey: ["artwork", trackPath],
    queryFn: async () => {
      if (!trackPath) return null;
      const cachePath = await invoke<string | null>("get_artwork", {
        trackPath,
      });
      if (!cachePath) return null;
      return convertFileSrc(cachePath);
    },
    enabled: !!trackPath,
    staleTime: Infinity, // artwork never changes for a given track
  });
}