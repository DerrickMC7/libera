import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTracksCount, PAGE_SIZE } from "../hooks/useLibrary";
import { useAlbums } from "../hooks/useAlbums";
import { useArtists } from "../hooks/useArtists";
import { useBooks } from "../hooks/useBooks";
import { usePlayerStore } from "../store/playerStore";
import { useRecentSearchStore } from "../store/recentSearchStore";
import { useContextMenuStore } from "../store/contextMenuStore";
import { ArtistLinks } from "../components/atoms/ArtistLinks";
import { useLibraryStats, type LibraryStats, type StorageCategory } from "../hooks/useLibraryStats";
import { PdfReader } from "../components/organisms/PdfReader/PdfReader";
import { EpubViewer } from "../components/organisms/EpubViewer";
import { AlbumView } from "../components/organisms/AlbumView";
import { ArtistView } from "../components/organisms/ArtistView";
import { Tooltip } from "../components/atoms/Tooltip";
import { Track } from "../types/track";
import { Book } from "../types/book";
import { Album } from "../types/album";
import { Artist } from "../types/artist";

type Scope = "all" | "music" | "books";

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Reusable row components ─────────────────────────────────────────────────

function TrackItem({ track, isActive, focused, onClick }: {
  track: Track; isActive: boolean; focused: boolean; onClick: () => void;
}) {
  const showContextMenu = useContextMenuStore((s) => s.show);
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); showContextMenu(track, e.clientX, e.clientY); }}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        focused ? "bg-[var(--accent-a10)]" : isActive ? "bg-[var(--accent-a08)]" : "hover:bg-[#1a1814]"
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
      <span className={`text-sm truncate flex-1 ${isActive ? "text-[var(--accent)]" : "text-[#f0ead8]"}`} title={track.title}>
        {track.title}
      </span>
      <span className="text-xs text-[#3a3628] truncate max-w-[140px] shrink-0" title={track.artist}>
        <ArtistLinks artist={track.artist} />
      </span>
      <span className="text-xs font-mono text-[#3a3628] shrink-0 w-8 text-right">{formatDuration(track.duration_secs)}</span>
    </button>
  );
}


