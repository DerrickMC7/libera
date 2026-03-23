import { useState, useCallback, useEffect, useRef } from "react";
import { Book } from "../../../types/book";
import { usePdfDocument } from "../../../hooks/usePdfDocument";
import { usePdfSearch } from "../../../hooks/usePdfSearch";
import { PdfToolbar } from "./PdfToolbar";
import { PdfSidebar } from "./PdfSidebar";
import { PdfCanvas } from "./PdfCanvas";
import { PdfSearchBar } from "./PdfSearchBar";

interface PdfReaderProps {
  book: Book;
  onClose: () => void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;
const INITIAL_ZOOM = 1.2;
const RENDER_DEBOUNCE = 600;

export function PdfReader({ book, onClose }: PdfReaderProps) {
  const [scale, setScale] = useState(INITIAL_ZOOM);
  const [renderScale, setRenderScale] = useState(INITIAL_ZOOM);
  const [tocVisible, setTocVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [scrollToPage, setScrollToPage] = useState<number | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { pdf, pageInfos, toc, isLoading, error } = usePdfDocument(book.path);

const {
  query, results, selectedIndex, isSearching,
  search, next, prev, clear, registerTextLayer,
} = usePdfSearch(pdf);

  

  // Convert search results to highlight rects
  const highlights = results.map((r, i) => ({
    pageNumber: r.pageNumber,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    isSelected: i === selectedIndex,
  }));

  // When selected result changes, scroll to that page
  useEffect(() => {
    if (results.length > 0 && results[selectedIndex]) {
      setScrollToPage(results[selectedIndex].pageNumber);
    }
  }, [selectedIndex, results]);

  // Zoom logic
  const clampZoom = (z: number) =>
    Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;

  function scheduleRender(newScale: number) {
    setScale(newScale);
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(() => {
      setRenderScale(newScale);
    }, RENDER_DEBOUNCE);
  }

  function zoomIn() {
    scheduleRender(clampZoom(scale + ZOOM_STEP));
  }

  function zoomOut() {
    scheduleRender(clampZoom(scale - ZOOM_STEP));
  }

  // Ctrl+scroll zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale((prev) => {
        const next = clampZoom(prev + delta);
        if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
        renderTimerRef.current = setTimeout(() => setRenderScale(next), RENDER_DEBOUNCE);
        return next;
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inInput = (e.target as HTMLElement)?.tagName === "INPUT";
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
        return;
      }
      if (!inInput) {
        if (e.key === "+" || e.key === "=") zoomIn();
        if (e.key === "-") zoomOut();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scale]);

  // Pop out
  async function handlePopOut() {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const encodedPath = encodeURIComponent(book.path);
    const encodedTitle = encodeURIComponent(book.title);
    const url = `pdf-viewer.html?path=${encodedPath}&title=${encodedTitle}`;
    new WebviewWindow("pdf-viewer-popup", {
      url,
      title: book.title,
      width: 1100,
      height: 850,
      resizable: true,
    });
  }

  function handleCloseSearch() {
    setSearchVisible(false);
    clear();
  }

  const handleScrollHandled = useCallback(() => {
    setScrollToPage(null);
  }, []);

  // Loading / error states
  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-[#0e0d0b]">
        <PdfToolbar
          title={book.title}
          currentPage={0}
          totalPages={0}
          zoom={scale}
          tocVisible={tocVisible}
          hasToc={false}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onToggleToc={() => setTocVisible((v) => !v)}
          onPopOut={handlePopOut}
          onClose={onClose}
          onOpenSearch={() => setSearchVisible(true)}
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#3a3628] text-sm font-mono">Loading document...</p>
        </div>
      </div>
    );
  }

  if (error || !pdf) {
    return (
      <div className="flex flex-col h-full bg-[#0e0d0b]">
        <PdfToolbar
          title={book.title}
          currentPage={0}
          totalPages={0}
          zoom={scale}
          tocVisible={tocVisible}
          hasToc={false}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onToggleToc={() => setTocVisible((v) => !v)}
          onPopOut={handlePopOut}
          onClose={onClose}
          onOpenSearch={() => setSearchVisible(true)}
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#c85858] text-sm font-mono">{error ?? "Failed to load document"}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-[#0e0d0b]">
      <PdfToolbar
        title={book.title}
        currentPage={currentPage}
        totalPages={pdf.numPages}
        zoom={scale}
        tocVisible={tocVisible}
        hasToc={toc.length > 0}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onToggleToc={() => setTocVisible((v) => !v)}
        onPopOut={handlePopOut}
        onClose={onClose}
        onOpenSearch={() => setSearchVisible(true)}
      />

      <PdfSearchBar
        query={query}
        resultCount={results.length}
        selectedIndex={selectedIndex}
        isSearching={isSearching}
        visible={searchVisible}
        onSearch={search}
        onNext={next}
        onPrev={prev}
        onClose={handleCloseSearch}
      />

      <div className="flex flex-1 overflow-hidden">
        {tocVisible && toc.length > 0 && (
          <PdfSidebar
            toc={toc}
            currentPage={currentPage}
            onNavigate={(page) => setScrollToPage(page)}
          />
        )}

        <PdfCanvas
  pdf={pdf}
  pageInfos={pageInfos}
  scale={scale}
  renderScale={renderScale}
  highlights={highlights}
  selectedHighlight={selectedIndex}
  onPageChange={setCurrentPage}
  scrollToPage={scrollToPage}
  onScrollHandled={handleScrollHandled}
  onTextLayerReady={registerTextLayer}
/>
      </div>
    </div>
  );
}