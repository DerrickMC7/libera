import { QueryClient } from "@tanstack/react-query";

// Single app-wide QueryClient. Lives in its own module so non-React code (e.g. the
// global metadata-fetch event listeners) can invalidate queries without going
// through a React hook, and without creating an import cycle with App.tsx.
//
// Defaults tuned for a local desktop app: the data only changes through in-app
// mutations (which invalidate the relevant keys explicitly), so refetching whenever
// the window regains focus or reconnects is pure churn — IPC calls + re-renders for
// data we already have. A modest default staleTime also stops queries that don't set
// their own from refetching on every component mount (e.g. navigating between tabs).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 60_000,
      retry: 1,
    },
  },
});
