import { useState, useMemo, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Video, VideoTab, VideoSortBy, isWatched, isInProgress, watchedPct } from "../../types/video";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAllVideos, useScanAndSaveVideos, useClearVideosLibrary,
  useSetVideoWatched, useToggleVideoFavorite, useDeleteVideoFromLibrary,
  useVideoThumb, pregenVideoThumbs,
} from "../../hooks/useVideos";
import { useVideoStore } from "../../store/videoStore";
import { VideoPlayer } from "./VideoPlayer";
import { useToastStore } from "../../store/toastStore";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(secs: number): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m} min`;
}

function qualityBadge(v: Video): string | null {
  const h = Math.min(v.width, v.height) || v.height;
  if (h >= 2100) return "4K";
  if (h >= 1050) return "FHD";
  if (h >= 700) return "HD";
  return null;
}

function epCode(v: Video): string {
  return `S${String(v.season).padStart(2, "0")}E${String(v.episode).padStart(2, "0")}`;
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortVideos(list: Video[], sortBy: VideoSortBy): Video[] {
  const sorted = [...list];
  switch (sortBy) {
    case "title":         sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
    case "date-desc":     sorted.sort((a, b) => b.date_added - a.date_added); break;
    case "date-asc":      sorted.sort((a, b) => a.date_added - b.date_added); break;
    case "duration-desc": sorted.sort((a, b) => b.duration_secs - a.duration_secs); break;
    case "duration-asc":  sorted.sort((a, b) => a.duration_secs - b.duration_secs); break;
    case "size-desc":     sorted.sort((a, b) => b.file_size - a.file_size); break;
  }
  return sorted;
}

/** Natural series order: season, then episode */
function episodeOrder(a: Video, b: Video): number {
  return a.season - b.season || a.episode - b.episode || a.title.localeCompare(b.title);
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface MenuState { video: Video; x: number; y: number }

function VideoContextMenu({ menu, onClose, onPlay }: {
  menu: MenuState; onClose: () => void; onPlay: (v: Video) => void;
}) {
  const { mutate: setWatched } = useSetVideoWatched();
  const { mutate: toggleFav } = useToggleVideoFavorite();
  const { mutate: deleteVideo } = useDeleteVideoFromLibrary();
  const { show: showToast } = useToastStore();
  const v = menu.video;
  const watched = isWatched(v);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("contextmenu", close); };
  }, [onClose]);

  const item = "w-full text-left px-3 py-1.5 text-xs text-[#c8bfa8] hover:bg-white/5 transition-colors flex items-center gap-2";

  return (
    <div
      className="fixed z-[90] bg-[#1a1814] border border-white/10 rounded-lg shadow-xl py-1.5 w-52"
      style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 230) }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className={item} onClick={() => { onPlay(v); onClose(); }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        Play
      </button>
      <button className={item} onClick={() => { setWatched({ path: v.path, watched: !watched }); onClose(); }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
        {watched ? "Mark as unwatched" : "Mark as watched"}
      </button>
      <button className={item} onClick={() => { toggleFav(v.path); onClose(); }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill={v.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        {v.is_favorite ? "Remove favorite" : "Add to favorites"}
      </button>
      {!IS_DEMO && (
        <>
          <div className="h-px bg-white/5 my-1" />
          <button className={item} onClick={() => { invoke("reveal_in_explorer", { path: v.path }).catch(() => showToast("Couldn't open Explorer")); onClose(); }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
            Show in Explorer
          </button>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-red-400/80 hover:bg-red-500/10 transition-colors flex items-center gap-2"
            onClick={() => { deleteVideo(v.path, { onSuccess: () => showToast("Removed from library") }); onClose(); }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /></svg>
            Remove from library
          </button>
        </>
      )}
    </div>
  );
}

// ── Thumbnail ────────────────────────────────────────────────────────────────

function Thumb({ path, className }: { path: string; className?: string }) {
  const { data: src, isPending, isError } = useVideoThumb(path);
  return (
    // NOTE: callers pass their own position class ("absolute inset-0"). Never
    // add `relative` here — a second position utility wins in the stylesheet
    // and collapses this box to 0 height (all children are absolute).
    <div className={`bg-[#111009] overflow-hidden ${className ?? "relative"}`}>
      {/* While generating: shimmer. On failure (or demo): static film icon. */}
      {!src && (
        <div className={`absolute inset-0 flex items-center justify-center ${isPending && !isError && !IS_DEMO ? "animate-pulse bg-[#16140f]" : ""}`}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        </div>
      )}
      {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />}
    </div>
  );
}

