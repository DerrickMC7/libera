import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Video, VideoTab, VideoSortBy } from "../types/video";

interface VideoState {
  tab: VideoTab;
  search: string;
  sortBy: VideoSortBy;
  /** Series drill-down: name of the open series, or null for the series grid */
  openSeries: string | null;

  /** Player: the video being played plus its surrounding list for prev/next */
  playing: Video | null;
  playingList: Video[];
  autoplayNext: boolean;
  volume: number;

  setTab: (tab: VideoTab) => void;
  setSearch: (s: string) => void;
  setSortBy: (s: VideoSortBy) => void;
  setOpenSeries: (name: string | null) => void;
  play: (video: Video, list?: Video[]) => void;
  closePlayer: () => void;
  setAutoplayNext: (v: boolean) => void;
  setVolume: (v: number) => void;
  /** Advance to next/prev video in the playing list; returns the new video or null */
  step: (dir: 1 | -1) => Video | null;
}

export const useVideoStore = create<VideoState>()(
  persist(
    (set, get) => ({
      tab: "all",
      search: "",
      sortBy: "title",
      openSeries: null,
      playing: null,
      playingList: [],
      autoplayNext: true,
      volume: 1,

      setTab: (tab) => set({ tab, openSeries: null }),
      setSearch: (search) => set({ search }),
      setSortBy: (sortBy) => set({ sortBy }),
      setOpenSeries: (openSeries) => set({ openSeries }),
      play: (video, list) => set({ playing: video, playingList: list ?? [video] }),
      closePlayer: () => set({ playing: null, playingList: [] }),
      setAutoplayNext: (autoplayNext) => set({ autoplayNext }),
      setVolume: (volume) => set({ volume }),

      step: (dir) => {
        const { playing, playingList } = get();
        if (!playing) return null;
        const idx = playingList.findIndex((v) => v.path === playing.path);
        const next = playingList[idx + dir];
        if (!next) return null;
        set({ playing: next });
        return next;
      },
    }),
    {
      name: "libera-videos",
      partialize: (s) => ({ sortBy: s.sortBy, autoplayNext: s.autoplayNext, volume: s.volume }),
    }
  )
);
