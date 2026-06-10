import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

export function usePhotoThumbnail(path: string | null) {
  return useQuery({
    queryKey: ["photo-thumb", path],
    queryFn: async () => {
      if (!path) return null;
      if (IS_DEMO) return path; // demo: path is already a URL
      const cachePath = await invoke<string | null>("get_photo_thumbnail", { path });
      return cachePath ? convertFileSrc(cachePath) : null;
    },
    enabled: !!path,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
  });
}
