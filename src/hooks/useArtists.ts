import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Artist, ArtistAlbum } from "../types/artist";

export function useArtists(search: string = "", enabled: boolean = true) {
  return useQuery({
    queryKey: ["artists", search],
    queryFn: () => invoke<Artist[]>("search_artists", { query: search }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

export function useArtistDetails(artist: string | null) {
  return useQuery({
    queryKey: ["artist-details", artist],
    queryFn: () => invoke<ArtistAlbum[]>("get_artist_details", { artist }),
    staleTime: 1000 * 60 * 5,
    enabled: !!artist,
  });
}