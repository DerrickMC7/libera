import { useState } from "react";
import { PhotoAlbum } from "../../types/photo";
import { PhotoAlbumCard } from "../molecules/PhotoAlbumCard";
import { usePhotoAlbums, usePhotosCount, useGpsPhotos, usePhotoCameraStats, usePhotoYearStats, usePhotosPage } from "../../hooks/usePhotos";
import { usePhotoStore } from "../../store/photoStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

type AlbumSort = "name" | "count";

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY_STR = new Date().toISOString().slice(0, 10);
const LAST_30_FROM = dateNDaysAgo(30);

function SmartAlbumPill({
  label, icon, count, onClick,
}: { label: string; icon: React.ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#1a1814] hover:bg-[var(--accent-a10)] text-[#c8bfa8] hover:text-[var(--accent)] transition-colors text-sm group"
    >
      <span className="text-[#5a5244] group-hover:text-[var(--accent)] transition-colors">{icon}</span>
      <span className="font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-xs font-mono text-[#5a5244] group-hover:text-[var(--accent)]/60 transition-colors">{count}</span>
      )}
    </button>
  );
}

export function PhotoAlbumGrid() {
  const { data: rawAlbums = [], isLoading } = usePhotoAlbums();
  const { setViewWithAlbumFilter, setViewWithYearFilter, setViewWithDateFilter, setView, setMinRatingFilter, setCameraFilter, setOrientationFilter } = usePhotoStore();
  const { data: gpsPhotos = [] } = useGpsPhotos();
  const { data: cameraStats = [] } = usePhotoCameraStats();
  const [search, setSearch] = useState("");
  const [albumSort, setAlbumSort] = useState<AlbumSort>("name");

  const { data: thisYearCount = 0 } = usePhotosCount("", "date_desc", null, currentYear, null, null, false, null);
  const { data: thisMonthCount = 0 } = usePhotosCount("", "date_desc", null, currentYear, currentMonth, null, false, null);
  const { data: favCount = 0 } = usePhotosCount("", "date_desc", null, null, null, null, true, null);
  const { data: topRatedCount = 0 } = usePhotosCount("", "rating_desc", null, null, null, null, false, null, null, 4);

  const sorted = [...rawAlbums].sort((a, b) =>
    albumSort === "count" ? b.count - a.count : a.name.localeCompare(b.name)
  );
  const filtered = search
    ? sorted.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.folder_path.toLowerCase().includes(search.toLowerCase())
      )
    : sorted;

  function openAlbum(album: PhotoAlbum) {
    setViewWithAlbumFilter("all", album.folder_path);
  }

  const ClockIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
  const CalendarIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
  const HeartIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  );

  if (isLoading) {
    return (
      <div className="px-4 sm:px-10 py-4 grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="rounded-xl aspect-square bg-[#1a1814] animate-pulse" />
            <div className="h-3.5 rounded bg-[#1a1814] animate-pulse w-3/4 mx-1" />
            <div className="h-3 rounded bg-[#1a1814] animate-pulse w-1/2 mx-1" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full px-4 sm:px-10 py-4">
      {/* Smart albums */}
      <div className="mb-6">
        <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-2.5">Smart Albums</p>
        <div className="flex flex-wrap gap-2.5">
          <SmartAlbumPill
            label="This Month"
            icon={ClockIcon}
            count={thisMonthCount}
            onClick={() => setViewWithYearFilter("all", currentYear, currentMonth)}
          />
          <SmartAlbumPill
            label="Last 30 Days"
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            }
            onClick={() => setViewWithDateFilter("all", LAST_30_FROM, TODAY_STR)}
          />
          <SmartAlbumPill
            label={`${currentYear}`}
            icon={CalendarIcon}
            count={thisYearCount}
            onClick={() => setViewWithYearFilter("all", currentYear)}
          />
          <SmartAlbumPill
            label="Favorites"
            icon={HeartIcon}
            count={favCount}
            onClick={() => setView("favorites")}
          />
          {topRatedCount > 0 && (
            <SmartAlbumPill
              label="Top Rated"
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" className="text-[var(--accent)]">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              }
              count={topRatedCount}
              onClick={() => { setView("all"); setMinRatingFilter(4); }}
            />
          )}
          {gpsPhotos.length > 0 && (
            <SmartAlbumPill
              label="On Map"
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
              }
              count={gpsPhotos.length}
              onClick={() => setView("map")}
            />
          )}
          <SmartAlbumPill
            label="Landscape"
            icon={
              <svg width="16" height="12" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="1" y="1" width="22" height="16" rx="2"/>
                <path d="M1 11l5-5 4 4 3-3 10 10" strokeLinejoin="round" strokeWidth="1.5"/>
              </svg>
            }
            onClick={() => { setView("all"); setOrientationFilter("landscape"); }}
          />
          <SmartAlbumPill
            label="Portrait"
            icon={
              <svg width="12" height="16" viewBox="0 0 18 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="1" y="1" width="16" height="22" rx="2"/>
                <circle cx="9" cy="9" r="2.5" strokeWidth="1.5"/>
                <path d="M3 18c1-3 4-5 6-5s5 2 6 5" strokeLinecap="round" strokeWidth="1.5"/>
              </svg>
            }
            onClick={() => { setView("all"); setOrientationFilter("portrait"); }}
          />
          <SmartAlbumPill
            label="Duplicates"
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="2" width="14" height="14" rx="2"/><rect x="8" y="8" width="14" height="14" rx="2"/>
              </svg>
            }
            onClick={() => setView("duplicates")}
          />
          <SmartAlbumPill
            label="Stats"
            icon={
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round"/>
              </svg>
            }
            onClick={() => setView("stats")}
          />
        </div>
      </div>

      {rawAlbums.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 gap-3">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
            <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="7.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2 15l6-6 4 4 2-2 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <p className="text-[#3a3628] text-sm">No albums yet</p>
          <p className="text-[#3a3628] text-xs">Albums are created from your folder structure</p>
        </div>
      ) : (
        <>
          {/* Folder albums header + search/sort */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mr-2">Folder Albums</p>
            <input
              type="text"
              placeholder="Search albums…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[140px] max-w-xs bg-[#1f1d18] border border-white/7 rounded-lg px-4 py-2 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors"
              style={{ fontSize: "16px" }}
            />
            <div className="flex items-center border border-white/7 rounded-lg overflow-hidden shrink-0">
              {(["name", "count"] as AlbumSort[]).map((s, i) => (
                <button
                  key={s}
                  onClick={() => setAlbumSort(s)}
                  className={`px-3 py-2 text-xs font-mono transition-colors ${albumSort === s ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"} ${i > 0 ? "border-l border-white/7" : ""}`}
                >
                  {s === "name" ? "A–Z" : "By count"}
                </button>
              ))}
            </div>
            {search && (
              <p className="text-[#3a3628] text-xs font-mono">
                {filtered.length} of {rawAlbums.length}
              </p>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center mt-20 gap-2">
              <p className="text-[#3a3628] text-sm">No albums match "{search}"</p>
            </div>
          ) : (
            <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              {filtered.map((album) => (
                <PhotoAlbumCard key={album.folder_path} album={album} onClick={() => openAlbum(album)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Year albums */}
      <YearAlbumsSection onYearClick={(y) => setViewWithYearFilter("timeline", y)} search={search} />

      {/* Camera albums */}
      {cameraStats.filter((c) => c.camera !== "Unknown").length > 0 && !search && (
        <div className="mt-8">
          <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-3">By Camera</p>
          <div className="flex flex-wrap gap-2">
            {cameraStats.filter((c) => c.camera !== "Unknown").map((c) => (
              <button
                key={c.camera}
                onClick={() => { setView("all"); setCameraFilter(c.camera); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1a1814] hover:bg-[var(--accent-a10)] text-[#c8bfa8] hover:text-[var(--accent)] transition-colors text-sm group"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                <span className="truncate max-w-[140px]">{c.camera}</span>
                <span className="text-xs font-mono text-[#5a5244] group-hover:text-[var(--accent)]/60 ml-auto shrink-0">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function YearCoverThumb({ year }: { year: number }) {
  const { data: page = [] } = usePhotosPage("", "date_asc", null, year, null, null, false, null, 0);
  const cover = page[0] ?? null;
  const { data: thumbUrl } = usePhotoThumbnail(cover?.path ?? null);
  const src = thumbUrl ?? (IS_DEMO && cover ? cover.path : null);
  const [err, setErr] = useState(false);

  if (src && !err) {
    return (
      <img
        src={src}
        alt={String(year)}
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#1a1814]">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.5"/>
        <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

function YearAlbumCard({ year, count, onClick }: { year: number; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-2 text-left"
    >
      <div className="relative rounded-xl overflow-hidden bg-[#1a1814] border border-white/5 group-hover:border-[var(--accent)]/30 transition-colors" style={{ aspectRatio: "1/1" }}>
        <YearCoverThumb year={year} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute bottom-2 left-3">
          <p className="text-white text-2xl font-light leading-none" style={{ fontFamily: "Fraunces, serif" }}>{year}</p>
        </div>
      </div>
      <p className="text-[#5a5244] text-xs font-mono px-1">{count.toLocaleString()} photo{count !== 1 ? "s" : ""}</p>
    </button>
  );
}

function YearAlbumsSection({ onYearClick, search }: { onYearClick: (year: number) => void; search: string }) {
  const { data: yearStats = [] } = usePhotoYearStats();
  if (yearStats.length < 2 || search) return null;
  const sorted = [...yearStats].sort((a, b) => b.year - a.year);
  return (
    <div className="mt-8">
      <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-3">By Year</p>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        {sorted.map((s) => (
          <YearAlbumCard key={s.year} year={s.year} count={s.count} onClick={() => onYearClick(s.year)} />
        ))}
      </div>
    </div>
  );
}
