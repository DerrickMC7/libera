import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./components/organisms/Shell";
import { AudioPlayer } from "./components/organisms/AudioPlayer";
import { useSettingsStore, AccentColor } from "./store/settingsStore";

const queryClient = new QueryClient();

const ACCENT_MAP: Record<AccentColor, { base: string; hover: string; rgb: string }> = {
  amber:  { base: "#d4872a", hover: "#e8a84c", rgb: "212,135,42"  },
  blue:   { base: "#3b82f6", hover: "#60a5fa", rgb: "59,130,246"  },
  green:  { base: "#22c55e", hover: "#4ade80", rgb: "34,197,94"   },
  purple: { base: "#a855f7", hover: "#c084fc", rgb: "168,85,247"  },
  red:    { base: "#ef4444", hover: "#f87171", rgb: "239,68,68"   },
};

function ThemeProvider() {
  const { accentColor, theme } = useSettingsStore();

  useEffect(() => {
    const { base, hover, rgb } = ACCENT_MAP[accentColor];
    const r = document.documentElement;
    r.style.setProperty("--accent",       base);
    r.style.setProperty("--accent-hover", hover);
    r.style.setProperty("--accent-a08",   `rgba(${rgb},0.08)`);
    r.style.setProperty("--accent-a10",   `rgba(${rgb},0.10)`);
    r.style.setProperty("--accent-a12",   `rgba(${rgb},0.12)`);
    r.style.setProperty("--accent-a20",   `rgba(${rgb},0.20)`);
    r.style.setProperty("--accent-a30",   `rgba(${rgb},0.30)`);
    r.style.setProperty("--accent-a40",   `rgba(${rgb},0.40)`);
  }, [accentColor]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider />
      <Shell />
      <AudioPlayer />
    </QueryClientProvider>
  );
}

export default App;
