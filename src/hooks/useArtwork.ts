import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

// Shared cache-bust token for artwork URLs. The cache file path is content-stable
// per album (album-hashed), so a per-call Date.now() forced the browser to re-fetch
// and re-decode the SAME jpeg once per track sharing that album. Instead we key the
// bust on this epoch, which only changes when artwork is actually edited — so
// identical album art resolves to one URL the browser can cache, while edits still
// invalidate it. Call bumpArtworkEpoch() wherever artwork is changed, right before
// resetting/invalidating the ["artwork"] query (which re-runs the queryFn below).
let artworkEpoch = Date.now();
export function bumpArtworkEpoch() {
  artworkEpoch = Date.now();
}

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
      return `${convertFileSrc(cachePath)}?v=${artworkEpoch}`;
    },
    enabled: !!trackPath,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
  });
}