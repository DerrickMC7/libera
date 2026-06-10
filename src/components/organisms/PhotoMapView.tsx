import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Photo } from "../../types/photo";
import { useGpsPhotos } from "../../hooks/usePhotos";
import { usePhotoStore } from "../../store/photoStore";
import { usePhotoThumbnail } from "../../hooks/usePhotoThumbnail";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

function PhotoThumb({ photo, size }: { photo: Photo; size: number }) {
  const { data: thumbUrl } = usePhotoThumbnail(photo.path);
  const src = thumbUrl || (IS_DEMO ? photo.path : null);
  if (!src) return <div className="w-full h-full bg-[#1a1814]" />;
  return (
    <img
      src={src}
      alt={photo.name}
      className="w-full h-full object-cover"
      loading="lazy"
    />
  );
}

interface Cluster {
  key: string;
  lat: number;
  lon: number;
  photos: Photo[];
  label: string;
}

function clusterPhotos(photos: Photo[], precision: number): Cluster[] {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    if (p.gps_lat == null || p.gps_lon == null) continue;
    const lat = Math.round(p.gps_lat * precision) / precision;
    const lon = Math.round(p.gps_lon * precision) / precision;
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const clusters: Cluster[] = [];
  map.forEach((ps, key) => {
    const avgLat = ps.reduce((s, p) => s + (p.gps_lat ?? 0), 0) / ps.length;
    const avgLon = ps.reduce((s, p) => s + (p.gps_lon ?? 0), 0) / ps.length;
    clusters.push({ key, lat: avgLat, lon: avgLon, photos: ps, label: key });
  });
  return clusters.sort((a, b) => b.photos.length - a.photos.length);
}

function formatCoord(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lonStr}`;
}

export function PhotoMapView() {
  const { data: gpsPhotos = [], isLoading } = useGpsPhotos();
  const { openLightbox } = usePhotoStore();
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [precision, setPrecision] = useState(10);

  const clusters = useMemo(() => clusterPhotos(gpsPhotos, precision), [gpsPhotos, precision]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (gpsPhotos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <p className="text-[#3a3628] text-sm">No photos with GPS data</p>
        <p className="text-[#3a3628] text-xs text-center max-w-xs">
          Photos taken with GPS-enabled cameras or phones will appear here grouped by location.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-0 overflow-hidden">
      {/* Cluster list */}
      <div className="w-72 shrink-0 border-r border-white/8 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[#f0ead8] text-sm font-medium">Locations</p>
            <p className="text-[#3a3628] text-xs font-mono mt-0.5">{gpsPhotos.length} photos · {clusters.length} places</p>
          </div>
          <div className="flex items-center gap-1 border border-white/7 rounded-lg overflow-hidden">
            {([5, 10, 100] as const).map((p, i) => (
              <button
                key={p}
                onClick={() => setPrecision(p)}
                title={p === 5 ? "Broad clusters" : p === 10 ? "Medium clusters" : "Fine clusters"}
                className={`px-2 py-1 text-[10px] font-mono transition-colors ${i > 0 ? "border-l border-white/7" : ""} ${precision === p ? "bg-[var(--accent-a10)] text-[var(--accent)]" : "text-[#3a3628] hover:text-[#7a7060]"}`}
              >
                {p === 5 ? "Broad" : p === 10 ? "Mid" : "Fine"}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto flex-1 py-1">
          {clusters.map((cluster) => (
            <button
              key={cluster.key}
              onClick={() => setSelectedCluster(cluster)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left group ${
                selectedCluster?.key === cluster.key
                  ? "bg-[var(--accent-a10)]"
                  : "hover:bg-white/5"
              }`}
            >
              <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/10 bg-[#1a1814]">
                <PhotoThumb photo={cluster.photos[0]} size={40} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[#c8bfa8] text-xs font-mono truncate">{formatCoord(cluster.lat, cluster.lon)}</p>
                <p className="text-[#5a5244] text-xs mt-0.5">
                  {cluster.photos.length} photo{cluster.photos.length !== 1 ? "s" : ""}
                </p>
              </div>
              {selectedCluster?.key === cluster.key && (
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          {selectedCluster ? (
            <motion.div
              key={selectedCluster.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col overflow-hidden"
            >
              {/* Map + header */}
              <div className="shrink-0 border-b border-white/8">
                <div className="px-6 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[#f0ead8] text-sm font-medium">{formatCoord(selectedCluster.lat, selectedCluster.lon)}</p>
                    <p className="text-[#3a3628] text-xs font-mono mt-0.5">{selectedCluster.photos.length} photo{selectedCluster.photos.length !== 1 ? "s" : ""} at this location</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openLightbox(selectedCluster.photos, 0)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)] text-xs font-mono transition-colors"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                      Slideshow
                    </button>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${selectedCluster.lat}&mlon=${selectedCluster.lon}&zoom=12`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-[11px] font-mono text-[#5a5244] hover:text-[var(--accent)] transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                      </svg>
                      Open on map
                    </a>
                  </div>
                </div>
                {/* Static map preview */}
                <div className="mx-6 mb-3 rounded-xl overflow-hidden border border-white/8 bg-[#1a1814]" style={{ height: 160 }}>
                  <img
                    src={`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${selectedCluster.lon},${selectedCluster.lat}&z=10&l=sat&size=600,160&pt=${selectedCluster.lon},${selectedCluster.lat},pm2rdl`}
                    alt="Map"
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.parentElement!.innerHTML = `<div class="w-full h-full flex items-center justify-center text-[#3a3628] text-xs font-mono">Map preview unavailable</div>`;
                    }}
                  />
                </div>
              </div>

              {/* Photo grid */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  {selectedCluster.photos.map((photo, i) => (
                    <button
                      key={photo.path}
                      onClick={() => openLightbox(selectedCluster.photos, i)}
                      className="relative aspect-square rounded-lg overflow-hidden bg-[#1a1814] group hover:ring-1 hover:ring-[var(--accent)]/40 transition-all"
                    >
                      <PhotoThumb photo={photo} size={150} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <p className="absolute bottom-1.5 left-0 right-0 text-center text-white/80 text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity px-1 truncate">
                        {photo.name}
                      </p>
                      {photo.is_favorite && (
                        <div className="absolute top-1.5 right-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="1">
                            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full gap-3"
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-[#3a3628]">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <p className="text-[#5a5244] text-sm">Select a location</p>
              <p className="text-[#3a3628] text-xs">{clusters.length} locations found</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