// ── Video card ───────────────────────────────────────────────────────────────

function VideoCard({ video, onPlay, onMenu, subtitle }: {
  video: Video;
  onPlay: () => void;
  onMenu: (e: React.MouseEvent) => void;
  subtitle?: string;
}) {
  const { mutate: toggleFav } = useToggleVideoFavorite();
  const watched = isWatched(video);
  const pct = watchedPct(video);
  const quality = qualityBadge(video);

  return (
    <div
      onClick={onPlay}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}
      className="group flex flex-col rounded-xl overflow-hidden bg-[#1a1814] border border-white/5 hover:border-[var(--accent)]/40 transition-all hover:shadow-lg text-left cursor-pointer"
    >
      <div className="aspect-video w-full relative">
        <Thumb path={video.path} className="absolute inset-0" />

        {/* Badges */}
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          {quality && <span className="text-[9px] font-mono bg-[var(--accent)]/85 text-black font-semibold px-1.5 py-0.5 rounded">{quality}</span>}
          <span className="text-[9px] font-mono uppercase bg-black/70 text-white/50 px-1.5 py-0.5 rounded">{video.format}</span>
        </div>
        {watched && (
          <span className="absolute top-2 left-2 z-10 bg-black/70 rounded-full p-1" title="Watched">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7ec77e" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
        )}
        {video.duration_secs > 0 && (
          <span className="absolute bottom-2 right-2 text-[9px] font-mono bg-black/70 text-white/70 px-1.5 py-0.5 rounded z-10">
            {formatDuration(video.duration_secs)}
          </span>
        )}

        {/* Favorite */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFav(video.path); }}
          className={`absolute bottom-2 left-2 z-10 p-1 rounded-full bg-black/50 transition-all ${video.is_favorite ? "text-[var(--accent)] opacity-100" : "text-white/60 opacity-0 group-hover:opacity-100"}`}
          title={video.is_favorite ? "Remove favorite" : "Add to favorites"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={video.is_favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 z-[5]">
          <div className="bg-black/60 rounded-full p-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>

        {/* Resume progress */}
        {isInProgress(video) && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60 z-10">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="p-3">
        <p className="text-[#c8bfa8] text-sm font-medium truncate leading-tight">{video.title}</p>
        <p className="text-[#3a3628] text-[10px] font-mono mt-1 truncate">
          {subtitle ?? formatBytes(video.file_size)}
        </p>
      </div>
    </div>
  );
}

// ── Incremental grid (renders more cards as you scroll) ─────────────────────

function VideoGrid({ videos, onPlay, onMenu, subtitleFor }: {
  videos: Video[];
  onPlay: (v: Video, list: Video[]) => void;
  onMenu: (v: Video, e: React.MouseEvent) => void;
  subtitleFor?: (v: Video) => string | undefined;
}) {
  const STEP = 48;
  const [visible, setVisible] = useState(STEP);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setVisible(STEP); }, [videos]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visible >= videos.length) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisible((n) => n + STEP);
    }, { rootMargin: "600px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible, videos.length]);

  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {videos.slice(0, visible).map((v) => (
          <VideoCard
            key={v.path}
            video={v}
            onPlay={() => onPlay(v, videos)}
            onMenu={(e) => onMenu(v, e)}
            subtitle={subtitleFor?.(v)}
          />
        ))}
      </div>
      {visible < videos.length && <div ref={sentinelRef} className="h-10" />}
    </>
  );
}

// ── Series ────────────────────────────────────────────────────────────────────

interface SeriesGroup {
  name: string;
  episodes: Video[];
  watchedCount: number;
  inProgress: Video | null; // most recently watched unfinished episode
}

