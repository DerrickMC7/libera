import { useState, useCallback, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";

export interface SearchResult {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function usePdfSearch(pdf: pdfjsLib.PDFDocumentProxy | null) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const textLayersRef = useRef<Map<number, HTMLDivElement>>(new Map());

  function registerTextLayer(pageNumber: number, el: HTMLDivElement) {
    textLayersRef.current.set(pageNumber, el);
  }

  const search = useCallback(
    async (q: string) => {
      setQuery(q);
      setSelectedIndex(0);

      if (!pdf || !q.trim()) {
        setResults([]);
        return;
      }

      setIsSearching(true);
      const found: SearchResult[] = [];
      const normalizedQ = q.toLowerCase().trim();

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const textDiv = textLayersRef.current.get(pageNum);
        if (!textDiv) continue;

const divWidth = textDiv.offsetWidth;
const divHeight = textDiv.offsetHeight;

        const spans = Array.from(
          textDiv.querySelectorAll("span")
        ) as HTMLSpanElement[];

        interface SpanMeta {
          span: HTMLSpanElement;
          start: number;
          end: number;
        }

        const spanMetas: SpanMeta[] = [];
        let fullText = "";

        for (const span of spans) {
          const text = span.textContent || "";
          spanMetas.push({
            span,
            start: fullText.length,
            end: fullText.length + text.length,
          });
          fullText += text;
        }

        const lowerText = fullText.toLowerCase();
        let searchFrom = 0;

        while (true) {
          const matchIndex = lowerText.indexOf(normalizedQ, searchFrom);
          if (matchIndex === -1) break;
          const matchEnd = matchIndex + normalizedQ.length;

          const overlapping = spanMetas.filter(
            (sm) => sm.end > matchIndex && sm.start < matchEnd
          );

       for (const sm of overlapping) {
  const spanRect = sm.span.getBoundingClientRect();
  const divRect = textDiv.getBoundingClientRect();

  const spanText = sm.span.textContent || "";
  const spanWidth = spanRect.width;
  const spanHeight = spanRect.height;

  const overlapStart = Math.max(matchIndex, sm.start) - sm.start;
  const overlapEnd = Math.min(matchEnd, sm.end) - sm.start;
  const charWidth = spanText.length > 0 ? spanWidth / spanText.length : spanWidth;

  const xOffset = overlapStart * charWidth;
  const w = (overlapEnd - overlapStart) * charWidth;
  if (w <= 0) continue;

  found.push({
    pageNumber: pageNum,
    x: spanRect.left - divRect.left + xOffset,
    y: spanRect.top - divRect.top,
    width: w,
    height: spanHeight,
  });
}

          searchFrom = matchIndex + 1;
        }
      }

      setResults(found);
      setSelectedIndex(0);
      setIsSearching(false);
    },
    [pdf]
  );

  function next() {
    if (!results.length) return;
    setSelectedIndex((i) => (i + 1) % results.length);
  }

  function prev() {
    if (!results.length) return;
    setSelectedIndex((i) => (i - 1 + results.length) % results.length);
  }

  function clear() {
    setQuery("");
    setResults([]);
    setSelectedIndex(0);
  }

  return {
    query,
    results,
    selectedIndex,
    isSearching,
    search,
    next,
    prev,
    clear,
    registerTextLayer,
  };
}