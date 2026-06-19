import { create } from "zustand";

// Module-level mirrors — updated by Shell/MusicLibrary/detail views each render.
// Not reactive; only read at the moment navigateToArtist/Album fires.
let _section = "music";
let _musicView = "tracks";
let _genreName: string | null = null;
let _albumDetail: { album: string; albumArtist: string } | null = null;

export function syncSection(s: string) { _section = s; }
export function syncMusicView(v: string) { _musicView = v; }
export function syncGenreName(name: string | null) { _genreName = name; }
export function syncAlbumDetail(detail: { album: string; albumArtist: string } | null) { _albumDetail = detail; }

// Registered setters — used by goBack() to drive navigation without prop drilling.
let _setSection: ((s: string) => void) | null = null;
let _setMusicView: ((v: string) => void) | null = null;

export function registerSectionSetter(fn: (s: string) => void) { _setSection = fn; }
export function registerMusicViewSetter(fn: (v: string) => void) { _setMusicView = fn; }

// Imperative drivers used by the benchmark automation (and anything that needs to navigate
// without prop drilling). No-ops if the target component isn't mounted yet.
export function driveSection(section: string) { _setSection?.(section); }
export function driveMusicView(view: string) { _setMusicView?.(view); }

interface BackTarget {
  section: string;
  musicView: string;
  // Sub-state to restore inside the target view
  restoreGenre: string | null;
  restoreAlbum: { album: string; albumArtist: string } | null;
}

interface NavigationStore {
  // Artist deep-link
  pendingArtistName: string | null;
  navigateToArtist: (name: string) => void;
  clearPendingArtist: () => void;

  // Album deep-link (also used internally by goBack to restore an open album)
  pendingAlbumTarget: { album: string; albumArtist: string } | null;
  navigateToAlbum: (album: string, albumArtist: string) => void;
  clearPendingAlbum: () => void;

  // Genre restore (set by goBack when returning to a genre detail view)
  pendingGenreName: string | null;
  clearPendingGenre: () => void;

  // Shared back navigation
  backTarget: BackTarget | null;
  goBack: () => void;
  clearBackTarget: () => void;
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  pendingArtistName: null,
  navigateToArtist: (name) => set({
    pendingArtistName: name,
    backTarget: {
      section: _section,
      musicView: _musicView,
      restoreGenre: _musicView === "genres" ? _genreName : null,
      restoreAlbum: _musicView === "albums" ? _albumDetail : null,
    },
  }),
  clearPendingArtist: () => set({ pendingArtistName: null }),

  pendingAlbumTarget: null,
  navigateToAlbum: (album, albumArtist) => set({
    pendingAlbumTarget: { album, albumArtist },
    backTarget: {
      section: _section,
      musicView: _musicView,
      restoreGenre: _musicView === "genres" ? _genreName : null,
      restoreAlbum: _musicView === "albums" ? _albumDetail : null,
    },
  }),
  clearPendingAlbum: () => set({ pendingAlbumTarget: null }),

  pendingGenreName: null,
  clearPendingGenre: () => set({ pendingGenreName: null }),

  backTarget: null,
  goBack: () => {
    const { backTarget } = get();
    if (!backTarget) return;
    set({
      backTarget: null,
      // Restore sub-state for the target view
      pendingGenreName: backTarget.restoreGenre ?? null,
      pendingAlbumTarget: backTarget.restoreAlbum ?? null,
    });
    _setSection?.(backTarget.section);
    if (backTarget.section === "music") _setMusicView?.(backTarget.musicView);
  },
  clearBackTarget: () => set({ backTarget: null }),
}));
