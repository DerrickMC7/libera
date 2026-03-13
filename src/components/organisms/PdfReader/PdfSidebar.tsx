import { TocItem } from "../../../hooks/usePdfDocument";

interface PdfSidebarProps {
  toc: TocItem[];
  currentPage: number;
  onNavigate: (pageNumber: number) => void;
}

export function PdfSidebar({ toc, currentPage, onNavigate }: PdfSidebarProps) {
  return (
    <div className="w-56 shrink-0 bg-[#131210] border-r border-white/5 overflow-y-auto flex flex-col">
      <div className="px-4 py-3 border-b border-white/5">
        <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-[#3a3628]">
          Contents
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {toc.length === 0 && (
          <p className="text-[#3a3628] text-xs px-4 py-3">No table of contents</p>
        )}
        {toc.map((item, i) => (
          <TocNode
            key={i}
            item={item}
            currentPage={currentPage}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function TocNode({
  item,
  currentPage,
  onNavigate,
}: {
  item: TocItem;
  currentPage: number;
  onNavigate: (page: number) => void;
}) {
  const isActive = item.pageNumber === currentPage;
  const indent = item.level * 12;

  return (
    <>
      <button
        onClick={() => item.pageNumber && onNavigate(item.pageNumber)}
        disabled={!item.pageNumber}
        className={`w-full text-left px-4 py-1.5 text-[12px] transition-colors leading-snug ${
          isActive
            ? "text-[#d4872a] bg-[#d4872a]/8"
            : "text-[#7a7060] hover:text-[#c8bfa8] hover:bg-white/3"
        } ${!item.pageNumber ? "opacity-40 cursor-default" : "cursor-pointer"}`}
        style={{ paddingLeft: `${16 + indent}px`, fontFamily: "Georgia, serif" }}
      >
        {item.title}
      </button>
      {item.items.map((child, i) => (
        <TocNode
          key={i}
          item={child}
          currentPage={currentPage}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}