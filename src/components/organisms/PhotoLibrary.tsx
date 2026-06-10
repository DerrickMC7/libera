import { useState, useCallback, useRef, useEffect, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { usePhotoStore } from "../../store/photoStore";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";
import { usePhotosCount, usePhotosPage, usePhotoYears, usePhotoFormats, useAllPhotoTags, usePhotoStats, useScanAndSavePhotos, usePhotoCountForTag, usePhotoCountForYear, usePhotoMonthsForYear, usePhotoYearStats, useTogglePhotoFavorite, useAddPhotoTag, useCopySelectedPhotos, usePhotoCameras, useOnThisDayPhotos, useSetPhotoRating, usePhotoCollections, useAddPhotosToCollection, useCreatePhotoCollection, useDeletePhotoFromLibrary, PHOTO_PAGE_SIZE } from "../../hooks/usePhotos";
import { Photo, PhotoView, PhotoSortBy } from "../../types/photo";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoAlbumGrid } from "./PhotoAlbumGrid";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoDuplicates } from "./PhotoDuplicates";
import { PhotoCollections } from "./PhotoCollections";
import { PhotoMapView } from "./PhotoMapView";
import { PhotoStatsView } from "./PhotoStatsView";
import { Tooltip } from "../atoms/Tooltip";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

const SORT_OPTIONS: { id: PhotoSortBy; label: string }[] = [
  { id: "date_desc",   label: "Newest first" },
  { id: "date_asc",    label: "Oldest first" },
  { id: "name_asc",    label: "Name A–Z" },
  { id: "name_desc",   label: "Name Z–A" },
  { id: "size_desc",   label: "Largest" },
  { id: "size_asc",    label: "Smallest" },
  { id: "rating_desc", label: "Highest rated" },
  { id: "rating_asc",  label: "Lowest rated" },
];

