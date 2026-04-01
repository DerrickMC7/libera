import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Genre } from "../types/genre";

export function useGenres(search: string = "", enabled: boolean = true) {
  return useQuery({
    queryKey: ["genres", search],
    queryFn: () => invoke<Genre[]>("search_genres", { query: search }),
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}