import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtworkOriginal(trackPath: string | undefined) {
  return useQuery({
    queryKey: ["artwork-original", trackPath],
    queryFn: async () => {
      if (!trackPath) return null;
      const cachePath = await invoke<string | null>("get_artwork_original", { trackPath });
      if (!cachePath) return null;
      return convertFileSrc(cachePath);
    },
    enabled: !!trackPath,
    staleTime: Infinity,
  });
}
