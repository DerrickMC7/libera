export interface Video {
  id: number;
  path: string;
  title: string;
  format: string;
  file_size: number;
  date_added: number; // unix seconds
  duration_secs: number;
  width: number;
  height: number;
  folder: string;
  watched_secs: number;
  last_watched: number; // unix seconds, 0 = never
  is_favorite: boolean;
  /** Series name parsed from the filename/folders; "" for standalone films */
  series: string;
  season: number;
  episode: number;
}

export interface SubtitleTrack {
  label: string;
  vtt_path: string;
}

export type VideoTab = "all" | "films" | "series" | "continue" | "favorites";
export type VideoSortBy =
  | "title"
  | "date-desc"
  | "date-asc"
  | "duration-desc"
  | "duration-asc"
  | "size-desc";

/** A video is "watched" once 95% has been seen */
export function isWatched(v: Video): boolean {
  return v.duration_secs > 0
    ? v.watched_secs >= v.duration_secs * 0.95
    : v.watched_secs > 0;
}

/** In progress: started but not finished (and meaningfully past the start) */
export function isInProgress(v: Video): boolean {
  return v.watched_secs > 10 && !isWatched(v);
}

export function watchedPct(v: Video): number {
  if (v.duration_secs <= 0) return 0;
  return Math.min(100, (v.watched_secs / v.duration_secs) * 100);
}
