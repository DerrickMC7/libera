import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import { Book } from "../types/book";

export function useBookCover(book: Book | undefined) {
  return useQuery({
    queryKey: ["book-cover", book?.path],
    queryFn: async () => {
      if (!book) return null;

      if (book.format === "epub") {
        const cachePath = await invoke<string | null>("get_epub_cover", {
          bookPath: book.path,
        });
        if (!cachePath) return null;
        return convertFileSrc(cachePath);
      }

      // PDF covers are handled by PDF.js in the viewer
      // For the library thumbnail we return null and show a generic icon
      return null;
    },
    enabled: !!book,
    staleTime: Infinity,
  });
}