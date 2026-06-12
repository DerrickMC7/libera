import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Video, SubtitleTrack } from "../types/video";

// The whole library is fetched in one query (metadata only — cheap even for
// thousands of files) so tabs/series grouping/filtering happen client-side
// without round-trips.
export function useAllVideos() {
  return useQuery({
    queryKey: ["videos-all"],
    queryFn: () => invoke<Video[]>("get_all_videos"),
    staleTime: 1000 * 60 * 5,
  });
}

function invalidateVideos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["videos-all"] });
  qc.invalidateQueries({ queryKey: ["library-stats"] });
}

export function useScanAndSaveVideos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => invoke<number>("scan_and_save_videos", { path }),
    onSuccess: () => invalidateVideos(qc),
  });
}

export function useClearVideosLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke("clear_videos_library"),
    onSuccess: () => invalidateVideos(qc),
  });
}

export function useUpdateVideoMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { path: string; durationSecs: number; width: number; height: number }) =>
      invoke("update_video_metadata", args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["videos-all"] }),
  });
}

/** Persist resume position. Does NOT invalidate on every save (called every
 *  few seconds during playback) — callers invalidate once on player close. */
export function useSetVideoProgress() {
  return useMutation({
    mutationFn: (args: { path: string; watchedSecs: number; durationSecs: number }) =>
      invoke("set_video_progress", args),
  });
}

export function useSetVideoWatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { path: string; watched: boolean }) => invoke("set_video_watched", args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["videos-all"] }),
  });
}

export function useToggleVideoFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => invoke<boolean>("toggle_video_favorite", { path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["videos-all"] }),
  });
}

export function useDeleteVideoFromLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => invoke("delete_video_from_library", { path }),
    onSuccess: () => invalidateVideos(qc),
  });
}

export function useVideoSubtitles(path: string | null) {
  return useQuery({
    queryKey: ["video-subtitles", path],
    queryFn: () => invoke<SubtitleTrack[]>("get_video_subtitles", { path }),
    enabled: !!path,
    staleTime: 1000 * 60 * 30,
  });
}

// ── Thumbnails ───────────────────────────────────────────────────────────────
// Captured once per video by seeking a throwaway <video> element, then saved
// to the Rust cache so future loads are a plain image fetch. Capture is
// serialized through a small queue — video decoders are expensive and a grid
// of 50 cards must not spawn 50 of them at once.

const MAX_CONCURRENT_CAPTURES = 2;
let activeCaptures = 0;
const captureQueue: (() => void)[] = [];

function acquireCaptureSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeCaptures < MAX_CONCURRENT_CAPTURES) {
      activeCaptures++;
      resolve();
    } else {
      captureQueue.push(() => { activeCaptures++; resolve(); });
    }
  });
}

function releaseCaptureSlot() {
  activeCaptures--;
  captureQueue.shift()?.();
}

function captureFrame(videoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "metadata";
    el.crossOrigin = "anonymous";
    el.src = convertFileSrc(videoPath);

    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      el.removeAttribute("src");
      el.load();
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), 15000);

    el.addEventListener("loadedmetadata", () => {
      el.currentTime = Math.min(el.duration * 0.1, 180) || 3;
    }, { once: true });

    el.addEventListener("seeked", () => {
      // Draw on the next presented frame — drawing synchronously inside
      // `seeked` can grab an unpresented (black) frame with HW decoding.
      const draw = () => {
        try {
          const canvas = document.createElement("canvas");
          const targetW = 480;
          const scale = targetW / (el.videoWidth || targetW);
          canvas.width = targetW;
          canvas.height = Math.round((el.videoHeight || 270) * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          clearTimeout(timeout);
          finish(dataUrl.split(",")[1] ?? null);
        } catch {
          clearTimeout(timeout);
          finish(null);
        }
      };
      // rVFC fires on the presented frame; the timer is a fallback in case it
      // doesn't (paused element whose frame already composited). draw() is
      // effectively idempotent — finish() ignores the second call.
      let drawn = false;
      const drawOnce = () => { if (!drawn) { drawn = true; draw(); } };
      if ("requestVideoFrameCallback" in el) {
        (el as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void })
          .requestVideoFrameCallback(drawOnce);
        setTimeout(drawOnce, 400);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(drawOnce));
      }
    }, { once: true });

    el.addEventListener("error", () => { clearTimeout(timeout); finish(null); }, { once: true });
  });
}

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

/** Disk cache first; otherwise capture a frame once and persist it. */
export async function fetchVideoThumb(path: string): Promise<string> {
  const cached = await invoke<string | null>("get_video_thumb", { path });
  if (cached) return convertFileSrc(cached);

  await acquireCaptureSlot();
  try {
    const base64 = await captureFrame(path);
    if (!base64) throw new Error("thumbnail capture failed");
    const saved = await invoke<string>("save_video_thumb", { path, dataBase64: base64 });
    return convertFileSrc(saved);
  } finally {
    releaseCaptureSlot();
  }
}

export const videoThumbQuery = (path: string) => ({
  queryKey: ["video-thumb", path],
  queryFn: () => fetchVideoThumb(path),
  staleTime: Infinity,
  gcTime: 1000 * 60 * 30,
  // A failed capture throws (not cached-as-null) so a later mount retries —
  // e.g. when the first attempt raced a backend restart or a busy decoder.
  retry: 1,
  retryDelay: 4000,
});

export function useVideoThumb(path: string) {
  return useQuery({ ...videoThumbQuery(path), enabled: !IS_DEMO });
}

/** Fire-and-forget: warm the thumbnail cache for the whole library so cards
 *  show images even before each one scrolls into view. Captures are bounded
 *  by the shared 2-slot queue; already-cached paths resolve with one cheap
 *  invoke. React Query dedupes against any mounted card queries. */
export function pregenVideoThumbs(qc: ReturnType<typeof useQueryClient>, paths: string[]) {
  if (IS_DEMO) return;
  for (const path of paths.slice(0, 500)) {
    qc.prefetchQuery(videoThumbQuery(path)).catch(() => {});
  }
}
