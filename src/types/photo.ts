export interface Photo {
  path: string;
  name: string;
  folder: string;
  format: string;
  width: number | null;
  height: number | null;
  file_size: number;
  date_taken: number | null;
  date_modified: number | null;
  is_favorite: boolean;
  orientation: number;
  camera: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  rating: number;
}

export interface PhotoAlbum {
  name: string;
  folder_path: string;
  count: number;
  cover_path: string | null;
  cover_paths: string[];
}

export interface PhotoMetadata extends Photo {
  tags: string[];
  notes: string | null;
  aperture: number | null;
  shutter_speed: string | null;
  iso: number | null;
  focal_length: number | null;
  lens: string | null;
  exposure_bias: number | null;
  flash: string | null;
}

export interface PhotoStats {
  total: number;
  favorites: number;
  total_size: number;
  albums: number;
}

export type PhotoSortBy = "date_desc" | "date_asc" | "name_asc" | "name_desc" | "size_asc" | "size_desc" | "rating_desc" | "rating_asc";

export interface PhotoCollection {
  id: number;
  name: string;
  description: string | null;
  created_at: number;
  count: number;
  cover_path: string | null;
}

export type PhotoView = "all" | "albums" | "favorites" | "timeline" | "tags" | "duplicates" | "collections" | "map" | "stats";
