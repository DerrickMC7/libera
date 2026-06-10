import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtwork(trackPath: string | undefined, full?: boolean, trackOverride?: boolean) {
  return useQuery({
    queryKey: ["artwork", trackPath, full ?? false, trackOverride ?? false],
    queryFn: async () => {
      if (!trackPath) return null;
      const cachePath = await invoke<string | null>("get_artwork", {
        trackPath,
        full: full ?? false,
        trackOverride: trackOverride ?? false,
      });
      if (!cachePath) return null;
      // Append a timestamp so the browser never serves a stale cached response
      // when the same on-disk file is overwritten with new artwork.
      return `${convertFileSrc(cachePath)}?v=${Date.now()}`;
    },
    enabled: !!trackPath,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
  });
}