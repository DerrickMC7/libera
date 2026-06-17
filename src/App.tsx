import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./components/organisms/Shell";
import { AudioPlayer } from "./components/organisms/AudioPlayer";
import { TrackContextMenu } from "./components/organisms/TrackContextMenu";
import { useSettingsStore, AccentColor } from "./store/settingsStore";
import { queryClient } from "./lib/queryClient";

type PresetColor = Exclude<AccentColor, "custom">;
const ACCENT_MAP: Record<PresetColor, { base: string; hover: string; rgb: string }> = {
  amber:  { base: "#d4872a", hover: "#e8a84c", rgb: "212,135,42"  },
  blue:   { base: "#3b82f6", hover: "#60a5fa", rgb: "59,130,246"  },
  green:  { base: "#22c55e", hover: "#4ade80", rgb: "34,197,94"   },
  purple: { base: "#a855f7", hover: "#c084fc", rgb: "168,85,247"  },
  red:    { base: "#ef4444", hover: "#f87171", rgb: "239,68,68"   },
};

function hexToRgbStr(hex: string): string {
  return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
}

function lightenHex(hex: string): string {
  const lighten = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.25));
  const r = lighten(parseInt(hex.slice(1,3),16)).toString(16).padStart(2,"0");
  const g = lighten(parseInt(hex.slice(3,5),16)).toString(16).padStart(2,"0");
  const b = lighten(parseInt(hex.slice(5,7),16)).toString(16).padStart(2,"0");
  return `#${r}${g}${b}`;
}

function accentOnColor(hex: string): string {
  const toLinear = (c: number) => { const s = c/255; return s <= 0.04045 ? s/12.92 : ((s+0.055)/1.055)**2.4; };
  const r = toLinear(parseInt(hex.slice(1,3),16));
  const g = toLinear(parseInt(hex.slice(3,5),16));
  const b = toLinear(parseInt(hex.slice(5,7),16));
  return (0.2126*r + 0.7152*g + 0.0722*b) > 0.45 ? "#1a1814" : "#ffffff";
}

function ThemeProvider() {
  const { accentColor, customAccentHex, theme } = useSettingsStore();

  useEffect(() => {
    let base: string, hover: string, rgb: string;
    if (accentColor === "custom") {
      base  = customAccentHex || "#8b5cf6";
      hover = lightenHex(base);
      rgb   = hexToRgbStr(base);
    } else {
      ({ base, hover, rgb } = ACCENT_MAP[accentColor]);
    }
    const onColor = accentOnColor(base);
    const el = document.documentElement;
    el.style.setProperty("--accent",       base);
    el.style.setProperty("--accent-hover", hover);
    el.style.setProperty("--accent-on",    onColor);
    el.style.setProperty("--accent-a08",   `rgba(${rgb},0.08)`);
    el.style.setProperty("--accent-a10",   `rgba(${rgb},0.10)`);
    el.style.setProperty("--accent-a12",   `rgba(${rgb},0.12)`);
    el.style.setProperty("--accent-a20",   `rgba(${rgb},0.20)`);
    el.style.setProperty("--accent-a30",   `rgba(${rgb},0.30)`);
    el.style.setProperty("--accent-a40",   `rgba(${rgb},0.40)`);
  }, [accentColor, customAccentHex]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return null;
}

function App() {
  useEffect(() => {
    const suppress = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", suppress);
    return () => document.removeEventListener("contextmenu", suppress);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider />
      <div className="w-screen h-screen flex flex-col overflow-hidden bg-[#0e0d0b]">
        <Shell />
        <AudioPlayer />
        <TrackContextMenu />
      </div>
    </QueryClientProvider>
  );
}

export default App;
