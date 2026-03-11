import { useEffect, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface PdfViewerProps {
  book: { path: string; title: string };
  onClose: () => void;
}

export function PdfViewer({ book, onClose }: PdfViewerProps) {
  const createdRef = useRef(false);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;

    const encodedPath = encodeURIComponent(book.path);
    const encodedTitle = encodeURIComponent(book.title);
    const url = `pdf-viewer.html?path=${encodedPath}&title=${encodedTitle}`;

    const webview = new WebviewWindow("pdf-viewer", {
      url,
      title: book.title,
      width: 1100,
      height: 850,
      resizable: true,
    });

    webview.once("tauri://created", () => onClose());
    webview.once("tauri://error", (e) => {
      console.error("Webview error:", e);
      onClose();
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-[#1a1814] z-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-[#f0ead8] text-sm mb-2">Opening PDF viewer...</p>
        <p className="text-[#3a3628] text-xs font-mono truncate max-w-xs">{book.title}</p>
      </div>
    </div>
  );
}