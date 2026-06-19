import { useSyncExternalStore } from "react";
import { benchmarkRecorder } from "../../lib/benchmark";
import { subscribeAutomation, automationSnapshot, abortAutomation } from "../../lib/benchmarkScenarios";

// Floating status badge. Mounted once in Shell so it stays visible while the benchmark
// navigates between sections (the recorder + automation are module singletons that keep
// running regardless of which view is mounted). Shows live memory/fps, the current auto
// scenario, and a Stop/Abort button so you never have to be in Settings to end a run.
export function BenchmarkRecBadge() {
  const snap = useSyncExternalStore(
    (cb) => benchmarkRecorder.subscribe(cb),
    () => benchmarkRecorder.lastSample,
  );
  const recording = useSyncExternalStore(
    (cb) => benchmarkRecorder.subscribe(cb),
    () => benchmarkRecorder.recording,
  );
  const auto = useSyncExternalStore(subscribeAutomation, automationSnapshot);

  if (!recording && !auto.running) return null;

  const secs = Math.floor(benchmarkRecorder.elapsedMs() / 1000);
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 px-4 py-2 rounded-full bg-[#1a1814]/95 border border-[#c85858]/40 shadow-2xl backdrop-blur-sm">
      <span className="w-2.5 h-2.5 rounded-full bg-[#c85858] animate-pulse" />
      {auto.running ? (
        <span className="text-xs font-mono text-[#f0ead8]">
          {auto.index}/{auto.total} · <span className="text-[#c8bfa8]">{auto.name}</span>
        </span>
      ) : (
        <span className="text-xs font-mono text-[#f0ead8]">
          REC {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
      )}
      {snap && (
        <span className="text-[11px] font-mono text-[#7a7060]">
          {snap.memMB.toFixed(0)}MB · {snap.cpu.toFixed(0)}% · {snap.fps.toFixed(0)}fps
        </span>
      )}
      <button
        onClick={() => (auto.running ? abortAutomation() : benchmarkRecorder.stop())}
        className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#c85858] text-white hover:bg-[#d96868] transition-colors"
      >
        {auto.running ? "Abort" : "Stop"}
      </button>
    </div>
  );
}
