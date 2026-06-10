import { useQuery } from "@tanstack/react-query";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

/**
 * Screen-resolution preview of a photo — the image the lightbox shows the instant you open it.
 *
 * A ~2560px JPEG is visually identical to the original at fit-to-screen but decodes ~10× faster,
 * which is what makes opening feel instant on low-end PCs and phones. The true full-resolution
 * original is loaded separately, only when the user zooms in.
 *
 * The Rust command returns `null` when the original is already within the preview budget; in that
 * case we hand back the original URL directly (no needless re-encode / quality loss).
 */
export function usePhotoPreview(path: string | null, maxEdge = 2560) {
  return useQuery({
    queryKey: ["photo-preview", path, maxEdge],
    queryFn: async () => {
      if (!path) return null;
      if (IS_DEMO) return path; // demo: path is already a URL
      try {
        const cachePath = await invoke<string | null>("get_photo_preview", { path, maxEdge });
        // null → original already small enough; use it directly.
        return cachePath ? convertFileSrc(cachePath) : convertFileSrc(path);
      } catch {
        // Backend command missing/failed → never leave the viewer stuck; use the original.
        return convertFileSrc(path);
      }
    },
    retry: false,
    enabled: !!path,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
  });
}
