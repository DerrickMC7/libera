import { Track } from "./track";

export interface Artist {
  name: string;
  album_count: number;
  track_count: number;
  cover_path: string;
}

export interface ArtistAlbum {
  album: string;
  year: number | null;
  track_count: number;
  cover_path: string;
  tracks: Track[];
}