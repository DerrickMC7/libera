import { invoke } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Book } from "../types/book";

// Fetches all books stored in the database
export function useBooks() {
  return useQuery({
    queryKey: ["books"],
    queryFn: async () => {
      const books = await invoke<Book[]>("get_books");
      return books;
    },
  });
}

// Scans a folder and saves the results to the database
export function useScanBooks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (folderPath: string) => {
      const books = await invoke<Book[]>("scan_books", { path: folderPath });
      const saved = await invoke<number>("save_books", { books });
      return { books, saved };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["books"] });
    },
  });
}