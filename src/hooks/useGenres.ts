import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Genre } from "../types/genre";

export type GenreSortBy = "name" | "count";

export function useGenres(search: string = "", enabled = true, sortBy: GenreSortBy = "name") {
  return useQuery({
    queryKey: ["genres", search, sortBy],
    queryFn: () => invoke<Genre[]>("search_genres", { query: search, sortBy }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}
