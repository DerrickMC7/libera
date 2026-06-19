import { invoke } from "@tauri-apps/api/core";
import { driveSection, driveMusicView } from "../store/navigationStore";
import { setGenreMapOpen, getTracksScroller } from "./automationBus";
import { usePlayerStore } from "../store/playerStore";
import { queryClient } from "./queryClient";
import { benchmarkRecorder } from "./benchmark";
import { Track } from "../types/track";

// Automated benchmark suite. Drives the real app through a fixed, identical sequence of
// scenarios every run (navigate → scroll → open map → play), recording each as a separate
// result row via `benchmarkRecorder`. Runs as a module singleton so it survives the
// section switches that unmount Settings.

let _cancel = false;

// ─── Low-level driving API ──────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (_cancel || performance.now() - start >= ms) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** Smoothly scroll the tracks list from top to bottom over `durationMs`, firing the lazy
 *  page loads + artwork fetches exactly like a manual scroll. */
function scrollTracks(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const el = getTracksScroller();
    if (!el) { void wait(durationMs).then(resolve); return; }
    el.scrollTop = 0;
    const start = performance.now();
    const step = (now: number) => {
      if (_cancel) return resolve();
      const p = Math.min(1, (now - start) / durationMs);
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = max * p;
      el.dispatchEvent(new Event("scroll")); // ensure the React onScroll handler fires
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function play() {
  try {
    const tracks = await invoke<Track[]>("get_tracks_page", {
      query: "",
      limit: 100,
      offset: 0,
      sortBy: "title",
    });
    if (tracks.length) {
      usePlayerStore.getState().setQueue(tracks, 0);
      usePlayerStore.getState().setIsPlaying(true);
    }
  } catch { /* no library / demo edge — pulse still animates off currentTrack if any */ }
}

/** Return to a known-neutral state between scenarios so each run starts comparably. */
async function reset() {
  usePlayerStore.getState().closePlayer();
  setGenreMapOpen(false);
  driveSection("music");
  driveMusicView("tracks");
  const el = getTracksScroller();
  if (el) el.scrollTop = 0;
  queryClient.clear(); // drop cached pages/artwork URLs so the JS-side baseline is reproducible
  await wait(1500); // let the webview settle / GC before the next recording
}

interface Api {
  section: (s: string) => void;
  musicView: (v: string) => void;
  genreMap: (open: boolean) => void;
  scrollTracks: (ms: number) => Promise<void>;
  play: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
}

const api: Api = {
  section: driveSection,
  musicView: driveMusicView,
  genreMap: setGenreMapOpen,
  scrollTracks,
  play,
  wait,
};

// ─── Scenarios (fixed order — identical every run) ───────────────────────────────

interface Scenario { name: string; run: (a: Api) => Promise<void>; }

export const SCENARIOS: Scenario[] = [
  {
    name: "Idle — tracks",
    run: async (a) => { a.section("music"); a.musicView("tracks"); await a.wait(600); await a.wait(4000); },
  },
  {
    name: "Albums grid",
    run: async (a) => { a.section("music"); a.musicView("albums"); await a.wait(700); await a.wait(4000); },
  },
  {
    name: "Artists grid",
    run: async (a) => { a.section("music"); a.musicView("artists"); await a.wait(700); await a.wait(4000); },
  },
  {
    name: "Genres list",
    run: async (a) => { a.section("music"); a.musicView("genres"); await a.wait(700); await a.wait(4000); },
  },
  {
    name: "Scroll all tracks",
    run: async (a) => { a.section("music"); a.musicView("tracks"); await a.wait(600); await a.scrollTracks(6000); await a.wait(2500); },
  },
  {
    // Isolation A: audio playback cost WITHOUT the Genre Map animation (plain tracks view).
    name: "Music playing — tracks view",
    run: async (a) => { a.section("music"); a.musicView("tracks"); await a.wait(600); await a.play(); await a.wait(6000); },
  },
  {
    // Isolation B: the Genre Map render/sim cost WITHOUT music (pulse asleep — nothing playing).
    name: "Genre Map idle (no music)",
    run: async (a) => {
      a.section("music"); a.musicView("genres"); await a.wait(800);
      a.genreMap(true); await a.wait(6000);
    },
  },
  {
    // Combined: Map + playing ≈ (Genre Map idle) + (Music playing − Idle) + pulse-animation marginal.
    name: "Genre Map + playing",
    run: async (a) => {
      a.section("music"); a.musicView("genres"); await a.wait(800);
      a.genreMap(true); await a.wait(800);
      await a.play(); await a.wait(6000);
    },
  },
  {
    name: "Full scroll → Genre Map + playing",
    run: async (a) => {
      a.section("music"); a.musicView("tracks"); await a.wait(600);
      await a.scrollTracks(6000);
      a.musicView("genres"); await a.wait(800);
      a.genreMap(true); await a.wait(800);
      await a.play(); await a.wait(6000);
    },
  },
];

// ─── Runner + progress observable ────────────────────────────────────────────────

interface AutoState { running: boolean; index: number; total: number; name: string; }
let _state: AutoState = { running: false, index: 0, total: 0, name: "" };
const listeners = new Set<() => void>();

export function subscribeAutomation(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export function automationSnapshot(): AutoState { return _state; }
function setState(s: Partial<AutoState>) { _state = { ..._state, ...s }; listeners.forEach((l) => l()); }

export function abortAutomation() { _cancel = true; }
export function isAutomationRunning() { return _state.running; }

/** Run every scenario once, in order, recording each. Resolves when the suite finishes or
 *  is aborted, then returns to Settings so results are visible. */
export async function runAllScenarios(): Promise<void> {
  if (_state.running || benchmarkRecorder.recording) return;
  _cancel = false;
  setState({ running: true, total: SCENARIOS.length, index: 0, name: "" });

  for (let i = 0; i < SCENARIOS.length; i++) {
    if (_cancel) break;
    const sc = SCENARIOS[i];
    setState({ index: i + 1, name: sc.name });
    await reset();
    if (_cancel) break;
    benchmarkRecorder.start(`${sc.name} [auto]`);
    await sc.run(api);
    benchmarkRecorder.stop();
    await wait(800);
  }

  // Clean up + surface results.
  usePlayerStore.getState().closePlayer();
  setGenreMapOpen(false);
  driveSection("settings");
  setState({ running: false, index: 0, name: "" });
  _cancel = false;
}
