import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export interface GenreStat {
  name: string;
  albums: number;
  artists: number;
}

export function useGenreStats(enabled = true) {
  return useQuery({
    queryKey: ["genre-stats"],
    queryFn: () => invoke<GenreStat[]>("get_genre_stats"),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

export interface GenreCooccurrence {
  a: string;
  b: string;
  shared: number;
}

export function useGenreCooccurrence(enabled = true, minShared = 1) {
  return useQuery({
    queryKey: ["genre-cooccurrence", minShared],
    queryFn: () => invoke<GenreCooccurrence[]>("get_genre_cooccurrence", { minShared }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}
