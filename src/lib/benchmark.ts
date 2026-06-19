import { invoke } from "@tauri-apps/api/core";

// ─── Metric sources ────────────────────────────────────────────────────────────

export interface RawMetrics {
  /** Resident memory of the whole app process tree, bytes. */
  memory_bytes: number;
  /** CPU usage of the whole process tree, normalised to total machine capacity. */
  cpu_percent: number;
  /** Number of OS processes that make up the app. */
  process_count: number;
}

/** Total app memory + CPU from the Rust backend (sysinfo). Falls back to zeros if the
 *  command is unavailable (e.g. an old build). */
export async function sampleProcessMetrics(): Promise<RawMetrics> {
  try {
    return await invoke<RawMetrics>("get_app_metrics");
  } catch {
    return { memory_bytes: 0, cpu_percent: 0, process_count: 0 };
  }
}

/** JS heap in use (Chromium/WebView2 only — undefined in WKWebView, returns 0 there). */
export function jsHeapBytes(): number {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem?.usedJSHeapSize ?? 0;
}

// ─── FPS meter ───────────────────────────────────────────────────────────────────
// Drives its own rAF loop and records recent frame durations. The achieved frame rate is
// our render/GPU-load proxy: there is no portable per-process GPU API, but a section that
// drops the app's frame cadence is exactly where the GPU/compositor is struggling.

export class FpsMeter {
  private raf = 0;
  private last = 0;
  private frames: number[] = []; // recent frame durations (ms), capped
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = now - this.last;
      this.last = now;
      if (dt > 0 && dt < 1000) {
        this.frames.push(dt);
        if (this.frames.length > 600) this.frames.shift();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  reset() {
    this.frames = [];
  }

  /** Rolling average FPS over the window. */
  fps(): number {
    if (this.frames.length === 0) return 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  /** 1%-low FPS — the average of the worst 1% of frames. A stutter proxy. */
  lowFps(): number {
    if (this.frames.length < 5) return this.fps();
    const sorted = [...this.frames].sort((a, b) => b - a); // longest (worst) first
    const n = Math.max(1, Math.floor(sorted.length * 0.01));
    const worst = sorted.slice(0, n);
    const avg = worst.reduce((a, b) => a + b, 0) / worst.length;
    return avg > 0 ? 1000 / avg : 0;
  }
}

// ─── Scenario recording ────────────────────────────────────────────────────────
// The recorder is a module-level singleton (NOT tied to a React component) so a recording
// survives navigating away from Settings — start it, walk through the scenario (scroll the
// library, open the Genre Map, play music…), then come back and stop it.

const MB = 1024 * 1024;

export interface BenchmarkSample {
  t: number; // ms since record start
  memMB: number;
  cpu: number;
  jsHeapMB: number;
  fps: number;
  processCount: number;
}

export interface BenchmarkResult {
  id: string;
  name: string;
  date: number;
  durationMs: number;
  samples: number;
  memMin: number;
  memAvg: number;
  memMax: number;
  memEnd: number;
  cpuAvg: number;
  cpuMax: number;
  jsHeapAvg: number;
  jsHeapMax: number;
  fpsAvg: number;
  fpsMin: number;
  processCount: number;
}

function aggregate(name: string, durationMs: number, s: BenchmarkSample[]): BenchmarkResult | null {
  if (s.length === 0) return null;
  const mem = s.map((x) => x.memMB);
  const cpu = s.map((x) => x.cpu);
  const heap = s.map((x) => x.jsHeapMB);
  const fps = s.map((x) => x.fps).filter((f) => f > 0);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    id: (crypto as { randomUUID?: () => string }).randomUUID?.() ?? `bench-${Date.now()}`,
    name: name.trim() || "Untitled scenario",
    date: Date.now(),
    durationMs,
    samples: s.length,
    memMin: Math.min(...mem),
    memAvg: avg(mem),
    memMax: Math.max(...mem),
    memEnd: mem[mem.length - 1],
    cpuAvg: avg(cpu),
    cpuMax: Math.max(...cpu),
    jsHeapAvg: avg(heap),
    jsHeapMax: Math.max(...heap),
    fpsAvg: avg(fps),
    fpsMin: fps.length ? Math.min(...fps) : 0,
    processCount: Math.max(...s.map((x) => x.processCount)),
  };
}

type Listener = () => void;

class BenchmarkRecorder {
  recording = false;
  name = "";
  startedAt = 0;
  lastSample: BenchmarkSample | null = null;
  sampleCount = 0;
  private samples: BenchmarkSample[] = [];
  private meter = new FpsMeter();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  private emit() { this.listeners.forEach((l) => l()); }

  start(name: string, intervalMs = 500) {
    if (this.recording) return;
    this.recording = true;
    this.name = name;
    this.startedAt = performance.now();
    this.samples = [];
    this.sampleCount = 0;
    this.lastSample = null;
    this.meter.reset();
    this.meter.start();

    const tick = async () => {
      const m = await sampleProcessMetrics();
      if (!this.recording) return; // stopped mid-await
      const sample: BenchmarkSample = {
        t: performance.now() - this.startedAt,
        memMB: m.memory_bytes / MB,
        cpu: m.cpu_percent,
        jsHeapMB: jsHeapBytes() / MB,
        fps: this.meter.fps(),
        processCount: m.process_count,
      };
      this.samples.push(sample);
      this.lastSample = sample;
      this.sampleCount = this.samples.length;
      this.emit();
    };
    void tick();
    this.timer = setInterval(tick, intervalMs);
    this.emit();
  }

  stop(): BenchmarkResult | null {
    if (!this.recording) return null;
    this.recording = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.meter.stop();
    const result = aggregate(this.name, performance.now() - this.startedAt, this.samples);
    if (result) saveResult(result);
    this.emit();
    return result;
  }

  elapsedMs(): number {
    return this.recording ? performance.now() - this.startedAt : 0;
  }
}

export const benchmarkRecorder = new BenchmarkRecorder();

// ─── Persisted results ───────────────────────────────────────────────────────────

const LS_KEY = "libera-benchmarks";

export function loadResults(): BenchmarkResult[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as BenchmarkResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResult(r: BenchmarkResult) {
  const all = loadResults();
  all.unshift(r);
  try { localStorage.setItem(LS_KEY, JSON.stringify(all.slice(0, 100))); } catch { /* quota */ }
}

export function deleteResult(id: string) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(loadResults().filter((r) => r.id !== id))); } catch { /* ignore */ }
}

export function clearResults() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
