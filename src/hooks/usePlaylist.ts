import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Playlist } from "../types/playlist";
import { Track } from "../types/track";

export function usePlaylists() {
  return useQuery<Playlist[]>({
    queryKey: ["playlists"],
    queryFn: () => invoke("get_playlists"),
    staleTime: 1000 * 60 * 5,
  });
}

export function usePlaylistTracks(playlistId: number | null) {
  return useQuery<Track[]>({
    queryKey: ["playlist-tracks", playlistId],
    queryFn: () => invoke("get_playlist_tracks", { playlistId }),
    enabled: playlistId !== null,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => invoke<number>("create_playlist", { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playlists"] }),
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playlistId: number) => invoke("delete_playlist", { playlistId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playlists"] }),
  });
}

export function useRenamePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, name }: { playlistId: number; name: string }) =>
      invoke("rename_playlist", { playlistId, name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playlists"] }),
  });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackPaths }: { playlistId: number; trackPaths: string[] }) =>
      invoke("add_tracks_to_playlist", { playlistId, trackPaths }),
    onSuccess: (_data, { playlistId }) => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist-tracks", playlistId] });
    },
  });
}

export function useRemoveFromPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackPath }: { playlistId: number; trackPath: string }) =>
      invoke("remove_from_playlist", { playlistId, trackPath }),
    onSuccess: (_data, { playlistId }) => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist-tracks", playlistId] });
    },
  });
}

export function useSetPlaylistCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, imageBase64 }: { playlistId: number; imageBase64: string }) =>
      invoke("set_playlist_cover", { playlistId, imageBase64 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playlists"] }),
  });
}

export function useReorderPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      playlistId,
      trackPath,
      newPosition,
    }: {
      playlistId: number;
      trackPath: string;
      newPosition: number;
    }) => invoke("reorder_playlist_track", { playlistId, trackPath, newPosition }),
    onSuccess: (_data, { playlistId }) => {
      qc.invalidateQueries({ queryKey: ["playlist-tracks", playlistId] });
    },
  });
}
