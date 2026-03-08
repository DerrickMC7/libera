import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  book: { path: string; title: string };
  onClose: () => void;
}

export function PdfViewer({ book, onClose }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    const url = convertFileSrc(book.path);
    pdfjsLib.getDocument(url).promise.then((pdf) => {
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      renderAllPages(pdf, scale);
    });

    return () => {
      pdfRef.current?.destroy();
    };
  }, [book.path]);

  useEffect(() => {
    if (pdfRef.current && numPages > 0) {
      renderAllPages(pdfRef.current, scale);
    }
  }, [scale, numPages]);

  async function renderAllPages(
    pdf: pdfjsLib.PDFDocumentProxy,
    pageScale: number
  ) {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: pageScale });

      const wrapper = document.createElement("div");
      wrapper.style.marginBottom = "16px";
      wrapper.style.boxShadow = "0 4px 24px rgba(0,0,0,0.5)";

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = "block";

      wrapper.appendChild(canvas);
      containerRef.current.appendChild(wrapper);

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    }
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0e0d0b] z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#161410] shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <p className="text-sm text-[#f0ead8] truncate max-w-md">{book.title}</p>
          <span className="text-xs font-mono text-[#3a3628]">{numPages} pages</span>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors cursor-pointer text-lg leading-none"
          >
            −
          </button>
          <span className="text-xs font-mono text-[#7a7060] w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.2))}
            className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors cursor-pointer text-lg leading-none"
          >
            +
          </button>
          <span className="text-xs font-mono text-[#3a3628] ml-2">Esc to close</span>
        </div>
      </div>

      {/* Scrollable pages */}
      <div className="flex-1 overflow-y-auto bg-[#1a1814] px-8 py-8">
        <div
          ref={containerRef}
          className="flex flex-col items-center"
        />
      </div>
    </div>
  );
}