function BookItem({ book, focused, onClick }: { book: Book; focused: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
        focused ? "bg-[var(--accent-a10)]" : "hover:bg-[#1a1814]"
      }`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
        <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" />
      </svg>
      <span className="text-sm text-[#f0ead8] truncate flex-1" title={book.title}>{book.title}</span>
      <span className="text-xs font-mono text-[#3a3628] shrink-0 uppercase">{book.format}</span>
    </button>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-[9px] font-mono tracking-[0.18em] uppercase text-[#3a3628] px-3 pt-4 pb-1">
      {label}
    </p>
  );
}

// ─── Library stats panel ─────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}

function fmtDuration(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function CategoryRow({
  icon, label, cat, open, onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  cat: StorageCategory;
  open: boolean;
  onToggle: () => void;
}) {
  const empty = cat.total_count === 0;
  const maxBytes = Math.max(...cat.entries.map((e) => e.size_bytes), 1);

  return (
    <div>
      <button
        onClick={empty ? undefined : onToggle}
        className={`w-full flex items-center gap-2.5 py-2 ${empty ? "cursor-default" : "group"}`}
      >
        <span className={`shrink-0 ${empty ? "text-[#252320]" : "text-[#3a3628]"}`}>{icon}</span>
        <span className={`text-xs flex-1 text-left font-mono tracking-wide ${empty ? "text-[#2e2c24]" : "text-[#c8bfa8]"}`}>
          {label}
        </span>
        <span className={`text-xs font-mono tabular-nums ${empty ? "text-[#252320]" : "text-[#7a7060]"}`}>
          {empty ? "—" : fmtBytes(cat.total_size_bytes)}
        </span>
        {!empty && (
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
            className={`text-[#3a3628] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        )}
        {empty && <span className="w-[10px] shrink-0" />}
      </button>

      {open && !empty && (
        <div className="flex flex-col gap-1.5 pl-6 pb-2">
          {cat.entries.map((e) => (
            <div key={e.label} className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase text-[#4a4438] w-20 shrink-0 truncate">{e.label}</span>
              <div className="flex-1 h-[2px] bg-[#1e1c17] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full opacity-60"
                  style={{ width: `${(e.size_bytes / maxBytes) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-[#3a3628] w-14 text-right shrink-0 tabular-nums">
                {fmtBytes(e.size_bytes)}
              </span>
              <span className="text-[10px] font-mono text-[#2e2c24] text-right shrink-0 tabular-nums">
                {e.count.toLocaleString()} items
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryStatsPanel({ stats }: { stats: LibraryStats }) {
  const [open, toggle] = useReducer(
    (s: Record<string, boolean>, key: string) => ({ ...s, [key]: !s[key] }),
    {}
  );
  const totalBytes =
    stats.music.total_size_bytes +
    stats.videos.total_size_bytes +
    stats.books.total_size_bytes +
    stats.images.total_size_bytes;

  return (
    <div className="flex flex-col gap-5">

      {/* Header */}
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-mono text-[#f0ead8] tabular-nums">{fmtBytes(totalBytes)}</p>
        {stats.total_duration_secs > 0 && (
          <span className="text-xs font-mono text-[#5a5244]">{fmtDuration(stats.total_duration_secs)}</span>
        )}
      </div>

      {/* Categories — always all four */}
      <div className="flex flex-col divide-y divide-white/4">
        <CategoryRow
          open={!!open["music"]} onToggle={() => toggle("music")} label="Music"
          cat={stats.music}
          icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>}
        />
        <CategoryRow
          open={!!open["videos"]} onToggle={() => toggle("videos")} label="Videos"
          cat={stats.videos}
          icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" /></svg>}
        />
        <CategoryRow
          open={!!open["books"]} onToggle={() => toggle("books")} label="Books"
          cat={stats.books}
          icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" /></svg>}
        />
        <CategoryRow
          open={!!open["images"]} onToggle={() => toggle("images")} label="Images"
          cat={stats.images}
          icon={<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>}
        />
      </div>

    </div>
  );
}

// ─── Jaro-Winkler fuzzy matching ─────────────────────────────────────────────

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  const dist = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const am = new Array(la).fill(false);
  const bm = new Array(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - dist), hi = Math.min(i + dist + 1, lb);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let trans = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) trans++;
    k++;
  }
  return (matches / la + matches / lb + (matches - trans / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const score = jaro(a, b);
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return score + l * 0.1 * (1 - score);
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 1;
  const qw = q.split(/\s+/).filter(Boolean);
  const tw = t.split(/\s+/).filter(Boolean);
  if (!qw.length || !tw.length) return 0;
  let total = 0;
  for (const qWord of qw) {
    let best = 0;
    for (const tWord of tw) best = Math.max(best, jaroWinkler(qWord, tWord));
    total += best;
  }
  return total / qw.length;
}

const FUZZY_THRESHOLD = 0.78;

// ─── Main page ────────────────────────────────────────────────────────────────

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);

  // Viewers
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const { searches: recentSearches, add: addRecentSearch, remove: removeRecentSearch } = useRecentSearchStore();
  const { data: books = [] } = useBooks();

  // Library stats (idle)
  const { data: totalTracks = 0 } = useTracksCount("");
  const { data: allAlbums = [] } = useAlbums("", true);
  const { data: allArtists = [] } = useArtists("", true);

  // Search results
  const { data: trackCount = 0 } = useTracksCount(debouncedQuery);
  const { data: albumResults = [] } = useAlbums(debouncedQuery, !!debouncedQuery);
  const { data: artistResults = [] } = useArtists(debouncedQuery, !!debouncedQuery);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onFocusSearch() { inputRef.current?.focus(); }
    window.addEventListener("focus-search-bar", onFocusSearch);
    return () => window.removeEventListener("focus-search-bar", onFocusSearch);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setFocusedIndex(-1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Save to recent searches when results arrive
  useEffect(() => {
    if (debouncedQuery && (trackCount > 0 || albumResults.length > 0 || artistResults.length > 0)) {
      addRecentSearch(debouncedQuery);
    }
  }, [debouncedQuery, trackCount]);

  // Load track results
  useEffect(() => {
    if (!debouncedQuery.trim()) { setTracks([]); return; }
    setLoadingTracks(true);
    queryClient.fetchQuery({
      queryKey: ["tracks-page", debouncedQuery, 0, "title"],
      queryFn: () => invoke<Track[]>("get_tracks_page", {
        query: debouncedQuery, limit: PAGE_SIZE, offset: 0, sortBy: "title",
      }),
      staleTime: 1000 * 60 * 5,
    }).then((t) => { setTracks(t); setLoadingTracks(false); })
      .catch(() => setLoadingTracks(false));
  }, [debouncedQuery]);

  const filteredBooks = debouncedQuery
    ? books.filter((b) => b.title.toLowerCase().includes(debouncedQuery.toLowerCase()))
    : [];

  type NavItem =
    | { kind: "track"; data: Track }
    | { kind: "book";  data: Book };

  const navItems: NavItem[] = [];
  if (scope !== "books") tracks.forEach((t) => navItems.push({ kind: "track", data: t }));
  if (scope !== "music") filteredBooks.forEach((b) => navItems.push({ kind: "book", data: b }));

  const activateItem = useCallback((item: NavItem) => {
    if (item.kind === "track") { setQueue(tracks, tracks.indexOf(item.data)); setIsPlaying(true); }
    if (item.kind === "book")  { setSelectedBook(item.data); }
  }, [tracks]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setQuery(""); inputRef.current?.focus(); return; }
      if (!debouncedQuery) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, navItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, -1));
        if (focusedIndex <= 0) inputRef.current?.focus();
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        activateItem(navItems[focusedIndex]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [debouncedQuery, focusedIndex, navItems, activateItem]);

  const { data: libraryStats } = useLibraryStats();

  const hasResults = tracks.length > 0 || albumResults.length > 0 || artistResults.length > 0 || filteredBooks.length > 0;

  // Fuzzy fallback — only fires when SQL LIKE found nothing
  const fuzzyArtists = useMemo((): Artist[] => {
    if (!debouncedQuery || hasResults || debouncedQuery.length < 2) return [];
    return allArtists
      .map((a) => [a, fuzzyScore(debouncedQuery, a.name)] as [Artist, number])
      .filter(([, s]) => s >= FUZZY_THRESHOLD)
      .sort(([, a], [, b]) => b - a)
      .map(([a]) => a)
      .slice(0, 5);
  }, [debouncedQuery, hasResults, allArtists]);

  const fuzzyAlbums = useMemo((): Album[] => {
    if (!debouncedQuery || hasResults || debouncedQuery.length < 2) return [];
    return allAlbums
      .map((a) => [a, fuzzyScore(debouncedQuery, `${a.album} ${a.artist}`)] as [Album, number])
      .filter(([, s]) => s >= FUZZY_THRESHOLD)
      .sort(([, a], [, b]) => b - a)
      .map(([a]) => a)
      .slice(0, 5);
  }, [debouncedQuery, hasResults, allAlbums]);

  const hasFuzzyResults = fuzzyArtists.length > 0 || fuzzyAlbums.length > 0;

  // ─── Viewers ────────────────────────────────────────────────────────────────
  if (selectedAlbum)  return <AlbumView  album={selectedAlbum}   onBack={() => setSelectedAlbum(null)} />;
  if (selectedArtist) return <ArtistView artist={selectedArtist} onBack={() => setSelectedArtist(null)} />;
  if (selectedBook?.format === "pdf")  return <PdfReader   book={selectedBook} onClose={() => setSelectedBook(null)} />;
  if (selectedBook?.format === "epub") return <EpubViewer  book={selectedBook} onClose={() => setSelectedBook(null)} />;

  let navIdx = -1;
  function nextIdx() { return ++navIdx; }

  return (
    <div className="flex flex-col h-full bg-[#0e0d0b]">

      {/* Search bar */}
      <div className="px-10 pt-10 pb-5 shrink-0">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-[#3a3628] pointer-events-none"
            width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <Tooltip shortcut="Ctrl+F">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search everything..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-[#1a1814] border border-white/7 rounded-xl pl-11 pr-10 py-3 text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)]/40 transition-colors"
            />
          </Tooltip>
          {query && (
            <button onClick={() => { setQuery(""); inputRef.current?.focus(); }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#3a3628] hover:text-[#7a7060] transition-colors p-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          )}
        </div>

        {/* Scope tabs — only when there's a query */}
        {debouncedQuery && (
          <div className="flex gap-1 mt-3">
            {(["all", "music", "books"] as Scope[]).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`px-3 py-1 rounded-full text-xs font-mono tracking-widest uppercase transition-colors ${
                  scope === s ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"
                }`}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-6">

        {/* ── IDLE STATE ─────────────────────────────────────────────────── */}
        {!query && (
          <>
            {/* Library stats */}
            {totalTracks > 0 && (
              <p className="text-xs font-mono text-[#3a3628] mb-6">
                {totalTracks.toLocaleString()} tracks
                {" · "}
                {allAlbums.length.toLocaleString()} albums
                {" · "}
                {allArtists.length.toLocaleString()} artists
              </p>
            )}

            {/* Recent searches */}
            {recentSearches.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] font-mono tracking-[0.18em] uppercase text-[#3a3628]">Recent searches</p>
                  <button onClick={() => useRecentSearchStore.getState().clear()}
                    className="text-[9px] font-mono text-[#3a3628] hover:text-[#7a7060] transition-colors">
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((s) => (
                    <div key={s} className="flex items-center gap-1 bg-[#1a1814] border border-white/6 rounded-full px-3 py-1">
                      <button onClick={() => setQuery(s)} className="text-xs text-[#c8bfa8] hover:text-[#f0ead8] transition-colors">
                        {s}
                      </button>
                      <button onClick={() => removeRecentSearch(s)} className="text-[#3a3628] hover:text-[#7a7060] transition-colors ml-1">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Library stats panel */}
            {libraryStats && libraryStats.music.total_count > 0 && (
              <LibraryStatsPanel stats={libraryStats} />
            )}

            {/* Empty library */}
            {totalTracks === 0 && recentSearches.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 gap-2">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                <p className="text-[#3a3628] text-sm">Search tracks, albums, artists, books…</p>
              </div>
            )}
          </>
        )}

        {/* ── NO EXACT RESULTS ───────────────────────────────────────────── */}
        {query && !loadingTracks && !hasResults && (
          <div className="flex flex-col">
            <p className="text-[#3a3628] text-sm mt-20 text-center">
              No results for "<span className="text-[#7a7060]">{query}</span>"
            </p>

            {hasFuzzyResults && (
              <div className="mt-8">
                <p className="text-[9px] font-mono tracking-[0.18em] uppercase text-[#3a3628] mb-3">
                  Did you mean…
                </p>
                <div className="flex flex-wrap gap-1.5 px-1">
                  {fuzzyArtists.map((artist) => (
                    <button key={artist.name} onClick={() => setSelectedArtist(artist)}
                      className="flex items-center gap-1.5 bg-[#1a1814] border border-white/6 rounded-full px-2.5 py-1 text-[11px] text-[#c8bfa8] hover:text-[#f0ead8] hover:border-white/12 transition-colors">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                      </svg>
                      {artist.name}
                    </button>
                  ))}
                  {fuzzyAlbums.map((album) => (
                    <button key={`${album.artist}-${album.album}`} onClick={() => setSelectedAlbum(album)}
                      className="flex items-center gap-1.5 bg-[#1a1814] border border-white/6 rounded-full px-2.5 py-1 text-[11px] text-[#c8bfa8] hover:text-[#f0ead8] hover:border-white/12 transition-colors">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                      </svg>
                      {album.album}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── RESULTS ────────────────────────────────────────────────────── */}
        {hasResults && (
          <div className="flex flex-col gap-0.5">

            {/* Tracks */}
            {scope !== "books" && tracks.length > 0 && (
              <>
                <SectionLabel label={`Tracks — ${trackCount}`} />
                {tracks.map((track) => {
                  const idx = nextIdx();
                  return (
                    <TrackItem key={track.path} track={track} focused={focusedIndex === idx}
                      isActive={currentTrack?.path === track.path}
                      onClick={() => { setQueue(tracks, tracks.indexOf(track)); setIsPlaying(true); }} />
                  );
                })}
                {trackCount > tracks.length && (
                  <p className="text-[10px] font-mono text-[#3a3628] px-3 pt-1">
                    +{trackCount - tracks.length} more — try a more specific query
                  </p>
                )}
              </>
            )}

            {/* Books */}
            {scope !== "music" && filteredBooks.length > 0 && (
              <>
                <SectionLabel label={`Books — ${filteredBooks.length}`} />
                {filteredBooks.map((book) => {
                  const idx = nextIdx();
                  return (
                    <BookItem key={book.path} book={book} focused={focusedIndex === idx}
                      onClick={() => setSelectedBook(book)} />
                  );
                })}
              </>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
