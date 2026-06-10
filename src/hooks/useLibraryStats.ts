import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export interface StorageEntry {
  label: string;
  count: number;
  size_bytes: number;
}

export interface StorageCategory {
  total_size_bytes: number;
  total_count: number;
  entries: StorageEntry[];
}

export interface LibraryStats {
  total_duration_secs: number;
  music: StorageCategory;
  videos: StorageCategory;
  books: StorageCategory;
  images: StorageCategory;
}

export function useLibraryStats() {
  return useQuery({
    queryKey: ["library-stats"],
    queryFn: () => invoke<LibraryStats>("get_library_stats"),
    staleTime: 1000 * 60 * 10,
  });
}
