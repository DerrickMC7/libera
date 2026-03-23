import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PdfPageInfo } from "../../../hooks/usePdfDocument";

export interface HighlightRect {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isSelected: boolean;
}

interface PdfCanvasProps {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageInfos: PdfPageInfo[];
  scale: number;
  renderScale: number;
  highlights: HighlightRect[];
  selectedHighlight: number;
  onPageChange: (page: number) => void;
  scrollToPage: number | null;
  onScrollHandled: () => void;
  onTextLayerReady: (pageNumber: number, el: HTMLDivElement) => void;
}

export function PdfCanvas({
  pdf,
  pageInfos,
  scale,
  renderScale,
  highlights,
  selectedHighlight,
  onPageChange,
  scrollToPage,
  onScrollHandled,
  onTextLayerReady,
}: PdfCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const renderingRef = useRef<Set<number>>(new Set());
  const renderedScaleRef = useRef<Map<number, number>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const zoomRatio = scale / renderScale;

  const totalHeight = pageInfos.reduce(
    (sum, p) => sum + p.height * renderScale + 16,
    0
  );

  const computeVisiblePages = useCallback(() => {
    const el = scrollRef.current;
    if (!el || pageInfos.length === 0) return new Set<number>();
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const buffer = viewHeight * 1.5;
    const visible = new Set<number>();
    for (const info of pageInfos) {
      const top = info.top * renderScale * zoomRatio;
      const bottom = top + info.height * renderScale * zoomRatio;
      if (bottom >= scrollTop - buffer && top <= scrollTop + viewHeight + buffer) {
        visible.add(info.pageNumber);
      }
    }
    return visible;
  }, [pageInfos, renderScale, zoomRatio]);

  const updateVisiblePages = useCallback(() => {
    const el = scrollRef.current;
    if (!el || pageInfos.length === 0) return;
    const visible = computeVisiblePages();
    setVisiblePages(visible);
    const scrollTop = el.scrollTop;
    for (const info of [...pageInfos].reverse()) {
      const top = info.top * renderScale * zoomRatio;
      if (top <= scrollTop + 80) {
        onPageChange(info.pageNumber);
        break;
      }
    }
  }, [computeVisiblePages, pageInfos, renderScale, zoomRatio, onPageChange]);

  useEffect(() => {
    updateVisiblePages();
  }, [updateVisiblePages]);

  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (renderingRef.current.has(pageNumber)) return;
      if (renderedScaleRef.current.get(pageNumber) === renderScale) return;
      const canvas = canvasRefs.current.get(pageNumber);
      const textDiv = textLayerRefs.current.get(pageNumber);
      if (!canvas || !textDiv) return;

      renderingRef.current.add(pageNumber);
      try {
        const page = await pdf.getPage(pageNumber);
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: renderScale * dpr });
        const viewportNormal = page.getViewport({ scale: renderScale });

        // Render canvas
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        // Render text layer
        textDiv.className = "textLayer";
        textDiv.innerHTML = "";
        textDiv.style.width = viewportNormal.width + "px";
        textDiv.style.height = viewportNormal.height + "px";

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport: viewportNormal,
        });
        await textLayer.render();

        onTextLayerReady(pageNumber, textDiv);
        renderedScaleRef.current.set(pageNumber, renderScale);
        page.cleanup();
      } finally {
        renderingRef.current.delete(pageNumber);
      }
    },
    [pdf, renderScale, onTextLayerReady]
  );

  useEffect(() => {
    renderedScaleRef.current.clear();
    renderingRef.current.clear();
  }, [renderScale]);

  useEffect(() => {
    visiblePages.forEach((pageNum) => renderPage(pageNum));
  }, [visiblePages, renderPage]);

  useEffect(() => {
    if (scrollToPage === null || pageInfos.length === 0) return;
    const info = pageInfos.find((p) => p.pageNumber === scrollToPage);
    if (!info || !scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: info.top * renderScale * zoomRatio,
      behavior: "smooth",
    });
    onScrollHandled();
  }, [scrollToPage]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto bg-[#1a1814]"
      onScroll={updateVisiblePages}
    >
      <div
        className="relative mx-auto"
        style={{
          height: totalHeight * zoomRatio,
          width: pageInfos[0]
            ? pageInfos[0].width * renderScale * zoomRatio + 64
            : "100%",
        }}
      >
        {pageInfos.map((info) => {
          const pageWidth = info.width * renderScale;
          const pageHeight = info.height * renderScale;
          const top = info.top * renderScale * zoomRatio;
          const pageHighlights = highlights.filter(
            (h) => h.pageNumber === info.pageNumber
          );

          return (
            <div
              key={info.pageNumber}
              style={{
                position: "absolute",
                top,
                left: 32,
                width: pageWidth * zoomRatio,
                height: pageHeight * zoomRatio,
                overflow: "hidden",
              }}
            >
              {/* Shadow */}
              <div
                className="absolute inset-0 rounded-sm"
                style={{ boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }}
              />

              {/* Canvas */}
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(info.pageNumber, el);
                }}
                style={{
                  display: "block",
                  width: pageWidth * zoomRatio,
                  height: pageHeight * zoomRatio,
                  imageRendering: "auto",
                }}
              />

              {/* Text layer — invisible, for search position data */}
              <div
                ref={(el) => {
                  if (el) textLayerRefs.current.set(info.pageNumber, el);
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: pageWidth,
                  height: pageHeight,
                  transformOrigin: "top left",
                  transform: `scale(${zoomRatio})`,
                  opacity: 0,
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />

              {/* Highlights */}
              {pageHighlights.map((h, i) => {
  const globalIndex = highlights.indexOf(h);
  return (
    <div
      key={i}
      style={{
        position: "absolute",
        left: h.x,
        top: h.y,
        width: h.width,
        height: h.height,
        backgroundColor:
          globalIndex === selectedHighlight
            ? "rgba(212, 135, 42, 0.75)"
            : "rgba(212, 135, 42, 0.35)",
        borderRadius: 2,
        pointerEvents: "none",
      }}
    />
  );
})}
            </div>
          );
        })}
      </div>
    </div>
  );
}