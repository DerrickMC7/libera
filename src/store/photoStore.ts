import { create } from "zustand";
import { Photo, PhotoView, PhotoSortBy } from "../types/photo";

interface PhotoState {
  // Lightbox
  lightboxPhotos: Photo[];
  lightboxIndex: number;
  lightboxOpen: boolean;

  // Filters / sort
  view: PhotoView;
  search: string;
  sortBy: PhotoSortBy;
  formatFilter: string | null;
  yearFilter: number | null;
  monthFilter: number | null;
  albumFilter: string | null;
  tagFilter: string | null;
  cameraFilter: string | null;
  minRatingFilter: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  orientationFilter: "all" | "portrait" | "landscape" | "square";

  // Selection mode
  selectionMode: boolean;
  selectedPaths: Set<string>;
  selectionAnchor: string | null;

  // Tag editor
  tagEditorPath: string | null;

  openLightbox: (photos: Photo[], index: number) => void;
  closeLightbox: () => void;
  setLightboxIndex: (index: number) => void;
  setLightboxPhotos: (photos: Photo[]) => void;

  setView: (view: PhotoView) => void;
  setViewWithTagFilter: (view: PhotoView, tag: string) => void;
  setViewWithAlbumFilter: (view: PhotoView, albumPath: string) => void;
  setViewWithYearFilter: (view: PhotoView, year: number, month?: number) => void;
  setViewWithDateFilter: (view: PhotoView, dateFrom: string, dateTo: string) => void;
  setSearch: (s: string) => void;
  setSortBy: (s: PhotoSortBy) => void;
  setFormatFilter: (f: string | null) => void;
  setYearFilter: (y: number | null) => void;
  setMonthFilter: (m: number | null) => void;
  setAlbumFilter: (a: string | null) => void;
  setTagFilter: (t: string | null) => void;
  setCameraFilter: (c: string | null) => void;
  setMinRatingFilter: (r: number | null) => void;
  setDateFrom: (d: string | null) => void;
  setDateTo: (d: string | null) => void;
  setOrientationFilter: (o: "all" | "portrait" | "landscape" | "square") => void;

  favoriteOverrides: Record<string, boolean>;
  setFavoriteOverride: (path: string, value: boolean) => void;
  ratingOverrides: Record<string, number>;
  setRatingOverride: (path: string, value: number) => void;

  openTagEditor: (path: string) => void;
  closeTagEditor: () => void;

  toggleSelectionMode: () => void;
  startSelection: (path: string) => void;
  toggleSelect: (path: string) => void;
  selectAll: (paths: string[]) => void;
  selectRange: (paths: string[]) => void;
  clearSelection: () => void;
}

export const usePhotoStore = create<PhotoState>()((set) => ({
  lightboxPhotos: [],
  lightboxIndex: 0,
  lightboxOpen: false,

  view: "all",
  search: "",
  sortBy: "date_desc",
  formatFilter: null,
  yearFilter: null,
  monthFilter: null,
  albumFilter: null,
  tagFilter: null,
  cameraFilter: null,
  minRatingFilter: null,
  dateFrom: null,
  dateTo: null,
  orientationFilter: "all",

  tagEditorPath: null,
  favoriteOverrides: {},
  ratingOverrides: {},

  selectionMode: false,
  selectedPaths: new Set<string>(),
  selectionAnchor: null,

  openLightbox: (photos, index) => set({ lightboxPhotos: photos, lightboxIndex: index, lightboxOpen: true }),
  closeLightbox: () => set({ lightboxOpen: false, lightboxPhotos: [], lightboxIndex: 0 }),
  setLightboxIndex: (index) => set({ lightboxIndex: index }),
  setLightboxPhotos: (lightboxPhotos) => set({ lightboxPhotos }),

  setView: (view) => set({ view, search: "", formatFilter: null, yearFilter: null, monthFilter: null, albumFilter: null, tagFilter: null, cameraFilter: null, minRatingFilter: null, dateFrom: null, dateTo: null, orientationFilter: "all" }),
  setViewWithTagFilter: (view, tag) => set({ view, search: "", formatFilter: null, yearFilter: null, monthFilter: null, albumFilter: null, tagFilter: tag, cameraFilter: null, minRatingFilter: null, dateFrom: null, dateTo: null, orientationFilter: "all" }),
  setViewWithAlbumFilter: (view, albumPath) => set({ view, search: "", formatFilter: null, yearFilter: null, monthFilter: null, albumFilter: albumPath, tagFilter: null, cameraFilter: null, minRatingFilter: null, dateFrom: null, dateTo: null, orientationFilter: "all" }),
  setViewWithYearFilter: (view, year, month) => set({ view, search: "", formatFilter: null, yearFilter: year, monthFilter: month ?? null, albumFilter: null, tagFilter: null, cameraFilter: null, minRatingFilter: null, dateFrom: null, dateTo: null, orientationFilter: "all" }),
  setViewWithDateFilter: (view, dateFrom, dateTo) => set({ view, search: "", formatFilter: null, yearFilter: null, monthFilter: null, albumFilter: null, tagFilter: null, cameraFilter: null, minRatingFilter: null, dateFrom, dateTo, orientationFilter: "all" }),
  setSearch: (search) => set({ search }),
  setSortBy: (sortBy) => set({ sortBy }),
  setFormatFilter: (formatFilter) => set({ formatFilter }),
  setYearFilter: (yearFilter) => set({ yearFilter }),
  setMonthFilter: (monthFilter) => set({ monthFilter }),
  setAlbumFilter: (albumFilter) => set({ albumFilter }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setCameraFilter: (cameraFilter) => set({ cameraFilter }),
  setMinRatingFilter: (minRatingFilter) => set({ minRatingFilter }),
  setDateFrom: (dateFrom) => set({ dateFrom }),
  setDateTo: (dateTo) => set({ dateTo }),
  setOrientationFilter: (orientationFilter) => set({ orientationFilter }),

  setFavoriteOverride: (path, value) => set((s) => ({ favoriteOverrides: { ...s.favoriteOverrides, [path]: value } })),
  setRatingOverride: (path, value) => set((s) => ({ ratingOverrides: { ...s.ratingOverrides, [path]: value } })),

  openTagEditor: (tagEditorPath) => set({ tagEditorPath }),
  closeTagEditor: () => set({ tagEditorPath: null }),

  toggleSelectionMode: () => set((s) => ({ selectionMode: !s.selectionMode, selectedPaths: new Set(), selectionAnchor: null })),
  startSelection: (path) => set({ selectionMode: true, selectedPaths: new Set([path]), selectionAnchor: path }),
  toggleSelect: (path) => set((s) => {
    const next = new Set(s.selectedPaths);
    const adding = !next.has(path);
    if (adding) next.add(path); else next.delete(path);
    return { selectedPaths: next, selectionMode: next.size > 0, selectionAnchor: adding ? path : s.selectionAnchor };
  }),
  selectAll: (paths) => set({ selectedPaths: new Set(paths) }),
  selectRange: (paths) => set({ selectedPaths: new Set(paths), selectionMode: true }),
  clearSelection: () => set({ selectedPaths: new Set(), selectionMode: false, selectionAnchor: null }),
}));