const PAGE = PHOTO_PAGE_SIZE; // must match usePhotosPage limit so all photos are reachable

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function PhotoLibrary() {
  const {
    view, search, sortBy, formatFilter, yearFilter, monthFilter, albumFilter, tagFilter, cameraFilter, minRatingFilter,
    dateFrom, dateTo, orientationFilter,
    setView, setSearch, setSortBy, setFormatFilter, setYearFilter, setMonthFilter, setAlbumFilter, setTagFilter, setCameraFilter, setMinRatingFilter,
    setDateFrom, setDateTo, setOrientationFilter,
    setViewWithTagFilter,
    openLightbox, lightboxOpen, lightboxPhotos, setLightboxPhotos,
    selectionMode, selectedPaths, toggleSelectionMode, selectAll, clearSelection,
    favoriteOverrides, setFavoriteOverride, setRatingOverride,
  } = usePhotoStore();

  const [localSearch, setLocalSearch] = useState(search);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("photo-search-history") ?? "[]"); } catch { return []; }
  });
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [pages, setPages] = useState<Photo[][]>([]);
  const [gridSize, setGridSize] = useState<"sm" | "md" | "lg">(() => {
    const s = localStorage.getItem("photo-grid-size");
    return (s === "sm" || s === "lg") ? s : "md";
  });
  const [viewLayout, setViewLayout] = useState<"grid" | "list" | "masonry">(() => {
    const saved = localStorage.getItem("photo-view-layout");
    return (saved === "list" || saved === "masonry") ? saved : "grid";
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const allPhotosRef = useRef<Photo[]>([]);
  const [batchTagInput, setBatchTagInput] = useState("");
  const [showBatchTag, setShowBatchTag] = useState(false);
  const [showBatchRate, setShowBatchRate] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ scanned: number; total: number; saved: number } | null>(null);
  const [scanFolder, setScanFolder] = useState<string | null>(null);
  const scanStartTimeRef = useRef<number | null>(null);
  const dragCounterRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);
  const qc = useQueryClient();
  const { mutate: scanPhotos, isPending: isScanning } = useScanAndSavePhotos();

  // Listen to Rust progress events and refresh queries incrementally
  useEffect(() => {
    if (IS_DEMO) return;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ scanned: number; total: number; saved: number }>(
        "photos://scan-progress",
        (ev) => {
          setScanProgress(ev.payload);
          // Refresh first page so newly-saved photos appear while scan is running
          qc.invalidateQueries({ queryKey: ["photos-count"] });
          qc.invalidateQueries({ queryKey: ["photos-page"] });
        }
      ).then((u) => { unlisten = u; });
    });
    return () => { unlisten?.(); };
  }, [qc]);
  const { mutate: toggleFavorite } = useTogglePhotoFavorite();
  const { mutate: addTag } = useAddPhotoTag();
  const { mutate: copyPhotos } = useCopySelectedPhotos();
  const { mutate: setRating } = useSetPhotoRating();
  const { mutate: deletePhoto } = useDeletePhotoFromLibrary();
  const { data: collections = [] } = usePhotoCollections();
  const { mutate: addToCollection } = useAddPhotosToCollection();

  // Ctrl+F focuses photo search; Escape clears selection; Ctrl+A selects all
  // 1-5 to batch rate selected photos; Delete to toggle favorites on selection
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && selectionMode) {
        clearSelection();
      } else if (e.ctrlKey && e.key === "a" && selectionMode) {
        e.preventDefault();
        selectAll(allPhotosRef.current.map((p) => p.path));
      } else if (selectionMode && selectedPaths.size > 0 && ["1","2","3","4","5"].includes(e.key) && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        const star = Number(e.key);
        Array.from(selectedPaths).forEach((path) => {
          setRating({ path, rating: star });
        });
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [selectionMode, selectedPaths, clearSelection, selectAll, setRating]);

  // Debounce search — intercept "#tag" prefix to activate tag filter
  useEffect(() => {
    const t = setTimeout(() => {
      if (localSearch.startsWith("#") && localSearch.length > 1) {
        const tag = localSearch.slice(1).trim();
        if (tag) {
          setViewWithTagFilter("all", tag);
          setLocalSearch("");
          setDebouncedSearch("");
          return;
        }
      }
      setDebouncedSearch(localSearch);
      setSearch(localSearch);
    }, 300);
    return () => clearTimeout(t);
  }, [localSearch]);

  // Reset pages AND current page when filters/view change so we always load from page 0.
  // Without resetting currentPage, the query fires for the last auto-loaded page (e.g. page 7)
  // and pages[0..6] stay undefined — flat() returns only the last 60 photos.
  useEffect(() => {
    setPages([]);
    setCurrentPage(0);
  }, [debouncedSearch, sortBy, formatFilter, yearFilter, monthFilter, albumFilter, tagFilter, cameraFilter, minRatingFilter, view]);

  const isFavoritesView = view === "favorites";
  const isTimelineView = view === "timeline";
  const isTagsView = view === "tags";
  const isAlbumsView = view === "albums";
  const isDuplicatesView = view === "duplicates";
  const isCollectionsView = view === "collections";
  const isMapView = view === "map";
  const isStatsView = view === "stats";

  const favoritesOnly = isFavoritesView;

  const { data: total = 0 } = usePhotosCount(
    debouncedSearch, sortBy, formatFilter, yearFilter, monthFilter, albumFilter, favoritesOnly, tagFilter, cameraFilter, minRatingFilter
  );
  const { data: years = [] } = usePhotoYears();
  const { data: formats = [] } = usePhotoFormats();
  const { data: cameras = [] } = usePhotoCameras();
  const { data: allTags = [] } = useAllPhotoTags();
  const { data: onThisDayPhotos = [] } = useOnThisDayPhotos();
  const { data: stats } = usePhotoStats();
  const { data: monthsForYear = [] } = usePhotoMonthsForYear(yearFilter);

  // Load first page
  const pageCount = Math.ceil(total / PAGE);
  const [currentPage, setCurrentPage] = useState(0);

  const { data: pageData, isLoading } = usePhotosPage(
    debouncedSearch, sortBy, formatFilter, yearFilter, monthFilter, albumFilter, favoritesOnly, tagFilter,
    currentPage, cameraFilter, minRatingFilter
  );

  useEffect(() => {
    if (!pageData) return;
    setPages((prev) => {
      const next = [...prev];
      next[currentPage] = pageData;
      return next;
    });
  }, [pageData, currentPage]);

  const allPhotosRaw = pages.flat();
  const dateFromTs = dateFrom ? new Date(dateFrom).getTime() / 1000 : null;
  const dateToTs = dateTo ? (new Date(dateTo).getTime() / 1000 + 86399) : null;
  const allPhotosDateFiltered = (dateFromTs !== null || dateToTs !== null)
    ? allPhotosRaw.filter((p) => {
        const ts = p.date_taken ?? p.date_modified;
        if (!ts) return false;
        if (dateFromTs !== null && ts < dateFromTs) return false;
        if (dateToTs !== null && ts > dateToTs) return false;
        return true;
      })
    : allPhotosRaw;
  const allPhotos = orientationFilter === "all"
    ? allPhotosDateFiltered
    : allPhotosDateFiltered.filter((p) => {
        if (!p.width || !p.height) return false;
        const ratio = p.width / p.height;
        if (orientationFilter === "portrait") return ratio < 0.95;
        if (orientationFilter === "landscape") return ratio > 1.05;
        if (orientationFilter === "square") return ratio >= 0.95 && ratio <= 1.05;
        return true;
      });
  allPhotosRef.current = allPhotos;

  function loadMore() {
    if (currentPage + 1 < pageCount) setCurrentPage((p) => p + 1);
  }

  // Auto-load all pages sequentially — no scrolling required to see every photo
  useEffect(() => {
    if (!isLoading && pageData && currentPage < pageCount - 1) {
      setCurrentPage((p) => p + 1);
    }
  }, [pageData, isLoading, currentPage, pageCount]);

  // Sync lightbox navigation list as more pages load (guards against album/collection lightboxes)
  useEffect(() => {
    if (!lightboxOpen || allPhotos.length <= lightboxPhotos.length) return;
    if (lightboxPhotos.length > 0 && lightboxPhotos[0].path !== allPhotos[0]?.path) return;
    setLightboxPhotos(allPhotos);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPhotos.length, lightboxOpen]);

  function getScanEta(): string {
    if (!scanStartTimeRef.current || !scanProgress || scanProgress.scanned === 0) return "";
    const elapsed = (Date.now() - scanStartTimeRef.current) / 1000;
    const rate = scanProgress.scanned / elapsed;
    const remaining = (scanProgress.total - scanProgress.scanned) / rate;
    if (remaining < 60) return `${Math.round(remaining)}s left`;
    return `${Math.floor(remaining / 60)}m ${Math.round(remaining % 60)}s left`;
  }

  async function handleAddFolder() {
    if (IS_DEMO) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select photo folder" });
      if (selected && typeof selected === "string") {
        setScanProgress({ scanned: 0, total: 0, saved: 0 });
        setScanFolder(selected);
        scanStartTimeRef.current = Date.now();
        scanPhotos(selected, {
          onSuccess: () => {
            setScanProgress(null);
            setScanFolder(null);
            scanStartTimeRef.current = null;
            setPages([]);
            setCurrentPage(0);
          },
          onError: () => {
            setScanProgress(null);
            setScanFolder(null);
            scanStartTimeRef.current = null;
          },
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  const views: { id: PhotoView; label: string }[] = [
    { id: "all",         label: "All Photos" },
    { id: "albums",      label: "Albums" },
    { id: "favorites",   label: "Favorites" },
    { id: "timeline",    label: "Timeline" },
    { id: "tags",        label: "Tags" },
    { id: "collections", label: "Collections" },
    { id: "map",         label: "Map" },
    { id: "stats",       label: "Stats" },
    { id: "duplicates",  label: "Duplicates" },
  ];

  const activeFiltersCount = [formatFilter, yearFilter, monthFilter, albumFilter, tagFilter, cameraFilter, minRatingFilter, dateFrom, dateTo,
    orientationFilter !== "all" ? orientationFilter : null]
    .filter((v) => v !== null && v !== undefined).length;

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }
  function handleDragLeave() {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false); }
  }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (IS_DEMO) return;
    const folders = new Set<string>();
    for (const file of Array.from(e.dataTransfer.files)) {
      const path = (file as any).path as string | undefined;
      if (!path) continue;
      const parts = path.replace(/\\/g, "/").split("/");
      parts.pop();
      const folder = parts.join("/");
      if (folder) folders.add(folder);
    }
    const firstFolder = Array.from(folders)[0] ?? null;
    setScanProgress({ scanned: 0, total: 0, saved: 0 });
    setScanFolder(firstFolder);
    scanStartTimeRef.current = Date.now();
    for (const folder of folders) {
      scanPhotos(folder, {
        onSuccess: () => {
          setScanProgress(null);
          setScanFolder(null);
          scanStartTimeRef.current = null;
          setPages([]);
          setCurrentPage(0);
        },
        onError: () => {
          setScanProgress(null);
          setScanFolder(null);
          scanStartTimeRef.current = null;
        },
      });
    }
  }

  return (
    <div
      className="flex flex-col h-full bg-[#0e0d0b] relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Scan loading overlay */}
      <AnimatePresence>
        {isScanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#0e0d0b]"
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(ellipse 60% 40% at 50% 60%, rgba(212,135,42,0.06) 0%, transparent 70%)" }}
            />
            <div className="relative flex flex-col items-center w-full max-w-sm px-8">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="mb-12 text-center"
              >
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" className="text-[#3a3628] mx-auto mb-5">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <p className="text-[#3a3628] text-[10px] font-mono tracking-[0.25em] uppercase">Scanning photos</p>
                {scanFolder && (
                  <p className="text-[#5a5244] text-[11px] font-mono mt-2 max-w-[260px] truncate">
                    {scanFolder.replace(/\\/g, "/").split("/").filter(Boolean).pop()}
                  </p>
                )}
              </motion.div>

              {scanProgress && scanProgress.total > 0 ? (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="w-full flex items-end justify-between mb-3"
                  >
                    <div>
                      <span
                        className="text-[32px] leading-none font-light text-[#f0ead8] tabular-nums"
                        style={{ fontFamily: "Fraunces, serif" }}
                      >
                        {scanProgress.scanned.toLocaleString()}
                      </span>
                      <span className="text-[#3a3628] text-sm ml-1.5">/ {scanProgress.total.toLocaleString()}</span>
                    </div>
                    <span className="text-[var(--accent)] text-sm font-mono">
                      {Math.round((scanProgress.scanned / scanProgress.total) * 100)}%
                    </span>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 }}
                    className="w-full mb-3"
                  >
                    <div className="h-px bg-[#1f1d18] rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          background: "linear-gradient(90deg, var(--accent), var(--accent-hover))",
                          width: `${Math.round((scanProgress.scanned / scanProgress.total) * 100)}%`,
                        }}
                        transition={{ ease: "easeOut", duration: 0.2 }}
                      />
                    </div>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="w-full flex items-center justify-between"
                  >
                    <p className="text-[11px] text-[#3a3628] font-mono">
                      {scanProgress.saved.toLocaleString()} new photos
                    </p>
                    <p className="text-[11px] text-[#3a3628] font-mono">{getScanEta()}</p>
                  </motion.div>
                </>
              ) : (
                <div className="flex items-center gap-2.5">
                  <div className="w-4 h-4 border border-[var(--accent)]/30 border-t-[var(--accent)] rounded-full animate-spin" />
                  <p className="text-[11px] text-[#3a3628] font-mono">Discovering files…</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drag & drop overlay */}
      <AnimatePresence>
        {isDragOver && !IS_DEMO && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#0e0d0b]/80 border-2 border-dashed border-[var(--accent)]/60 rounded-2xl m-2 pointer-events-none"
          >
            <div className="flex flex-col items-center gap-3">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[var(--accent)]">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.5"/>
                <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <p className="text-[var(--accent)] font-medium">Drop photos to import</p>
              <p className="text-[var(--accent)]/60 text-sm">Photos will be imported from their folders</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="px-10 pt-9 pb-0 bg-[#0e0d0b] z-10 shrink-0">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1.5">
              Your Collection
            </p>
            <h1
              className="text-[42px] leading-none tracking-[-1.5px] text-[#faf8f2] font-light"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Pictures{" "}
              <em className="italic text-[#c8bfa8] font-light">library</em>
            </h1>
          </div>

          {/* Stats + Add */}
          <div className="flex items-center gap-4 mb-1">
            {stats && (
              <div className="flex gap-4 text-xs text-[#5a5244] font-mono">
                <span>{stats.total.toLocaleString()} photos</span>
                <span>{stats.albums} albums</span>
                <span>{stats.favorites} favorites</span>
                <span>{formatBytes(stats.total_size)}</span>
              </div>
            )}
            <button
              onClick={handleAddFolder}
              disabled={isScanning || IS_DEMO}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)] text-xs font-mono transition-colors disabled:opacity-40"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Folder
            </button>
          </div>
        </div>

        {/* View tabs */}
        <div className="flex gap-1 mb-5">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setView(v.id);
                setLocalSearch("");
              }}
              className={`relative px-4 py-1.5 rounded-full text-xs font-mono tracking-widest uppercase transition-colors ${
                view === v.id ? "text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"
              }`}
            >
              {view === v.id && (
                <motion.span
                  layoutId="photo-tab-indicator"
                  className="absolute inset-0 rounded-full bg-[var(--accent-a10)]"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10">{v.label}</span>
            </button>
          ))}
        </div>

        {/* Search + filters (shown in non-special views) */}
        {!isAlbumsView && !isTagsView && !isDuplicatesView && !isCollectionsView && !isMapView && !isStatsView && (
          <div className="flex gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Tooltip shortcut="Ctrl+F">
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search photos… or #tag"
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  onFocus={() => setShowSearchHistory(true)}
                  onBlur={() => setTimeout(() => setShowSearchHistory(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && localSearch.trim()) {
                      const term = localSearch.trim();
                      setSearchHistory((prev) => {
                        const next = [term, ...prev.filter((s) => s !== term)].slice(0, 8);
                        localStorage.setItem("photo-search-history", JSON.stringify(next));
                        return next;
                      });
                      setShowSearchHistory(false);
                    } else if (e.key === "Escape") {
                      setShowSearchHistory(false);
                      setLocalSearch("");
                    }
                  }}
                  className="w-full bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2.5 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
                />
              </Tooltip>
              {showSearchHistory && searchHistory.length > 0 && !localSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1814] border border-white/10 rounded-lg overflow-hidden z-30 shadow-xl">
                  <p className="px-3 py-1.5 text-[10px] font-mono text-[#3a3628] tracking-widest uppercase border-b border-white/7">Recent searches</p>
                  {searchHistory.map((term, i) => (
                    <button
                      key={i}
                      onMouseDown={() => {
                        setLocalSearch(term);
                        setDebouncedSearch(term);
                        setSearch(term);
                        setShowSearchHistory(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] transition-colors text-left"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#3a3628] shrink-0">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <span className="flex-1 truncate">{term}</span>
                      <button
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setSearchHistory((prev) => {
                            const next = prev.filter((s) => s !== term);
                            localStorage.setItem("photo-search-history", JSON.stringify(next));
                            return next;
                          });
                        }}
                        className="text-[#3a3628] hover:text-[#c8bfa8] transition-colors px-1"
                        title="Remove from history"
                      >
                        ×
                      </button>
                    </button>
                  ))}
                  <button
                    onMouseDown={() => {
                      setSearchHistory([]);
                      localStorage.removeItem("photo-search-history");
                      setShowSearchHistory(false);
                    }}
                    className="w-full px-3 py-1.5 text-[10px] font-mono text-[#3a3628] hover:text-[#c8bfa8] transition-colors text-left border-t border-white/7"
                  >
                    Clear history
                  </button>
                </div>
              )}
              {showSearchHistory && localSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1814] border border-white/10 rounded-lg overflow-hidden z-30 shadow-xl">
                  {searchHistory.filter((s) => s.toLowerCase().includes(localSearch.toLowerCase()) && s !== localSearch).slice(0, 5).map((term, i) => (
                    <button
                      key={i}
                      onMouseDown={() => {
                        setLocalSearch(term);
                        setDebouncedSearch(term);
                        setSearch(term);
                        setShowSearchHistory(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] transition-colors text-left"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#3a3628] shrink-0">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <span className="flex-1 truncate">{term}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as PhotoSortBy)}
              className="bg-[#1f1d18] border border-white/7 rounded-lg px-3 py-2.5 text-xs text-[#c8bfa8] font-mono outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>

            {/* Format filter */}
            {formats.length > 0 && (
              <select
                value={formatFilter ?? ""}
                onChange={(e) => setFormatFilter(e.target.value || null)}
                className="bg-[#1f1d18] border border-white/7 rounded-lg px-3 py-2.5 text-xs text-[#c8bfa8] font-mono outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
              >
                <option value="">All formats</option>
                {formats.map((f) => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
            )}

            {/* Camera filter */}
            {cameras.length > 0 && (
              <select
                value={cameraFilter ?? ""}
                onChange={(e) => setCameraFilter(e.target.value || null)}
                className="bg-[#1f1d18] border border-white/7 rounded-lg px-3 py-2.5 text-xs text-[#c8bfa8] font-mono outline-none focus:border-[var(--accent)] transition-colors cursor-pointer"
              >
                <option value="">All cameras</option>
                {cameras.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {/* Min-rating filter */}
            <div className="flex items-center border border-white/7 rounded-lg overflow-hidden shrink-0">
              {([null, 1, 2, 3, 4, 5] as const).map((r, i) => (
                <button
                  key={r ?? "all"}
                  onClick={() => setMinRatingFilter(r)}
                  className={`px-2 py-2 text-xs font-mono transition-colors ${i > 0 ? "border-l border-white/7" : ""} ${minRatingFilter === r ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
                  title={r === null ? "All ratings" : `Exactly ${r} ${r === 1 ? "star" : "stars"}`}
                >
                  {r === null ? "All" : `${"★".repeat(r)}`}
                </button>
              ))}
            </div>

            {/* Orientation filter */}
            {!isAlbumsView && !isTagsView && !isMapView && !isStatsView && (
              <div className="flex items-center border border-white/7 rounded-lg overflow-hidden shrink-0">
                {(["all", "landscape", "portrait", "square"] as const).map((o, i) => (
                  <button
                    key={o}
                    onClick={() => setOrientationFilter(o)}
                    className={`px-2 py-2 text-xs font-mono transition-colors ${i > 0 ? "border-l border-white/7" : ""} ${orientationFilter === o ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
                    title={{ all: "All orientations", landscape: "Landscape", portrait: "Portrait", square: "Square" }[o]}
                  >
                    {o === "all" ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                      </svg>
                    ) : o === "landscape" ? (
                      <svg width="14" height="11" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="1" y="1" width="22" height="16" rx="2"/>
                      </svg>
                    ) : o === "portrait" ? (
                      <svg width="11" height="14" viewBox="0 0 18 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="1" y="1" width="16" height="22" rx="2"/>
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M3 12h18M12 3v18" strokeDasharray="4 3"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Layout toggle: grid / list */}
            {!isAlbumsView && !isTagsView && (
              <div className="flex items-center border border-white/7 rounded-lg overflow-hidden shrink-0">
                <button
                  onClick={() => { setViewLayout("grid"); localStorage.setItem("photo-view-layout", "grid"); }}
                  className={`px-2.5 py-2 transition-colors ${viewLayout === "grid" ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
                  title="Grid view"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/>
                  </svg>
                </button>
                <button
                  onClick={() => { setViewLayout("list"); localStorage.setItem("photo-view-layout", "list"); }}
                  className={`px-2.5 py-2 transition-colors border-l border-white/7 ${viewLayout === "list" ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
                  title="List view"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                </button>
                <button
                  onClick={() => { setViewLayout("masonry"); localStorage.setItem("photo-view-layout", "masonry"); }}
                  className={`px-2.5 py-2 transition-colors border-l border-white/7 ${viewLayout === "masonry" ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
                  title="Masonry view"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="2" y="2" width="6" height="9" rx="1"/>
                    <rect x="10" y="2" width="6" height="6" rx="1"/>
                    <rect x="18" y="2" width="4" height="11" rx="1"/>
                    <rect x="2" y="13" width="6" height="9" rx="1"/>
                    <rect x="10" y="10" width="6" height="12" rx="1"/>
                    <rect x="18" y="15" width="4" height="7" rx="1"/>
                  </svg>
                </button>
              </div>
            )}

            {/* Grid size toggle (only relevant for square-grid mode) */}
            {!isAlbumsView && !isTagsView && viewLayout === "grid" && (
              <div className="flex items-center border border-white/7 rounded-lg overflow-hidden shrink-0">
                {(["sm", "md", "lg"] as const).map((sz, i) => (
                  <button
                    key={sz}
                    onClick={() => { setGridSize(sz); localStorage.setItem("photo-grid-size", sz); }}
                    className={`px-2.5 py-2 transition-colors ${gridSize === sz ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"} ${i > 0 ? "border-l border-white/7" : ""}`}
                    title={{ sm: "Small grid", md: "Medium grid", lg: "Large grid" }[sz]}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      {sz === "sm" ? (
                        <path d="M3 3h4v4H3V3zm6 0h4v4H9V3zm6 0h4v4h-4V3zM3 9h4v4H3V9zm6 0h4v4H9V9zm6 0h4v4h-4V9zM3 15h4v4H3v-4zm6 0h4v4H9v-4zm6 0h4v4h-4v-4z"/>
                      ) : sz === "md" ? (
                        <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/>
                      ) : (
                        <path d="M3 3h18v18H3V3z"/>
                      )}
                    </svg>
                  </button>
                ))}
              </div>
            )}

            {/* Selection mode toggle */}
            {!isAlbumsView && !isTagsView && (
              <button
                onClick={toggleSelectionMode}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono transition-colors ${selectionMode ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060] border border-white/7"}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                {selectionMode ? `${selectedPaths.size} selected` : "Select"}
              </button>
            )}

            {/* Date range filter */}
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="date"
                value={dateFrom ?? ""}
                onChange={(e) => setDateFrom(e.target.value || null)}
                className="bg-[#1f1d18] border border-white/7 rounded-lg px-2 py-2 text-xs text-[#c8bfa8] font-mono outline-none focus:border-[var(--accent)] transition-colors cursor-pointer w-[130px]"
                title="Date from"
              />
              <span className="text-[#3a3628] text-xs">–</span>
              <input
                type="date"
                value={dateTo ?? ""}
                onChange={(e) => setDateTo(e.target.value || null)}
                className="bg-[#1f1d18] border border-white/7 rounded-lg px-2 py-2 text-xs text-[#c8bfa8] font-mono outline-none focus:border-[var(--accent)] transition-colors cursor-pointer w-[130px]"
                title="Date to"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(null); setDateTo(null); }}
                  className="p-1 text-[#3a3628] hover:text-[var(--accent)] transition-colors"
                  title="Clear date range"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Active filters badge + clear */}
            {(albumFilter || activeFiltersCount > 0) && (
              <button
                onClick={() => {
                  setFormatFilter(null);
                  setYearFilter(null);
                  setMonthFilter(null);
                  setAlbumFilter(null);
                  setTagFilter(null);
                  setCameraFilter(null);
                  setMinRatingFilter(null);
                  setDateFrom(null);
                  setDateTo(null);
                  setOrientationFilter("all");
                }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--accent-a12)] text-[var(--accent)] text-xs font-mono transition-colors hover:bg-[var(--accent-a20)]"
              >
                {albumFilter && <span>📁 {albumFilter.split(/[/\\]/).pop()}</span>}
                {tagFilter && <span>#{tagFilter}</span>}
                {formatFilter && !albumFilter && !tagFilter && <span>{formatFilter.toUpperCase()}</span>}
                {(dateFrom || dateTo) && !albumFilter && !tagFilter && !formatFilter && <span>{dateFrom ?? "…"} – {dateTo ?? "…"}</span>}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Year/month pills for timeline */}
        {!isDuplicatesView && !isCollectionsView && !isMapView && !isStatsView && isTimelineView && years.length > 0 && (
          <>
            {/* Quick date shortcuts */}
            {!yearFilter && (
              <div className="flex gap-2 mb-2">
                {[
                  { label: "This year", year: new Date().getFullYear(), month: null },
                  { label: "This month", year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
                ].map((s) => (
                  years.includes(s.year) && (
                    <button
                      key={s.label}
                      onClick={() => { setYearFilter(s.year); if (s.month) setMonthFilter(s.month); }}
                      className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-[#1a1814] text-[#5a5244] hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors"
                    >
                      {s.label}
                    </button>
                  )
                ))}
              </div>
            )}
            <TimelineSparkline years={years} activeYear={yearFilter} onYearClick={(y) => { setYearFilter(y); setMonthFilter(null); }} />
            <div className="flex gap-1.5 mb-2 flex-wrap">
              <button
                onClick={() => { setYearFilter(null); setMonthFilter(null); }}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  !yearFilter ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"
                }`}
              >
                All
              </button>
              {years.map((y) => (
                <YearPill
                  key={y}
                  year={y!}
                  active={yearFilter === y}
                  onClick={() => { setYearFilter(y); setMonthFilter(null); }}
                />
              ))}
            </div>
            {yearFilter && monthsForYear.length > 0 && (
              <div className="flex gap-1.5 mb-3 flex-wrap pl-1">
                <button
                  onClick={() => setMonthFilter(null)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-mono transition-colors ${
                    !monthFilter ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#2a2820] hover:text-[#5a5244]"
                  }`}
                >
                  All months
                </button>
                {monthsForYear.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMonthFilter(m)}
                    className={`px-2.5 py-0.5 rounded text-[11px] font-mono transition-colors ${
                      monthFilter === m ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#2a2820] hover:text-[#5a5244]"
                    }`}
                  >
                    {MONTH_NAMES[m - 1]}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Breadcrumb when album or tag filter active */}
        {!isAlbumsView && !isTagsView && !isDuplicatesView && !isCollectionsView && !isMapView && !isStatsView && (albumFilter || tagFilter) && (
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => { setAlbumFilter(null); setTagFilter(null); }}
              className="flex items-center gap-1.5 text-[11px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              All photos
            </button>
            <span className="text-[#2a2820] text-[11px]">/</span>
            {albumFilter && (
              <span className="text-[11px] font-mono text-[#c8bfa8] truncate max-w-[300px]">
                {albumFilter.split(/[/\\]/).filter(Boolean).join(" / ")}
              </span>
            )}
            {tagFilter && (
              <span className="text-[11px] font-mono text-[#c8bfa8]">#{tagFilter}</span>
            )}
          </div>
        )}

        {/* Photo count */}
        {!isAlbumsView && !isTagsView && !isDuplicatesView && !isCollectionsView && !isMapView && !isStatsView && total > 0 && (
          <p className="text-[#3a3628] text-[11px] font-mono mb-3">
            {orientationFilter !== "all" || dateFrom || dateTo
              ? <>{allPhotos.length.toLocaleString()} <span className="text-[#3a3628]/60">(filtered from {total.toLocaleString()})</span> {allPhotos.length === 1 ? "photo" : "photos"}</>
              : <>{total.toLocaleString()} {total === 1 ? "photo" : "photos"}</>
            }
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {isAlbumsView && <PhotoAlbumGrid />}

            {isTagsView && (
              <TagsView
                tags={allTags}
                onTagClick={(tag) => setViewWithTagFilter("all", tag)}
              />
            )}

            {isCollectionsView && <PhotoCollections />}

            {isMapView && <PhotoMapView />}

            {isStatsView && <PhotoStatsView />}

            {isDuplicatesView && <PhotoDuplicates />}

            {!isAlbumsView && !isTagsView && !isDuplicatesView && !isCollectionsView && !isMapView && !isStatsView && (
              <>
                {/* "On This Day" memories banner — shown only in All view with no filters */}
                {view === "all" && !debouncedSearch && !formatFilter && !yearFilter && !albumFilter && !tagFilter && !cameraFilter && onThisDayPhotos.length > 0 && (
                  <OnThisDayBanner photos={onThisDayPhotos} onOpen={(photos, idx) => openLightbox(photos, idx)} />
                )}
                {isTimelineView && yearFilter && !monthFilter ? (
                  <PhotoTimelineGrouped
                    year={yearFilter}
                    months={monthsForYear}
                    onMonthClick={(m) => setMonthFilter(m)}
                    onPhotoClick={openLightbox}
                    onBackToYears={() => { setYearFilter(null); setMonthFilter(null); }}
                  />
                ) : (
                  <PhotoGrid
                    photos={allPhotos}
                    total={total}
                    onLoadMore={loadMore}
                    loading={isLoading}
                    layout={viewLayout}
                    cardSize={gridSize === "sm" ? 130 : gridSize === "lg" ? 260 : 180}
                    emptyMessage={
                      tagFilter ? `No photos tagged with #${tagFilter}` :
                      albumFilter ? `No photos in this album` :
                      debouncedSearch ? `No photos matching "${debouncedSearch}"` :
                      isFavoritesView ? "No favorites yet — heart a photo to save it here" :
                      "No photos yet — add a folder to get started"
                    }
                  />
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Selection toolbar */}
      <AnimatePresence>
        {selectionMode && !isAlbumsView && !isTagsView && !isDuplicatesView && !isCollectionsView && !isMapView && !isStatsView && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="absolute bottom-0 left-0 right-0 z-20 bg-[#1a1814]/95 backdrop-blur border-t border-white/8"
          >
            {/* Batch tag input row */}
            <AnimatePresence>
              {showBatchTag && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center gap-2 px-8 py-2 border-b border-white/5"
                >
                  <span className="text-[#5a5244] text-xs font-mono shrink-0">Add tag to {selectedPaths.size} photos:</span>
                  <input
                    autoFocus
                    value={batchTagInput}
                    onChange={(e) => setBatchTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && batchTagInput.trim()) {
                        const tag = batchTagInput.trim();
                        const paths = Array.from(selectedPaths);
                        paths.forEach((path) => addTag({ path, tag }));
                        setBatchTagInput("");
                        setShowBatchTag(false);
                        showToast(`Tagged ${paths.length} photo${paths.length !== 1 ? "s" : ""} with "${tag}"`);
                      } else if (e.key === "Escape") {
                        setShowBatchTag(false);
                        setBatchTagInput("");
                      }
                    }}
                    placeholder="Type tag and press Enter…"
                    className="flex-1 max-w-xs bg-[#2a2820] border border-white/10 rounded px-2.5 py-1 text-xs text-[#c8bfa8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
                  />
                  <button
                    onClick={() => {
                      if (batchTagInput.trim()) {
                        const tag = batchTagInput.trim();
                        const paths = Array.from(selectedPaths);
                        paths.forEach((path) => addTag({ path, tag }));
                        setBatchTagInput("");
                        setShowBatchTag(false);
                        showToast(`Tagged ${paths.length} photo${paths.length !== 1 ? "s" : ""} with "${tag}"`);
                      }
                    }}
                    className="px-2 py-1 rounded bg-[var(--accent-a10)] text-[var(--accent)] text-xs hover:bg-[var(--accent-a20)] transition-colors"
                  >Apply</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Collection picker row */}
            <AnimatePresence>
              {showCollectionPicker && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center gap-3 px-8 py-2 border-b border-white/5 flex-wrap"
                >
                  <span className="text-[#5a5244] text-xs font-mono shrink-0">Add {selectedPaths.size} photos to:</span>
                  {collections.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => {
                        const paths = Array.from(selectedPaths);
                        addToCollection({ collectionId: col.id, paths }, {
                          onSuccess: () => showToast(`Added ${paths.length} photo${paths.length !== 1 ? "s" : ""} to "${col.name}"`),
                        });
                        setShowCollectionPicker(false);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#2a2820] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] text-[#c8bfa8] transition-colors text-xs font-mono"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                      </svg>
                      {col.name}
                    </button>
                  ))}
                  <NewCollectionFromSelection
                    paths={Array.from(selectedPaths)}
                    onDone={() => setShowCollectionPicker(false)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Batch rating row */}
            <AnimatePresence>
              {showBatchRate && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center gap-3 px-8 py-2 border-b border-white/5"
                >
                  <span className="text-[#5a5244] text-xs font-mono shrink-0">Rate {selectedPaths.size} photos:</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => {
                          const paths = Array.from(selectedPaths);
                          paths.forEach((path) => { setRatingOverride(path, star); setRating({ path, rating: star }); });
                          setShowBatchRate(false);
                          showToast(`Rated ${paths.length} photo${paths.length !== 1 ? "s" : ""} ${"★".repeat(star)}`);
                        }}
                        className="flex items-center gap-0.5 px-2 py-1 rounded bg-[#2a2820] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] text-[#c8bfa8] transition-colors text-xs font-mono"
                      >
                        {"★".repeat(star)}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        const paths = Array.from(selectedPaths);
                        paths.forEach((path) => { setRatingOverride(path, 0); setRating({ path, rating: 0 }); });
                        setShowBatchRate(false);
                        showToast(`Cleared ratings for ${paths.length} photo${paths.length !== 1 ? "s" : ""}`);
                      }}
                      className="px-2 py-1 rounded bg-[#2a2820] hover:bg-white/10 text-[#5a5244] transition-colors text-xs font-mono"
                    >
                      Clear
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>


            <div className="flex items-center justify-between px-8 py-3">
              <div className="flex items-center gap-3">
                <span className="text-[#c8bfa8] text-sm font-mono">
                  {selectedPaths.size} {selectedPaths.size === 1 ? "photo" : "photos"} selected
                </span>
                <button
                  onClick={() => selectAll(allPhotos.map((p) => p.path))}
                  className="text-xs text-[#5a5244] hover:text-[var(--accent)] transition-colors font-mono"
                >
                  Select all ({total})
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={selectedPaths.size === 0}
                  onClick={() => {
                    const selected = allPhotos.filter((p) => selectedPaths.has(p.path));
                    if (selected.length > 0) openLightbox(selected, 0);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--accent-a10)] text-[var(--accent)] hover:bg-[var(--accent-a20)] transition-colors disabled:opacity-40"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Slideshow
                </button>
                <button
                  disabled={selectedPaths.size === 0}
                  onClick={() => {
                    const paths = Array.from(selectedPaths);
                    paths.forEach((path) => {
                      const cur = path in favoriteOverrides ? favoriteOverrides[path] : (allPhotos.find(p => p.path === path)?.is_favorite ?? false);
                      setFavoriteOverride(path, !cur);
                      toggleFavorite({ path });
                    });
                    showToast(`Updated favorites for ${paths.length} photo${paths.length !== 1 ? "s" : ""}`);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[#2a2820] text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                  </svg>
                  Favorite all
                </button>
                <button
                  disabled={selectedPaths.size === 0}
                  onClick={() => { setShowBatchRate((v) => !v); setShowBatchTag(false); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors disabled:opacity-40 ${showBatchRate ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "bg-[#2a2820] text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)]"}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={showBatchRate ? "var(--accent)" : "none"} stroke={showBatchRate ? "var(--accent)" : "currentColor"} strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Rate
                </button>
                <button
                  disabled={selectedPaths.size === 0}
                  onClick={() => { setShowCollectionPicker((v) => !v); setShowBatchRate(false); setShowBatchTag(false); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors disabled:opacity-40 ${showCollectionPicker ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "bg-[#2a2820] text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)]"}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  </svg>
                  Collect
                </button>
                <button
                  disabled={selectedPaths.size === 0}
                  onClick={() => { setShowBatchTag((v) => !v); setShowBatchRate(false); setShowCollectionPicker(false); setBatchTagInput(""); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors disabled:opacity-40 ${showBatchTag ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "bg-[#2a2820] text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)]"}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
                    <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  Tag
                </button>
                {!IS_DEMO && (
                  <button
                    disabled={selectedPaths.size === 0}
                    onClick={async () => {
                      if (IS_DEMO) return;
                      const { open } = await import("@tauri-apps/plugin-dialog");
                      const dest = await open({ directory: true, multiple: false, title: "Export photos to folder" });
                      if (dest && typeof dest === "string") {
                        copyPhotos(
                          { paths: Array.from(selectedPaths), destFolder: dest },
                          {
                            onSuccess: (count) => showToast(`Exported ${count} photo${count === 1 ? "" : "s"} to "${dest.split(/[/\\]/).pop()}"`),
                          }
                        );
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[#2a2820] text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Export
                  </button>
                )}
                <button
                  disabled={selectedPaths.size === 0}
                  onClick={async () => {
                    const rows = allPhotos.filter((p) => selectedPaths.has(p.path));
                    const defaultName = `libera-photos-${new Date().toISOString().slice(0, 10)}.csv`;
                    const csvHeader = "name,path,folder,format,width,height,file_size,date_taken,date_modified,camera,gps_lat,gps_lon,rating,is_favorite";
                    const csvRows = rows.map((p) =>
                      [p.name, p.path, p.folder, p.format, p.width ?? "", p.height ?? "", p.file_size,
                        p.date_taken ?? "", p.date_modified ?? "", p.camera ?? "", p.gps_lat ?? "", p.gps_lon ?? "", p.rating, p.is_favorite ? 1 : 0]
                      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
                    );
                    const csv = [csvHeader, ...csvRows].join("\n");
                    if (!IS_DEMO) {
                      const { save } = await import("@tauri-apps/plugin-dialog");
                      const savePath = await save({
                        filters: [{ name: "CSV", extensions: ["csv"] }],
                        defaultPath: defaultName,
                        title: "Save metadata CSV",
                      });
                      if (!savePath) return;
                      const { invoke } = await import("@tauri-apps/api/core");
                      await invoke("write_text_file", { path: savePath, content: csv });
                      const fileName = savePath.split(/[/\\]/).pop();
                      showToast(`Saved metadata CSV: ${fileName}`);
                    } else {
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = defaultName;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      showToast(`Exported metadata CSV for ${rows.length} photo${rows.length !== 1 ? "s" : ""}`);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[#2a2820] text-[#c8bfa8] hover:bg-[var(--accent-a10)] hover:text-[var(--accent)] transition-colors disabled:opacity-40"
                  title="Export photo metadata as CSV"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                  </svg>
                  Metadata CSV
                </button>
                {!IS_DEMO && (
                  <button
                    disabled={selectedPaths.size === 0}
                    onClick={() => {
                      const count = selectedPaths.size;
                      if (!window.confirm(`Remove ${count} photo${count !== 1 ? "s" : ""} from the library? Files on disk will not be deleted.`)) return;
                      Array.from(selectedPaths).forEach((path) => deletePhoto({ path }));
                      clearSelection();
                      showToast(`Removed ${count} photo${count !== 1 ? "s" : ""} from library`);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                    Remove
                  </button>
                )}
                <button
                  onClick={() => { clearSelection(); setShowBatchTag(false); setShowBatchRate(false); setShowCollectionPicker(false); setBatchTagInput(""); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-[#2a2820] text-[#c8bfa8] hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[200] px-4 py-2.5 rounded-xl bg-[#2a2820] border border-white/12 shadow-2xl text-sm text-[#c8bfa8] font-mono pointer-events-none whitespace-nowrap"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <PhotoLightbox />
    </div>
  );
}

function NewCollectionFromSelection({ paths, onDone }: { paths: string[]; onDone: () => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { mutate: createCollection, isPending } = useCreatePhotoCollection();
  const { mutate: addToCollection } = useAddPhotosToCollection();

  if (!creating) {
    return (
      <button
        onClick={() => setCreating(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--accent-a12)] hover:bg-[var(--accent-a20)] text-[var(--accent)] transition-colors text-xs font-mono"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        New…
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            createCollection(
              { name: name.trim() },
              {
                onSuccess: (col) => {
                  addToCollection({ collectionId: col.id, paths });
                  onDone();
                },
              }
            );
          }
          if (e.key === "Escape") setCreating(false);
        }}
        placeholder="Collection name…"
        className="bg-[#2a2820] border border-white/10 rounded px-2 py-0.5 text-xs text-[#c8bfa8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors w-36"
      />
      <button
        disabled={!name.trim() || isPending}
        onClick={() => {
          if (!name.trim()) return;
          createCollection(
            { name: name.trim() },
            {
              onSuccess: (col) => {
                addToCollection({ collectionId: col.id, paths });
                onDone();
              },
            }
          );
        }}
        className="px-2 py-0.5 rounded bg-[var(--accent-a10)] text-[var(--accent)] text-xs disabled:opacity-40 hover:bg-[var(--accent-a20)] transition-colors"
      >
        {isPending ? "…" : "Create"}
      </button>
    </div>
  );
}

function OTDThumb({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const { data: thumbUrl } = usePhotoThumbnail(photo.path);
  const src = thumbUrl ?? (IS_DEMO ? photo.path : null);
  return (
    <button
      onClick={onClick}
      className="relative shrink-0 overflow-hidden hover:opacity-90 transition-opacity"
      style={{ width: 52, height: 76 }}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-[#1a1814]" />
      )}
      <div className="absolute inset-0 bg-black/20" />
    </button>
  );
}

function OnThisDayBanner({ photos, onOpen }: { photos: Photo[]; onOpen: (photos: Photo[], idx: number) => void }) {
  const today = new Date();
  const label = today.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const years = [...new Set(photos.map((p) => p.date_taken ? new Date(p.date_taken * 1000).getFullYear() : null).filter(Boolean))] as number[];
  const yearsLabel = years.length === 1 ? `${years[0]}` : years.length === 2 ? `${years[0]} & ${years[1]}` : `${Math.min(...years)} – ${Math.max(...years)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-10 mt-2 mb-4 rounded-xl overflow-hidden border border-white/8 bg-gradient-to-r from-[#1a1814] to-[#1f1c17]"
    >
      <div className="flex items-stretch">
        {/* Thumbnail strip */}
        <div className="flex gap-0.5 shrink-0 overflow-hidden" style={{ maxWidth: 260 }}>
          {photos.slice(0, 5).map((p, i) => (
            <OTDThumb key={p.path} photo={p} onClick={() => onOpen(photos, i)} />
          ))}
          {photos.length > 5 && (
            <div className="w-10 bg-[#1a1814] flex items-center justify-center shrink-0">
              <span className="text-[#5a5244] text-xs font-mono rotate-90">+{photos.length - 5}</span>
            </div>
          )}
        </div>
        {/* Text */}
        <div className="flex flex-col justify-center px-4 py-3 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            <span className="text-[10px] font-mono text-[var(--accent)] tracking-widest uppercase">On This Day</span>
          </div>
          <p className="text-[#f0ead8] text-sm font-medium">{label}</p>
          <p className="text-[#5a5244] text-xs mt-0.5">{photos.length} photo{photos.length !== 1 ? "s" : ""} from {yearsLabel}</p>
        </div>
        <button
          onClick={() => onOpen(photos, 0)}
          className="flex items-center gap-1.5 px-4 text-xs font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors shrink-0 border-l border-white/5"
        >
          View all
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

function TimelineSparkline({
  years,
  activeYear,
  onYearClick,
}: {
  years: (number | null)[];
  activeYear: number | null;
  onYearClick?: (year: number) => void;
}) {
  const { data: yearStats = [] } = usePhotoYearStats();
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const validYears = years.filter((y): y is number => y !== null);
  const barW = 6;
  const barGap = 2;
  const h = 32;
  if (validYears.length < 2) return null;

  const max = Math.max(...yearStats.map((s) => s.count), 1);
  const statsMap = new Map(yearStats.map((s) => [s.year, s.count]));

  const totalW = validYears.length * barW + (validYears.length - 1) * barGap;

  return (
    <div className="mb-2 relative" style={{ width: totalW }}>
      <div className="flex items-end" style={{ gap: barGap }}>
        {validYears.map((y) => {
          const count = statsMap.get(y) ?? 0;
          const barH = Math.max(2, Math.round((count / max) * h));
          const isActive = y === activeYear;
          const isHovered = y === hoveredYear;
          return (
            <div
              key={y}
              style={{ width: barW, height: h, flexShrink: 0, position: "relative", cursor: onYearClick ? "pointer" : "default" }}
              onClick={() => onYearClick?.(y)}
              onMouseEnter={() => setHoveredYear(y)}
              onMouseLeave={() => setHoveredYear(null)}
            >
              <svg width={barW} height={h}>
                <rect
                  x={0} y={h - barH} width={barW} height={barH} rx={1}
                  fill={isActive ? "var(--accent)" : isHovered ? "#7a7060" : count > 0 ? "#3a3628" : "#1a1814"}
                  style={{ transition: "fill 0.1s" }}
                />
              </svg>
            </div>
          );
        })}
      </div>
      {hoveredYear !== null && (() => {
        const idx = validYears.indexOf(hoveredYear);
        const count = statsMap.get(hoveredYear) ?? 0;
        const tipLeft = idx * (barW + barGap) + barW / 2;
        return (
          <div
            style={{
              position: "absolute",
              bottom: h + 4,
              left: tipLeft,
              transform: "translateX(-50%)",
              pointerEvents: "none",
              zIndex: 50,
            }}
          >
            <div className="bg-[#1f1d18] border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-[#c8bfa8] whitespace-nowrap shadow-lg">
              {hoveredYear}: {count.toLocaleString()}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function YearPill({ year, active, onClick }: { year: number; active: boolean; onClick: () => void }) {
  const { data: count } = usePhotoCountForYear(year);
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
        active ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"
      }`}
    >
      {year}
      {count !== undefined && (
        <span className={`text-[10px] ${active ? "text-[var(--accent)]/60" : "text-[#2a2820]"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function TagPill({ tag, onTagClick }: { tag: string; onTagClick: (tag: string) => void }) {
  const { data: count } = usePhotoCountForTag(tag);
  return (
    <button
      onClick={() => onTagClick(tag)}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1a1814] hover:bg-[var(--accent-a10)] text-[#c8bfa8] hover:text-[var(--accent)] transition-colors text-sm font-medium group"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {tag}
      {count !== undefined && (
        <span className="ml-1 text-xs text-[#5a5244] group-hover:text-[var(--accent)]/60 font-mono transition-colors">
          {count}
        </span>
      )}
    </button>
  );
}

function TagCloudPill({ tag, count, maxCount, onTagClick }: { tag: string; count: number; maxCount: number; onTagClick: (tag: string) => void }) {
  const scale = maxCount > 1 ? 0.7 + (count / maxCount) * 1.3 : 1;
  const opacity = 0.5 + (count / maxCount) * 0.5;
  return (
    <button
      onClick={() => onTagClick(tag)}
      className="px-2 py-1 rounded-lg hover:bg-[var(--accent-a10)] text-[#c8bfa8] hover:text-[var(--accent)] transition-all font-medium"
      style={{ fontSize: `${Math.round(scale * 14)}px`, opacity }}
      title={`${count} photo${count !== 1 ? "s" : ""}`}
    >
      #{tag}
    </button>
  );
}

function TagsView({ tags, onTagClick }: { tags: string[]; onTagClick: (tag: string) => void }) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"alpha" | "cloud">("alpha");

  if (tags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center mt-32 gap-3">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" stroke="currentColor" strokeWidth="1.5" />
          <line x1="7" y1="7" x2="7.01" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <p className="text-[#3a3628] text-sm">No tags yet</p>
        <p className="text-[#3a3628] text-xs">Open a photo and add tags from the lightbox info panel</p>
      </div>
    );
  }

  const filtered = search ? tags.filter((t) => t.toLowerCase().includes(search.toLowerCase())) : tags;

  // Group by first letter
  const groups = new Map<string, string[]>();
  filtered.forEach((tag) => {
    const letter = tag[0].toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(tag);
  });

  return (
    <div className="overflow-y-auto h-full px-10 py-4">
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
        />
        <span className="text-[#3a3628] text-xs font-mono">{filtered.length} tags</span>
        <div className="ml-auto flex items-center border border-white/7 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode("alpha")}
            className={`px-3 py-1.5 text-xs font-mono transition-colors ${viewMode === "alpha" ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
          >A–Z</button>
          <button
            onClick={() => setViewMode("cloud")}
            className={`px-3 py-1.5 text-xs font-mono transition-colors border-l border-white/7 ${viewMode === "cloud" ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
          >Cloud</button>
        </div>
      </div>

      {viewMode === "cloud" ? (
        <TagCloudView tags={filtered} onTagClick={onTagClick} />
      ) : (
        Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([letter, groupTags]) => (
          <div key={letter} className="mb-5">
            <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-2">{letter}</p>
            <div className="flex flex-wrap gap-2.5">
              {groupTags.map((tag) => (
                <TagPill key={tag} tag={tag} onTagClick={onTagClick} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TagCloudItem({ tag, onTagClick }: { tag: string; onTagClick: (tag: string) => void }) {
  const { data: count = 1 } = usePhotoCountForTag(tag);
  return <TagCloudPill tag={tag} count={count} maxCount={100} onTagClick={onTagClick} />;
}

function TagCloudView({ tags, onTagClick }: { tags: string[]; onTagClick: (tag: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 items-baseline justify-start">
      {tags.map((tag) => (
        <TagCloudItem key={tag} tag={tag} onTagClick={onTagClick} />
      ))}
    </div>
  );
}

const MONTH_NAMES_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const TimelineThumb = memo(function TimelineThumb({ photo, onClick }: { photo: Photo; onClick: () => void }) {
  const { data: thumbUrl } = usePhotoThumbnail(photo.path);
  const src = thumbUrl ?? (IS_DEMO ? photo.path : null);
  const [err, setErr] = useState(false);
  return (
    <div
      className="w-24 h-24 shrink-0 rounded-lg overflow-hidden cursor-pointer bg-[#1a1814] hover:ring-2 ring-[var(--accent)]/50 transition-all"
      onClick={onClick}
      title={photo.name}
    >
      {src && !err ? (
        <img
          src={src} alt={photo.name}
          className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M3 15l5-5 4 4 2-2 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
});

function MonthTimelineSection({
  year, month, onViewAll, onPhotoClick,
}: {
  year: number; month: number;
  onViewAll: () => void;
  onPhotoClick: (photos: Photo[], idx: number) => void;
}) {
  const { data: photos = [] } = usePhotosPage("", "date_asc", null, year, month, null, false, null, 0);
  const { data: count = 0 } = usePhotosCount("", "date_asc", null, year, month, null, false, null);

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-[#c8bfa8] font-semibold text-base" style={{ fontFamily: "Fraunces, serif" }}>
          {MONTH_NAMES_FULL[month - 1]}
        </h3>
        <span className="text-[#3a3628] text-xs font-mono">{count} photo{count !== 1 ? "s" : ""}</span>
        <button
          onClick={onViewAll}
          className="ml-auto flex items-center gap-1 text-[10px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
        >
          View all
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
      {photos.length === 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-24 h-24 shrink-0 rounded-lg bg-[#1a1814] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {photos.map((p, i) => (
            <TimelineThumb key={p.path} photo={p} onClick={() => onPhotoClick(photos, i)} />
          ))}
          {count > photos.length && (
            <button
              onClick={onViewAll}
              className="w-24 h-24 shrink-0 rounded-lg bg-[#1a1814] hover:bg-[var(--accent-a10)] border border-white/8 hover:border-[var(--accent)]/30 text-[#5a5244] hover:text-[var(--accent)] transition-all flex flex-col items-center justify-center gap-1.5"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
              </svg>
              <span className="text-[10px] font-mono">+{count - photos.length}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoTimelineGrouped({
  year, months, onMonthClick, onPhotoClick, onBackToYears,
}: {
  year: number;
  months: number[];
  onMonthClick: (month: number) => void;
  onPhotoClick: (photos: Photo[], idx: number) => void;
  onBackToYears: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setShowScrollTop(el.scrollTop > 200);
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  if (months.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-[#3a3628] text-sm">No photos found in {year}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {/* Year header */}
      <div className="px-10 pt-4 pb-3 shrink-0 flex items-center gap-3">
        <button
          onClick={onBackToYears}
          className="flex items-center gap-1.5 text-[11px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All years
        </button>
        <span className="text-[#2a2820] text-sm">/</span>
        <h2 className="text-[#c8bfa8] text-lg font-medium" style={{ fontFamily: "Fraunces, serif" }}>{year}</h2>
        <span className="text-[#3a3628] text-xs font-mono">{months.length} month{months.length !== 1 ? "s" : ""}</span>
      </div>
      <div ref={scrollRef} className="overflow-y-auto flex-1 px-10 pb-4">
        {[...months].sort((a, b) => b - a).map((month) => (
          <MonthTimelineSection
            key={month}
            year={year}
            month={month}
            onViewAll={() => onMonthClick(month)}
            onPhotoClick={onPhotoClick}
          />
        ))}
      </div>
      {/* Scroll to top */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="absolute bottom-6 right-6 w-9 h-9 rounded-full bg-[#1a1814] border border-white/10 shadow-xl flex items-center justify-center text-[#5a5244] hover:text-[var(--accent)] hover:border-[var(--accent)]/30 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
