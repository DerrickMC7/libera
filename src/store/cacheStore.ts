import { create } from "zustand";

interface CacheState {
  isProcessing: boolean;
  completed: number;
  total: number;
  currentPath: string;
  isFirstTime: boolean;
  setProgress: (completed: number, total: number, currentPath: string) => void;
  startProcessing: (total: number, isFirstTime: boolean) => void;
  finishProcessing: () => void;
  reset: () => void;
}

export const useCacheStore = create<CacheState>((set) => ({
  isProcessing: false,
  completed: 0,
  total: 0,
  currentPath: "",
  isFirstTime: false,

  setProgress: (completed, total, currentPath) =>
    set({ completed, total, currentPath }),

  startProcessing: (total, isFirstTime) =>
    set({ isProcessing: true, completed: 0, total, currentPath: "", isFirstTime }),

  finishProcessing: () =>
    set({ isProcessing: false, completed: 0, total: 0, currentPath: "", isFirstTime: false }),

  reset: () =>
    set({ isProcessing: false, completed: 0, total: 0, currentPath: "", isFirstTime: false }),
}));