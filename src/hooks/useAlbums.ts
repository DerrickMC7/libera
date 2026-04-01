import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Album } from "../types/album";

export function useAlbums(search: string = "", enabled: boolean = true) {
  return useQuery({
    queryKey: ["albums", search],
    queryFn: () => invoke<Album[]>("search_albums", { query: search }).then(albums => albums.sort((a, b) => a.album.localeCompare(b.album))),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}
