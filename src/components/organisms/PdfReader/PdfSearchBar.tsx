import { useEffect, useRef } from "react";

interface PdfSearchBarProps {
  query: string;
  resultCount: number;
  selectedIndex: number;
  isSearching: boolean;
  visible: boolean;
  onSearch: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function PdfSearchBar({
  query,
  resultCount,
  selectedIndex,
  isSearching,
  visible,
  onSearch,
  onNext,
  onPrev,
  onClose,
}: PdfSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="flex items-center gap-3 px-5 py-2 bg-[#161410] border-b border-white/5 shrink-0">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="#7a7060" className="shrink-0">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.shiftKey ? onPrev() : onNext();
          if (e.key === "Escape") onClose();
        }}
        placeholder="Search in document..."
        className="flex-1 max-w-xs bg-[#2a2820] border border-white/8 rounded-md px-3 py-1.5 text-[13px] text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[#d4872a]/40 transition-colors"
        style={{ fontFamily: "Georgia, serif" }}
      />

      <span className="text-[11px] font-mono text-[#3a3628] min-w-[60px]">
        {isSearching
          ? "Searching..."
          : query && resultCount === 0
          ? "No results"
          : query
          ? `${selectedIndex + 1} / ${resultCount}`
          : ""}
      </span>

      <button
        onClick={onPrev}
        disabled={resultCount === 0}
        className="p-1 text-[#7a7060] hover:text-[#c8bfa8] disabled:opacity-30 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
        </svg>
      </button>

      <button
        onClick={onNext}
        disabled={resultCount === 0}
        className="p-1 text-[#7a7060] hover:text-[#c8bfa8] disabled:opacity-30 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
        </svg>
      </button>

      <button
        onClick={onClose}
        className="p-1 text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
  );
}