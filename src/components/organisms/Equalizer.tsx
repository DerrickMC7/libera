import { useState, useRef, useEffect } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface EqualizerProps {
  onClose?: () => void;
  compact?: boolean;
  analyserRef?: React.RefObject<AnalyserNode | null>;
}

// EQ band center frequencies matching the settingsStore bands
const BAND_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function SpectrumAnalyser({ analyserRef, enabled }: { analyserRef: React.RefObject<AnalyserNode | null>; enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Non-null re-bindings so TypeScript keeps the narrowing inside closures
    const cvs: HTMLCanvasElement = canvas;
    const c2d: CanvasRenderingContext2D = ctx;

    // Keep canvas internal resolution in sync with its CSS width so bar
    // positions are calculated in real pixels (no scaling distortion).
    const syncWidth = () => { cvs.width = cvs.offsetWidth; };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(cvs);

    const fftSize = 512;
    const dataArray = new Uint8Array(fftSize / 2);
    // Must match the CSS gap-2 (8px) used between the flex EQ band sliders
    const GAP = 8;

    function freqToBin(freq: number, sampleRate: number): number {
      return Math.round((freq / (sampleRate / 2)) * (fftSize / 2));
    }

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const analyser = analyserRef.current;
      const w = cvs.width;
      const h = cvs.height;
      c2d.clearRect(0, 0, w, h);

      const barW = (w - 9 * GAP) / 10;

      if (!analyser || !enabled) {
        c2d.fillStyle = "rgba(42,40,32,0.5)";
        for (let i = 0; i < 10; i++) {
          c2d.fillRect(Math.round(i * (barW + GAP)), h - 2, Math.round(barW), 2);
        }
        return;
      }

      // Snappier response: lower smoothing = bars react faster to transients
      analyser.smoothingTimeConstant = 0.65;
      analyser.getByteFrequencyData(dataArray);
      const sampleRate = analyser.context.sampleRate;

      BAND_FREQS.forEach((freq, i) => {
        const bin = freqToBin(freq, sampleRate);
        let sum = 0, count = 0;
        for (let b = Math.max(0, bin - 2); b <= Math.min(dataArray.length - 1, bin + 2); b++) {
          sum += dataArray[b]; count++;
        }
        const val = count > 0 ? sum / count : 0;
        const barH = Math.max(2, (val / 255) * h);
        const x = Math.round(i * (barW + GAP));
        const bw = Math.round(barW);

        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#d4872a';
        const grad = c2d.createLinearGradient(0, h - barH, 0, h);
        grad.addColorStop(0, accent + 'e6'); // 90% opacity
        grad.addColorStop(1, accent + '33'); // 20% opacity
        c2d.fillStyle = grad;
        c2d.fillRect(x, h - barH, bw, barH);
      });
    }

    draw();
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [analyserRef, enabled]);

  return (
    <canvas
      ref={canvasRef}
      height={64}
      className="w-full rounded-md"
      style={{ display: "block", background: "rgba(15,14,11,0.6)" }}
    />
  );
}

