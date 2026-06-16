import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CustomGenreNode {
  id: string;     // "custom-..."
  label: string;
  family: string; // family id → determines colour
}

export interface CustomGenreLink {
  id: string;     // "link-..."
  source: string; // node id
  target: string; // node id
  label?: string; // optional relationship label ("influence", "fusion", …)
  weight?: number; // 1 = thin, 2 = medium, 3 = thick
}

interface GenreMapState {
  customNodes: CustomGenreNode[];
  customLinks: CustomGenreLink[];
  addNode: (label: string, family: string) => string | null;
  removeNode: (id: string) => void;
  addLink: (source: string, target: string) => void;
  removeLink: (id: string) => void;
  updateLink: (id: string, patch: { label?: string; weight?: number }) => void;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useGenreMapStore = create<GenreMapState>()(
  persist(
    (set, get) => ({
      customNodes: [],
      customLinks: [],
      addNode: (label, family) => {
        const trimmed = label.trim();
        if (!trimmed) return null;
        if (get().customNodes.some((n) => n.label.toLowerCase() === trimmed.toLowerCase())) return null;
        const id = uid("custom");
        set({ customNodes: [...get().customNodes, { id, label: trimmed, family }] });
        return id;
      },
      removeNode: (id) =>
        set({
          customNodes: get().customNodes.filter((n) => n.id !== id),
          customLinks: get().customLinks.filter((l) => l.source !== id && l.target !== id),
        }),
      addLink: (source, target) => {
        if (source === target) return;
        const exists = get().customLinks.some(
          (l) =>
            (l.source === source && l.target === target) ||
            (l.source === target && l.target === source),
        );
        if (exists) return;
        set({ customLinks: [...get().customLinks, { id: uid("link"), source, target }] });
      },
      removeLink: (id) => set({ customLinks: get().customLinks.filter((l) => l.id !== id) }),
      updateLink: (id, patch) =>
        set({
          customLinks: get().customLinks.map((l) =>
            l.id === id ? { ...l, ...patch } : l,
          ),
        }),
    }),
    { name: "libera-genre-map" },
  ),
);
