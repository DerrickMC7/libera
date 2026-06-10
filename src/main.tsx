import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MiniPlayerPage } from "./pages/MiniPlayerPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Tauri injects __TAURI_INTERNALS__ synchronously before JS runs.
// Using it directly avoids a top-level await and works in both dev and prod.
// Falls back to "main" in non-Tauri (browser demo) environments.
const windowLabel: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "main";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (windowLabel === "mini-player") {
  const miniQueryClient = new QueryClient();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={miniQueryClient}>
        <MiniPlayerPage />
      </QueryClientProvider>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
