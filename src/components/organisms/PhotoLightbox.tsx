import { useState, useEffect, useRef, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { Photo } from "../../types/photo";
import { usePhotoStore } from "../../store/photoStore";
import { useTogglePhotoFavorite, usePhotoMetadata, useAddPhotoTag, useRemovePhotoTag, useUpdatePhotoNotes, useSetPhotoRating, useAllPhotoTags, usePhotoCollections, useAddPhotosToCollection, useCreatePhotoCollection } from "../../hooks/usePhotos";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";
import { usePhotoPreview } from "../../hooks/usePhotoPreview";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "Unknown";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function getImageSrc(photo: Photo): string {
  return IS_DEMO ? photo.path : convertFileSrc(photo.path);
}

export function PhotoLightbox() {
  const { lightboxOpen, lightboxPhotos, lightboxIndex, closeLightbox, setLightboxIndex } = usePhotoStore();
  const [showInfo, setShowInfo] = useState(false);
  // Zoom/pan/drag live in refs — bypasses React render on every scroll/drag tick
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const rotationRef = useRef(0);
  const [zoomDisplay, setZoomDisplay] = useState(1); // debounced, toolbar only
  const zoomDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowSpeed, setSlideshowSpeed] = useState(4);
  const [slideshowLoop, setSlideshowLoop] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [copied, setCopied] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const transformRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { mutate: toggleFavorite } = useTogglePhotoFavorite();
  const { mutate: addTag } = useAddPhotoTag();
  const { mutate: removeTag } = useRemovePhotoTag();
  const { mutate: updateNotes } = useUpdatePhotoNotes();
  const { mutate: setRating } = useSetPhotoRating();
  const { data: allTags = [] } = useAllPhotoTags();
  const { data: collections = [] } = usePhotoCollections();
  const { mutate: addToCollection } = useAddPhotosToCollection();
  const { mutate: createCollection, isPending: isCreatingCol } = useCreatePhotoCollection();
  const [newTagInput, setNewTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [notesValue, setNotesValue] = useState<string>("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [newColInput, setNewColInput] = useState("");
  const [showNewCol, setShowNewCol] = useState(false);
  const [addedToCol, setAddedToCol] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIndex, setCompareIndex] = useState<number | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [histogram, setHistogram] = useState<{ r: number[]; g: number[]; b: number[] } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [wantFull, setWantFull] = useState(false);

  const photo = lightboxPhotos[lightboxIndex] ?? null;
  const { data: meta } = usePhotoMetadata(showInfo && photo ? photo.path : null);
  const { data: thumbUrl } = usePhotoThumbnail(photo?.path ?? null);
  const { data: previewUrl } = usePhotoPreview(photo?.path ?? null);

  // Extract color palette and histogram from the current image via canvas
  useEffect(() => {
    if (!showInfo || !photo) { setPalette([]); setHistogram(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = 80;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // k-means palette extraction (k=6)
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      const k = 6;
      let centers: [number, number, number][] = [];
      for (let j = 0; j < k; j++) centers.push(pixels[Math.floor((j / k) * pixels.length)]);
      for (let iter = 0; iter < 8; iter++) {
        const sums: [number, number, number, number][] = Array.from({ length: k }, () => [0, 0, 0, 0]);
        for (const [r, g, b] of pixels) {
          let best = 0, bestDist = Infinity;
          for (let ci = 0; ci < k; ci++) {
            const dr = r - centers[ci][0], dg = g - centers[ci][1], db = b - centers[ci][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < bestDist) { bestDist = d; best = ci; }
          }
          sums[best][0] += r; sums[best][1] += g; sums[best][2] += b; sums[best][3]++;
        }
        centers = sums.map(([sr, sg, sb, n]) =>
          n > 0 ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : [128, 128, 128]
        );
      }
      setPalette(centers.map(([r, g, b]) => `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`));

      // Histogram
      const rBins = new Array(32).fill(0);
      const gBins = new Array(32).fill(0);
      const bBins = new Array(32).fill(0);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        rBins[Math.floor(data[i] / 8)]++;
        gBins[Math.floor(data[i + 1] / 8)]++;
        bBins[Math.floor(data[i + 2] / 8)]++;
      }
      setHistogram({ r: rBins, g: gBins, b: bBins });
    };
    img.onerror = () => { setPalette([]); setHistogram(null); };
    // Use the cached thumbnail (decodes instantly) — an 80×80 canvas sample needs no more.
    img.src = thumbUrl ?? getImageSrc(photo);
  }, [showInfo, photo?.path, thumbUrl]);

  // Applies zoom/pan/rotation directly to DOM — zero React re-render overhead
  const applyTransform = useCallback(() => {
    const z = zoomRef.current;
    const { x, y } = panRef.current;
    const r = rotationRef.current;
    const t = `scale(${z}) translate(${x / z}px, ${y / z}px) rotate(${r}deg)`;
    if (transformRef.current) transformRef.current.style.transform = t;
    if (imageContainerRef.current) {
      imageContainerRef.current.style.cursor = z > 1 ? (isDraggingRef.current ? "grabbing" : "grab") : "default";
    }
    if (zoomDisplayTimerRef.current) clearTimeout(zoomDisplayTimerRef.current);
    zoomDisplayTimerRef.current = setTimeout(() => setZoomDisplay(zoomRef.current), 80);
  }, []);

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    rotationRef.current = 0;
    setRotation(0);
    setZoomDisplay(1);
    applyTransform();
  }, [applyTransform]);

  // Sync notes textarea when metadata loads or photo changes
  useEffect(() => {
    setNotesValue(meta?.notes ?? "");
    setNotesSaved(false);
  }, [meta?.notes, photo?.path]);

  // Reset adjustments on photo change
  useEffect(() => {
    setBrightness(100); setContrast(100); setSaturation(100);
  }, [photo?.path]);

  // Reset zoom/pan/rotation and full-image flag when photo changes
  useEffect(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    rotationRef.current = 0;
    setZoomDisplay(1);
    setPreviewLoaded(false);
    setFullLoaded(false);
    setWantFull(false);
    applyTransform();
  }, [photo?.path, applyTransform]);

  // Safety backstop: if the preview hasn't loaded shortly after opening a photo, load the full
  // original directly — so the viewer is NEVER stuck on the blurred thumbnail.
  useEffect(() => {
    if (!photo || previewLoaded || wantFull) return;
    const t = setTimeout(() => setWantFull(true), 700);
    return () => clearTimeout(t);
  }, [photo?.path, previewLoaded, wantFull]);

  // Prefetch neighbour previews + thumbnails so arrow navigation is instant.
  // Delayed so the CURRENT photo's preview grabs the decode permits first (avoids the open
  // stalling behind neighbour decodes).
  useEffect(() => {
    if (IS_DEMO || !lightboxOpen) return;
    const timer = setTimeout(() => {
      const idxs = [lightboxIndex + 1, lightboxIndex - 1].filter((i) => i >= 0 && i < lightboxPhotos.length);
      for (const i of idxs) {
        const p = lightboxPhotos[i];
        if (!p) continue;
        qc.prefetchQuery({
          queryKey: ["photo-preview", p.path, 2560],
          queryFn: async () => {
            try {
              const cp = await invoke<string | null>("get_photo_preview", { path: p.path, maxEdge: 2560 });
              return cp ? convertFileSrc(cp) : convertFileSrc(p.path);
            } catch {
              return convertFileSrc(p.path);
            }
          },
          staleTime: Infinity,
        });
        qc.prefetchQuery({
          queryKey: ["photo-thumb", p.path],
          queryFn: async () => {
            const cp = await invoke<string | null>("get_photo_thumbnail", { path: p.path });
            return cp ? convertFileSrc(cp) : null;
          },
          staleTime: Infinity,
        });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [lightboxOpen, lightboxIndex, lightboxPhotos, qc]);

  const goPrev = useCallback(() => {
    if (lightboxIndex > 0) { setLightboxIndex(lightboxIndex - 1); resetZoom(); }
  }, [lightboxIndex, lightboxPhotos, setLightboxIndex, resetZoom]);

  const goNext = useCallback(() => {
    if (lightboxIndex < lightboxPhotos.length - 1) {
      setLightboxIndex(lightboxIndex + 1); resetZoom();
    } else if (slideshowLoop) {
      setLightboxIndex(0); resetZoom();
    } else {
      setSlideshowActive(false);
    }
  }, [lightboxIndex, lightboxPhotos, setLightboxIndex, resetZoom, slideshowLoop]);

  // Slideshow auto-advance
  useEffect(() => {
    if (!slideshowActive) return;
    const id = setInterval(() => goNext(), slideshowSpeed * 1000);
    return () => clearInterval(id);
  }, [slideshowActive, slideshowSpeed, goNext]);

  function copyPath() {
    if (!photo) return;
    navigator.clipboard.writeText(photo.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function printPhoto() {
    if (!photo) return;
    const src = getImageSrc(photo);
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${photo.name}</title><style>
      body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: white; }
      img { max-width: 100%; max-height: 100vh; object-fit: contain; }
      @media print { body { margin: 0; } img { width: 100%; height: auto; } }
    </style></head><body><img src="${src}" onload="window.print(); window.close();" /></body></html>`);
    win.document.close();
  }

  async function revealInExplorer() {
    if (!photo || IS_DEMO) return;
    const { invoke } = await import("@tauri-apps/api/core");
    invoke("reveal_in_explorer", { path: photo.path }).catch(console.error);
  }

  async function openWithSystem() {
    if (!photo || IS_DEMO) return;
    const { openPath } = await import("@tauri-apps/plugin-opener");
    openPath(photo.path).catch(console.error);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      lightboxRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function downloadPhoto() {
    if (!photo) return;
    if (IS_DEMO) {
      const a = document.createElement("a");
      a.href = photo.path;
      a.download = photo.name;
      a.target = "_blank";
      a.click();
    }
  }

  // Clamps pan (in screen pixels) so the image edge never goes past the viewport center,
  // preventing the image from being dragged fully out of view.
  const clampPan = useCallback((x: number, y: number, z: number): { x: number; y: number } => {
    if (!imageContainerRef.current || z <= 1) return { x: 0, y: 0 };
    const cW = imageContainerRef.current.clientWidth;
    const cH = imageContainerRef.current.clientHeight;
    // Compute the image's rendered size at zoom=1 (object-contain within container)
    let rendW = cW, rendH = cH;
    if (photo?.width && photo?.height) {
      const aspect = photo.width / photo.height;
      if (aspect > cW / cH) { rendW = cW; rendH = cW / aspect; }
      else { rendH = cH; rendW = cH * aspect; }
    }
    const maxX = Math.max(0, (z * rendW - cW) / 2);
    const maxY = Math.max(0, (z * rendH - cH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, [photo]);

  const zoomIn = useCallback(() => {
    zoomRef.current = Math.min(zoomRef.current * 1.25, 10);
    // Once the user zooms past fit-to-screen, fetch the true full-resolution original.
    if (zoomRef.current > 1.01) setWantFull(true);
    applyTransform();
  }, [applyTransform]);

  const zoomOut = useCallback(() => {
    zoomRef.current = Math.max(zoomRef.current / 1.25, 1);
    panRef.current = zoomRef.current <= 1
      ? { x: 0, y: 0 }
      : clampPan(panRef.current.x, panRef.current.y, zoomRef.current);
    applyTransform();
  }, [applyTransform, clampPan]);

  useEffect(() => {
    if (!lightboxOpen) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape": closeLightbox(); break;
        case "ArrowLeft": goPrev(); break;
        case "ArrowRight": goNext(); break;
        case "+": case "=": zoomIn(); break;
        case "-": zoomOut(); break;
        case "0": resetZoom(); break;
        case "i": case "I": setShowInfo((v) => !v); break;
        case "s": case "S": setSlideshowActive((v) => !v); break;
        case "r": case "R": {
          rotationRef.current = (rotationRef.current + 90) % 360;
          setRotation(rotationRef.current);
          applyTransform();
          break;
        }
        case "c": case "C": if (photo) copyPath(); break;
        case "f": case "F":
          if (photo) toggleFavorite({ path: photo.path });
          break;
        case "1": case "2": case "3": case "4": case "5":
          if (photo) {
            const star = Number(e.key);
            setRating({ path: photo.path, rating: star === photo.rating ? 0 : star });
          }
          break;
        case "p": case "P": printPhoto(); break;
        case "x": case "X": setCompareMode((v) => !v); break;
        case "g": case "G": toggleFullscreen(); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, goPrev, goNext, zoomIn, zoomOut, resetZoom, closeLightbox, photo, setRating, printPhoto]);

  // Use non-passive wheel listener to allow preventDefault (prevents page scroll while zooming)
  useEffect(() => {
    if (!lightboxOpen) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, [lightboxOpen, zoomIn, zoomOut]);

  function handleMouseDown(e: React.MouseEvent) {
    if (zoomRef.current <= 1) return;
    isDraggingRef.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
    applyTransform();
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDraggingRef.current) return;
    const newX = dragStart.current.panX + (e.clientX - dragStart.current.x);
    const newY = dragStart.current.panY + (e.clientY - dragStart.current.y);
    panRef.current = clampPan(newX, newY, zoomRef.current);
    applyTransform();
  }

  function handleMouseUp() { isDraggingRef.current = false; applyTransform(); }

  if (!lightboxOpen || !photo) return null;

  const src = getImageSrc(photo);
  const hasPrev = lightboxIndex > 0;
  const hasNext = lightboxIndex < lightboxPhotos.length - 1;
  // Only build a CSS filter string when an adjustment is actually active. A non-"none" filter
  // forces the browser to re-rasterise the full bitmap on every zoom/pan tick (the old 3s lag);
  // "none" keeps zoom/pan fully GPU-composited and instant.
  const isAdjusted = brightness !== 100 || contrast !== 100 || saturation !== 100;
  const filterStr = isAdjusted
    ? `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
    : "none";

  return (
    <AnimatePresence>
      <motion.div
        ref={lightboxRef}
        className="fixed inset-0 z-50 bg-black/95 flex flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Slideshow progress bar */}
        {slideshowActive && (
          <div className="h-0.5 bg-white/10 shrink-0 overflow-hidden">
            <motion.div
              key={`${lightboxIndex}-${slideshowSpeed}`}
              className="h-full bg-[var(--accent)]"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: slideshowSpeed, ease: "linear" }}
            />
          </div>
        )}

        {/* Top bar */}
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 shrink-0 bg-black/40 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={closeLightbox}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="hidden sm:block">
              <p className="text-white/90 text-sm font-medium">{photo.name}</p>
              <p className="text-white/40 text-xs">
                {lightboxIndex + 1} / {lightboxPhotos.length}
                {photo.width && photo.height && ` · ${photo.width}×${photo.height}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-none min-w-0">
            {/* Zoom */}
            <button onClick={zoomOut} className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M8 11h6" />
              </svg>
            </button>
            <span className="text-white/40 text-xs w-12 text-center font-mono">{Math.round(zoomDisplay * 100)}%</span>
            <button onClick={zoomIn} className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
              </svg>
            </button>
            <button onClick={resetZoom} className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white text-xs font-mono">
              1:1
            </button>

            {/* Rotate */}
            <button
              onClick={() => { rotationRef.current = (rotationRef.current + 90) % 360; setRotation(rotationRef.current); applyTransform(); }}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
              title="Rotate 90° (R)"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
              </svg>
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-white/10 mx-1" />

            {/* Favorite */}
            <button
              onClick={() => toggleFavorite({ path: photo.path })}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24"
                fill={photo.is_favorite ? "var(--accent)" : "none"}
                stroke={photo.is_favorite ? "var(--accent)" : "white"}
                strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>

            {/* Slideshow */}
            <button
              onClick={() => setSlideshowActive((v) => !v)}
              className={`p-2 rounded-lg transition-colors ${slideshowActive ? "bg-white/15 text-white" : "hover:bg-white/10 text-white/60 hover:text-white"}`}
              title={slideshowActive ? "Stop slideshow (S)" : "Start slideshow (S)"}
            >
              {slideshowActive ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <select
              value={slideshowSpeed}
              onChange={(e) => setSlideshowSpeed(Number(e.target.value))}
              className="bg-transparent text-white/40 hover:text-white/70 text-xs font-mono outline-none cursor-pointer transition-colors px-1"
              title="Slideshow speed"
            >
              <option value={2} className="bg-[#1a1814]">2s</option>
              <option value={4} className="bg-[#1a1814]">4s</option>
              <option value={6} className="bg-[#1a1814]">6s</option>
              <option value={10} className="bg-[#1a1814]">10s</option>
            </select>
            <button
              onClick={() => setSlideshowLoop((v) => !v)}
              className={`p-1.5 rounded transition-colors ${slideshowLoop ? "text-[var(--accent)]" : "text-white/30 hover:text-white/60"}`}
              title={slideshowLoop ? "Loop: on" : "Loop: off"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
              </svg>
            </button>

            {/* Compare */}
            <button
              onClick={() => {
                setCompareMode((v) => !v);
                if (!compareMode && compareIndex === null) {
                  const next = lightboxIndex < lightboxPhotos.length - 1 ? lightboxIndex + 1 : lightboxIndex - 1;
                  if (next >= 0) setCompareIndex(next);
                }
              }}
              className={`p-2 rounded-lg transition-colors ${compareMode ? "bg-white/15 text-white" : "hover:bg-white/10 text-white/60 hover:text-white"}`}
              title="Compare photos (X)"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/>
              </svg>
            </button>

            {/* Print */}
            <button
              onClick={printPhoto}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
              title="Print photo (P)"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
              </svg>
            </button>

            {/* Open with system viewer (non-demo only) */}
            {!IS_DEMO && (
              <button
                onClick={openWithSystem}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
                title="Open with system viewer"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
            )}

            {/* Adjust */}
            <button
              onClick={() => setShowAdjust((v) => !v)}
              className={`p-2 rounded-lg transition-colors ${showAdjust ? "bg-white/15 text-white" : "hover:bg-white/10 text-white/60 hover:text-white"}`}
              title="Adjust image"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
                <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
                <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>
                <line x1="17" y1="16" x2="23" y2="16"/>
              </svg>
            </button>

            {/* Download (demo only) */}
            {IS_DEMO && (
              <button
                onClick={downloadPhoto}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
                title="Download photo"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            )}

            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className={`p-2 rounded-lg transition-colors ${isFullscreen ? "bg-white/15 text-white" : "hover:bg-white/10 text-white/60 hover:text-white"}`}
              title={isFullscreen ? "Exit fullscreen (G)" : "Fullscreen (G)"}
            >
              {isFullscreen ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3"/>
                </svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>
                </svg>
              )}
            </button>

            {/* Info panel toggle */}
            <button
              onClick={() => setShowInfo((v) => !v)}
              className={`p-2 rounded-lg transition-colors ${showInfo ? "bg-white/15 text-white" : "hover:bg-white/10 text-white/60 hover:text-white"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          </div>
        </div>

        {/* Adjust panel */}
        <AnimatePresence>
          {showAdjust && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="shrink-0 bg-black/70 border-b border-white/8 overflow-hidden"
            >
              <div className="flex items-center gap-6 px-6 py-3 flex-wrap">
                {[
                  { label: "Brightness", value: brightness, set: setBrightness, min: 0, max: 200, default: 100 },
                  { label: "Contrast",   value: contrast,   set: setContrast,   min: 0, max: 200, default: 100 },
                  { label: "Saturation", value: saturation, set: setSaturation, min: 0, max: 200, default: 100 },
                ].map(({ label, value, set, min, max, default: def }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-white/40 text-xs font-mono w-20 shrink-0">{label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={value}
                      onChange={(e) => set(Number(e.target.value))}
                      className="w-28 accent-[var(--accent)] cursor-pointer"
                    />
                    <span className="text-white/50 text-xs font-mono w-8 text-right">{value}</span>
                    <button
                      onClick={() => set(def)}
                      className="text-white/25 hover:text-white/60 text-[10px] font-mono transition-colors"
                      title="Reset"
                    >↺</button>
                  </div>
                ))}
                <button
                  onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); }}
                  className="text-xs font-mono text-white/30 hover:text-white/60 transition-colors ml-2"
                >
                  Reset all
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Compare mode picker strip */}
        {compareMode && (
          <div className="shrink-0 bg-black/60 border-b border-white/8 px-4 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none">
            <span className="text-white/40 text-xs font-mono shrink-0">Compare with:</span>
            {lightboxPhotos.map((p, i) => {
              if (i === lightboxIndex) return null;
              const isActive = compareIndex === i;
              return (
                <button
                  key={p.path}
                  onClick={() => setCompareIndex(i)}
                  className="relative shrink-0 rounded overflow-hidden transition-all"
                  style={{ width: 40, height: 40, outline: isActive ? "2px solid var(--accent)" : "2px solid transparent", opacity: isActive ? 1 : 0.45 }}
                >
                  <LightboxThumb photo={p} className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
        )}

        {/* Main area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Image area */}
          <div className="flex-1 relative overflow-hidden">
            {/* Compare view */}
            {compareMode && compareIndex !== null && lightboxPhotos[compareIndex] && (
              <div className="w-full h-full flex">
                <div className="flex-1 flex items-center justify-center border-r border-white/15 relative overflow-hidden">
                  <img
                    src={src}
                    alt={photo.name}
                    className="max-w-full max-h-full object-contain"
                  />
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/70 text-white/80 text-xs font-mono px-2 py-1 rounded-md">
                    {photo.name}
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center relative overflow-hidden">
                  <img
                    src={IS_DEMO ? lightboxPhotos[compareIndex].path : getImageSrc(lightboxPhotos[compareIndex])}
                    alt={lightboxPhotos[compareIndex].name}
                    className="max-w-full max-h-full object-contain"
                  />
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/70 text-white/80 text-xs font-mono px-2 py-1 rounded-md">
                    {lightboxPhotos[compareIndex].name}
                  </div>
                </div>
              </div>
            )}

            {/* Normal view */}
            {!compareMode && (
            <>
            {/* Prev button */}
            {hasPrev && (
              <button
                onClick={goPrev}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            )}

            {/* Image */}
            <div
              ref={imageContainerRef}
              className="w-full h-full flex items-center justify-center select-none relative"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={resetZoom}
            >
              {/* One transform wrapper holds the whole image stack — zoom/pan/rotate are applied
                  here once (GPU-composited), and the adjustment filter lives here too. */}
              <div
                ref={transformRef}
                className="absolute inset-0"
                style={{
                  transformOrigin: "center center",
                  willChange: "transform",
                  filter: filterStr,
                }}
              >
                {/* Tier 1: cached thumbnail — instant, blurred, until the preview is ready */}
                {thumbUrl && !previewLoaded && !fullLoaded && (
                  <img
                    src={thumbUrl}
                    alt=""
                    className="absolute inset-0 m-auto max-w-full max-h-full object-contain"
                    style={{ filter: "blur(8px)", transform: "scale(1.03)", userSelect: "none", pointerEvents: "none" }}
                    draggable={false}
                  />
                )}
                {/* Tier 2: screen-resolution preview — the main image, loads fast */}
                {previewUrl && (
                  <img
                    key={`prev-${photo.path}`}
                    src={previewUrl}
                    alt={photo.name}
                    className="absolute inset-0 m-auto max-w-full max-h-full object-contain select-none"
                    onLoad={() => setPreviewLoaded(true)}
                    decoding="async"
                    style={{
                      opacity: previewLoaded ? (fullLoaded ? 0 : 1) : 0,
                      transition: "opacity 0.18s ease",
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                    draggable={false}
                  />
                )}
                {/* Tier 3: true full-resolution original — only fetched once the user zooms in */}
                {wantFull && (
                  <img
                    key={`full-${photo.path}`}
                    src={src}
                    alt={photo.name}
                    className="absolute inset-0 m-auto max-w-full max-h-full object-contain select-none"
                    onLoad={() => setFullLoaded(true)}
                    decoding="async"
                    style={{
                      opacity: fullLoaded ? 1 : 0,
                      transition: "opacity 0.18s ease",
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                    draggable={false}
                  />
                )}
              </div>
            </div>

            {/* Next button */}
            {hasNext && (
              <button
                onClick={goNext}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 hover:bg-black/80 text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            )}
            </>
            )}
          </div>

          {/* Info panel */}
          <AnimatePresence>
            {showInfo && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0 bg-[#0e0d0b] border-l border-white/8 overflow-hidden"
              >
                <div className="w-[280px] h-full overflow-y-auto p-5 flex flex-col gap-5">
                  <h3 className="text-[#f0ead8] font-medium text-sm">Photo Info</h3>

                  {/* File info */}
                  <InfoSection title="File">
                    <InfoRow label="Name" value={photo.name} />
                    <InfoRow label="Format" value={photo.format.toUpperCase()} />
                    <InfoRow label="Size" value={formatBytes(photo.file_size)} />
                    {photo.width && photo.height && (
                      <InfoRow label="Dimensions" value={`${photo.width} × ${photo.height}`} />
                    )}
                    <div className="flex justify-between items-center pt-0.5">
                      <span className="text-[#5a5244] text-xs">Rating</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => photo && setRating({ path: photo.path, rating: star === photo.rating ? 0 : star })}
                            className="transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24"
                              fill={star <= photo.rating ? "var(--accent)" : "none"}
                              stroke={star <= photo.rating ? "var(--accent)" : "#5a5244"}
                              strokeWidth="1.5"
                            >
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    </div>
                  </InfoSection>

                  {/* Color palette */}
                  {palette.length > 0 && (
                    <InfoSection title="Color Palette">
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {palette.map((hex) => (
                          <button
                            key={hex}
                            title={hex}
                            onClick={() => navigator.clipboard.writeText(hex)}
                            className="group relative w-8 h-8 rounded-md border border-white/10 transition-transform hover:scale-110 hover:border-white/30 cursor-pointer shrink-0"
                            style={{ backgroundColor: hex }}
                          >
                            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[#5a5244] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{hex}</span>
                          </button>
                        ))}
                      </div>
                    </InfoSection>
                  )}

                  {/* Histogram */}
                  {histogram && (
                    <InfoSection title="Histogram">
                      <div className="flex flex-col gap-0.5 mt-1">
                        {(["r", "g", "b"] as const).map((ch) => {
                          const bins = histogram[ch];
                          const max = Math.max(...bins, 1);
                          const color = ch === "r" ? "#ef4444" : ch === "g" ? "#22c55e" : "#3b82f6";
                          return (
                            <div key={ch} className="flex items-end gap-px h-10">
                              {bins.map((v, i) => (
                                <div
                                  key={i}
                                  className="flex-1 rounded-sm opacity-80"
                                  style={{ height: `${Math.round((v / max) * 100)}%`, backgroundColor: color, minWidth: 2 }}
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </InfoSection>
                  )}

                  {/* Date */}
                  <InfoSection title="Date">
                    <InfoRow label="Taken" value={formatDate(photo.date_taken)} />
                    <InfoRow label="Modified" value={formatDate(photo.date_modified)} />
                  </InfoSection>

                  {/* Camera / Exposure */}
                  {(photo.camera || meta?.aperture || meta?.iso || meta?.focal_length) && (
                    <InfoSection title="Camera & Exposure">
                      {photo.camera && <InfoRow label="Device" value={photo.camera} />}
                      {meta?.lens && <InfoRow label="Lens" value={meta.lens} />}
                      {meta?.focal_length != null && (
                        <InfoRow label="Focal length" value={`${meta.focal_length.toFixed(0)} mm`} />
                      )}
                      {meta?.aperture != null && (
                        <InfoRow label="Aperture" value={`f/${meta.aperture.toFixed(1)}`} />
                      )}
                      {meta?.shutter_speed && <InfoRow label="Shutter" value={meta.shutter_speed} />}
                      {meta?.iso != null && <InfoRow label="ISO" value={String(meta.iso)} />}
                      {meta?.exposure_bias != null && meta.exposure_bias !== 0 && (
                        <InfoRow label="Exposure bias" value={`${meta.exposure_bias > 0 ? "+" : ""}${meta.exposure_bias.toFixed(1)} EV`} />
                      )}
                      {meta?.flash && <InfoRow label="Flash" value={meta.flash} />}
                    </InfoSection>
                  )}

                  {/* GPS */}
                  {photo.gps_lat != null && photo.gps_lon != null && (
                    <InfoSection title="Location">
                      <InfoRow label="Lat" value={`${photo.gps_lat.toFixed(5)}°`} />
                      <InfoRow label="Lon" value={`${photo.gps_lon.toFixed(5)}°`} />
                      {/* Mini map tile */}
                      <div className="mt-2 rounded-lg overflow-hidden border border-white/8" style={{ height: 100 }}>
                        <img
                          src={`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${photo.gps_lon},${photo.gps_lat}&z=14&l=sat&size=270,100&pt=${photo.gps_lon},${photo.gps_lat},pm2rdl`}
                          alt="Map"
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </div>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${photo.gps_lat}&mlon=${photo.gps_lon}&zoom=14`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-[10px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors mt-1"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        Open on map
                      </a>
                    </InfoSection>
                  )}

                  {/* Tags */}
                  <InfoSection title="Tags">
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {meta?.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[var(--accent-a12)] text-[var(--accent)] group/tag"
                        >
                          {tag}
                          <button
                            onClick={() => photo && removeTag({ path: photo.path, tag })}
                            className="opacity-0 group-hover/tag:opacity-100 transition-opacity"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 relative">
                      <div className="flex gap-1.5">
                        <input
                          value={newTagInput}
                          onChange={(e) => {
                            const v = e.target.value;
                            setNewTagInput(v);
                            if (v.trim().length > 0) {
                              const lv = v.toLowerCase();
                              const existing = meta?.tags ?? [];
                              setTagSuggestions(
                                allTags.filter((t) => t.toLowerCase().includes(lv) && !existing.includes(t)).slice(0, 6)
                              );
                            } else {
                              setTagSuggestions([]);
                            }
                          }}
                          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === "Enter" && newTagInput.trim() && photo) {
                              addTag({ path: photo.path, tag: newTagInput.trim() });
                              setNewTagInput(""); setTagSuggestions([]);
                            }
                            if (e.key === "Escape") { setNewTagInput(""); setTagSuggestions([]); }
                          }}
                          onBlur={() => setTimeout(() => setTagSuggestions([]), 200)}
                          placeholder="Add tag…"
                          className="flex-1 bg-[#1a1814] border border-white/7 rounded px-2 py-1 text-xs text-[#c8bfa8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
                        />
                        <button
                          onClick={() => {
                            if (newTagInput.trim() && photo) {
                              addTag({ path: photo.path, tag: newTagInput.trim() });
                              setNewTagInput(""); setTagSuggestions([]);
                            }
                          }}
                          className="px-2 py-1 rounded bg-[var(--accent-a10)] text-[var(--accent)] text-xs hover:bg-[var(--accent-a20)] transition-colors shrink-0"
                        >
                          Add
                        </button>
                      </div>
                      {tagSuggestions.length > 0 && (
                        <div className="absolute left-0 right-8 mt-1 bg-[#1a1814] border border-white/10 rounded-lg shadow-xl z-10 overflow-hidden">
                          {tagSuggestions.map((t) => (
                            <button
                              key={t}
                              onMouseDown={() => {
                                if (photo) { addTag({ path: photo.path, tag: t }); }
                                setNewTagInput(""); setTagSuggestions([]);
                              }}
                              className="w-full text-left px-3 py-1.5 text-xs text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] transition-colors"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </InfoSection>

                  {/* Notes */}
                  <InfoSection title="Notes">
                    <textarea
                      value={notesValue}
                      onChange={(e) => { setNotesValue(e.target.value); setNotesSaved(false); }}
                      onBlur={() => {
                        if (photo && notesValue !== (meta?.notes ?? "")) {
                          updateNotes({ path: photo.path, notes: notesValue });
                          setNotesSaved(true);
                          setTimeout(() => setNotesSaved(false), 2000);
                        }
                      }}
                      placeholder="Add a note about this photo…"
                      rows={3}
                      className="w-full bg-[#1a1814] border border-white/7 rounded px-2 py-1.5 text-xs text-[#c8bfa8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors resize-none leading-relaxed"
                    />
                    {notesSaved && (
                      <p className="text-[10px] font-mono text-[var(--accent)]/60 mt-1">Saved</p>
                    )}
                  </InfoSection>

                  {/* Copy EXIF summary */}
                  {(meta?.aperture || meta?.shutter_speed || meta?.iso || meta?.focal_length) && (
                    <button
                      onClick={() => {
                        if (!meta) return;
                        const lines: string[] = [
                          `File: ${photo.name}`,
                          `Size: ${photo.width}×${photo.height}`,
                          photo.camera ? `Camera: ${photo.camera}` : "",
                          meta.lens ? `Lens: ${meta.lens}` : "",
                          meta.focal_length != null ? `Focal: ${meta.focal_length.toFixed(0)}mm` : "",
                          meta.aperture != null ? `Aperture: f/${meta.aperture.toFixed(1)}` : "",
                          meta.shutter_speed ? `Shutter: ${meta.shutter_speed}` : "",
                          meta.iso != null ? `ISO: ${meta.iso}` : "",
                          meta.exposure_bias != null && meta.exposure_bias !== 0 ? `EV: ${meta.exposure_bias > 0 ? "+" : ""}${meta.exposure_bias.toFixed(1)}` : "",
                          meta.flash ? `Flash: ${meta.flash}` : "",
                          photo.gps_lat != null ? `GPS: ${photo.gps_lat.toFixed(5)}, ${photo.gps_lon?.toFixed(5)}` : "",
                        ].filter(Boolean);
                        navigator.clipboard.writeText(lines.join("\n"));
                      }}
                      className="text-[10px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
                    >
                      Copy EXIF data
                    </button>
                  )}

                  {/* Path */}
                  <InfoSection title="Location on disk">
                    <p className="text-[#5a5244] text-[10px] font-mono break-all leading-relaxed">{photo.path}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={copyPath}
                        className="flex items-center gap-1.5 text-[10px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
                      >
                        {copied ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                        )}
                        {copied ? "Copied!" : "Copy"}
                      </button>
                      {!IS_DEMO && (
                        <button
                          onClick={revealInExplorer}
                          className="flex items-center gap-1.5 text-[10px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                          </svg>
                          Show in folder
                        </button>
                      )}
                      {!IS_DEMO && (
                        <button
                          onClick={openWithSystem}
                          className="flex items-center gap-1.5 text-[10px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                          Open with viewer
                        </button>
                      )}
                    </div>
                  </InfoSection>

                  {/* Add to Collection */}
                  <InfoSection title="Collections">
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {collections.map((col) => {
                        const justAdded = addedToCol === col.id;
                        return (
                          <button
                            key={col.id}
                            onClick={() => {
                              if (!photo) return;
                              addToCollection({ collectionId: col.id, paths: [photo.path] }, {
                                onSuccess: () => {
                                  setAddedToCol(col.id);
                                  setTimeout(() => setAddedToCol(null), 1500);
                                },
                              });
                            }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                              justAdded
                                ? "bg-[var(--accent-a20)] text-[var(--accent)]"
                                : "bg-[#1a1814] text-[#5a5244] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)]"
                            }`}
                            title={`Add to "${col.name}"`}
                          >
                            {justAdded ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M12 5v14M5 12h14" />
                              </svg>
                            )}
                            {col.name}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setShowNewCol((v) => !v)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[#1a1814] text-[#3a3628] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        New
                      </button>
                    </div>
                    {showNewCol && (
                      <div className="flex gap-1.5 mt-2">
                        <input
                          autoFocus
                          value={newColInput}
                          onChange={(e) => setNewColInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newColInput.trim() && photo) {
                              createCollection({ name: newColInput.trim() }, {
                                onSuccess: (col) => {
                                  if (col) addToCollection({ collectionId: col.id, paths: [photo.path] });
                                  setNewColInput(""); setShowNewCol(false);
                                },
                              });
                            }
                            if (e.key === "Escape") { setNewColInput(""); setShowNewCol(false); }
                          }}
                          placeholder="Collection name…"
                          className="flex-1 bg-[#1a1814] border border-white/7 rounded px-2 py-1 text-[10px] text-[#c8bfa8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
                        />
                        <button
                          disabled={!newColInput.trim() || isCreatingCol}
                          onClick={() => {
                            if (!newColInput.trim() || !photo) return;
                            createCollection({ name: newColInput.trim() }, {
                              onSuccess: (col) => {
                                if (col) addToCollection({ collectionId: col.id, paths: [photo.path] });
                                setNewColInput(""); setShowNewCol(false);
                              },
                            });
                          }}
                          className="px-2 py-1 rounded bg-[var(--accent-a10)] text-[var(--accent)] text-[10px] hover:bg-[var(--accent-a20)] transition-colors disabled:opacity-40 shrink-0"
                        >
                          Create
                        </button>
                      </div>
                    )}
                    {collections.length === 0 && !showNewCol && (
                      <p className="text-[#3a3628] text-[10px] font-mono mt-1">No collections yet</p>
                    )}
                  </InfoSection>

                  {/* Keyboard shortcuts hint */}
                  <div className="border-t border-white/5 pt-4 mt-auto">
                    <p className="text-[#3a3628] text-[10px] font-mono mb-2">KEYBOARD SHORTCUTS</p>
                    <div className="flex flex-col gap-1">
                      {[
                        ["←/→", "Navigate"],
                        ["+/-", "Zoom"],
                        ["0", "Reset zoom"],
                        ["R", "Rotate 90°"],
                        ["F", "Favorite"],
                        ["C", "Copy path"],
                        ["1–5", "Rate photo"],
                        ["P", "Print"],
                        ["X", "Compare"],
                        ["S", "Slideshow"],
                        ["G", "Fullscreen"],
                        ["I", "Toggle info"],
                        ["Esc", "Close"],
                      ].map(([key, label]) => (
                        <div key={key} className="flex justify-between">
                          <span className="text-[#3a3628] text-[10px]">{label}</span>
                          <kbd className="text-[#3a3628] text-[10px] font-mono bg-white/5 px-1 rounded">{key}</kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Thumbnail strip */}
        {lightboxPhotos.length > 1 && (
          <ThumbnailStrip
            photos={lightboxPhotos}
            currentIndex={lightboxIndex}
            onSelect={(i) => { setLightboxIndex(i); resetZoom(); }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[#3a3628] text-[10px] font-mono uppercase tracking-widest mb-2">{title}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[#5a5244] text-xs shrink-0">{label}</span>
      <span className="text-[#c8bfa8] text-xs text-right break-all">{value}</span>
    </div>
  );
}

const ThumbnailStrip = memo(function ThumbnailStrip({
  photos, currentIndex, onSelect,
}: { photos: Photo[]; currentIndex: number; onSelect: (i: number) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeRef.current && stripRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [currentIndex]);

  return (
    <div ref={stripRef} className="shrink-0 bg-black/60 px-4 py-2 flex gap-1.5 overflow-x-auto scrollbar-none">
      {photos.map((p, i) => (
        <button
          key={p.path}
          ref={i === currentIndex ? activeRef : null}
          onClick={() => onSelect(i)}
          className="relative shrink-0 rounded overflow-hidden transition-all"
          style={{
            width: 48,
            height: 48,
            outline: i === currentIndex ? "2px solid var(--accent)" : "2px solid transparent",
            outlineOffset: "0px",
            opacity: i === currentIndex ? 1 : 0.4,
          }}
        >
          <LightboxThumb photo={p} className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
});

/**
 * Small thumbnail used by the filmstrip and compare picker. Uses the cached thumbnail
 * (the same instant EXIF/cache path the grid uses) instead of decoding the full original —
 * decoding full-resolution originals for 48px tiles is what made big sets / slideshows crawl.
 */
const LightboxThumb = memo(function LightboxThumb({ photo, className }: { photo: Photo; className?: string }) {
  const { data: thumbUrl } = usePhotoThumbnail(photo.path);
  const src = IS_DEMO ? photo.path : thumbUrl ?? null;
  if (!src) return <div className={`${className ?? ""} bg-[#1a1814]`} />;
  return (
    <img src={src} alt="" className={className} loading="lazy" decoding="async" draggable={false} />
  );
});
