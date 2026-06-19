import { lazy, Suspense } from "react";
import { Book } from "../../types/book";

// The book readers pull in heavy parsers — pdfjs-dist (multiple MB) and epubjs — that
// most sessions never touch. Loading them statically anywhere that's always mounted
// (BookLibrary, SearchPage) drags those parsers into the initial bundle. These wrappers
// code-split each reader into its own chunk, fetched only when a book is actually
// opened. Both call sites import the same dynamic target, so they share one chunk.
const PdfReaderInner = lazy(() => import("./PdfReader/PdfReader").then((m) => ({ default: m.PdfReader })));
const EpubViewerInner = lazy(() => import("./EpubViewer").then((m) => ({ default: m.EpubViewer })));

interface ReaderProps {
  book: Book;
  onClose: () => void;
}

function ReaderLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[#0e0d0b]">
      <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function LazyPdfReader(props: ReaderProps) {
  return (
    <Suspense fallback={<ReaderLoading />}>
      <PdfReaderInner {...props} />
    </Suspense>
  );
}

export function LazyEpubViewer(props: ReaderProps) {
  return (
    <Suspense fallback={<ReaderLoading />}>
      <EpubViewerInner {...props} />
    </Suspense>
  );
}
