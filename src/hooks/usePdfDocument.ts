import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
  top: number; // accumulated offset from top
}

export interface TocItem {
  title: string;
  pageNumber: number | null;
  items: TocItem[];
  level: number;
}

export function usePdfDocument(filePath: string | null) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageInfos, setPageInfos] = useState<PdfPageInfo[]>([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!filePath) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    async function load() {
      try {
const w = window as any;
const assetUrl = w.__TAURI_INTERNALS__
  ? w.__TAURI_INTERNALS__.convertFileSrc(filePath!)
  : filePath!;

        const loadingTask = pdfjsLib.getDocument(assetUrl);
        const doc = await loadingTask.promise;
        if (cancelled) { doc.destroy(); return; }

        docRef.current = doc;
        setPdf(doc);

        // Build page layout info at scale 1.0
        const infos: PdfPageInfo[] = [];
        let top = 0;
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1.0 });
          infos.push({ pageNumber: i, width: vp.width, height: vp.height, top });
          top += vp.height + 16; // 16px gap between pages
          page.cleanup();
        }
        if (!cancelled) setPageInfos(infos);

        // Load TOC
        try {
          const outline = await doc.getOutline();
          if (outline && !cancelled) {
            const items = await resolveOutline(doc, outline, 0);
            setToc(items);
          }
        } catch { /* no TOC */ }

        if (!cancelled) setIsLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setIsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [filePath]);

  return { pdf, pageInfos, toc, isLoading, error };
}

async function resolveOutline(
  doc: pdfjsLib.PDFDocumentProxy,
  outline: any[],
  level: number
): Promise<TocItem[]> {
  const items: TocItem[] = [];
  for (const item of outline) {
    let pageNumber: number | null = null;
    try {
      if (item.dest) {
        const dest = typeof item.dest === "string"
          ? await doc.getDestination(item.dest)
          : item.dest;
        if (dest && dest[0]) {
          const ref = dest[0];
          pageNumber = await doc.getPageIndex(ref) + 1;
        }
      }
    } catch { /* skip */ }

    items.push({
      title: item.title,
      pageNumber,
      level,
      items: item.items?.length
        ? await resolveOutline(doc, item.items, level + 1)
        : [],
    });
  }
  return items;
}