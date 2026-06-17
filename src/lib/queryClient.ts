import { QueryClient } from "@tanstack/react-query";

// Single app-wide QueryClient. Lives in its own module so non-React code (e.g. the
// global metadata-fetch event listeners) can invalidate queries without going
// through a React hook, and without creating an import cycle with App.tsx.
export const queryClient = new QueryClient();
