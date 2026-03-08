import { useState } from "react";
import { useBooks, useScanBooks } from "../../hooks/useBooks";
import { Button } from "../atoms/Button";
import { BookRow } from "../molecules/BookRow";
import { PdfViewer } from "./PdfViewer";
import { EpubViewer } from "./EpubViewer";
import { Book } from "../../types/book";

export function BookLibrary() {
  const { data: books = [], isLoading } = useBooks();
  const { mutate: scanBooks, isPending } = useScanBooks();
  const [search, setSearch] = useState("");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  const filtered = books.filter((b) =>
    b.title.toLowerCase().includes(search.toLowerCase())
  );

  async function handleScan() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select books folder",
      });
      if (selected && typeof selected === "string") {
        scanBooks(selected);
      }
    } catch (e) {
      console.error("Dialog error:", e);
    }
  }

  if (selectedBook?.format === "pdf") {
    return (
      <PdfViewer
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    );
  }

  if (selectedBook?.format === "epub") {
    return (
      <EpubViewer
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">
      {/* Header */}
      <div className="px-10 pt-9 pb-0 sticky top-0 bg-[#0e0d0b] z-10">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#d4872a] mb-1.5">
              Your Collection
            </p>
            <h1
              className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Books <em className="italic text-[#c8bfa8] font-light">& papers</em>
            </h1>
          </div>
          <Button variant="primary" onClick={handleScan} disabled={isPending}>
            {isPending ? "Scanning..." : "Add folder"}
          </Button>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search books..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 mb-6 transition-colors"
        />

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_80px_80px] gap-4 px-4 pb-2 border-b border-white/6 text-[11px] font-mono tracking-widest uppercase text-[#3a3628]">
          <span>Title</span>
          <span>Format</span>
          <span className="text-right">Size</span>
        </div>
      </div>

      {/* Book list */}
      <div className="flex-1 overflow-y-auto px-10 py-4">
        {isLoading && (
          <p className="text-center text-[#3a3628] text-sm mt-20">
            Loading library...
          </p>
        )}

        {!isLoading && books.length === 0 && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <p className="text-[#3a3628] text-sm">Your book library is empty</p>
            <p className="text-[#3a3628] text-xs">
              Click "Add folder" to scan your books and papers
            </p>
          </div>
        )}

        {filtered.map((book, index) => (
          <BookRow
            key={book.path}
            book={book}
            index={index}
            onClick={() => setSelectedBook(book)}
          />
        ))}
      </div>
    </div>
  );
}