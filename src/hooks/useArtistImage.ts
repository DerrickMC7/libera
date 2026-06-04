import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useArtistImage(artistName: string | undefined) {
  return useQuery({
    queryKey: ["artist-image", artistName],
    queryFn: async () => {
      if (!artistName) return null;
      const cachePath = await invoke<string | null>("get_artist_image", { artistName });
      if (!cachePath) return null;
      return convertFileSrc(cachePath);
    },
    enabled: !!artistName,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
  });
}
