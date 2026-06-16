import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export function useGenreImage(genreName: string | undefined) {
  return useQuery({
    queryKey: ["genre-image", genreName],
    queryFn: async () => {
      if (!genreName) return null;
      const cachePath = await invoke<string | null>("get_genre_image", { genreName });
      if (!cachePath) return null;
      // Append timestamp so the browser doesn't serve a stale cached version
      // after the file is updated on disk (same path, new content).
      return convertFileSrc(cachePath) + `?v=${Date.now()}`;
    },
    enabled: !!genreName,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
  });
}
