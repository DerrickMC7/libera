import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Album } from "../types/album";

export function useAlbums() {
  return useQuery({
    queryKey: ["albums"],
    queryFn: () => invoke<Album[]>("get_albums"),
    staleTime: 1000 * 60 * 5,
  });
}