export function Equalizer({ onClose, compact = false, analyserRef }: EqualizerProps) {
  const {
    eqEnabled, eqBands, activePresetId, customPresets,
    setEqEnabled, setEqBand, applyPreset,
    saveCustomPreset, deleteCustomPreset, renameCustomPreset,
    getAllPresets,
  } = useSettingsStore();

  const [savingName, setSavingName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const allPresets = getAllPresets();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, compact); // compact=true means it's the popup EQ

  function handleSave() {
    if (!savingName.trim()) return;
    saveCustomPreset(savingName.trim());
    setSavingName("");
    setShowSaveInput(false);
  }

  function formatFreq(freq: number): string {
    return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
  }

  return (
    <div
      ref={panelRef}
      role={compact ? "dialog" : undefined}
      aria-label={compact ? "Equalizer" : undefined}
      className={`bg-[#161410] border border-white/8 rounded-xl ${compact ? "p-4 w-80" : "p-6 w-full"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#f0ead8]" style={{ fontFamily: "Georgia, serif" }}>
            Equalizer
          </span>
          <button
            onClick={() => setEqEnabled(!eqEnabled)}
            className={`relative w-9 h-5 rounded-full transition-colors overflow-hidden ${eqEnabled ? "bg-[var(--accent)]" : "bg-[#2a2820]"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${eqEnabled ? "translate-x-4" : ""}`}
            />
          </button>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {allPresets.map((preset) => (
          <div key={preset.id} className="flex items-center gap-1 group">
            {editingId === preset.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameCustomPreset(preset.id, editingName);
                    setEditingId(null);
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => setEditingId(null)}
                className="bg-[#2a2820] text-[#f0ead8] text-xs px-2 py-1 rounded-full outline-none border border-[var(--accent-a40)] w-20"
              />
            ) : (
              <button
                onClick={() => applyPreset(preset.id)}
                onDoubleClick={() => {
                  if (!preset.isBuiltIn) {
                    setEditingId(preset.id);
                    setEditingName(preset.name);
                  }
                }}
                className={`text-xs px-3 py-1 rounded-full transition-colors font-mono ${
                  activePresetId === preset.id
                    ? "bg-[var(--accent-a20)] text-[var(--accent)] border border-[var(--accent-a30)]"
                    : "bg-[#1f1d18] text-[#7a7060] hover:text-[#c8bfa8] border border-transparent"
                }`}
              >
                {preset.name}
              </button>
            )}
            {!preset.isBuiltIn && (
              <button
                onClick={() => deleteCustomPreset(preset.id)}
                className="opacity-0 group-hover:opacity-100 text-[#3a3628] hover:text-[#c85858] transition-all"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            )}
          </div>
        ))}

        {/* Save preset button */}
        {showSaveInput ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setShowSaveInput(false);
              }}
              placeholder="Preset name"
              className="bg-[#2a2820] text-[#f0ead8] text-xs px-2 py-1 rounded-full outline-none border border-[var(--accent-a40)] w-24 placeholder-[#3a3628]"
            />
            <button onClick={handleSave} className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors text-xs">✓</button>
            <button onClick={() => setShowSaveInput(false)} className="text-[#3a3628] hover:text-[#7a7060] transition-colors text-xs">✗</button>
          </div>
        ) : (
          <button
            onClick={() => setShowSaveInput(true)}
            className="text-xs px-3 py-1 rounded-full bg-[#1f1d18] text-[#3a3628] hover:text-[#7a7060] border border-transparent transition-colors font-mono"
          >
            + Save
          </button>
        )}
      </div>

      {/* Spectrum */}
      {analyserRef && (
        <div className="mb-3">
          <SpectrumAnalyser analyserRef={analyserRef} enabled={eqEnabled} />
        </div>
      )}

      {/* Bands */}
      <div className={`flex items-end gap-2 ${compact ? "h-28" : "h-36"}`}>
        {eqBands.map((band, i) => (
          <div key={band.frequency} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[9px] font-mono text-[#7a7060]">
              {band.gain > 0 ? `+${band.gain}` : band.gain}
            </span>
            <div className="flex-1 flex items-center justify-center w-full">
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={band.gain}
                disabled={!eqEnabled}
                onChange={(e) => setEqBand(i, parseFloat(e.target.value))}
                className="cursor-pointer disabled:opacity-30"
                style={{
                  writingMode: "vertical-lr" as any,
                  direction: "rtl" as any,
                  width: "100%",
                  height: compact ? "80px" : "100px",
                  accentColor: "var(--accent)",
                  appearance: "slider-vertical" as any,
                  WebkitAppearance: "slider-vertical" as any,
                }}
              />
            </div>
            <span className="text-[9px] font-mono text-[#3a3628]">
              {formatFreq(band.frequency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}