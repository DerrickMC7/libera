import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCacheStore } from "../../store/cacheStore";

export function CacheProgress() {
  const { isProcessing, completed, total, currentPath, isFirstTime } = useCacheStore();
  const startTimeRef = useRef<number | null>(null);
  const etaRef = useRef<string>("");

  const percent = total > 0 ? (completed / total) * 100 : 0;

  // Track start time and calculate ETA
  useEffect(() => {
    if (isProcessing && completed === 0) {
      startTimeRef.current = Date.now();
    }
    if (!isProcessing) {
      startTimeRef.current = null;
      etaRef.current = "";
    }
  }, [isProcessing, completed]);

  function getEta(): string {
    if (!startTimeRef.current || completed === 0) return "";
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const rate = completed / elapsed;
    const remaining = (total - completed) / rate;
    if (remaining < 60) return `${Math.round(remaining)}s remaining`;
    const mins = Math.floor(remaining / 60);
    const secs = Math.round(remaining % 60);
    return `${mins}m ${secs}s remaining`;
  }

  function getTrackName(path: string): string {
    if (!path) return "";
    const parts = path.replace(/\\/g, "/").split("/");
    const filename = parts[parts.length - 1];
    return filename.replace(/\.(mp3|flac|wav|aac|ogg)$/i, "");
  }

  if (isFirstTime) {
    return (
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0e0d0b]"
          >
            {/* Ambient glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(ellipse 60% 40% at 50% 60%, rgba(212,135,42,0.06) 0%, transparent 70%)`,
              }}
            />

            <div className="relative flex flex-col items-center w-full max-w-sm px-8">
              {/* Logo */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.5 }}
                className="mb-16 text-center"
              >
                <h1
                  className="text-[56px] leading-none tracking-[-2.5px] text-[#faf8f2] font-light mb-3"
                  style={{ fontFamily: "Fraunces, serif" }}
                >
                  Libera
                </h1>
                <p className="text-[#3a3628] text-[10px] font-mono tracking-[0.25em] uppercase">
                  Building your library
                </p>
              </motion.div>

              {/* Stats row */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="w-full flex items-end justify-between mb-3"
              >
                <div>
                  <span
                    className="text-[32px] leading-none font-light text-[#f0ead8] tabular-nums"
                    style={{ fontFamily: "Fraunces, serif" }}
                  >
                    {completed}
                  </span>
                  <span className="text-[#3a3628] text-sm ml-1.5">/ {total}</span>
                </div>
                <div className="text-right">
                  <span className="text-[#d4872a] text-sm font-mono">
                    {Math.round(percent)}%
                  </span>
                </div>
              </motion.div>

              {/* Progress bar */}
              <motion.div
                initial={{ opacity: 0, scaleX: 0.95 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{ delay: 0.35 }}
                className="w-full mb-4"
              >
                <div className="h-px bg-[#1f1d18] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: "linear-gradient(90deg, #d4872a, #e8a84c)",
                      width: `${percent}%`,
                    }}
                    transition={{ ease: "easeOut", duration: 0.2 }}
                  />
                </div>
              </motion.div>

              {/* ETA + current track */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="w-full flex items-center justify-between"
              >
                <p className="text-[11px] text-[#3a3628] font-mono truncate max-w-[200px]">
                  {getTrackName(currentPath)}
                </p>
                <p className="text-[11px] text-[#3a3628] font-mono shrink-0 ml-4">
                  {getEta()}
                </p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // Non-first-time: slim banner
  return (
    <AnimatePresence>
      {isProcessing && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden shrink-0"
        >
          <div className="px-10 py-2.5 bg-[#161410] border-b border-white/5 flex items-center gap-4">
            <div className="flex-1 h-px bg-[#1f1d18] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: "linear-gradient(90deg, #d4872a, #e8a84c)",
                  width: `${percent}%`,
                }}
                transition={{ ease: "easeOut", duration: 0.2 }}
              />
            </div>
            <span className="text-[11px] font-mono text-[#7a7060] shrink-0">
              {completed} / {total}
            </span>
            <span className="text-[11px] font-mono text-[#3a3628] shrink-0">
              {getEta()}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}