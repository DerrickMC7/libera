import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtwork(trackPath: string | undefined, full?: boolean) {
  return useQuery({
    queryKey: ["artwork", trackPath, full ?? false],
    queryFn: async () => {
      if (!trackPath) return null;
      const cachePath = await invoke<string | null>("get_artwork", {
        trackPath,
        full: full ?? false,
      });
      if (!cachePath) return null;
      return convertFileSrc(cachePath);
    },
    enabled: !!trackPath,
    staleTime: Infinity,
  });
}