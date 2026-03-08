import { motion } from "framer-motion";
import { Book } from "../../types/book";
import { useBookCover } from "../../hooks/useBookCover";

interface BookRowProps {
  book: Book;
  index: number;
  onClick: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BookRow({ book, index, onClick }: BookRowProps) {
  const { data: coverUrl } = useBookCover(book);

  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className="grid grid-cols-[1fr_80px_80px] gap-4 px-4 py-3 rounded-lg cursor-pointer hover:bg-[#1f1d18] transition-colors"
    >
      <div className="min-w-0 flex items-center gap-3">
        {/* Cover thumbnail */}
        <div className="w-8 h-10 rounded bg-[#2a2820] shrink-0 overflow-hidden">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className={`
                text-[7px] font-mono tracking-widest uppercase font-bold
                ${book.format === "pdf" ? "text-[#c85858]" : "text-[#6ab87a]"}
              `}>
                {book.format}
              </span>
            </div>
          )}
        </div>

        {/* Format badge + title */}
        <div className="min-w-0">
          <p className="text-sm text-[#f0ead8] truncate">{book.title}</p>
          <span className={`
            text-[9px] font-mono tracking-widest uppercase
            ${book.format === "pdf" ? "text-[#c85858]" : "text-[#6ab87a]"}
          `}>
            {book.format}
          </span>
        </div>
      </div>
      <p className="text-sm text-[#7a7060] self-center font-mono uppercase text-xs">
        {book.format}
      </p>
      <p className="text-sm text-[#7a7060] self-center text-right font-mono text-xs">
        {formatSize(book.file_size)}
      </p>
    </motion.div>
  );
}