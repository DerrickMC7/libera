import { motion } from "framer-motion";
import { Book } from "../../types/book";

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
  return (
    <motion.div
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: index * 0.02 }}
      className="grid grid-cols-[1fr_80px_80px] gap-4 px-4 py-3 rounded-lg cursor-pointer hover:bg-[#1f1d18] transition-colors"
    >
      <div className="min-w-0 flex items-center gap-3">
        {/* Format badge */}
        <span className={`
          text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded shrink-0
          ${book.format === "pdf"
            ? "bg-[rgba(200,88,88,0.15)] text-[#c85858]"
            : "bg-[rgba(106,184,122,0.15)] text-[#6ab87a]"
          }
        `}>
          {book.format}
        </span>
        <p className="text-sm text-[#f0ead8] truncate">{book.title}</p>
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