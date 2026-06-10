import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Track } from "../types/track";

export interface LyricsResult {
  synced_lrc: string | null;
  plain_text: string | null;
  source: "embedded" | "lrclib" | "manual" | "not_found";
}

export function useLyrics(track: Track | null) {
  return useQuery<LyricsResult>({
    queryKey: ["lyrics", track?.path],
    queryFn: () =>
      invoke<LyricsResult>("get_lyrics", {
        trackPath: track!.path,
        artist: track!.artist,
        title: track!.title,
        album: track!.album,
        duration: track!.duration_secs,
      }),
    enabled: !!track,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });
}

export function useSetLyrics(trackPath: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      invoke("set_lyrics", { trackPath, text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lyrics", trackPath] });
    },
  });
}
