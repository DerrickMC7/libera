import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  benchmarkRecorder,
  sampleProcessMetrics,
  jsHeapBytes,
  FpsMeter,
  loadResults,
  deleteResult,
  clearResults,
  BenchmarkResult,
} from "../../lib/benchmark";
import {
  runAllScenarios,
  abortAutomation,
  subscribeAutomation,
  automationSnapshot,
  SCENARIOS,
} from "../../lib/benchmarkScenarios";

const MB = 1024 * 1024;

// Quick-fill scenario names — the ones the user cares about plus a couple of common views.
const PRESET_SCENARIOS = [
  "Idle (just opened)",
  "Genre Map + playing",
  "Full scroll tracks → Genre Map + playing",
  "Scroll all tracks",
  "Albums grid",
  "Artists grid",
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-lg bg-[#1f1d18] border border-white/5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448]">{label}</span>
      <span className="text-lg font-mono text-[#f0ead8] tabular-nums">{value}</span>
      {sub && <span className="text-[10px] font-mono text-[#5a5448]">{sub}</span>}
    </div>
  );
}

export function BenchmarkPanel() {
  const recording = useSyncExternalStore(
    (cb) => benchmarkRecorder.subscribe(cb),
    () => benchmarkRecorder.recording,
  );
  const auto = useSyncExternalStore(subscribeAutomation, automationSnapshot);

  const [name, setName] = useState(PRESET_SCENARIOS[1]);
  const [results, setResults] = useState<BenchmarkResult[]>(() => loadResults());

  // Live readout (only while not recording — during a recording the badge shows live data).
  const [live, setLive] = useState({ memMB: 0, cpu: 0, procs: 0, jsHeapMB: 0, fps: 0, low: 0 });
  const meterRef = useRef<FpsMeter | null>(null);

  useEffect(() => {
    const meter = new FpsMeter();
    meter.start();
    meterRef.current = meter;
    let alive = true;
    const tick = async () => {
      const m = await sampleProcessMetrics();
      if (!alive) return;
      setLive({
        memMB: m.memory_bytes / MB,
        cpu: m.cpu_percent,
        procs: m.process_count,
        jsHeapMB: jsHeapBytes() / MB,
        fps: meter.fps(),
        low: meter.lowFps(),
      });
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); meter.stop(); };
  }, []);

  // Refresh the results table whenever a recording stops or the auto suite finishes.
  useEffect(() => {
    if (!recording && !auto.running) setResults(loadResults());
  }, [recording, auto.running]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(loadResults(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `libera-benchmarks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const baseline = results.length ? results[results.length - 1] : null; // oldest = baseline

  return (
    <div className="flex flex-col gap-6">
      {/* Live readout */}
      <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-[#f0ead8]">Live metrics</p>
          <span className="text-[10px] font-mono text-[#5a5448]">updates every 1s</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="Total memory" value={`${live.memMB.toFixed(0)} MB`} sub={`${live.procs} processes`} />
          <Stat label="CPU" value={`${live.cpu.toFixed(0)} %`} sub="whole app, all cores" />
          <Stat label="JS heap" value={`${live.jsHeapMB.toFixed(0)} MB`} sub="renderer only" />
          <Stat label="FPS" value={live.fps.toFixed(0)} sub="render/GPU proxy" />
          <Stat label="1% low FPS" value={live.low.toFixed(0)} sub="stutter proxy" />
        </div>
        <p className="text-[10px] font-mono text-[#3a3628] mt-3 leading-relaxed">
          GPU usage isn't measurable from inside the app on every platform, so FPS / 1%-low FPS stand in as
          the render-load proxy. Memory &amp; CPU cover the whole process tree (WebView + helpers + Rust).
          In dev mode these numbers are inflated vs a release build.
        </p>
      </div>

      {/* Automated suite */}
      <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-[#f0ead8]">Automated suite</p>
          {auto.running ? (
            <button
              onClick={() => abortAutomation()}
              className="text-xs px-4 py-1.5 rounded-lg bg-[#c85858] text-white font-mono hover:bg-[#d96868] transition-colors"
            >
              Abort
            </button>
          ) : (
            <button
              onClick={() => void runAllScenarios()}
              disabled={recording}
              className="text-xs px-4 py-1.5 rounded-lg bg-[var(--accent)] font-mono hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: "var(--accent-on)" }}
            >
              Run all scenarios
            </button>
          )}
        </div>
        <p className="text-xs text-[#3a3628] mb-3 leading-relaxed">
          Runs all {SCENARIOS.length} scenarios automatically, identically every time — it navigates, scrolls
          the whole track list, opens the Genre Map and starts playback for you, recording each as its own row.
          Takes about a minute; you can watch progress on the floating badge. The app navigates on its own while
          it runs, then returns here.
        </p>
        {auto.running && (
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--accent)]">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
            {auto.index}/{auto.total} · {auto.name}
          </div>
        )}
        {!auto.running && (
          <div className="flex flex-wrap gap-1.5">
            {SCENARIOS.map((s) => (
              <span key={s.name} className="text-[10px] font-mono px-2 py-1 rounded-md bg-[#1f1d18] text-[#5a5448]">{s.name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Recorder */}
      <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
        <p className="text-sm text-[#f0ead8] mb-1">Record a scenario manually</p>
        <p className="text-xs text-[#3a3628] mb-3 leading-relaxed">
          Press Record, then perform the scenario (you can navigate anywhere — a floating badge keeps the
          recording alive and lets you stop from any screen). Stop to save min/avg/max/end stats.
        </p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRESET_SCENARIOS.map((s) => (
            <button
              key={s}
              onClick={() => setName(s)}
              disabled={recording}
              className={`text-[10px] font-mono px-2 py-1 rounded-md transition-colors disabled:opacity-40 ${
                name === s ? "bg-[var(--accent-a20)] text-[var(--accent)]" : "bg-[#1f1d18] text-[#7a7060] hover:text-[#c8bfa8]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={recording}
            placeholder="Scenario name"
            className="flex-1 bg-[#1f1d18] border border-white/7 rounded-lg px-3 py-2 text-sm text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-50"
          />
          {recording ? (
            <button
              onClick={() => benchmarkRecorder.stop()}
              className="text-xs px-4 py-2 rounded-lg bg-[#c85858] text-white font-mono hover:bg-[#d96868] transition-colors shrink-0"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => benchmarkRecorder.start(name)}
              disabled={auto.running}
              className="text-xs px-4 py-2 rounded-lg bg-[var(--accent)] font-mono hover:bg-[var(--accent-hover)] transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: "var(--accent-on)" }}
            >
              Record
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-[#f0ead8]">Results</p>
          {results.length > 0 && (
            <div className="flex gap-3">
              <button onClick={exportJson} className="text-[11px] font-mono text-[#7a7060] hover:text-[var(--accent)] transition-colors">
                Export JSON
              </button>
              <button
                onClick={() => { clearResults(); setResults([]); }}
                className="text-[11px] font-mono text-[#7a7060] hover:text-[#c85858] transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {results.length === 0 ? (
          <p className="text-xs text-[#3a3628] font-mono py-4 text-center">No recordings yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448] border-b border-white/5">
                  <th className="py-2 px-1 font-normal">Scenario</th>
                  <th className="py-2 px-1 font-normal text-right">Mem avg</th>
                  <th className="py-2 px-1 font-normal text-right">Mem max</th>
                  <th className="py-2 px-1 font-normal text-right">Mem end</th>
                  <th className="py-2 px-1 font-normal text-right">Δ base</th>
                  <th className="py-2 px-1 font-normal text-right">CPU avg/max</th>
                  <th className="py-2 px-1 font-normal text-right">FPS avg/low</th>
                  <th className="py-2 px-1 font-normal text-right" />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const delta = baseline && r.id !== baseline.id ? r.memAvg - baseline.memAvg : null;
                  return (
                    <tr key={r.id} className="text-xs font-mono text-[#c8bfa8] border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 px-1 max-w-[160px]">
                        <span className="text-[#f0ead8] truncate block" title={r.name}>{r.name}</span>
                        <span className="text-[9px] text-[#5a5448]">
                          {new Date(r.date).toLocaleString()} · {(r.durationMs / 1000).toFixed(0)}s · {r.processCount}p
                        </span>
                      </td>
                      <td className="py-2 px-1 text-right tabular-nums">{r.memAvg.toFixed(0)}</td>
                      <td className="py-2 px-1 text-right tabular-nums">{r.memMax.toFixed(0)}</td>
                      <td className="py-2 px-1 text-right tabular-nums">{r.memEnd.toFixed(0)}</td>
                      <td className={`py-2 px-1 text-right tabular-nums ${delta == null ? "text-[#5a5448]" : delta > 0 ? "text-[#c85858]" : "text-[#6fae6f]"}`}>
                        {delta == null ? "base" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}`}
                      </td>
                      <td className="py-2 px-1 text-right tabular-nums text-[#7a7060]">{r.cpuAvg.toFixed(0)}/{r.cpuMax.toFixed(0)}%</td>
                      <td className="py-2 px-1 text-right tabular-nums text-[#7a7060]">{r.fpsAvg.toFixed(0)}/{r.fpsMin.toFixed(0)}</td>
                      <td className="py-2 px-1 text-right">
                        <button
                          onClick={() => { deleteResult(r.id); setResults(loadResults()); }}
                          className="text-[#3a3628] hover:text-[#c85858] transition-colors"
                          title="Delete"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] font-mono text-[#3a3628] mt-3">
              Memory in MB. <span className="text-[#7a7060]">Δ base</span> compares each run's average memory to the
              oldest run. Record the same scenario before and after a change to see the effect.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
