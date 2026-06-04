import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Album } from "../types/album";

export type AlbumSortBy = "name" | "artist";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortAlbums(albums: Album[], sortBy: AlbumSortBy): Album[] {
  const copy = [...albums];
  if (sortBy === "artist") {
    return copy.sort((a, b) =>
      collator.compare(a.artist, b.artist) || collator.compare(a.album, b.album)
    );
  }
  return copy.sort((a, b) => collator.compare(a.album, b.album));
}

export function useAlbums(search: string = "", enabled = true, sortBy: AlbumSortBy = "name") {
  return useQuery({
    queryKey: ["albums", search, sortBy],
    queryFn: () =>
      invoke<Album[]>("search_albums", { query: search }).then((albums) =>
        sortAlbums(albums, sortBy)
      ),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}
