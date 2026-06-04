import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../store/settingsStore";
import { Equalizer } from "../components/organisms/Equalizer";
import { useQueryClient } from "@tanstack/react-query";

type SettingsSection = "library" | "appearance" | "player" | "equalizer" | "shortcuts" | "about";

const SHORTCUTS = [
  { key: "Space", action: "Play / Pause" },
  { key: "→", action: "Next track" },
  { key: "←", action: "Previous track" },
  { key: "↑ / ↓", action: "Volume up / down" },
  { key: "S", action: "Toggle shuffle" },
  { key: "R", action: "Toggle repeat" },
  { key: "Ctrl + F", action: "Search" },
  { key: "Ctrl + ,", action: "Settings" },
  { key: "Ctrl + =", action: "Zoom in (PDF)" },
  { key: "Ctrl + -", action: "Zoom out (PDF)" },
];

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("library");
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    theme, language, accentColor, autoplay, crossfadeDuration, normalizeVolume,
    setTheme, setLanguage, setAccentColor, setAutoplay,
    setCrossfadeDuration, setNormalizeVolume,
  } = useSettingsStore();

  async function handleClearLibrary(type: "music" | "books" | "artist_images" | "artist_banners" | "all" | "wipe") {
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
    <div className="flex h-full bg-[#0e0d0b]">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-white/5 pt-9 px-4">
        <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-4 px-2">
          Settings
        </p>
        <nav className="flex flex-col gap-0.5">
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-10 pt-9 pb-10">
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

            <div className="flex flex-col gap-4">
              {[
                { id: "music",          label: "Clear music library",        desc: "Removes all tracks and albums from the database", danger: true },
                { id: "books",          label: "Clear books library",         desc: "Removes all books and papers from the database", danger: true },
                { id: "artist_images",  label: "Delete artist images",        desc: "Deletes all downloaded artist portrait photos", danger: true },
                { id: "artist_banners", label: "Delete artist banners",       desc: "Deletes all downloaded artist banner images", danger: true },
                { id: "all",            label: "Clear everything",            desc: "Removes all content and deletes artwork cache files", danger: true },
                { id: "wipe",           label: "Delete all app data",         desc: "Wipes database, all cached images, and artist photos — for a clean uninstall", danger: true },
              ].map((item) => (
                <div key={item.id} className="flex items-center justify-between p-4 rounded-xl bg-[#161410] border border-white/5">
                  <div>
                    <p className="text-sm text-[#f0ead8]">{item.label}</p>
                    <p className="text-xs text-[#3a3628] mt-0.5">{item.desc}</p>
                  </div>
                  {confirmClear === item.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleClearLibrary(item.id as any)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[#c85858] text-white font-mono hover:bg-[#d96868] transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmClear(null)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] font-mono hover:text-[#c8bfa8] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmClear(item.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[#2a2820] text-[#c85858] font-mono hover:bg-[#c85858]/10 transition-colors"
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
                <div className="flex gap-3">
                  {([
                    { id: "amber", color: "#d4872a" },
                    { id: "blue", color: "#3b82f6" },
                    { id: "green", color: "#22c55e" },
                    { id: "purple", color: "#a855f7" },
                    { id: "red", color: "#ef4444" },
                  ] as const).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setAccentColor(c.id)}
                      className={`w-7 h-7 rounded-full transition-all ${accentColor === c.id ? "ring-2 ring-white/40 scale-110" : "opacity-60 hover:opacity-100"}`}
                      style={{ backgroundColor: c.color }}
                    />
                  ))}
                </div>
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
            <p className="text-[#3a3628] text-xs font-mono mb-8">Global shortcuts for Libera</p>
            <div className="flex flex-col gap-1">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-[#161410] transition-colors">
                  <span className="text-sm text-[#c8bfa8]">{s.action}</span>
                  <kbd className="text-xs font-mono bg-[#2a2820] text-[var(--accent)] px-2.5 py-1 rounded-md border border-white/8">
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
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