import { Book } from "../../types/book";

interface EpubViewerProps {
  book: Book;
  onClose: () => void;
}

export function EpubViewer({ book, onClose }: EpubViewerProps) {
  return (
    <div className="fixed inset-0 bg-[#1a1814] z-50 flex flex-col">
      <div className="flex items-center px-6 py-4 border-b border-white/5 bg-[#161410]">
        <button
          onClick={onClose}
          className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <p className="text-sm text-[#f0ead8] truncate max-w-md ml-4">{book.title}</p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-[#2a2820] flex items-center justify-center">
          <span className="text-xs font-mono text-[#6ab87a] tracking-widest uppercase font-bold">
            epub
          </span>
        </div>
        <p className="text-[#f0ead8] text-sm">EPUB reader coming soon</p>
        <p className="text-[#3a3628] text-xs text-center max-w-xs">
          Full EPUB support is on the roadmap. Use your system reader in the meantime.
        </p>
      </div>
    </div>
  );
}