import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, SHORTCUT_IDS, SHORTCUT_LABELS, DEFAULT_KEY_BINDINGS, DEFAULT_KEY_BINDINGS_2, ShortcutId } from "../store/settingsStore";
import { Equalizer } from "../components/organisms/Equalizer";
import { Tooltip } from "../components/atoms/Tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { useScanFolder } from "../hooks/useLibrary";
import { useMetadataFetch } from "../hooks/useMetadataFetch";
import { useScanPhotos } from "../hooks/usePhotos";

function displayKey(key: string): string {
  const map: Record<string, string> = {
    space: "Space", escape: "Esc", enter: "Enter", tab: "Tab",
    backspace: "⌫", delete: "Del",
    arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓",
    ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "⌘",
  };
  return key.split("+").map((p) => map[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p)).join("+");
}

// ─── Color picker helpers ──────────────────────────────────────────────────
function hsvToHex(h: number, s: number, v: number): string {
  s /= 100; v /= 100;
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => v * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

function hexToHsv(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [0, 0, 80];
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [Math.round(h), Math.round(max ? (d / max) * 100 : 0), Math.round(max * 100)];
}

type SettingsSection = "library" | "appearance" | "player" | "equalizer" | "shortcuts" | "about";


export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("library");
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { mutate: scanFolder, isPending: isScanning } = useScanFolder();
  const { mutate: scanPhotos, isPending: isScanningPhotos } = useScanPhotos();
  const metadataFetch = useMetadataFetch();

  async function handleAddPhotosFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select photo folder" });
      if (selected && typeof selected === "string") scanPhotos(selected);
    } catch (e) {
      console.error("Dialog error:", e);
    }
  }

  async function handleAddFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select music folder" });
      if (selected && typeof selected === "string") scanFolder(selected);
    } catch (e) {
      console.error("Dialog error:", e);
    }
  }

  const {
    theme, language, accentColor, customAccentHex, savedCustomColors,
    keyBindings, keyBindings2, autoplay, crossfadeDuration, normalizeVolume,
    setTheme, setLanguage, setAccentColor, setCustomAccentHex,
    saveCustomColor, removeCustomColor,
    setShortcut, resetShortcut, resetAllShortcuts,
    setShortcut2, resetShortcut2, resetAllShortcuts2,
    setAutoplay, setCrossfadeDuration, setNormalizeVolume,
    maxPagesInMemory, maxConcurrentLoads, setMaxPagesInMemory, setMaxConcurrentLoads,
  } = useSettingsStore();

  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [recordingId2, setRecordingId2] = useState<ShortcutId | null>(null);

  useEffect(() => {
    if (!recordingId) return;
    function capture(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecordingId(null); return; }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      if (e.metaKey) parts.push("meta");
      parts.push(e.key === " " ? "space" : e.key.toLowerCase());
      if (!recordingId) return;
      setShortcut(recordingId, parts.join("+"));
      setRecordingId(null);
    }
    document.addEventListener("keydown", capture, true);
    return () => document.removeEventListener("keydown", capture, true);
  }, [recordingId]);

  useEffect(() => {
    if (!recordingId2) return;
    function capture(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecordingId2(null); return; }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      if (e.metaKey) parts.push("meta");
      parts.push(e.key === " " ? "space" : e.key.toLowerCase());
      if (!recordingId2) return;
      setShortcut2(recordingId2, parts.join("+"));
      setRecordingId2(null);
    }
    document.addEventListener("keydown", capture, true);
    return () => document.removeEventListener("keydown", capture, true);
  }, [recordingId2]);

  // ─── Custom color picker state ───────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ph, setPh] = useState(0);
  const [ps, setPs] = useState(80);
  const [pv, setPv] = useState(83);
  const [hexText, setHexText] = useState("#d4872a");
  const [swatchPopover, setSwatchPopover] = useState<{ hex: string; step: "options" | "confirm" } | null>(null);
  const squareRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    const base = accentColor === "custom" ? customAccentHex : "#8b5cf6";
    const [h, s, v] = hexToHsv(base);
    setPh(h); setPs(s); setPv(v); setHexText(base);
    setPickerOpen(true);
  }

  function applyHex(hex: string) {
    setHexText(hex);
    setCustomAccentHex(hex);
  }

  function handleSquare(e: React.PointerEvent) {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100);
    const v = Math.round((1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))) * 100);
    setPs(s); setPv(v);
    applyHex(hsvToHex(ph, s, v));
  }

  function handleHexInput(val: string) {
    setHexText(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      const [h, s, v] = hexToHsv(val.toLowerCase());
      setPh(h); setPs(s); setPv(v);
      applyHex(val.toLowerCase());
    }
  }

  async function handleClearLibrary(type: "music" | "books" | "photos" | "artist_images" | "artist_banners" | "all" | "wipe") {
    try {
      if (type === "wipe") {
        await invoke("clear_all_data");
        queryClient.clear();
      } else if (type === "artist_images") {
        await invoke("clear_artist_images");
        queryClient.invalidateQueries({ queryKey: ["artist-image"] });
      } else if (type === "artist_banners") {
        await invoke("clear_artist_banners");
        queryClient.invalidateQueries({ queryKey: ["artist-banner"] });
      } else {
        if (type === "music" || type === "all") {
          await invoke("clear_music_library");
          queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
          queryClient.invalidateQueries({ queryKey: ["tracks-count"] });
          queryClient.invalidateQueries({ queryKey: ["albums"] });
          queryClient.invalidateQueries({ queryKey: ["artists"] });
          queryClient.invalidateQueries({ queryKey: ["genres"] });
        }
        if (type === "books" || type === "all") {
          await invoke("clear_books_library");
          queryClient.invalidateQueries({ queryKey: ["books"] });
        }
        if (type === "photos" || type === "all") {
          await invoke("clear_photos_library");
          queryClient.invalidateQueries({ queryKey: ["photos-count"] });
          queryClient.invalidateQueries({ queryKey: ["photos-page"] });
          queryClient.invalidateQueries({ queryKey: ["photo-albums"] });
          queryClient.invalidateQueries({ queryKey: ["photo-stats"] });
        }
        if (type === "all") {
          await invoke("clear_artwork_cache");
          queryClient.invalidateQueries({ queryKey: ["artwork"] });
          queryClient.invalidateQueries({ queryKey: ["artist-image"] });
          queryClient.invalidateQueries({ queryKey: ["artist-banner"] });
        }
      }
      setFeedback("Done!");
      setTimeout(() => setFeedback(null), 2000);
    } catch (e) {
      setFeedback("Error clearing data");
      setTimeout(() => setFeedback(null), 2000);
    }
    setConfirmClear(null);
  }

  const sections: { id: SettingsSection; label: string; icon: string }[] = [
    { id: "library", label: "Library", icon: "M4 6h16M4 10h16M4 14h16M4 18h16" },
    { id: "appearance", label: "Appearance", icon: "M12 3v1m0 16v1M4.22 4.22l.707.707m12.02 12.02l.707.707M1 12h1m18 0h1M4.22 19.78l.707-.707M18.364 5.636l-.707-.707" },
    { id: "player", label: "Player", icon: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" },
    { id: "equalizer", label: "Equalizer", icon: "M9 19V5m0 0L5 9m4-4l4 4M15 5v14m0 0l4-4m-4 4l-4-4" },
    { id: "shortcuts", label: "Shortcuts", icon: "M12 6v6m0 0v6m0-6h6m-6 0H6" },
    { id: "about", label: "About", icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  ];

  return (
    <div className="flex flex-col sm:flex-row h-full bg-[#0e0d0b]">
      {/* Sidebar (desktop) / Tab bar (mobile) */}
      <div className="sm:w-48 sm:shrink-0 sm:border-r sm:border-b-0 border-b border-white/5 sm:pt-9 pt-3 px-4 sm:px-4 bg-[#0e0d0b]">
        <p className="hidden sm:block font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-4 px-2">
          Settings
        </p>
        {/* Desktop: vertical nav */}
        <nav className="hidden sm:flex flex-col gap-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                activeSection === s.id
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[#7a7060] hover:text-[#c8bfa8] hover:bg-white/3"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={s.icon} />
              </svg>
              {s.label}
            </button>
          ))}
        </nav>
        {/* Mobile: icon-only equal-width tabs */}
        <div className="flex sm:hidden">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              title={s.label}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors border-b-2 ${
                activeSection === s.id
                  ? "text-[var(--accent)] border-[var(--accent)]"
                  : "text-[#3a3628] hover:text-[#7a7060] border-transparent"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={s.icon} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-10 pt-4 sm:pt-9 pb-10">
        {feedback && (
          <div className="fixed top-4 right-4 bg-[var(--accent)] text-white text-xs px-4 py-2 rounded-lg font-mono z-50">
            {feedback}
          </div>
        )}

        {/* Library */}
        {activeSection === "library" && (
          <div className="max-w-xl">
            <h2 className="text-2xl text-[#faf8f2] font-light mb-1" style={{ fontFamily: "Fraunces, serif" }}>
              Library
            </h2>
            <p className="text-[#3a3628] text-xs font-mono mb-8">Manage your scanned content</p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#161410] border border-white/5 mb-10">
              <div>
                <p className="text-sm text-[#f0ead8]">Add music folder</p>
                <p className="text-xs text-[#3a3628] mt-0.5">Scan a folder and add its tracks to your library</p>
              </div>
              <button
                onClick={handleAddFolder}
                disabled={isScanning}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] font-mono hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-[80px] text-center"
                style={{ color: "var(--accent-on)" }}
              >
                {isScanning ? "Scanning..." : "Add folder"}
              </button>
            </div>

            {/* Photos folder */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#161410] border border-white/5 mb-4">
              <div>
                <p className="text-sm text-[#f0ead8]">Add photos folder</p>
                <p className="text-xs text-[#3a3628] mt-0.5">Scan a folder for images and add them to your picture library</p>
              </div>
              <button
                onClick={handleAddPhotosFolder}
                disabled={isScanningPhotos}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] font-mono hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-[80px] text-center"
                style={{ color: "var(--accent-on)" }}
              >
                {isScanningPhotos ? "Scanning..." : "Add folder"}
              </button>
            </div>

            {/* Fetch missing metadata */}
            <div className="p-4 rounded-xl bg-[#161410] border border-white/5 mb-10">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-[#f0ead8]">Fetch missing metadata</p>
                  <p className="text-xs text-[#3a3628] mt-0.5">
                    Look up missing year and genre from MusicBrainz for tracks that don't have them
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {metadataFetch.isRunning && (
                    <button
                      onClick={metadataFetch.cancel}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] font-mono hover:text-[#c8bfa8] transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={metadataFetch.start}
                    disabled={metadataFetch.isRunning}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] font-mono hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-[80px] text-center"
                    style={{ color: "var(--accent-on)" }}
                  >
                    {metadataFetch.isRunning ? "Running…" : "Fetch"}
                  </button>
                </div>
              </div>

              {/* Progress */}
              {metadataFetch.isRunning && metadataFetch.total > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] font-mono text-[#3a3628] mb-1.5">
                    <span className="truncate max-w-[200px]">{metadataFetch.current}</span>
                    <span className="shrink-0 ml-2">
                      {metadataFetch.completed} / {metadataFetch.total}
                      {metadataFetch.updated > 0 && (
                        <span className="text-[var(--accent)]"> · {metadataFetch.updated} updated</span>
                      )}
                    </span>
                  </div>
                  <div className="h-px bg-[#1f1d18] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${metadataFetch.percent}%`,
                        background: "linear-gradient(90deg, var(--accent), var(--accent-hover))",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Done message */}
              {!metadataFetch.isRunning && metadataFetch.doneMessage && (
                <div className="mt-3 flex items-center gap-3">
                  <p className="text-xs font-mono text-[var(--accent)]">{metadataFetch.doneMessage}</p>
                  {metadataFetch.logPath && (
                    <button
                      onClick={metadataFetch.openReport}
                      className="text-xs font-mono text-[#7a7060] hover:text-[#c8bfa8] transition-colors underline underline-offset-2"
                    >
                      View report
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Advanced */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-[#5a5244]">Advanced</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <div className="flex flex-col gap-3 mb-8">
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#161410] border border-white/5">
                <div className="min-w-0">
                  <p className="text-sm text-[#f0ead8]">Pages kept in memory</p>
                  <p className="text-xs text-[#3a3628] mt-0.5">
                    Max track-list pages held in RAM. Higher = smoother scrolling, more memory. Default: 6.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setMaxPagesInMemory(Math.max(2, maxPagesInMemory - 1))}
                    className="w-7 h-7 rounded-lg bg-[#1f1d18] hover:bg-[#2a2820] text-[#c8bfa8] text-sm transition-colors flex items-center justify-center"
                  >−</button>
                  <span className="w-6 text-center text-sm font-mono text-[#c8bfa8]">{maxPagesInMemory}</span>
                  <button
                    onClick={() => setMaxPagesInMemory(Math.min(20, maxPagesInMemory + 1))}
                    className="w-7 h-7 rounded-lg bg-[#1f1d18] hover:bg-[#2a2820] text-[#c8bfa8] text-sm transition-colors flex items-center justify-center"
                  >+</button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#161410] border border-white/5">
                <div className="min-w-0">
                  <p className="text-sm text-[#f0ead8]">Concurrent page loads</p>
                  <p className="text-xs text-[#3a3628] mt-0.5">
                    How many track pages load in parallel while scrolling. Lower = less CPU. Default: 2.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setMaxConcurrentLoads(Math.max(1, maxConcurrentLoads - 1))}
                    className="w-7 h-7 rounded-lg bg-[#1f1d18] hover:bg-[#2a2820] text-[#c8bfa8] text-sm transition-colors flex items-center justify-center"
                  >−</button>
                  <span className="w-6 text-center text-sm font-mono text-[#c8bfa8]">{maxConcurrentLoads}</span>
                  <button
                    onClick={() => setMaxConcurrentLoads(Math.min(8, maxConcurrentLoads + 1))}
                    className="w-7 h-7 rounded-lg bg-[#1f1d18] hover:bg-[#2a2820] text-[#c8bfa8] text-sm transition-colors flex items-center justify-center"
                  >+</button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-5">
              <span className="text-[9px] font-mono tracking-[0.18em] uppercase text-[#c85858]/60">Danger zone</span>
              <div className="flex-1 h-px bg-[#c85858]/10" />
            </div>

            <div className="flex flex-col gap-4">
              {[
                { id: "music",          label: "Clear music library",        desc: "Removes all tracks and albums from the database", danger: true },
                { id: "books",          label: "Clear books library",         desc: "Removes all books and papers from the database", danger: true },
                { id: "photos",         label: "Clear photos library",        desc: "Removes all photos from the database and thumbnail cache", danger: true },
                { id: "artist_images",  label: "Delete artist images",        desc: "Deletes all downloaded artist portrait photos", danger: true },
                { id: "artist_banners", label: "Delete artist banners",       desc: "Deletes all downloaded artist banner images", danger: true },
                { id: "all",            label: "Clear everything",            desc: "Removes all content and deletes artwork cache files", danger: true },
                { id: "wipe",           label: "Delete all app data",         desc: "Wipes database, all cached images, and artist photos — for a clean uninstall", danger: true },
              ].map((item) => (
                <div key={item.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 rounded-xl bg-[#161410] border border-white/5">
                  <div>
                    <p className="text-sm text-[#f0ead8]">{item.label}</p>
                    <p className="text-xs text-[#3a3628] mt-0.5">{item.desc}</p>
                  </div>
                  {confirmClear === item.id ? (
                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        onClick={() => handleClearLibrary(item.id as any)}
                        className="flex-1 sm:flex-none text-xs px-3 py-1.5 rounded-lg bg-[#c85858] text-white font-mono hover:bg-[#d96868] transition-colors text-center"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmClear(null)}
                        className="flex-1 sm:flex-none text-xs px-3 py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] font-mono hover:text-[#c8bfa8] transition-colors text-center"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmClear(item.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[#2a2820] text-[#c85858] font-mono hover:bg-[#c85858]/10 transition-colors sm:shrink-0 text-center"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Appearance */}
        {activeSection === "appearance" && (
          <div className="max-w-xl">
            <h2 className="text-2xl text-[#faf8f2] font-light mb-1" style={{ fontFamily: "Fraunces, serif" }}>
              Appearance
            </h2>
            <p className="text-[#3a3628] text-xs font-mono mb-8">Customize how Libera looks</p>

            <div className="flex flex-col gap-6">
              {/* Theme */}
              <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
                <p className="text-sm text-[#f0ead8] mb-3">Theme</p>
                <div className="flex gap-2">
                  {(["dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTheme(t)}
                      className={`flex-1 py-2 rounded-lg text-xs font-mono capitalize transition-colors ${
                        theme === t
                          ? "bg-[var(--accent-a20)] text-[var(--accent)] border border-[var(--accent-a30)]"
                          : "bg-[#1f1d18] text-[#7a7060] border border-transparent hover:text-[#c8bfa8]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent color */}
              <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
                <p className="text-sm text-[#f0ead8] mb-3">Accent color</p>

                {/* Backdrop — closes popover on outside click */}
                {swatchPopover && (
                  <div className="fixed inset-0 z-10" onClick={() => setSwatchPopover(null)} />
                )}

                {/* Swatch row */}
                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* Preset swatches */}
                  {([
                    { id: "amber",  color: "#d4872a" },
                    { id: "blue",   color: "#3b82f6" },
                    { id: "green",  color: "#22c55e" },
                    { id: "purple", color: "#a855f7" },
                    { id: "red",    color: "#ef4444" },
                  ] as const).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setAccentColor(c.id); setSwatchPopover(null); }}
                      className={`w-7 h-7 rounded-full transition-all ${accentColor === c.id ? "ring-2 ring-white/40 scale-110" : "opacity-60 hover:opacity-100"}`}
                      style={{ backgroundColor: c.color }}
                    />
                  ))}

                  {/* Saved custom colors */}
                  {savedCustomColors.length > 0 && (
                    <div className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />
                  )}
                  {savedCustomColors.map((hex) => (
                    <div key={hex} className="relative shrink-0" style={{ zIndex: swatchPopover?.hex === hex ? 20 : "auto" }}>
                      <button
                        onClick={() => setSwatchPopover(swatchPopover?.hex === hex ? null : { hex, step: "options" })}
                        title={hex}
                        className={`w-7 h-7 rounded-full transition-all block ${accentColor === "custom" && customAccentHex === hex ? "ring-2 ring-white/40 scale-110" : "opacity-60 hover:opacity-100"}`}
                        style={{ backgroundColor: hex }}
                      />

                      {/* Popover */}
                      {swatchPopover?.hex === hex && (
                        <div className="absolute top-full mt-2 left-0 bg-[#1a1814] border border-white/10 rounded-xl shadow-2xl overflow-hidden" style={{ minWidth: 164, zIndex: 30 }}>
                          {swatchPopover.step === "options" ? (
                            <>
                              <div className="flex items-center gap-2.5 px-3 pt-3 pb-2.5">
                                <div className="w-5 h-5 rounded-md shrink-0 ring-1 ring-white/10" style={{ backgroundColor: hex }} />
                                <span className="text-[10px] font-mono text-[#5a5448] uppercase tracking-wide">{hex}</span>
                              </div>
                              <div className="h-px bg-white/5" />
                              <div className="p-1.5 flex flex-col">
                                <button
                                  onClick={() => { setCustomAccentHex(hex); setSwatchPopover(null); }}
                                  className="w-full text-left text-xs px-3 py-2.5 rounded-lg text-[var(--accent)] hover:bg-[var(--accent-a10)] transition-colors font-mono"
                                >
                                  Apply
                                </button>
                                <button
                                  onClick={() => setSwatchPopover({ hex, step: "confirm" })}
                                  className="w-full text-left text-xs px-3 py-2.5 rounded-lg text-[#c85858] hover:bg-[#c85858]/10 transition-colors font-mono"
                                >
                                  Remove…
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="p-4">
                              <p className="text-sm text-[#f0ead8] mb-1">Remove this color?</p>
                              <p className="text-[10px] font-mono text-[#3a3628] mb-4 uppercase">{hex}</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setSwatchPopover({ hex, step: "options" })}
                                  className="flex-1 text-xs py-2 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => { removeCustomColor(hex); setSwatchPopover(null); }}
                                  className="flex-1 text-xs py-2 rounded-lg bg-[#c85858] hover:bg-[#d96868] transition-colors font-mono text-white"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Rainbow circle — open custom picker */}
                  <button
                    onClick={() => pickerOpen ? setPickerOpen(false) : openPicker()}
                    title="Custom color"
                    className={`w-7 h-7 rounded-full transition-all shrink-0 ${pickerOpen ? "ring-2 ring-white/40 scale-110" : "opacity-60 hover:opacity-100"}`}
                    style={{ background: "conic-gradient(hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))" }}
                  />
                </div>

                {/* Inline color picker */}
                {pickerOpen && (
                  <div className="mt-4 flex flex-col gap-3">
                    {/* SV square */}
                    <div
                      ref={squareRef}
                      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handleSquare(e); }}
                      onPointerMove={(e) => { if (e.buttons > 0) handleSquare(e); }}
                      style={{
                        width: "100%", height: 150, borderRadius: 8,
                        cursor: "crosshair", userSelect: "none", position: "relative",
                        background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, hsl(${ph}deg, 100%, 50%))`,
                      }}
                    >
                      <div style={{
                        position: "absolute",
                        left: `${ps}%`, top: `${100 - pv}%`,
                        transform: "translate(-50%, -50%)",
                        width: 14, height: 14, borderRadius: "50%",
                        border: "2px solid white",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                        pointerEvents: "none",
                        backgroundColor: hsvToHex(ph, ps, pv),
                      }} />
                    </div>

                    {/* Hue slider */}
                    <input
                      type="range" min="0" max="360" value={ph}
                      onChange={(e) => {
                        const h = parseInt(e.target.value);
                        setPh(h);
                        applyHex(hsvToHex(h, ps, pv));
                      }}
                      className="hue-range"
                    />

                    {/* Hex input + Save */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded shrink-0" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hexText) ? hexText : "#888", border: "1px solid rgba(255,255,255,0.1)" }} />
                      <input
                        value={hexText}
                        onChange={(e) => handleHexInput(e.target.value)}
                        spellCheck={false}
                        maxLength={7}
                        className="flex-1 bg-[#1f1d18] text-[#f0ead8] text-xs font-mono px-2 py-1.5 rounded-lg outline-none border border-white/5 focus:border-[var(--accent-a30)] uppercase"
                      />
                      <button
                        onClick={() => { const h = hexText.toLowerCase(); if (/^#[0-9a-f]{6}$/.test(h)) { saveCustomColor(h); setPickerOpen(false); } }}
                        disabled={savedCustomColors.length >= 7 || savedCustomColors.includes(hexText.toLowerCase())}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] font-mono disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                        style={{ color: "var(--accent-on)" }}
                        title={savedCustomColors.length >= 7 ? "Max 7 custom colors" : "Save this color"}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Language */}
              <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
                <p className="text-sm text-[#f0ead8] mb-3">Language</p>
                <div className="flex gap-2">
                  {([
                    { id: "en", label: "English" },
                    { id: "es", label: "Español" },
                  ] as const).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLanguage(l.id)}
                      className={`flex-1 py-2 rounded-lg text-xs font-mono transition-colors ${
                        language === l.id
                          ? "bg-[var(--accent-a20)] text-[var(--accent)] border border-[var(--accent-a30)]"
                          : "bg-[#1f1d18] text-[#7a7060] border border-transparent hover:text-[#c8bfa8]"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Player */}
        {activeSection === "player" && (
          <div className="max-w-xl">
            <h2 className="text-2xl text-[#faf8f2] font-light mb-1" style={{ fontFamily: "Fraunces, serif" }}>
              Player
            </h2>
            <p className="text-[#3a3628] text-xs font-mono mb-8">Playback behavior</p>

            <div className="flex flex-col gap-4">
              {/* Autoplay */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[#161410] border border-white/5">
                <div>
                  <p className="text-sm text-[#f0ead8]">Autoplay</p>
                  <p className="text-xs text-[#3a3628] mt-0.5">Start playing when opening the app</p>
                </div>
                <button
                  onClick={() => setAutoplay(!autoplay)}
                  className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${autoplay ? "bg-[var(--accent)]" : "bg-[#2a2820]"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoplay ? "translate-x-4" : ""}`} />
                </button>
              </div>

              {/* Normalize */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-[#161410] border border-white/5">
                <div>
                  <p className="text-sm text-[#f0ead8]">Volume normalization</p>
                  <p className="text-xs text-[#3a3628] mt-0.5">Equalize volume across tracks</p>
                </div>
                <button
                  onClick={() => setNormalizeVolume(!normalizeVolume)}
                  className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${normalizeVolume ? "bg-[var(--accent)]" : "bg-[#2a2820]"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${normalizeVolume ? "translate-x-4" : ""}`} />
                </button>
              </div>

              {/* Crossfade */}
              <div className="p-4 rounded-xl bg-[#161410] border border-white/5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm text-[#f0ead8]">Crossfade</p>
                    <p className="text-xs text-[#3a3628] mt-0.5">Smooth transition between tracks</p>
                  </div>
                  <span className="text-xs font-mono text-[var(--accent)]">
                    {crossfadeDuration === 0 ? "Off" : `${crossfadeDuration}s`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={crossfadeDuration}
                  onChange={(e) => setCrossfadeDuration(parseInt(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] font-mono text-[#3a3628]">Off</span>
                  <span className="text-[9px] font-mono text-[#3a3628]">10s</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Equalizer */}
        {activeSection === "equalizer" && (
          <div className="max-w-2xl">
            <h2 className="text-2xl text-[#faf8f2] font-light mb-1" style={{ fontFamily: "Fraunces, serif" }}>
              Equalizer
            </h2>
            <p className="text-[#3a3628] text-xs font-mono mb-8">10-band audio equalizer</p>
            <Equalizer />
          </div>
        )}

        {/* Shortcuts */}
        {activeSection === "shortcuts" && (
          <div className="max-w-xl">
            <h2 className="text-2xl text-[#faf8f2] font-light mb-1" style={{ fontFamily: "Fraunces, serif" }}>
              Keyboard Shortcuts
            </h2>
            <p className="text-[#3a3628] text-xs font-mono mb-8">Click a key badge to rebind — combos like Ctrl+G work too — Esc to cancel</p>

            {/* Conflict warning */}
            {(() => {
              const counts: Record<string, number> = {};
              Object.values(keyBindings).forEach((k) => { counts[k] = (counts[k] ?? 0) + 1; });
              Object.values(keyBindings2).forEach((k) => { if (k) counts[k] = (counts[k] ?? 0) + 1; });
              const hasConflict = Object.values(counts).some((n) => n > 1);
              return hasConflict ? (
                <div className="mb-4 px-3 py-2.5 rounded-lg bg-[#c85858]/8 border border-[#c85858]/20 text-xs font-mono text-[#c85858]">
                  Two shortcuts share the same key — only the first will fire.
                </div>
              ) : null;
            })()}

            <div className="flex flex-col gap-1.5">
              {SHORTCUT_IDS.map((id) => {
                const isRecording1 = recordingId === id;
                const isRecording2 = recordingId2 === id;
                const isModified1 = keyBindings[id] !== DEFAULT_KEY_BINDINGS[id];
                const isModified2 = keyBindings2[id] !== DEFAULT_KEY_BINDINGS_2[id];
                const counts: Record<string, number> = {};
                Object.values(keyBindings).forEach((k) => { counts[k] = (counts[k] ?? 0) + 1; });
                Object.values(keyBindings2).forEach((k) => { if (k) counts[k] = (counts[k] ?? 0) + 1; });
                const conflict1 = counts[keyBindings[id]] > 1;
                const conflict2 = keyBindings2[id] ? counts[keyBindings2[id]] > 1 : false;

                return (
                  <div
                    key={id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                      isRecording1 || isRecording2
                        ? "bg-[#161410] border-[var(--accent-a30)]"
                        : "bg-[#161410] border-white/5 hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Tooltip
                        shortcut={displayKey(keyBindings[id])}
                        altShortcut={keyBindings2[id] ? displayKey(keyBindings2[id]) : undefined}
                      >
                        <span className="text-sm text-[#c8bfa8] cursor-default">{SHORTCUT_LABELS[id]}</span>
                      </Tooltip>
                      {(conflict1 || conflict2) && (
                        <span className="text-[10px] font-mono text-[#c85858] bg-[#c85858]/10 px-1.5 py-0.5 rounded">conflict</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Primary slot */}
                      <div className="flex items-center gap-1.5">
                        {isRecording1 ? (
                          <span className="text-xs font-mono text-[var(--accent)] animate-pulse px-3 py-1">
                            Press a key or combo…
                          </span>
                        ) : (
                          <button
                            onClick={() => { setRecordingId2(null); setRecordingId(id); }}
                            title="Click to rebind"
                            className={`text-xs font-mono px-2.5 py-1 rounded-md border transition-colors ${
                              conflict1
                                ? "bg-[#c85858]/10 text-[#c85858] border-[#c85858]/30"
                                : "bg-[#2a2820] text-[var(--accent)] border-white/8 hover:border-[var(--accent-a30)] hover:bg-[var(--accent-a08)]"
                            }`}
                          >
                            {displayKey(keyBindings[id])}
                          </button>
                        )}
                        {isModified1 && !isRecording1 && (
                          <button onClick={() => resetShortcut(id)} title="Reset to default" className="text-[#3a3628] hover:text-[#7a7060] transition-colors">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                            </svg>
                          </button>
                        )}
                      </div>

                      <span className="text-[#2e2c24] text-xs font-mono">/</span>

                      {/* Secondary slot */}
                      <div className="flex items-center gap-1.5">
                        {isRecording2 ? (
                          <span className="text-xs font-mono text-[var(--accent)] animate-pulse px-3 py-1">
                            Press a key or combo…
                          </span>
                        ) : keyBindings2[id] ? (
                          <button
                            onClick={() => { setRecordingId(null); setRecordingId2(id); }}
                            title="Click to rebind"
                            className={`text-xs font-mono px-2.5 py-1 rounded-md border transition-colors ${
                              conflict2
                                ? "bg-[#c85858]/10 text-[#c85858] border-[#c85858]/30"
                                : "bg-[#2a2820] text-[var(--accent)] border-white/8 hover:border-[var(--accent-a30)] hover:bg-[var(--accent-a08)]"
                            }`}
                          >
                            {displayKey(keyBindings2[id])}
                          </button>
                        ) : (
                          <button
                            onClick={() => { setRecordingId(null); setRecordingId2(id); }}
                            title="Add second keybind"
                            className="text-xs font-mono px-2.5 py-1 rounded-md border border-dashed border-white/10 text-[#3a3628] hover:text-[#7a7060] hover:border-white/20 transition-colors"
                          >
                            +
                          </button>
                        )}
                        {keyBindings2[id] && !isRecording2 && (
                          <button onClick={() => resetShortcut2(id)} title="Clear second keybind" className="text-[#3a3628] hover:text-[#7a7060] transition-colors">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {(SHORTCUT_IDS.some((id) => keyBindings[id] !== DEFAULT_KEY_BINDINGS[id]) ||
              SHORTCUT_IDS.some((id) => keyBindings2[id] !== DEFAULT_KEY_BINDINGS_2[id])) && (
              <div className="flex gap-4 mt-5">
                {SHORTCUT_IDS.some((id) => keyBindings[id] !== DEFAULT_KEY_BINDINGS[id]) && (
                  <button onClick={resetAllShortcuts} className="text-xs font-mono text-[#3a3628] hover:text-[#7a7060] transition-colors">
                    Reset primary to defaults
                  </button>
                )}
                {SHORTCUT_IDS.some((id) => keyBindings2[id] !== DEFAULT_KEY_BINDINGS_2[id]) && (
                  <button onClick={resetAllShortcuts2} className="text-xs font-mono text-[#3a3628] hover:text-[#7a7060] transition-colors">
                    Reset secondary to defaults
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* About */}
        {activeSection === "about" && (
          <div className="max-w-xl">
            <h2 className="text-2xl text-[#faf8f2] font-light mb-1" style={{ fontFamily: "Fraunces, serif" }}>
              About Libera
            </h2>
            <p className="text-[#3a3628] text-xs font-mono mb-8">Version and license info</p>
            <div className="p-6 rounded-xl bg-[#161410] border border-white/5 flex flex-col gap-4">
              <div>
                <h1 className="text-3xl text-[#faf8f2] font-light" style={{ fontFamily: "Fraunces, serif" }}>
                  Libera
                </h1>
                <p className="text-[#3a3628] text-xs font-mono mt-1">Version 0.1.0</p>
              </div>
              <p className="text-sm text-[#7a7060] leading-relaxed">
                A local-first media manager and player for everything you own — music, films, books, papers and beyond.
              </p>
              <div className="border-t border-white/5 pt-4">
                <p className="text-xs text-[#3a3628] font-mono">Built with Tauri 2 · Rust · React 19</p>
                <p className="text-xs text-[#3a3628] font-mono mt-1">© 2025 Derrick · Proprietary License</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}