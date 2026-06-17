import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../store/playerStore";
import { Track } from "../types/track";

const IS_DEMO = !("__TAURI_INTERNALS__" in window);

// Paths currently being fetched, so overlapping calls (look-ahead + queue panel)
// don't request the same track twice.
const inFlight = new Set<string>();

// Hydrate display metadata for lazy (path-only) queue entries within a window around
// the current index. This is what keeps the queue panel and now-playing populated
// without ever fetching the whole library's metadata. Playback never waits on this —
// a lazy entry already has its `path`, which is all the audio element needs.
//
// The window is generous ahead (the queue panel shows up to ~160 upcoming rows) and
// small behind (history is capped at 20). It re-runs on every track change, so the
// hydrated region slides along with playback.
export async function hydrateQueueWindow(opts: { back?: number; ahead?: number } = {}): Promise<void> {
  if (IS_DEMO) return;
  const back = opts.back ?? 40;
  const ahead = opts.ahead ?? 250;

  const { queue, shuffledQueue, shuffle, queueIndex } = usePlayerStore.getState();
  const active = shuffle ? shuffledQueue : queue;
  if (active.length === 0) return;

  const from = Math.max(0, queueIndex - back);
  const to = Math.min(active.length - 1, queueIndex + ahead);
  const wanted: string[] = [];
  for (let i = from; i <= to; i++) {
    const t = active[i];
    if (t?.lazy && !inFlight.has(t.path)) wanted.push(t.path);
  }
  if (wanted.length === 0) return;

  wanted.forEach((p) => inFlight.add(p));
  try {
    const tracks = await invoke<Track[]>("get_tracks_by_paths", { paths: wanted });
    usePlayerStore.getState().hydrateTracks(tracks);
  } catch {
    // Leave placeholders in place; the next track change triggers another pass.
  } finally {
    wanted.forEach((p) => inFlight.delete(p));
  }
}
