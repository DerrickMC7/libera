import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtistBanner(artistName: string | undefined) {
  return useQuery({
    queryKey: ["artist-banner", artistName],
    queryFn: async () => {
      if (!artistName) return null;
      const cachePath = await invoke<string | null>("get_artist_banner", { artistName });
      if (!cachePath) return null;
      return convertFileSrc(cachePath);
    },
    enabled: !!artistName,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
  });
}
