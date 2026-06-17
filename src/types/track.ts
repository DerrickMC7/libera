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
  mbid: string | null;
  replay_gain_track: number | null;
  replay_gain_album: number | null;
  artwork_path?: string | null;
  // True for a placeholder queue entry that only has `path` set (used by the lazy
  // library queue). Playback needs only the path; display metadata is hydrated in
  // the background via get_tracks_by_paths, which clears this flag.
  lazy?: boolean;
}