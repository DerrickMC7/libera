import { useEffect, useRef, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { usePlayerStore } from "../../store/playerStore";
import { useLyrics, useSetLyrics } from "../../hooks/useLyrics";
import { parseLrc } from "../../utils/lrcParser";

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
  progress: number;
  seek: (time: number) => void;
}

const SOURCE_LABEL: Record<string, string> = {
  embedded: "Embedded",
  lrclib: "LRCLIB",
  manual: "Manual",
  not_found: "",
};

export function LyricsPanel({ open: isOpen, onClose, progress, seek }: LyricsPanelProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const { data, isLoading, isError } = useLyrics(isOpen ? currentTrack : null);
  const { mutate: saveLyrics, isPending: isSaving } = useSetLyrics(currentTrack?.path);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // When track changes, exit edit mode
  useEffect(() => { setEditing(false); }, [currentTrack?.path]);

  // Pre-fill draft when entering edit mode
  function enterEdit() {
    const current = data?.synced_lrc ?? data?.plain_text ?? "";
    setDraft(current);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }

  async function handleSave() {
    if (!draft.trim()) return;
    saveLyrics(draft.trim(), {
      onSuccess: () => setEditing(false),
    });
  }

  async function handleImportFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Lyrics", extensions: ["lrc", "txt"] }],
        title: "Import lyrics file",
      });
      if (!selected || typeof selected !== "string") return;
      const content = await invoke<string>("read_text_file", { path: selected });
      setDraft(content);
    } catch (e) {
      console.error("Failed to import file", e);
    }
  }

  const lrcLines = useMemo(
    () => (data?.synced_lrc ? parseLrc(data.synced_lrc) : null),
    [data?.synced_lrc],
  );

  const currentIdx = useMemo(() => {
    if (!lrcLines) return -1;
    let idx = -1;
    for (let i = 0; i < lrcLines.length; i++) {
      if (lrcLines[i].time <= progress) idx = i;
      else break;
    }
    return idx;
  }, [lrcLines, progress]);

  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing || currentIdx < 0) return;
    const el = lineRefs.current[currentIdx];
    if (!el || !scrollRef.current) return;
    const container = scrollRef.current;
    const target = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }, [currentIdx, editing]);

  const hasLyrics = !!(data?.synced_lrc || data?.plain_text);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            onClick={editing ? undefined : onClose}
          />

          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            className="fixed right-0 top-0 bottom-20 w-80 bg-[#161410] border-l border-white/5 z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
              <div>
                <p className="text-xs font-mono tracking-widest uppercase text-[var(--accent)]">
                  {editing ? "Edit Lyrics" : "Lyrics"}
                </p>
                {!editing && data && data.source !== "not_found" && (
                  <p className="text-[11px] text-[#3a3628] font-mono mt-0.5">
                    {SOURCE_LABEL[data.source] ?? data.source}
                    {lrcLines && <span className="text-[var(--accent)]"> · synced</span>}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                {!editing && currentTrack && (
                  <button
                    onClick={enterEdit}
                    title="Edit lyrics"
                    className="p-1.5 rounded-md text-[#3a3628] hover:text-[#7a7060] transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    </svg>
                  </button>
                )}
                <button
                  onClick={editing ? cancelEdit : onClose}
                  className="p-1 rounded-md text-[#3a3628] hover:text-[#7a7060] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Edit mode */}
            {editing ? (
              <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={"Paste plain text or .lrc format\n\nExample LRC:\n[00:12.34] First line\n[00:15.67] Second line"}
                  className="flex-1 min-h-0 resize-none bg-[#1a1814] border border-white/8 rounded-xl px-4 py-3 text-sm text-[#c8bfa8] font-mono leading-relaxed placeholder:text-[#3a3628] focus:outline-none focus:border-[var(--accent-a30)] transition-colors"
                  spellCheck={false}
                  autoFocus
                />

                <button
                  onClick={handleImportFile}
                  className="flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-white/10 text-xs font-mono text-[#3a3628] hover:text-[#7a7060] hover:border-white/20 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                  </svg>
                  Import .lrc / .txt file
                </button>

                <div className="flex gap-2">
                  <button
                    onClick={cancelEdit}
                    className="flex-1 py-2 rounded-lg bg-[#2a2820] text-xs font-mono text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !draft.trim()}
                    className="flex-1 py-2 rounded-lg bg-[var(--accent)] text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    style={{ color: "var(--accent-on)" }}
                  >
                    {isSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              /* View mode */
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
                {/* Loading */}
                {isLoading && (
                  <div className="flex flex-col gap-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-3 rounded-full bg-white/5 animate-pulse"
                        style={{ width: `${50 + (i % 3) * 20}%` }}
                      />
                    ))}
                  </div>
                )}

                {/* Error */}
                {isError && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                    </svg>
                    <p className="text-xs text-[#3a3628] font-mono">Could not load lyrics</p>
                  </div>
                )}

                {/* Not found */}
                {!isLoading && !isError && !hasLyrics && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                    <p className="text-sm text-[#3a3628]">No lyrics found</p>
                    <button
                      onClick={enterEdit}
                      className="text-xs font-mono text-[var(--accent)] hover:opacity-80 transition-opacity"
                    >
                      Add manually
                    </button>
                  </div>
                )}

                {/* Synced lyrics */}
                {!isLoading && !isError && lrcLines && lrcLines.length > 0 && (
                  <div className="flex flex-col gap-1 pb-32">
                    {lrcLines.map((line, i) => {
                      const isActive = i === currentIdx;
                      const isPast = i < currentIdx;
                      return (
                        <p
                          key={i}
                          ref={(el) => { lineRefs.current[i] = el; }}
                          className="text-sm leading-relaxed transition-all duration-300 cursor-pointer hover:text-[#c8bfa8]"
                          style={{
                            color: isActive ? "var(--accent)" : isPast ? "#3a3628" : "#7a7060",
                            fontWeight: isActive ? 600 : 400,
                            fontSize: isActive ? "0.9375rem" : "0.875rem",
                            transform: isActive ? "translateX(4px)" : "none",
                          }}
                          onClick={() => seek(line.time)}
                        >
                          {line.text}
                        </p>
                      );
                    })}
                  </div>
                )}

                {/* Plain text lyrics */}
                {!isLoading && !isError && !lrcLines && data?.plain_text && (
                  <div className="pb-8">
                    <pre className="text-sm text-[#7a7060] leading-relaxed whitespace-pre-wrap font-sans">
                      {data.plain_text}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
