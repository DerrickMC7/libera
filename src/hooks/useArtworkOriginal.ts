import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtworkOriginal(trackPath: string | undefined, trackOverride?: boolean) {
  return useQuery({
    queryKey: ["artwork-original", trackPath, trackOverride ?? false],
    queryFn: async () => {
      if (!trackPath) return null;
      const cachePath = await invoke<string | null>("get_artwork_original", {
        trackPath,
        trackOverride: trackOverride ?? false,
      });
      if (!cachePath) return null;
      return `${convertFileSrc(cachePath)}?v=${Date.now()}`;
    },
    enabled: !!trackPath,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
  });
}
