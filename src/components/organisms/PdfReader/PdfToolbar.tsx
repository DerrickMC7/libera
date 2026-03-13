interface PdfToolbarProps {
  title: string;
  currentPage: number;
  totalPages: number;
  zoom: number;
  tocVisible: boolean;
  hasToc: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleToc: () => void;
  onPopOut: () => void;
  onClose: () => void;
  onOpenSearch: () => void;
}

export function PdfToolbar({
  title, currentPage, totalPages, zoom,
  tocVisible, hasToc,
  onZoomIn, onZoomOut, onToggleToc, onPopOut, onClose, onOpenSearch,
}: PdfToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-[#161410] border-b border-white/5 shrink-0">
      {/* Back button */}
      <button
        onClick={onClose}
        className="flex items-center gap-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors mr-1"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
        </svg>
        <span className="text-xs font-mono">Books</span>
      </button>

      <div className="w-px h-4 bg-white/8" />

      {/* TOC toggle */}
      {hasToc && (
        <button
          onClick={onToggleToc}
          className={`p-1.5 rounded transition-colors ${tocVisible ? "text-[#d4872a]" : "text-[#7a7060] hover:text-[#c8bfa8]"}`}
          title="Table of contents"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z"/>
          </svg>
        </button>
      )}

      {/* Title */}
      <span
        className="flex-1 text-[13px] text-[#c8bfa8] truncate"
        style={{ fontFamily: "Georgia, serif" }}
      >
        {title}
      </span>

      {/* Page info */}
      <span className="text-[11px] font-mono text-[#3a3628] shrink-0">
        {currentPage} / {totalPages}
      </span>

      <div className="w-px h-4 bg-white/8" />

      {/* Search */}
      <button
        onClick={onOpenSearch}
        className="p-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
        title="Search (Ctrl+F)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
      </button>

      {/* Zoom */}
      <button onClick={onZoomOut} className="p-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors text-lg leading-none">−</button>
      <span className="text-[11px] font-mono text-[#7a7060] w-10 text-center">{Math.round(zoom * 100)}%</span>
      <button onClick={onZoomIn} className="p-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors text-lg leading-none">+</button>

      <div className="w-px h-4 bg-white/8" />

      {/* Pop out */}
      <button
        onClick={onPopOut}
        className="p-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
        title="Open in separate window"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
        </svg>
      </button>
    </div>
  );
}