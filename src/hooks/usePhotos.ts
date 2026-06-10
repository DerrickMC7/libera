import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Photo, PhotoAlbum, PhotoCollection, PhotoMetadata, PhotoStats, PhotoSortBy } from "../types/photo";

export const PHOTO_PAGE_SIZE = 60;

export function usePhotosCount(
  query: string,
  sortBy: PhotoSortBy,
  formatFilter: string | null,
  yearFilter: number | null,
  monthFilter: number | null,
  albumFilter: string | null,
  favoritesOnly: boolean,
  tagFilter: string | null,
  cameraFilter: string | null = null,
  minRating: number | null = null,
) {
  return useQuery({
    queryKey: ["photos-count", query, formatFilter, yearFilter, monthFilter, albumFilter, favoritesOnly, tagFilter, cameraFilter, minRating],
    queryFn: () =>
      invoke<number>("get_photos_count", {
        query,
        formatFilter,
        yearFilter,
        monthFilter,
        albumFilter,
        cameraFilter,
        favoritesOnly,
        tagFilter,
        minRating,
      }),
    staleTime: 30_000,
  });
}

export function usePhotosPage(
  query: string,
  sortBy: PhotoSortBy,
  formatFilter: string | null,
  yearFilter: number | null,
  monthFilter: number | null,
  albumFilter: string | null,
  favoritesOnly: boolean,
  tagFilter: string | null,
  page: number,
  cameraFilter: string | null = null,
  minRating: number | null = null,
) {
  return useQuery({
    queryKey: ["photos-page", query, sortBy, formatFilter, yearFilter, monthFilter, albumFilter, favoritesOnly, tagFilter, page, cameraFilter, minRating],
    queryFn: () =>
      invoke<Photo[]>("get_photos_page", {
        query,
        sortBy,
        formatFilter,
        yearFilter,
        monthFilter,
        albumFilter,
        cameraFilter,
        favoritesOnly,
        tagFilter,
        limit: PHOTO_PAGE_SIZE,
        offset: page * PHOTO_PAGE_SIZE,
        minRating,
      }),
    staleTime: 30_000,
  });
}

export function usePhotoCameras() {
  return useQuery({
    queryKey: ["photo-cameras"],
    queryFn: () => invoke<string[]>("get_photo_cameras"),
    staleTime: 60_000,
  });
}

export function useOnThisDayPhotos() {
  return useQuery({
    queryKey: ["on-this-day"],
    queryFn: () => invoke<Photo[]>("get_on_this_day_photos"),
    staleTime: 60_000,
  });
}

export function usePhotoAlbums() {
  return useQuery({
    queryKey: ["photo-albums"],
    queryFn: () => invoke<PhotoAlbum[]>("get_photo_albums"),
    staleTime: 60_000,
  });
}

export function usePhotoYears() {
  return useQuery({
    queryKey: ["photo-years"],
    queryFn: () => invoke<number[]>("get_photo_years"),
    staleTime: 60_000,
  });
}

export function usePhotoFormats() {
  return useQuery({
    queryKey: ["photo-formats"],
    queryFn: () => invoke<string[]>("get_photo_formats"),
    staleTime: 60_000,
  });
}

export function useAllPhotoTags() {
  return useQuery({
    queryKey: ["all-photo-tags"],
    queryFn: () => invoke<string[]>("get_all_photo_tags"),
    staleTime: 30_000,
  });
}

export function usePhotoMetadata(path: string | null) {
  return useQuery({
    queryKey: ["photo-metadata", path],
    queryFn: () => invoke<PhotoMetadata>("get_photo_metadata", { path }),
    enabled: !!path,
    staleTime: 10_000,
  });
}

export interface PhotoYearStat { year: number; count: number; }

export function usePhotoYearStats() {
  return useQuery({
    queryKey: ["photo-year-stats"],
    queryFn: () => invoke<PhotoYearStat[]>("get_photo_year_stats"),
    staleTime: 30_000,
  });
}

export function usePhotoMonthsForYear(year: number | null) {
  return useQuery({
    queryKey: ["photo-months-for-year", year],
    queryFn: () => invoke<number[]>("get_photo_months_for_year", { year }),
    enabled: year !== null,
    staleTime: 60_000,
  });
}

export function usePhotoCountForTag(tag: string) {
  return useQuery({
    queryKey: ["photos-count-tag", tag],
    queryFn: () =>
      invoke<number>("get_photos_count", {
        query: "",
        formatFilter: null,
        yearFilter: null,
        monthFilter: null,
        albumFilter: null,
        cameraFilter: null,
        favoritesOnly: false,
        tagFilter: tag,
        minRating: null,
      }),
    staleTime: 60_000,
  });
}

export function usePhotoCountForYear(year: number) {
  return useQuery({
    queryKey: ["photos-count-year", year],
    queryFn: () =>
      invoke<number>("get_photos_count", {
        query: "",
        formatFilter: null,
        yearFilter: year,
        monthFilter: null,
        albumFilter: null,
        cameraFilter: null,
        favoritesOnly: false,
        tagFilter: null,
        minRating: null,
      }),
    staleTime: 60_000,
  });
}

export function usePhotoFormatStats() {
  return useQuery({
    queryKey: ["photo-format-stats"],
    queryFn: () => invoke<{ format: string; count: number; size: number }[]>("get_photo_format_stats"),
    staleTime: 60_000,
  });
}

export function usePhotoCameraStats() {
  return useQuery({
    queryKey: ["photo-camera-stats"],
    queryFn: () => invoke<{ camera: string; count: number }[]>("get_photo_camera_stats"),
    staleTime: 60_000,
  });
}