function groupSeries(videos: Video[]): SeriesGroup[] {
  const map = new Map<string, Video[]>();
  for (const v of videos) {
    if (!v.series) continue;
    const list = map.get(v.series) ?? [];
    list.push(v);
    map.set(v.series, list);
  }
  return [...map.entries()]
    .map(([name, episodes]) => {
      episodes.sort(episodeOrder);
      const inProgressEps = episodes.filter(isInProgress).sort((a, b) => b.last_watched - a.last_watched);
      return {
        name,
        episodes,
        watchedCount: episodes.filter(isWatched).length,
        inProgress: inProgressEps[0] ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function SeriesCard({ group, onOpen }: { group: SeriesGroup; onOpen: () => void }) {
  const cover = group.inProgress ?? group.episodes[0];
  const seasons = new Set(group.episodes.map((e) => e.season)).size;
  const pct = group.episodes.length > 0 ? (group.watchedCount / group.episodes.length) * 100 : 0;

  return (
    <div
      onClick={onOpen}
      className="group flex flex-col rounded-xl overflow-hidden bg-[#1a1814] border border-white/5 hover:border-[var(--accent)]/40 transition-all hover:shadow-lg cursor-pointer"
    >
      <div className="aspect-video w-full relative">
        <Thumb path={cover.path} className="absolute inset-0" />
        <span className="absolute top-2 right-2 text-[9px] font-mono bg-black/70 text-white/70 px-1.5 py-0.5 rounded z-10">
          {seasons > 1 ? `${seasons} seasons` : `${group.episodes.length} ep`}
        </span>
        {pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60 z-10">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <div className="bg-black/60 rounded-full px-4 py-2 text-white text-xs font-mono">Open series</div>
        </div>
      </div>
      <div className="p-3">
        <p className="text-[#c8bfa8] text-sm font-medium truncate leading-tight">{group.name}</p>
        <p className="text-[#3a3628] text-[10px] font-mono mt-1">
          {group.episodes.length} episodes · {group.watchedCount} watched
        </p>
      </div>
    </div>
  );
}

function EpisodeRow({ video, onPlay, onMenu }: {
  video: Video; onPlay: () => void; onMenu: (e: React.MouseEvent) => void;
}) {
  const watched = isWatched(video);
  const pct = watchedPct(video);

  return (
    <div
      onClick={onPlay}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}
      className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5 cursor-pointer transition-colors"
    >
      <div className="w-32 shrink-0 aspect-video rounded-md overflow-hidden relative">
        <Thumb path={video.path} className="absolute inset-0" />
        {isInProgress(video) && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60">
            <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[#c8bfa8] text-sm truncate">
          <span className="font-mono text-[10px] text-[var(--accent)] mr-2">{epCode(video)}</span>
          {video.title}
        </p>
        <p className="text-[#3a3628] text-[10px] font-mono mt-0.5">
          {video.duration_secs > 0 ? formatDuration(video.duration_secs) : formatBytes(video.file_size)}
          {isInProgress(video) && ` · ${Math.round(pct)}% watched`}
        </p>
      </div>
      {watched && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7ec77e" strokeWidth="2.5" className="shrink-0 mr-2"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </div>
  );
}

function SeriesDetail({ group, onBack, onPlay, onMenu }: {
  group: SeriesGroup;
  onBack: () => void;
  onPlay: (v: Video, list: Video[]) => void;
  onMenu: (v: Video, e: React.MouseEvent) => void;
}) {
  const seasons = useMemo(() => {
    const m = new Map<number, Video[]>();
    for (const ep of group.episodes) {
      const list = m.get(ep.season) ?? [];
      list.push(ep);
      m.set(ep.season, list);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [group]);

  // "Continue": most recent in-progress episode, else first unwatched, else first
  const continueEp =
    group.inProgress ??
    group.episodes.find((e) => !isWatched(e)) ??
    group.episodes[0];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[#5a5244] hover:text-[#c8bfa8] text-xs font-mono transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" /></svg>
          All series
        </button>
        <h2 className="text-[#f0ead8] text-lg font-light flex-1" style={{ fontFamily: "Fraunces, serif" }}>{group.name}</h2>
        <span className="text-[#3a3628] text-xs font-mono">{group.watchedCount}/{group.episodes.length} watched</span>
        {continueEp && (
          <button
            onClick={() => onPlay(continueEp, group.episodes)}
            className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono px-4 py-1.5 rounded-full transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            {group.inProgress ? `Resume ${epCode(continueEp)}` : `Play ${epCode(continueEp)}`}
          </button>
        )}
      </div>

      {seasons.map(([season, eps]) => (
        <div key={season} className="mb-6">
          {seasons.length > 1 && (
            <h3 className="text-[#5a5244] text-xs font-mono uppercase tracking-widest mb-2">Season {season}</h3>
          )}
          <div className="flex flex-col">
            {eps.map((ep) => (
              <EpisodeRow key={ep.path} video={ep} onPlay={() => onPlay(ep, group.episodes)} onMenu={(e) => onMenu(ep, e)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS: { id: VideoTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "films", label: "Films" },
  { id: "series", label: "Series" },
  { id: "continue", label: "Continue" },
  { id: "favorites", label: "Favorites" },
];

export function VideoLibrary() {
  const { show: showToast } = useToastStore();
  const { data: videos = [], isLoading } = useAllVideos();
  const { mutate: scan, isPending: isScanning } = useScanAndSaveVideos();
  const { mutate: clearLibrary, isPending: isClearing } = useClearVideosLibrary();

  const {
    tab, setTab, search, setSearch, sortBy, setSortBy,
    openSeries, setOpenSeries, playing, play, closePlayer,
  } = useVideoStore();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const qc = useQueryClient();

  // Warm the on-disk thumbnail cache for the whole library in the background
  useEffect(() => {
    if (videos.length > 0) pregenVideoThumbs(qc, videos.map((v) => v.path));
  }, [videos, qc]);

  // ── Derived collections ────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const searched = useMemo(
    () => (q ? videos.filter((v) =>
      v.title.toLowerCase().includes(q) ||
      v.series.toLowerCase().includes(q) ||
      v.format.toLowerCase().includes(q)
    ) : videos),
    [videos, q]
  );

  const films       = useMemo(() => sortVideos(searched.filter((v) => !v.series), sortBy), [searched, sortBy]);
  const allSorted   = useMemo(() => sortVideos(searched, sortBy), [searched, sortBy]);
  const favorites   = useMemo(() => sortVideos(searched.filter((v) => v.is_favorite), sortBy), [searched, sortBy]);
  const continuing  = useMemo(
    () => searched.filter(isInProgress).sort((a, b) => b.last_watched - a.last_watched),
    [searched]
  );
  const seriesGroups = useMemo(() => groupSeries(searched), [searched]);
  const openGroup = openSeries ? seriesGroups.find((g) => g.name === openSeries) ?? null : null;

  const counts: Record<VideoTab, number> = {
    all: searched.length,
    films: films.length,
    series: seriesGroups.length,
    continue: continuing.length,
    favorites: favorites.length,
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleScan() {
    if (IS_DEMO) { showToast("Scanning not available in demo mode"); return; }
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      scan(selected as string, {
        onSuccess: (count) => showToast(`Scanned ${count} video${count !== 1 ? "s" : ""}`),
        onError: (e) => showToast("Scan failed — " + String(e).slice(0, 60)),
      });
    } catch (e) {
      showToast("Couldn't open folder picker — " + String(e).slice(0, 60));
    }
  }

  function handleClear() {
    clearLibrary(undefined, {
      onSuccess: () => showToast("Video library cleared"),
      onError: (e) => showToast("Clear failed — " + String(e).slice(0, 60)),
    });
  }

  const onPlay = (v: Video, list: Video[]) => play(v, list);
  const onMenu = (v: Video, e: React.MouseEvent) => setMenu({ video: v, x: e.clientX, y: e.clientY });

  // ── Empty library state ────────────────────────────────────────────────────
  if (videos.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="text-[#2a2820]">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <p className="text-[#f0ead8] text-lg font-light" style={{ fontFamily: "Fraunces, serif" }}>Your films, your rules</p>
          <p className="text-[#5a5244] text-sm leading-relaxed">
            Add a folder with your movies and series. Episodes named like
            <span className="font-mono text-[#7a7060]"> S01E02 </span>
            are grouped into series automatically, and your watch progress stays on your machine.
          </p>
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="mt-2 flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-6 py-3 rounded-full transition-colors disabled:opacity-60"
          >
            {isScanning ? (
              <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
              </svg>
            )}
            {isScanning ? "Scanning…" : "Add folder"}
          </button>
        </div>
      </div>
    );
  }

  const emptyTabMessage: Record<VideoTab, string> = {
    all: "No videos match your search",
    films: "No standalone films found",
    series: "No series detected — name episodes like ShowName S01E02 to group them",
    continue: "Nothing in progress — start watching something!",
    favorites: "No favorites yet — hover a card and tap the heart",
  };

  function renderTab() {
    if (tab === "series") {
      if (openGroup) {
        return <SeriesDetail group={openGroup} onBack={() => setOpenSeries(null)} onPlay={onPlay} onMenu={onMenu} />;
      }
      if (seriesGroups.length === 0) {
        return <p className="text-[#3a3628] text-sm text-center mt-16">{emptyTabMessage.series}</p>;
      }
      return (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {seriesGroups.map((g) => <SeriesCard key={g.name} group={g} onOpen={() => setOpenSeries(g.name)} />)}
        </div>
      );
    }

    const list =
      tab === "films" ? films :
      tab === "continue" ? continuing :
      tab === "favorites" ? favorites :
      allSorted;

    if (list.length === 0) {
      return <p className="text-[#3a3628] text-sm text-center mt-16">{emptyTabMessage[tab]}</p>;
    }

    return (
      <VideoGrid
        videos={list}
        onPlay={onPlay}
        onMenu={onMenu}
        subtitleFor={
          tab === "continue"
            ? (v) => (v.series ? `${v.series} · ${epCode(v)} · ${Math.round(watchedPct(v))}%` : `${Math.round(watchedPct(v))}% watched`)
            : (v) => (v.series ? `${v.series} · ${epCode(v)}` : undefined)
        }
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 pb-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-[#f0ead8] text-xl font-light" style={{ fontFamily: "Fraunces, serif" }}>Films</h1>
          <p className="text-[#3a3628] text-xs font-mono mt-0.5">
            {videos.length} video{videos.length !== 1 ? "s" : ""} · {seriesGroups.length} series
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="bg-[#1a1814] border border-white/7 rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#c8bfa8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors w-44"
          />
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3a3628]">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as VideoSortBy)}
          className="bg-[#1a1814] border border-white/7 rounded-lg px-2 py-1.5 text-xs text-[#7a7060] outline-none focus:border-[var(--accent)] transition-colors"
        >
          <option value="title">Title</option>
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="duration-desc">Longest</option>
          <option value="duration-asc">Shortest</option>
          <option value="size-desc">Largest file</option>
        </select>

        <button
          onClick={handleScan}
          disabled={isScanning}
          title="Add folder"
          className="flex items-center gap-2 bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)] text-xs font-mono px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
        >
          {isScanning ? (
            <svg width="13" height="13" viewBox="0 0 24 24" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          )}
          {isScanning ? "Scanning…" : "Add folder"}
        </button>

        <button
          onClick={handleClear}
          disabled={isClearing}
          title="Clear library"
          className="p-1.5 text-[#5a5244] hover:text-red-400 transition-colors disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 px-4 sm:px-8 pb-3 flex items-center gap-1.5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
              tab === t.id
                ? "bg-[var(--accent)] text-white"
                : "bg-[#1a1814] text-[#7a7060] hover:text-[#c8bfa8] border border-white/5"
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && <span className={tab === t.id ? "opacity-70" : "opacity-50"}> {counts[t.id]}</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          renderTab()
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <VideoContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onPlay={(v) => play(v, tab === "series" && openGroup ? openGroup.episodes : allSorted)}
        />
      )}

      {/* Player */}
      {playing && <VideoPlayer onClose={closePlayer} />}
    </div>
  );
}
