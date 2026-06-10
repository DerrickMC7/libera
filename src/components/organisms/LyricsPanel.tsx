import { useEffect, useRef, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { usePlayerStore } from "../../store/playerStore";
import { useLyrics, useSetLyrics } from "../../hooks/useLyrics";
import { parseLrc } from "../../utils/lrcParser";
import { useArtwork } from "../../hooks/useArtwork";

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
  progress: number;
  seek: (time: number) => void;
  isOnTop: boolean;
  onBringToFront: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  embedded: "Embedded",
  lrclib: "LRCLIB",
  manual: "Manual",
  not_found: "",
};

interface BuilderLine {
  id: string;
  time: number;
  text: string;
}

function formatLrcTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function parseLrcTime(str: string): number | null {
  const match = str.match(/^(\d{1,2}):(\d{2})[.:](\d{1,3})$/);
  if (!match) return null;
  const m = parseInt(match[1]);
  const s = parseInt(match[2]);
  const cs = parseInt(match[3].padEnd(3, "0"));
  return m * 60 + s + cs / 1000;
}

export function LyricsPanel({ open: isOpen, onClose, progress, seek, isOnTop, onBringToFront }: LyricsPanelProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, isError, refetch } = useLyrics(isOpen ? currentTrack : null);
  const { mutate: saveLyrics, isPending: isSaving } = useSetLyrics(currentTrack?.path);
  const { data: artworkUrl } = useArtwork(currentTrack?.path, false, true);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [karaokeOpen, setKaraokeOpen] = useState(false);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

  // LRC builder state
  const [lrcBuilding, setLrcBuilding] = useState(false);
  const [builderLines, setBuilderLines] = useState<BuilderLine[]>([]);
  const [stampedTime, setStampedTime] = useState<number | null>(null);
  const [newLineText, setNewLineText] = useState("");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editLineTime, setEditLineTime] = useState("");
  const [editLineText, setEditLineText] = useState("");
  const builderListRef = useRef<HTMLDivElement>(null);
  const newLineInputRef = useRef<HTMLInputElement>(null);

  async function handleRefresh() {
    if (refreshCooldown > 0 || isFetching || !currentTrack) return;
    try { await invoke("clear_lyrics_cache", { trackPath: currentTrack.path }); } catch {}
    queryClient.removeQueries({ queryKey: ["lyrics", currentTrack.path] });
    refetch();
    setRefreshCooldown(7);
    cooldownRef.current = setInterval(() => {
      setRefreshCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    setEditing(false);
    setKaraokeOpen(false);
    setLrcBuilding(false);
    setBuilderLines([]);
    setStampedTime(null);
    setNewLineText("");
  }, [currentTrack?.path]);

  useEffect(() => {
    if (!isOpen) {
      setKaraokeOpen(false);
      setLrcBuilding(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!karaokeOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setKaraokeOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [karaokeOpen]);

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

  // LRC builder functions
  function enterLrcBuilder() {
    if (data?.synced_lrc) {
      const parsed = parseLrc(data.synced_lrc);
      setBuilderLines(parsed.map((l, i) => ({ id: String(i), time: l.time, text: l.text })));
    } else {
      setBuilderLines([]);
    }
    setStampedTime(null);
    setNewLineText("");
    setEditingLineId(null);
    setLrcBuilding(true);
  }

  function cancelLrcBuilder() {
    setLrcBuilding(false);
    setBuilderLines([]);
    setStampedTime(null);
    setNewLineText("");
    setEditingLineId(null);
  }

  function handleStamp() {
    setStampedTime(progress);
    newLineInputRef.current?.focus();
  }

  function handleAddLine() {
    const text = newLineText.trim();
    if (!text) return;
    const time = stampedTime ?? progress;
    const id = `${Date.now()}-${Math.random()}`;
    setBuilderLines((prev) => [...prev, { id, time, text }]);
    setNewLineText("");
    setStampedTime(null);
    setTimeout(() => {
      builderListRef.current?.scrollTo({ top: builderListRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
    newLineInputRef.current?.focus();
  }

  function handleDeleteLine(id: string) {
    setBuilderLines((prev) => prev.filter((l) => l.id !== id));
    if (editingLineId === id) setEditingLineId(null);
  }

  function startEditLine(line: BuilderLine) {
    setEditingLineId(line.id);
    setEditLineTime(formatLrcTime(line.time));
    setEditLineText(line.text);
  }

  function saveEditLine(id: string) {
    const time = parseLrcTime(editLineTime);
    if (time === null) return;
    setBuilderLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, time, text: editLineText.trim() || l.text } : l))
    );
    setEditingLineId(null);
  }

  async function handleSaveLrc() {
    if (builderLines.length === 0) return;
    const sorted = [...builderLines].sort((a, b) => a.time - b.time);
    const lrc = sorted.map((l) => `[${formatLrcTime(l.time)}]${l.text}`).join("\n");
    saveLyrics(lrc, {
      onSuccess: () => {
        setLrcBuilding(false);
        setBuilderLines([]);
      },
    });
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
  const karaokeLineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const karaokeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing || lrcBuilding || currentIdx < 0) return;
    const el = lineRefs.current[currentIdx];
    if (!el || !scrollRef.current) return;
    const container = scrollRef.current;
    const target = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }, [currentIdx, editing, lrcBuilding]);

  useEffect(() => {
    if (!karaokeOpen || currentIdx < 0) return;
    const el = karaokeLineRefs.current[currentIdx];
    if (!el || !karaokeScrollRef.current) return;
    const container = karaokeScrollRef.current;
    const target = el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2;
    const start = container.scrollTop;
    const delta = target - start;
    const duration = 300;
    const t0 = performance.now();
    let raf: number;
    function step(now: number) {
      const p = Math.min((now - t0) / duration, 1);
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      container.scrollTop = start + delta * ease;
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [currentIdx, karaokeOpen]);

  const hasLyrics = !!(data?.synced_lrc || data?.plain_text);

  const headerLabel = lrcBuilding ? "LRC Builder" : editing ? "Edit Lyrics" : "Lyrics";

  return (
    <>
    <AnimatePresence>
      {isOpen && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            onMouseDown={onBringToFront}
            className={`fixed right-0 top-0 bottom-16 sm:bottom-20 w-full sm:w-80 bg-[#161410] border-l border-white/5 flex flex-col shadow-2xl ${isOnTop ? "z-[52]" : "z-[51]"}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
              <div>
                <p className="text-xs font-mono tracking-widest uppercase text-[var(--accent)]">
                  {headerLabel}
                </p>
                {!editing && !lrcBuilding && data && data.source !== "not_found" && (
                  <p className="text-[11px] text-[#3a3628] font-mono mt-0.5">
                    {SOURCE_LABEL[data.source] ?? data.source}
                    {lrcLines && <span className="text-[var(--accent)]"> · synced</span>}
                  </p>
                )}
                {lrcBuilding && (
                  <p className="text-[11px] text-[#3a3628] font-mono mt-0.5">
                    {builderLines.length} line{builderLines.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                {!editing && !lrcBuilding && hasLyrics && (
                  <button
                    onClick={() => setKaraokeOpen(true)}
                    title="Karaoke fullscreen"
                    className="p-1.5 rounded-md text-[#3a3628] hover:text-[#7a7060] transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                    </svg>
                  </button>
                )}
                {!editing && !lrcBuilding && currentTrack && (
                  <button
                    onClick={handleRefresh}
                    disabled={refreshCooldown > 0 || isFetching}
                    title={
                      isFetching
                        ? "Fetching…"
                        : refreshCooldown > 0
                        ? `Wait ${refreshCooldown}s`
                        : "Re-fetch from LRCLIB"
                    }
                    className="p-1.5 rounded-md text-[#3a3628] hover:text-[#7a7060] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
                      className={isFetching ? "animate-spin" : ""}
                    >
                      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                  </button>
                )}
                {!editing && !lrcBuilding && currentTrack && (
                  <button
                    onClick={enterLrcBuilder}
                    title="Create LRC interactively"
                    className="p-1.5 rounded-md text-[#3a3628] hover:text-[#7a7060] transition-colors"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
                    </svg>
                  </button>
                )}
                {!editing && !lrcBuilding && currentTrack && (
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
                  onClick={editing ? cancelEdit : lrcBuilding ? cancelLrcBuilder : onClose}
                  className="p-1 rounded-md text-[#3a3628] hover:text-[#7a7060] transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* LRC Builder mode */}
            {lrcBuilding ? (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Hint */}
                {builderLines.length === 0 && (
                  <p className="text-[11px] font-mono text-[#3a3628] text-center pt-6 px-6 leading-relaxed">
                    Play the song, press <span className="text-[var(--accent)]">Stamp</span> at the exact moment, then type the lyric line. Repeat for each line.
                  </p>
                )}

                {/* Line list */}
                <div
                  ref={builderListRef}
                  className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-0.5"
                >
                  {builderLines.map((line) =>
                    editingLineId === line.id ? (
                      <div
                        key={line.id}
                        className="flex items-center gap-1.5 bg-[#1a1814] border border-[var(--accent)]/30 rounded-lg px-2 py-2"
                      >
                        <input
                          value={editLineTime}
                          onChange={(e) => setEditLineTime(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditLine(line.id);
                            if (e.key === "Escape") setEditingLineId(null);
                          }}
                          className="w-[4.5rem] bg-transparent text-[11px] font-mono text-[var(--accent)] focus:outline-none shrink-0"
                          placeholder="mm:ss.xx"
                        />
                        <input
                          value={editLineText}
                          onChange={(e) => setEditLineText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditLine(line.id);
                            if (e.key === "Escape") setEditingLineId(null);
                          }}
                          autoFocus
                          className="flex-1 bg-transparent text-xs text-[#c8bfa8] focus:outline-none min-w-0"
                        />
                        <button
                          onClick={() => saveEditLine(line.id)}
                          className="text-[var(--accent)] hover:opacity-70 shrink-0 transition-opacity"
                          title="Confirm"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setEditingLineId(null)}
                          className="text-[#3a3628] hover:text-[#7a7060] shrink-0 transition-colors"
                          title="Cancel edit"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div
                        key={line.id}
                        className="flex items-center gap-1.5 group rounded-lg px-2 py-1.5 hover:bg-[#1a1814] transition-colors cursor-pointer"
                        onClick={() => startEditLine(line)}
                      >
                        <span className="text-[11px] font-mono text-[var(--accent)]/70 w-[4.5rem] shrink-0">
                          [{formatLrcTime(line.time)}]
                        </span>
                        <span className="flex-1 text-xs text-[#7a7060] truncate">{line.text}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteLine(line.id); }}
                          className="opacity-0 group-hover:opacity-100 text-[#3a3628] hover:text-red-400/70 transition-all shrink-0"
                          title="Delete line"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                          </svg>
                        </button>
                      </div>
                    )
                  )}
                </div>

                {/* Add line controls */}
                <div className="px-4 pt-3 pb-2 border-t border-white/5 flex flex-col gap-2 shrink-0">
                  {/* Timestamp row */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono tabular-nums w-[5rem] shrink-0" style={{
                      color: stampedTime !== null ? "var(--accent)" : "#3a3628"
                    }}>
                      [{stampedTime !== null ? formatLrcTime(stampedTime) : formatLrcTime(progress)}]
                    </span>
                    <button
                      onClick={handleStamp}
                      title="Stamp current playback time"
                      className="text-[11px] font-mono px-2.5 py-1 rounded-md border border-white/8 text-[#7a7060] hover:text-[var(--accent)] hover:border-[var(--accent)]/30 transition-colors"
                    >
                      {stampedTime !== null ? "Re-stamp" : "⏱ Stamp"}
                    </button>
                    {stampedTime !== null && (
                      <button
                        onClick={() => setStampedTime(null)}
                        title="Release stamp"
                        className="text-[#3a3628] hover:text-[#7a7060] transition-colors"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Text input + add button */}
                  <div className="flex items-center gap-2">
                    <input
                      ref={newLineInputRef}
                      value={newLineText}
                      onChange={(e) => setNewLineText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddLine(); }}
                      placeholder="Lyric line…"
                      className="flex-1 bg-[#1a1814] border border-white/8 rounded-lg px-3 py-2 text-xs text-[#c8bfa8] font-mono placeholder:text-[#3a3628] focus:outline-none focus:border-[var(--accent)]/30 transition-colors min-w-0"
                    />
                    <button
                      onClick={handleAddLine}
                      disabled={!newLineText.trim()}
                      title="Add line"
                      className="w-8 h-8 rounded-lg bg-[var(--accent)] text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-opacity shrink-0 flex items-center justify-center"
                      style={{ color: "var(--accent-on)" }}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Save / Cancel */}
                <div className="flex gap-2 px-4 pb-4 shrink-0">
                  <button
                    onClick={cancelLrcBuilder}
                    className="flex-1 py-2 rounded-lg bg-[#2a2820] text-xs font-mono text-[#7a7060] hover:text-[#c8bfa8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveLrc}
                    disabled={isSaving || builderLines.length === 0}
                    className="flex-1 py-2 rounded-lg bg-[var(--accent)] text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    style={{ color: "var(--accent-on)" }}
                  >
                    {isSaving ? "Saving…" : `Save LRC (${builderLines.length})`}
                  </button>
                </div>
              </div>

            ) : editing ? (
              /* Raw edit mode */
              <div className="flex flex-col flex-1 min-h-0 p-4 gap-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={"Paste plain text or .lrc format\n\nExample LRC:\n[00:12.34] First line\n[00:15.67] Second line"}
                  className="flex-1 min-h-0 resize-none bg-[#1a1814] border border-white/8 rounded-xl px-4 py-3 text-sm text-[#c8bfa8] font-mono leading-relaxed placeholder:text-[#3a3628] focus:outline-none focus:border-[var(--accent)]/30 transition-colors"
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
                {isFetching && !isLoading && (
                  <div className="flex items-center gap-2 mb-4 px-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] animate-spin shrink-0">
                      <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                    <p className="text-[11px] font-mono text-[#3a3628]">Searching LRCLIB…</p>
                  </div>
                )}

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

                {isError && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                    </svg>
                    <p className="text-xs text-[#3a3628] font-mono">Could not load lyrics</p>
                  </div>
                )}

                {!isLoading && !isError && !hasLyrics && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                    <p className="text-sm text-[#3a3628]">No lyrics found</p>
                    <div className="flex flex-col items-center gap-2">
                      <button
                        onClick={enterLrcBuilder}
                        className="text-xs font-mono text-[var(--accent)] hover:opacity-80 transition-opacity"
                      >
                        Create LRC
                      </button>
                      <button
                        onClick={enterEdit}
                        className="text-xs font-mono text-[#3a3628] hover:text-[#7a7060] transition-colors"
                      >
                        Add manually
                      </button>
                    </div>
                  </div>
                )}

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
      )}
    </AnimatePresence>

    {/* Karaoke fullscreen overlay */}
    <AnimatePresence>
      {karaokeOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center overflow-hidden select-none"
        >
          {artworkUrl && (
            <div
              className="absolute inset-0 scale-110"
              style={{
                backgroundImage: `url(${artworkUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(80px) brightness(0.15)",
              }}
            />
          )}

          <div className="absolute top-8 left-0 right-0 flex flex-col items-center gap-2 z-10 pointer-events-none">
            {artworkUrl && (
              <img src={artworkUrl} alt="" className="w-14 h-14 rounded-lg object-cover shadow-2xl" />
            )}
            <p className="text-sm font-semibold text-white/80">{currentTrack?.title}</p>
            <p className="text-xs text-white/40">{currentTrack?.artist}</p>
          </div>

          {lrcLines && lrcLines.length > 0 ? (
            <div
              ref={karaokeScrollRef}
              className="relative z-10 w-full max-w-2xl overflow-y-auto"
              style={{ maxHeight: "70vh", scrollbarWidth: "none" }}
            >
              <div className="flex flex-col gap-3 px-12 py-[35vh]">
                {lrcLines.map((line, i) => {
                  const isActive = i === currentIdx;
                  const isPast = i < currentIdx;
                  return (
                    <p
                      key={i}
                      ref={(el) => { karaokeLineRefs.current[i] = el; }}
                      className="text-center leading-relaxed transition-colors duration-300 cursor-pointer hover:opacity-80"
                      style={{
                        fontSize: "1.5rem",
                        color: isActive ? "var(--accent)" : isPast ? "#3a3628" : "#7a7060",
                        fontWeight: isActive ? 600 : 400,
                      }}
                      onClick={() => seek(line.time)}
                    >
                      {line.text}
                    </p>
                  );
                })}
              </div>
            </div>
          ) : data?.plain_text ? (
            <div
              className="relative z-10 w-full max-w-2xl px-12 overflow-y-auto"
              style={{ maxHeight: "70vh", scrollbarWidth: "none" }}
            >
              <pre className="text-xl text-white/70 leading-relaxed whitespace-pre-wrap font-sans text-center">
                {data.plain_text}
              </pre>
            </div>
          ) : null}

          <button
            onClick={() => setKaraokeOpen(false)}
            className="absolute top-6 right-6 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/50 hover:text-white transition-all"
            title="Exit karaoke (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