export function useGpsPhotos() {
  return useQuery({
    queryKey: ["photos-gps"],
    queryFn: () => invoke<Photo[]>("get_gps_photos"),
    staleTime: 60_000,
  });
}

export function usePhotoStats() {
  return useQuery({
    queryKey: ["photo-stats"],
    queryFn: () => invoke<PhotoStats>("get_photos_stats"),
    staleTime: 30_000,
  });
}

export function useScanPhotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderPath: string) => {
      const photos = await invoke<Photo[]>("scan_photos", { path: folderPath });
      await invoke<number>("save_photos", { photos });
      return photos.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos-count"] });
      qc.invalidateQueries({ queryKey: ["photos-page"] });
      qc.invalidateQueries({ queryKey: ["photo-albums"] });
      qc.invalidateQueries({ queryKey: ["photo-years"] });
      qc.invalidateQueries({ queryKey: ["photo-formats"] });
      qc.invalidateQueries({ queryKey: ["photo-stats"] });
    },
  });
}

// Preferred scanner: parallel Rust processing + incremental DB saves + progress events.
// Returns the number of new photos saved.
export function useScanAndSavePhotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folderPath: string) =>
      invoke<number>("scan_and_save_photos", { path: folderPath }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos-count"] });
      qc.invalidateQueries({ queryKey: ["photos-page"] });
      qc.invalidateQueries({ queryKey: ["photo-albums"] });
      qc.invalidateQueries({ queryKey: ["photo-years"] });
      qc.invalidateQueries({ queryKey: ["photo-formats"] });
      qc.invalidateQueries({ queryKey: ["photo-stats"] });
      qc.invalidateQueries({ queryKey: ["photo-cameras"] });
      qc.invalidateQueries({ queryKey: ["photo-year-stats"] });
    },
  });
}

export function useTogglePhotoFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path }: { path: string }) =>
      invoke<boolean>("toggle_photo_favorite", { path }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos-count"] });
      qc.invalidateQueries({ queryKey: ["photos-page"] });
      qc.invalidateQueries({ queryKey: ["photo-metadata"] });
      qc.invalidateQueries({ queryKey: ["photo-stats"] });
    },
  });
}

export function useAddPhotoTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, tag }: { path: string; tag: string }) =>
      invoke<void>("add_photo_tag", { path, tag }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photo-metadata"] });
      qc.invalidateQueries({ queryKey: ["all-photo-tags"] });
    },
  });
}

export function useRemovePhotoTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, tag }: { path: string; tag: string }) =>
      invoke<void>("remove_photo_tag", { path, tag }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photo-metadata"] });
      qc.invalidateQueries({ queryKey: ["all-photo-tags"] });
    },
  });
}

export function useSetPhotoRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, rating }: { path: string; rating: number }) =>
      invoke<void>("set_photo_rating", { path, rating }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos-page"] });
      qc.invalidateQueries({ queryKey: ["photo-metadata"] });
    },
  });
}

export function useUpdatePhotoNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, notes }: { path: string; notes: string }) =>
      invoke<void>("update_photo_notes", { path, notes }),
    onSuccess: (_data, { path }) => {
      qc.invalidateQueries({ queryKey: ["photo-metadata", path] });
    },
  });
}

export function useCopySelectedPhotos() {
  return useMutation({
    mutationFn: ({ paths, destFolder }: { paths: string[]; destFolder: string }) =>
      invoke<number>("copy_selected_photos", { paths, destFolder }),
  });
}

export function useFindDuplicatePhotos() {
  return useQuery({
    queryKey: ["photo-duplicates"],
    queryFn: () => invoke<Photo[][]>("find_duplicate_photos"),
    staleTime: 30_000,
  });
}

export function useDeletePhotoFromLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path }: { path: string }) =>
      invoke<void>("delete_photo_from_library", { path }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos-count"] });
      qc.invalidateQueries({ queryKey: ["photos-page"] });
      qc.invalidateQueries({ queryKey: ["photo-duplicates"] });
      qc.invalidateQueries({ queryKey: ["photo-stats"] });
    },
  });
}

export function usePhotoCollections() {
  return useQuery({
    queryKey: ["photo-collections"],
    queryFn: () => invoke<PhotoCollection[]>("get_photo_collections"),
    staleTime: 30_000,
  });
}

export function useCreatePhotoCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      invoke<PhotoCollection>("create_photo_collection", { name, description: description ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-collections"] }),
  });
}

export function useDeletePhotoCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => invoke<void>("delete_photo_collection", { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-collections"] }),
  });
}

export function useRenamePhotoCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      invoke<void>("rename_photo_collection", { id, name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo-collections"] }),
  });
}

export function useAddPhotosToCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, paths }: { collectionId: number; paths: string[] }) =>
      invoke<number>("add_photos_to_collection", { collectionId, paths }),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: ["photo-collections"] });
      qc.invalidateQueries({ queryKey: ["collection-photos", collectionId] });
    },
  });
}

export function useRemoveFromCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, path }: { collectionId: number; path: string }) =>
      invoke<void>("remove_from_collection", { collectionId, path }),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: ["photo-collections"] });
      qc.invalidateQueries({ queryKey: ["collection-photos", collectionId] });
    },
  });
}

export function useCollectionPhotos(collectionId: number | null) {
  return useQuery({
    queryKey: ["collection-photos", collectionId],
    queryFn: () => invoke<Photo[]>("get_collection_photos", { collectionId }),
    enabled: collectionId !== null,
    staleTime: 30_000,
  });
}
