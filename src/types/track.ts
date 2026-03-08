// Mirrors the Track struct from Rust exactly
export interface Track {
  path: string;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  genre: string;
  year: number | null;
  track_number: number | null;
  track_total: number | null;
  disc_number: number | null;
  disc_total: number | null;
  duration_secs: number;
  bitrate: number | null;
  sample_rate: number | null;
  channels: number | null;
  file_size: number;
  artwork_path?: string | null;
}