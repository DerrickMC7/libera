import { usePhotoStats, usePhotoYearStats, usePhotoFormatStats, usePhotoCameraStats, useGpsPhotos, useAllPhotoTags, usePhotosCount } from "../../hooks/usePhotos";
import { usePhotoStore } from "../../store/photoStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatCard({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  return (
    <div
      className={`bg-[#1a1814] rounded-xl p-5 flex flex-col gap-1.5 border border-white/5 ${onClick ? "cursor-pointer hover:border-[var(--accent)]/30 transition-colors" : ""}`}
      onClick={onClick}
    >
      <p className="text-[10px] font-mono text-[#3a3628] uppercase tracking-widest">{label}</p>
      <p className="text-[#f0ead8] text-2xl font-light" style={{ fontFamily: "Fraunces, serif" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[#5a5244] text-xs font-mono">{sub}</p>}
    </div>
  );
}

function RatingDistribution() {
  const { data: c1 = 0 } = usePhotosCount("", "date_desc", null, null, null, null, false, null, null, 1);
  const { data: c2 = 0 } = usePhotosCount("", "date_desc", null, null, null, null, false, null, null, 2);
  const { data: c3 = 0 } = usePhotosCount("", "date_desc", null, null, null, null, false, null, null, 3);
  const { data: c4 = 0 } = usePhotosCount("", "date_desc", null, null, null, null, false, null, null, 4);
  const { data: c5 = 0 } = usePhotosCount("", "date_desc", null, null, null, null, false, null, null, 5);
  if (c1 === 0) return null;

  const counts = [c5, c2 - c1 <= 0 ? 0 : 0, 0, 0, 0];
  const stars = [
    { stars: 5, count: c5 },
    { stars: 4, count: c4 - c5 },
    { stars: 3, count: c3 - c4 },
    { stars: 2, count: c2 - c3 },
    { stars: 1, count: c1 - c2 },
  ];
  void counts;
  const max = Math.max(...stars.map((s) => s.count), 1);

  return (
    <section>
      <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-4">
        Rating Distribution <span className="normal-case">({c1.toLocaleString()} rated)</span>
      </p>
      <div className="space-y-2">
        {stars.map(({ stars: n, count }) => (
          <div key={n} className="flex items-center gap-3">
            <div className="flex gap-0.5 w-20 justify-end shrink-0">
              {Array.from({ length: n }).map((_, i) => (
                <svg key={i} width="10" height="10" viewBox="0 0 24 24" fill="var(--accent)" stroke="none">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ))}
            </div>
            <div className="flex-1 h-2 bg-[#1a1814] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${max > 0 ? (count / max) * 100 : 0}%`, background: "var(--accent)", opacity: 0.7 }}
              />
            </div>
            <span className="w-10 text-right text-[11px] font-mono text-[#5a5244] shrink-0">{count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HBar({ label, value, max, onClick }: { label: string; value: number; max: number; onClick?: () => void }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div
      className={`flex items-center gap-3 group ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <div className="w-28 shrink-0 text-[11px] font-mono text-[#c8bfa8] truncate text-right group-hover:text-[var(--accent)] transition-colors">{label}</div>
      <div className="flex-1 h-2 bg-[#1a1814] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--accent)", opacity: 0.7 }}
        />
      </div>
      <span className="w-10 text-right text-[11px] font-mono text-[#5a5244] shrink-0">{value.toLocaleString()}</span>
    </div>
  );
}

export function PhotoStatsView() {
  const { data: stats } = usePhotoStats();
  const { data: yearStats = [] } = usePhotoYearStats();
  const { data: formatStats = [] } = usePhotoFormatStats();
  const { data: cameraStats = [] } = usePhotoCameraStats();
  const { data: gpsPhotos = [] } = useGpsPhotos();
  const { data: allTags = [] } = useAllPhotoTags();
  const { setViewWithYearFilter, setView, setCameraFilter, setFormatFilter } = usePhotoStore();

  const maxYearCount = Math.max(...yearStats.map((s) => s.count), 1);
  const maxFmtCount = Math.max(...formatStats.map((s) => s.count), 1);
  const maxCamCount = Math.max(...cameraStats.map((s) => s.count), 1);

  const mostActiveYear = yearStats.length > 0
    ? [...yearStats].sort((a, b) => b.count - a.count)[0]
    : null;
  const activeYearCount = yearStats.filter((s) => s.count > 0).length;
  const avgPerYear = activeYearCount > 0 && stats
    ? Math.round(stats.total / activeYearCount)
    : null;
  const avgFileSize = stats && stats.total > 0
    ? formatBytes(stats.total_size / stats.total)
    : null;

  return (
    <div className="h-full overflow-y-auto px-10 py-6">
      <div className="max-w-3xl space-y-8">
        {/* Summary cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total photos" value={stats.total} />
            <StatCard label="Favorites" value={stats.favorites} sub={`${stats.total > 0 ? ((stats.favorites / stats.total) * 100).toFixed(1) : 0}% of library`} />
            <StatCard label="Albums" value={stats.albums} />
            <StatCard label="Library size" value={formatBytes(stats.total_size)} />
            {gpsPhotos.length > 0 && (
              <StatCard
                label="With GPS"
                value={gpsPhotos.length}
                sub={`${stats.total > 0 ? ((gpsPhotos.length / stats.total) * 100).toFixed(1) : 0}% geotagged`}
              />
            )}
            {allTags.length > 0 && (
              <StatCard label="Unique tags" value={allTags.length} />
            )}
            {cameraStats.filter((c) => c.camera !== "Unknown").length > 0 && (
              <StatCard label="Cameras" value={cameraStats.filter((c) => c.camera !== "Unknown").length} />
            )}
            {formatStats.length > 0 && (
              <StatCard label="Formats" value={formatStats.length} />
            )}
            {mostActiveYear && (
              <StatCard
                label="Most active year"
                value={mostActiveYear.year}
                sub={`${mostActiveYear.count.toLocaleString()} photos`}
                onClick={() => setViewWithYearFilter("timeline", mostActiveYear.year)}
              />
            )}
            {avgPerYear !== null && activeYearCount > 1 && (
              <StatCard
                label="Avg per year"
                value={avgPerYear.toLocaleString()}
                sub={`across ${activeYearCount} years`}
              />
            )}
            {avgFileSize !== null && (
              <StatCard label="Avg file size" value={avgFileSize} />
            )}
          </div>
        )}

        {/* Photos by year */}
        {yearStats.length > 0 && (
          <section>
            <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-4">Photos by Year</p>
            <div className="space-y-2">
              {[...yearStats].sort((a, b) => b.year - a.year).map((s) => (
                <HBar
                  key={s.year}
                  label={String(s.year)}
                  value={s.count}
                  max={maxYearCount}
                  onClick={() => setViewWithYearFilter("all", s.year)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Photos by format */}
        {formatStats.length > 0 && (
          <section>
            <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-4">Formats</p>
            <div className="space-y-2">
              {formatStats.map((s) => (
                <HBar
                  key={s.format}
                  label={s.format.toUpperCase()}
                  value={s.count}
                  max={maxFmtCount}
                  onClick={() => { setView("all"); setFormatFilter(s.format); }}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {formatStats.map((s) => (
                <div key={s.format} className="bg-[#1a1814] rounded-lg px-3 py-1.5 text-[10px] font-mono text-[#5a5244]">
                  {s.format.toUpperCase()} · {formatBytes(s.size)}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Photos by camera */}
        {cameraStats.length > 0 && (
          <section>
            <p className="text-[10px] font-mono text-[#3a3628] tracking-widest uppercase mb-4">Cameras</p>
            <div className="space-y-2">
              {cameraStats.map((s) => (
                <HBar
                  key={s.camera}
                  label={s.camera}
                  value={s.count}
                  max={maxCamCount}
                  onClick={s.camera !== "Unknown" ? () => { setView("all"); setCameraFilter(s.camera); } : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* Rating distribution */}
        <RatingDistribution />

        {/* No data */}
        {(!stats || stats.total === 0) && (
          <div className="flex flex-col items-center justify-center mt-32 gap-3">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
              <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="text-[#3a3628] text-sm">No photos to analyze yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
