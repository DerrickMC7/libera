extern crate exif;
use chrono::Datelike;
use lofty::prelude::*;
use lofty::probe::Probe;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rayon::prelude::*;
use rusqlite::Result as SqlResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use walkdir::WalkDir;
use zip::ZipArchive;

pub struct DbState(pub Pool<SqliteConnectionManager>);

/// Limits concurrent full-image decodes to prevent OOM on large/4K photo imports.
/// Each decode of a 4K phone JPEG uses ~48MB RAM; 2 concurrent = ~100MB peak.
pub struct ThumbSemaphore(pub Arc<tokio::sync::Semaphore>);

/// Limits concurrent full-resolution *preview* decodes. A preview decode keeps the
/// full source bitmap plus a ~2560px downscaled copy in memory, so it is heavier than a
/// thumbnail decode — kept on its own small budget so it never starves grid thumbnails.
pub struct PreviewSemaphore(pub Arc<tokio::sync::Semaphore>);

pub struct DownloadControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
}

pub struct MetadataFetchControl {
    cancelled: AtomicBool,
}

impl MetadataFetchControl {
    fn new() -> Self {
        Self { cancelled: AtomicBool::new(false) }
    }
}

impl DownloadControl {
    fn new() -> Self {
        Self {
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        }
    }
}

/// Extract the primary artist from a collaboration credit.
/// Handles both spaced separators (" / ", " feat. ", etc.) and the bare "/"
/// that most tagging software writes (e.g. "Fred again../Baby Keem").
/// The bare "/" guard requires idx > 2 so band names like "AC/DC" are preserved.
fn clean_primary_artist(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() {
        return "Unknown Artist".to_string();
    }
    let lower = name.to_lowercase();
    // Spaced-separator patterns first (most explicit)
    for pat in &[" / ", " feat. ", " feat ", " ft. ", " ft ", " featuring ", " with "] {
        if let Some(idx) = lower.find(pat) {
            let primary = name[..idx].trim();
            if !primary.is_empty() {
                return primary.to_string();
            }
        }
    }
    // Bare "/" — common in taggers (e.g. "Fred again../Baby Keem").
    // Only split when the prefix is longer than 2 chars so "AC/DC" is left alone.
    if let Some(idx) = name.find('/') {
        if idx > 2 {
            let primary = name[..idx].trim();
            if !primary.is_empty() {
                return primary.to_string();
            }
        }
    }
    name.to_string()
}

/// Split "Fred again../Baby Keem" → ["Fred again..", "Baby Keem"].
/// Both spaced and bare "/" separators handled; "AC/DC" is preserved
/// because both sides have ≤2 chars.
fn split_all_artists(name: &str) -> Vec<String> {
    let name = name.trim();
    if name.is_empty() {
        return vec![];
    }
    // Phase 1: explicit spaced separators
    let mut parts: Vec<String> = vec![name.to_string()];
    for sep in &[" / ", " feat. ", " feat ", " ft. ", " ft ", " featuring ", " with "] {
        parts = parts
            .into_iter()
            .flat_map(|p| {
                let lower = p.to_lowercase();
                let mut out: Vec<String> = Vec::new();
                let mut start = 0usize;
                let mut cursor = 0usize;
                while let Some(rel) = lower[cursor..].find(sep) {
                    let abs = cursor + rel;
                    let piece = p[start..abs].trim().to_string();
                    if !piece.is_empty() {
                        out.push(piece);
                    }
                    start = abs + sep.len();
                    cursor = start;
                }
                let tail = p[start..].trim().to_string();
                if !tail.is_empty() {
                    out.push(tail);
                }
                out
            })
            .collect();
    }
    // Phase 2: bare "/" — split when either side has >2 chars (protects "AC/DC")
    parts = parts
        .into_iter()
        .flat_map(|p| split_on_bare_slash(&p))
        .collect();
    parts.into_iter().filter(|s| !s.is_empty()).collect()
}

fn split_on_bare_slash(name: &str) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut seg_start = 0usize;
    for (byte_idx, ch) in name.char_indices() {
        if ch == '/' {
            let prefix = name[seg_start..byte_idx].trim();
            let suffix = name[byte_idx + 1..].trim();
            let pl = prefix.chars().count();
            let sl = suffix.chars().count();
            if pl > 0 && sl > 0 && (pl > 2 || sl > 2) {
                result.push(prefix.to_string());
                seg_start = byte_idx + 1;
            }
        }
    }
    let tail = name[seg_start..].trim();
    if !tail.is_empty() {
        result.push(tail.to_string());
    }
    if result.is_empty() {
        result.push(name.to_string());
    }
    result
}

/// Build AND-of-ORs search conditions for multi-word queries.
///
/// Returns `(conditions_sql, flat_params)` where `conditions_sql` is a string like
/// `"(col1 LIKE ? OR col2 LIKE ?) AND (col1 LIKE ? OR col2 LIKE ?)"` and
/// `flat_params` has `cols_per_word` copies of `"%word%"` for each word.
///
/// Returns `(String::new(), vec![])` when there is only one word (or zero),
/// so callers fall back to their existing single-pattern LIKE logic.
fn word_search_params(query: &str, cols_per_word: usize, col_exprs: &[&str]) -> (String, Vec<String>) {
    let words: Vec<&str> = query.split_whitespace().filter(|w| w.len() >= 1).collect();
    if words.len() <= 1 {
        return (String::new(), vec![]);
    }
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();
    for word in &words {
        let pat = format!("%{}%", word.to_lowercase());
        let or_parts: Vec<String> = col_exprs.iter().map(|col| format!("{} LIKE ?", col)).collect();
        conditions.push(format!("({})", or_parts.join(" OR ")));
        for _ in 0..cols_per_word {
            params.push(pat.clone());
        }
    }
    (conditions.join(" AND "), params)
}

fn initialize_database(conn: &rusqlite::Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tracks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            path            TEXT NOT NULL UNIQUE,
            title           TEXT NOT NULL,
            artist          TEXT NOT NULL,
            album           TEXT NOT NULL,
            album_artist    TEXT NOT NULL,
            genre           TEXT NOT NULL,
            year            INTEGER,
            track_number    INTEGER,
            track_total     INTEGER,
            disc_number     INTEGER,
            disc_total      INTEGER,
            duration_secs   INTEGER NOT NULL,
            bitrate         INTEGER,
            sample_rate     INTEGER,
            channels        INTEGER,
            file_size       INTEGER NOT NULL,
            mbid            TEXT
        );
        CREATE TABLE IF NOT EXISTS books (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT NOT NULL UNIQUE,
            title       TEXT NOT NULL,
            file_name   TEXT NOT NULL,
            format      TEXT NOT NULL,
            file_size   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks(album_artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
        CREATE TABLE IF NOT EXISTS track_artists (
            track_path  TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            PRIMARY KEY (track_path, artist_name)
        );
        CREATE INDEX IF NOT EXISTS idx_track_artists_name ON track_artists(artist_name);
        CREATE INDEX IF NOT EXISTS idx_track_artists_path ON track_artists(track_path);",
    )?;
    // Non-destructive migration: add mbid column to existing databases
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN mbid TEXT", []);
    // Non-destructive migration: per-track custom artwork override hash
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN custom_artwork_hash TEXT", []);
    // Non-destructive migration: ReplayGain track/album gain values (dB as REAL)
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN replay_gain_track REAL", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN replay_gain_album REAL", []);
    // Clean existing album_artist values that contain bare "/" collaboration credits
    // (e.g. "Fred again../Baby Keem" → "Fred again..").
    // INSTR is 1-indexed in SQLite, so > 3 means at least 3 chars before the slash,
    // which preserves names like "AC/DC" (slash at position 3).
    let _ = conn.execute(
        "UPDATE tracks
         SET album_artist = TRIM(SUBSTR(album_artist, 1, INSTR(album_artist, '/') - 1))
         WHERE INSTR(album_artist, '/') > 3
           AND TRIM(SUBSTR(album_artist, 1, INSTR(album_artist, '/') - 1)) != ''",
        [],
    );
    // Non-destructive: add playlist support
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS playlists (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_path  TEXT NOT NULL,
            position    INTEGER NOT NULL,
            added_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (playlist_id, track_path)
        );
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);"
    )?;
    // Non-destructive: custom cover art for playlists
    let _ = conn.execute("ALTER TABLE playlists ADD COLUMN custom_cover TEXT", []);
    // Lyrics cache
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lyrics_cache (
            track_path  TEXT PRIMARY KEY,
            synced_lrc  TEXT,
            plain_text  TEXT,
            source      TEXT NOT NULL,
            fetched_at  INTEGER NOT NULL
        );"
    )?;
    // Photo library
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS photos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            path          TEXT NOT NULL UNIQUE,
            name          TEXT NOT NULL,
            folder        TEXT NOT NULL,
            format        TEXT NOT NULL,
            width         INTEGER,
            height        INTEGER,
            file_size     INTEGER NOT NULL,
            date_taken    INTEGER,
            date_modified INTEGER,
            is_favorite   INTEGER NOT NULL DEFAULT 0,
            orientation   INTEGER NOT NULL DEFAULT 1,
            camera        TEXT,
            gps_lat       REAL,
            gps_lon       REAL
        );
        CREATE INDEX IF NOT EXISTS idx_photos_folder     ON photos(folder);
        CREATE INDEX IF NOT EXISTS idx_photos_format     ON photos(format);
        CREATE INDEX IF NOT EXISTS idx_photos_date_taken ON photos(date_taken);
        CREATE INDEX IF NOT EXISTS idx_photos_favorite   ON photos(is_favorite);
        CREATE TABLE IF NOT EXISTS photo_tags (
            photo_path TEXT NOT NULL,
            tag        TEXT NOT NULL,
            PRIMARY KEY (photo_path, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag);
        CREATE INDEX IF NOT EXISTS idx_photo_tags_path ON photo_tags(photo_path);"
    )?;
    // Non-destructive: photo notes and rating columns
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN notes TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN rating INTEGER NOT NULL DEFAULT 0", []);
    // Photo collections (virtual albums / playlists for photos)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS photo_collections (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS photo_collection_items (
            collection_id INTEGER NOT NULL REFERENCES photo_collections(id) ON DELETE CASCADE,
            photo_path    TEXT    NOT NULL,
            added_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            sort_order    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (collection_id, photo_path)
        );
        CREATE INDEX IF NOT EXISTS idx_pci_collection ON photo_collection_items(collection_id);
        CREATE INDEX IF NOT EXISTS idx_pci_path ON photo_collection_items(photo_path);"
    ).ok();
    // Video library
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS videos (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            path          TEXT NOT NULL UNIQUE,
            title         TEXT NOT NULL,
            format        TEXT NOT NULL,
            file_size     INTEGER NOT NULL DEFAULT 0,
            date_added    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            duration_secs INTEGER NOT NULL DEFAULT 0,
            width         INTEGER NOT NULL DEFAULT 0,
            height        INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_videos_title  ON videos(title);
        CREATE INDEX IF NOT EXISTS idx_videos_format ON videos(format);"
    ).ok();
    // Non-destructive: video watch-state + series columns
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN folder TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN watched_secs INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN last_watched INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN series TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN season INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE videos ADD COLUMN episode INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_videos_series ON videos(series)", []);
    Ok(())
}

/// One-time migration: populate track_artists from existing tracks.
/// Skipped on subsequent startups because the table will already have rows.
fn populate_track_artists(conn: &rusqlite::Connection) -> SqlResult<()> {
    // Re-reads raw artist+album_artist tags from every file so that collaborators
    // stored only in album_artist (e.g. "Fred again../Baby Keem") are captured even
    // if tracks.artist was previously set to just the primary artist.
    let paths: Vec<String> = conn
        .prepare("SELECT path FROM tracks")?
        .query_map([], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    conn.execute_batch("BEGIN")?;
    for path in &paths {
        let file_path = std::path::PathBuf::from(path);
        // Gather all unique artists from both tags in the actual file
        let mut all: std::collections::HashSet<String> = std::collections::HashSet::new();
        if let Ok(tagged) = Probe::open(&file_path).and_then(|p| p.read()) {
            let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
            let raw_artist = tag.and_then(|t| t.artist().map(|s| s.to_string())).unwrap_or_default();
            let raw_aa = tag.and_then(|t| t.get_string(&lofty::tag::ItemKey::AlbumArtist).map(|s| s.to_string())).unwrap_or_default();
            for a in split_all_artists(&raw_artist).into_iter().chain(split_all_artists(&raw_aa)) {
                all.insert(a);
            }
        }
        // Fallback: use whatever is already in tracks.artist
        if all.is_empty() {
            if let Ok(a) = conn.query_row("SELECT artist FROM tracks WHERE path = ?1", rusqlite::params![path], |r| r.get::<_, String>(0)) {
                for name in split_all_artists(&a) { all.insert(name); }
            }
        }
        for name in all {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO track_artists (track_path, artist_name) VALUES (?1, ?2)",
                rusqlite::params![path, name],
            );
        }
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

#[tauri::command]
fn save_tracks(state: State<DbState>, tracks: Vec<Track>) -> Result<usize, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let mut saved = 0;
    for track in &tracks {
        let result = conn.execute(
            "INSERT OR IGNORE INTO tracks
                (path, title, artist, album, album_artist, genre, year,
                track_number, track_total, disc_number, disc_total,
                duration_secs, bitrate, sample_rate, channels, file_size, mbid,
                replay_gain_track, replay_gain_album)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                track.path,
                track.title,
                track.artist,
                track.album,
                track.album_artist,
                track.genre,
                track.year,
                track.track_number,
                track.track_total,
                track.disc_number,
                track.disc_total,
                track.duration_secs,
                track.bitrate,
                track.sample_rate,
                track.channels,
                track.file_size,
                track.mbid,
                track.replay_gain_track,
                track.replay_gain_album,
            ],
        );
        if result.is_ok() {
            saved += 1;
        }
        // Keep track_artists in sync: insert one row per contributing artist
        for artist_name in split_all_artists(&track.artist) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO track_artists (track_path, artist_name) VALUES (?1, ?2)",
                rusqlite::params![track.path, artist_name],
            );
        }
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn get_tracks(state: State<DbState>) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT path, title, artist, album, album_artist, genre, year, track_number, track_total, disc_number, disc_total, duration_secs, bitrate, sample_rate, channels, file_size, mbid, replay_gain_track, replay_gain_album FROM tracks")
        .map_err(|e| format!("Query error: {}", e))?;
    let tracks = stmt
        .query_map([], |row| {
            Ok(Track {
                path: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                album_artist: row.get(4)?,
                genre: row.get(5)?,
                year: row.get(6)?,
                track_number: row.get(7)?,
                track_total: row.get(8)?,
                disc_number: row.get(9)?,
                disc_total: row.get(10)?,
                duration_secs: row.get(11)?,
                bitrate: row.get(12)?,
                sample_rate: row.get(13)?,
                channels: row.get(14)?,
                file_size: row.get(15)?,
                mbid: row.get(16)?,
                replay_gain_track: row.get(17)?,
                replay_gain_album: row.get(18)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|t| t.ok())
        .collect();
    Ok(tracks)
}

#[tauri::command]
fn get_tracks_count(state: State<DbState>, query: String) -> Result<usize, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let count: usize = if query.is_empty() {
        conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .map_err(|e| e.to_string())?
    } else {
        let track_cols = &["LOWER(title)", "LOWER(artist)", "LOWER(album)"];
        let (multi_cond, multi_params) = word_search_params(&query, 3, track_cols);
        if !multi_cond.is_empty() {
            let sql = format!("SELECT COUNT(*) FROM tracks WHERE {}", multi_cond);
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            stmt.query_row(rusqlite::params_from_iter(multi_params.iter()), |row| row.get(0))
                .map_err(|e| e.to_string())?
        } else {
            let pattern = format!("%{}%", query.to_lowercase());
            conn.query_row(
                "SELECT COUNT(*) FROM tracks WHERE LOWER(title) LIKE ?1 OR LOWER(artist) LIKE ?1 OR LOWER(album) LIKE ?1",
                rusqlite::params![pattern],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?
        }
    };
    Ok(count)
}

#[tauri::command]
fn get_tracks_page(
    state: State<DbState>,
    query: String,
    limit: usize,
    offset: usize,
    sort_by: Option<String>,
) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let sql_base = "SELECT path, title, artist, album, album_artist, genre, year, track_number, track_total, disc_number, disc_total, duration_secs, bitrate, sample_rate, channels, file_size, mbid, replay_gain_track, replay_gain_album FROM tracks";
    let order_clause = match sort_by.as_deref() {
        Some("title") => "ORDER BY LOWER(title)",
        Some("album") => "ORDER BY album_artist, album",
        Some("duration_asc") => "ORDER BY duration_secs ASC",
        Some("duration_desc") => "ORDER BY duration_secs DESC",
        Some("year") => "ORDER BY year DESC NULLS LAST, album_artist, album",
        _ => "ORDER BY album_artist, album, disc_number, track_number",
    };
    let map_row = |row: &rusqlite::Row| {
        Ok(Track {
            path: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            album: row.get(3)?,
            album_artist: row.get(4)?,
            genre: row.get(5)?,
            year: row.get(6)?,
            track_number: row.get(7)?,
            track_total: row.get(8)?,
            disc_number: row.get(9)?,
            disc_total: row.get(10)?,
            duration_secs: row.get(11)?,
            bitrate: row.get(12)?,
            sample_rate: row.get(13)?,
            channels: row.get(14)?,
            file_size: row.get(15)?,
            mbid: row.get(16)?,
            replay_gain_track: row.get(17)?,
            replay_gain_album: row.get(18)?,
        })
    };
    let tracks: Vec<Track> = if query.is_empty() {
        let mut stmt = conn
            .prepare(&format!(
                "{} {} LIMIT ?1 OFFSET ?2",
                sql_base, order_clause
            ))
            .map_err(|e| e.to_string())?;
        let x = stmt
            .query_map(rusqlite::params![limit, offset], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|t| t.ok())
            .collect();
        x
    } else {
        let track_cols = &["LOWER(title)", "LOWER(artist)", "LOWER(album)"];
        let (multi_cond, multi_params) = word_search_params(&query, 3, track_cols);
        if !multi_cond.is_empty() {
            let sql = format!(
                "{} WHERE {} {} LIMIT ? OFFSET ?",
                sql_base, multi_cond, order_clause
            );
            let mut all_params: Vec<String> = multi_params;
            all_params.push(limit.to_string());
            all_params.push(offset.to_string());
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params_from_iter(all_params.iter()), map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|t| t.ok())
                .collect();
            x
        } else {
            let pattern = format!("%{}%", query.to_lowercase());
            let mut stmt = conn.prepare(&format!(
                "{} WHERE LOWER(title) LIKE ?3 OR LOWER(artist) LIKE ?3 OR LOWER(album) LIKE ?3 {} LIMIT ?1 OFFSET ?2",
                sql_base, order_clause
            )).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params![limit, offset, pattern], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|t| t.ok())
                .collect();
            x
        }
    };
    Ok(tracks)
}

#[tauri::command]
fn save_books(state: State<DbState>, books: Vec<Book>) -> Result<usize, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut saved = 0;
    for book in &books {
        let result = conn.execute(
            "INSERT OR REPLACE INTO books (path, title, file_name, format, file_size) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![book.path, book.title, book.file_name, book.format, book.file_size],
        );
        if result.is_ok() {
            saved += 1;
        }
    }
    Ok(saved)
}

#[tauri::command]
fn get_books(state: State<DbState>) -> Result<Vec<Book>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT path, title, file_name, format, file_size FROM books")
        .map_err(|e| format!("Query error: {}", e))?;
    let books = stmt
        .query_map([], |row| {
            Ok(Book {
                path: row.get(0)?,
                title: row.get(1)?,
                file_name: row.get(2)?,
                format: row.get(3)?,
                file_size: row.get(4)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|b| b.ok())
        .collect();
    Ok(books)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Track {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub duration_secs: u64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub file_size: u64,
    pub mbid: Option<String>,
    pub replay_gain_track: Option<f32>,
    pub replay_gain_album: Option<f32>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Book {
    pub path: String,
    pub title: String,
    pub file_name: String,
    pub format: String,
    pub file_size: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Video {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub format: String,
    pub file_size: i64,
    pub date_added: i64,
    pub duration_secs: i64,
    pub width: i64,
    pub height: i64,
    pub folder: String,
    pub watched_secs: i64,
    pub last_watched: i64,
    pub is_favorite: bool,
    /// Series name parsed from the filename/folders; empty for standalone films
    pub series: String,
    pub season: i64,
    pub episode: i64,
}

#[derive(Serialize, Debug)]
pub struct SubtitleTrack {
    pub label: String,
    /// Path to a .vtt file (sidecar .srt files are converted into the cache dir)
    pub vtt_path: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Album {
    pub album: String,
    pub artist: String,
    pub year: Option<u32>,
    pub track_count: usize,
    pub cover_path: String,
}

#[derive(Serialize)]
struct StorageEntry {
    label: String,
    count: i64,
    size_bytes: i64,
}

#[derive(Serialize)]
struct StorageCategory {
    total_size_bytes: i64,
    total_count: i64,
    entries: Vec<StorageEntry>,
}

#[derive(Serialize)]
struct LibraryStats {
    total_duration_secs: i64,
    music: StorageCategory,
    videos: StorageCategory,
    books: StorageCategory,
    images: StorageCategory,
}

fn scan_dir_size(path: &std::path::Path) -> (i64, i64) {
    if !path.exists() { return (0, 0); }
    let mut count = 0i64;
    let mut bytes = 0i64;
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            count += 1;
            bytes += entry.metadata().map(|m| m.len() as i64).unwrap_or(0);
        }
    }
    (count, bytes)
}

#[tauri::command]
fn get_library_stats(app: tauri::AppHandle, state: State<DbState>) -> Result<LibraryStats, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;

    let total_duration_secs: i64 = conn
        .query_row("SELECT COALESCE(SUM(duration_secs), 0) FROM tracks", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    // Videos: group by format
    let mut video_stmt = conn
        .prepare("SELECT format, file_size FROM videos")
        .map_err(|e| e.to_string())?;
    let video_rows: Vec<(String, i64)> = video_stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let mut video_map: std::collections::HashMap<String, (i64, i64)> =
        std::collections::HashMap::new();
    for (fmt, size) in &video_rows {
        let e = video_map.entry(fmt.to_lowercase()).or_insert((0, 0));
        e.0 += 1;
        e.1 += size;
    }
    let mut video_entries: Vec<StorageEntry> = video_map
        .into_iter()
        .map(|(label, (count, size_bytes))| StorageEntry { label, count, size_bytes })
        .collect();
    video_entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let video_total: i64 = video_entries.iter().map(|e| e.size_bytes).sum();
    let video_count: i64 = video_entries.iter().map(|e| e.count).sum();

    // Music: group by extension with count + size
    let music_rows: Vec<(String, i64)> = conn
        .prepare("SELECT path, file_size FROM tracks")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut music_map: std::collections::HashMap<String, (i64, i64)> =
        std::collections::HashMap::new();
    for (path, size) in &music_rows {
        if let Some(ext) = std::path::Path::new(path).extension() {
            let e = music_map
                .entry(ext.to_string_lossy().to_lowercase())
                .or_insert((0, 0));
            e.0 += 1;
            e.1 += size;
        }
    }
    let mut music_entries: Vec<StorageEntry> = music_map
        .into_iter()
        .map(|(label, (count, size_bytes))| StorageEntry { label, count, size_bytes })
        .collect();
    music_entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let music_total: i64 = music_entries.iter().map(|e| e.size_bytes).sum();
    let music_count: i64 = music_entries.iter().map(|e| e.count).sum();

    // Books: group by format with count + size
    let book_rows: Vec<(String, i64)> = conn
        .prepare("SELECT format, file_size FROM books")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut books_map: std::collections::HashMap<String, (i64, i64)> =
        std::collections::HashMap::new();
    for (fmt, size) in &book_rows {
        let e = books_map.entry(fmt.to_lowercase()).or_insert((0, 0));
        e.0 += 1;
        e.1 += size;
    }
    let mut books_entries: Vec<StorageEntry> = books_map
        .into_iter()
        .map(|(label, (count, size_bytes))| StorageEntry { label, count, size_bytes })
        .collect();
    books_entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    let books_total: i64 = books_entries.iter().map(|e| e.size_bytes).sum();
    let books_count: i64 = books_entries.iter().map(|e| e.count).sum();

    // Cached images: artwork thumbs+full, artist photos, banners
    let cache_base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let (art_count, art_bytes) = scan_dir_size(&cache_base.join("artwork"));
    let (img_count, img_bytes) = scan_dir_size(&cache_base.join("artist-images"));
    let (ban_count, ban_bytes) = scan_dir_size(&cache_base.join("artist-banners"));
    let images_entries: Vec<StorageEntry> = vec![
        StorageEntry { label: "album art".into(),     count: art_count, size_bytes: art_bytes },
        StorageEntry { label: "artist photos".into(), count: img_count, size_bytes: img_bytes },
        StorageEntry { label: "banners".into(),       count: ban_count, size_bytes: ban_bytes },
    ]
    .into_iter()
    .filter(|e| e.size_bytes > 0)
    .collect();
    let images_total: i64 = art_bytes + img_bytes + ban_bytes;
    let images_count: i64 = art_count + img_count + ban_count;

    Ok(LibraryStats {
        total_duration_secs,
        music:  StorageCategory { total_size_bytes: music_total,  total_count: music_count,  entries: music_entries },
        videos: StorageCategory { total_size_bytes: video_total, total_count: video_count, entries: video_entries },
        books:  StorageCategory { total_size_bytes: books_total,  total_count: books_count,  entries: books_entries },
        images: StorageCategory { total_size_bytes: images_total, total_count: images_count, entries: images_entries },
    })
}

#[tauri::command]
fn scan_folder(path: String) -> Result<Vec<Track>, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("Folder not found: {}", path));
    }
    let audio_files: Vec<PathBuf> = WalkDir::new(&folder)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let path = entry.path().to_path_buf();
            let ext = path.extension()?.to_str()?.to_lowercase();
            if ext == "mp3" || ext == "flac" || ext == "wav" || ext == "aac" || ext == "ogg" {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .map_err(|e| e.to_string())?;
    let tracks = pool.install(|| {
        audio_files
            .par_iter()
            .filter_map(|file_path| read_track_metadata(file_path))
            .collect::<Vec<Track>>()
    });
    Ok(tracks)
}

fn read_track_metadata(path: &PathBuf) -> Option<Track> {
    let tagged_file = Probe::open(path).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag();
    let properties = tagged_file.properties();
    let title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .unwrap_or_else(|| {
            path.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });
    // Capture both raw tags BEFORE any cleaning — collaboration credits may live
    // in either the artist OR album_artist tag depending on the tagger used.
    let raw_artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .unwrap_or_default();
    let raw_album_artist = tag
        .and_then(|t| t.get_string(&lofty::tag::ItemKey::AlbumArtist).map(|s| s.to_string()))
        .unwrap_or_default();

    // `artist` stored in DB = all unique contributors from BOTH tags joined by " / ".
    // This ensures track_artists can link every collaborator regardless of which tag
    // the tagger used (e.g. "Fred again.." in TPE1, "Fred again../Baby Keem" in TPE2).
    let artist = {
        let mut seen = std::collections::HashSet::new();
        let mut parts: Vec<String> = Vec::new();
        for a in split_all_artists(&raw_artist)
            .into_iter()
            .chain(split_all_artists(&raw_album_artist))
        {
            if seen.insert(a.clone()) {
                parts.push(a);
            }
        }
        if parts.is_empty() { "Unknown Artist".to_string() } else { parts.join(" / ") }
    };

    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Album".to_string());
    // album_artist = cleaned primary artist for grouping
    let album_artist = if !raw_album_artist.trim().is_empty() {
        clean_primary_artist(&raw_album_artist)
    } else if !raw_artist.trim().is_empty() {
        clean_primary_artist(&raw_artist)
    } else {
        "Unknown Artist".to_string()
    };
    let genre = tag
        .and_then(|t| t.genre().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Genre".to_string());
    // Read MusicBrainz Artist ID for accurate image lookup and disambiguation
    let mbid = tag
        .and_then(|t| {
            t.get_string(&lofty::tag::ItemKey::MusicBrainzArtistId)
                .map(|s| s.to_string())
        })
        .filter(|s| !s.trim().is_empty());
    let year = tag.and_then(|t| t.year());
    let track_number = tag.and_then(|t| t.track());
    let track_total = tag.and_then(|t| t.track_total());
    let disc_number = tag.and_then(|t| t.disk());
    let disc_total = tag.and_then(|t| t.disk_total());
    let duration_secs = properties.duration().as_secs();
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();
    let channels = properties.channels();
    let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    // Parse ReplayGain tags (value looks like "-4.21 dB" or "+2.00 dB")
    fn parse_rg(s: &str) -> Option<f32> {
        s.trim().trim_end_matches("dB").trim().parse::<f32>().ok()
    }
    let replay_gain_track = tag
        .and_then(|t| t.get_string(&lofty::tag::ItemKey::ReplayGainTrackGain).map(|s| s.to_string()))
        .as_deref()
        .and_then(parse_rg);
    let replay_gain_album = tag
        .and_then(|t| t.get_string(&lofty::tag::ItemKey::ReplayGainAlbumGain).map(|s| s.to_string()))
        .as_deref()
        .and_then(parse_rg);

    Some(Track {
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        album_artist,
        genre,
        year,
        track_number,
        track_total,
        disc_number,
        disc_total,
        duration_secs,
        bitrate,
        sample_rate,
        channels,
        file_size,
        mbid,
        replay_gain_track,
        replay_gain_album,
    })
}

#[tauri::command]
fn scan_books(path: String) -> Result<Vec<Book>, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("Folder not found: {}", path));
    }
    let books: Vec<Book> = WalkDir::new(&folder)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            let path = entry.path().to_path_buf();
            let ext = path.extension()?.to_str()?.to_lowercase();
            if ext == "pdf" || ext == "epub" {
                let file_name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let file_size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let title = if ext == "epub" {
                    extract_epub_title(&path).unwrap_or_else(|| file_name.clone())
                } else {
                    file_name.clone()
                };
                Some(Book {
                    path: path.to_string_lossy().to_string(),
                    title,
                    file_name,
                    format: ext,
                    file_size,
                })
            } else {
                None
            }
        })
        .collect();
    Ok(books)
}

fn extract_epub_title(path: &PathBuf) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;
    let opf_names = ["OEBPS/content.opf", "content.opf", "OPS/content.opf"];
    for name in &opf_names {
        if let Ok(mut opf_file) = archive.by_name(name) {
            let mut contents = String::new();
            opf_file.read_to_string(&mut contents).ok()?;
            if let Some(start) = contents.find("<dc:title>") {
                let rest = &contents[start + 10..];
                if let Some(end) = rest.find("</dc:title>") {
                    return Some(rest[..end].trim().to_string());
                }
            }
            if let Some(start) = contents.find("<dc:title") {
                if let Some(tag_end) = contents[start..].find('>') {
                    let rest = &contents[start + tag_end + 1..];
                    if let Some(end) = rest.find("</dc:title>") {
                        return Some(rest[..end].trim().to_string());
                    }
                }
            }
        }
    }
    None
}

fn album_hash(album: &str, album_artist: &str) -> String {
    format!("{:x}", md5_simple(&format!("{}||{}", album, album_artist)))
}

fn track_path_hash(path: &str) -> String {
    format!("{:x}", md5_simple(path))
}

#[tauri::command]
fn get_artwork(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    track_path: String,
    full: Option<bool>,
    track_override: Option<bool>,
) -> Option<String> {
    use image::imageops::FilterType;
    let want_full = full.unwrap_or(false);
    let cache_base = app.path().app_cache_dir().ok()?.join("artwork");

    // When the caller wants per-track artwork (e.g. Now Playing, queue rows), check for a
    // track-specific override saved by set_track_artwork with apply_to_album=false.
    if track_override.unwrap_or(false) {
        if let Ok(conn) = db.0.get() {
            let custom_hash: Option<String> = conn
                .query_row(
                    "SELECT custom_artwork_hash FROM tracks WHERE path = ?1",
                    rusqlite::params![&track_path],
                    |r| r.get(0),
                )
                .ok()
                .flatten();
            if let Some(hash) = custom_hash {
                let tier = if want_full { "full" } else { "thumb" };
                let override_path = cache_base
                    .join("track-override")
                    .join(tier)
                    .join(format!("{hash}.jpg"));
                if override_path.exists() {
                    return Some(override_path.to_string_lossy().to_string());
                }
            }
        }
    }

    let cache_dir = if want_full {
        cache_base.join("full")
    } else {
        cache_base.join("thumb")
    };
    fs::create_dir_all(&cache_dir).ok()?;

    // Try to get album info from track metadata
    let path = PathBuf::from(&track_path);
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    // Fall back to any available tag if there is no "primary" one
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    let album = tag.album().map(|s| s.to_string()).unwrap_or_default();
    let album_artist = tag
        .get_string(&lofty::tag::ItemKey::AlbumArtist)
        .map(|s| s.to_string())
        .or_else(|| tag.artist().map(|s| s.to_string()))
        .unwrap_or_default();

    let hash = album_hash(&album, &album_artist);
    let cache_path = cache_dir.join(format!("{}.jpg", hash));

    if !cache_path.exists() {
        let picture = tag.pictures().first()?;
        let image_data = picture.data();
        let img = image::load_from_memory(image_data).ok()?;
        let (size, quality) = if want_full { (300, 80) } else { (128, 75) };
        let img = img.resize(size, size, FilterType::Lanczos3);
        let output = fs::File::create(&cache_path).ok()?;
        let mut buf = std::io::BufWriter::new(output);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
        encoder.encode_image(&img).ok()?;
    }
    Some(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_artwork_original(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    track_path: String,
    track_override: Option<bool>,
) -> Option<String> {
    use image::imageops::FilterType;
    let cache_base = app.path().app_cache_dir().ok()?.join("artwork");

    // Check for per-track custom artwork override when requested.
    if track_override.unwrap_or(false) {
        if let Ok(conn) = db.0.get() {
            let custom_hash: Option<String> = conn
                .query_row(
                    "SELECT custom_artwork_hash FROM tracks WHERE path = ?1",
                    rusqlite::params![&track_path],
                    |r| r.get(0),
                )
                .ok()
                .flatten();
            if let Some(hash) = custom_hash {
                let override_path = cache_base
                    .join("track-override")
                    .join("original")
                    .join(format!("{hash}.jpg"));
                if override_path.exists() {
                    return Some(override_path.to_string_lossy().to_string());
                }
            }
        }
    }

    let cache_dir = cache_base.join("original");
    fs::create_dir_all(&cache_dir).ok()?;

    let path = PathBuf::from(&track_path);
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    let album = tag.album().map(|s| s.to_string()).unwrap_or_default();
    let album_artist = tag
        .get_string(&lofty::tag::ItemKey::AlbumArtist)
        .map(|s| s.to_string())
        .or_else(|| tag.artist().map(|s| s.to_string()))
        .unwrap_or_default();

    let hash = album_hash(&album, &album_artist);
    let cache_path = cache_dir.join(format!("{}.jpg", hash));

    if !cache_path.exists() {
        let picture = tag.pictures().first()?;
        let img = image::load_from_memory(picture.data()).ok()?;
        // Preserve original resolution; only downscale if larger than 1200px
        let max_px = 1200u32;
        let img = if img.width() > max_px || img.height() > max_px {
            img.resize(max_px, max_px, FilterType::Lanczos3)
        } else {
            img
        };
        let output = fs::File::create(&cache_path).ok()?;
        let mut buf = std::io::BufWriter::new(output);
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
        enc.encode_image(&img).ok()?;
    }
    Some(cache_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn fetch_missing_artwork(
    app: tauri::AppHandle,
    album_name: String,
    album_artist: String,
) -> Result<String, String> {
    use image::imageops::FilterType;

    let hash = album_hash(&album_name, &album_artist);
    let cache_base = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artwork");
    let thumb_path = cache_base.join("thumb").join(format!("{hash}.jpg"));
    let full_path = cache_base.join("full").join(format!("{hash}.jpg"));

    if thumb_path.exists() && full_path.exists() {
        return Ok(thumb_path.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Libera/1.0 (music player)")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let query = format!(
        "release:\"{}\" AND artist:\"{}\"",
        album_name.replace('"', ""),
        album_artist.replace('"', ""),
    );
    let mb_url = format!(
        "https://musicbrainz.org/ws/2/release/?query={}&fmt=json&limit=5",
        urlencoding::encode(&query),
    );

    let mb_json: serde_json::Value = client
        .get(&mb_url)
        .send()
        .await
        .map_err(|e| format!("MusicBrainz request: {e}"))?
        .json()
        .await
        .map_err(|e| format!("MusicBrainz parse: {e}"))?;

    let mbid = mb_json["releases"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|r| r["id"].as_str())
        .ok_or_else(|| "No release found on MusicBrainz".to_string())?
        .to_string();

    let caa_url = format!("https://coverartarchive.org/release/{mbid}/front");
    let img_resp = client
        .get(&caa_url)
        .send()
        .await
        .map_err(|e| format!("CoverArtArchive request: {e}"))?;

    if !img_resp.status().is_success() {
        return Err(format!("CoverArtArchive returned {}", img_resp.status()));
    }

    let img_bytes = img_resp.bytes().await.map_err(|e| e.to_string())?;
    let img =
        image::load_from_memory(&img_bytes).map_err(|e| format!("Image decode: {e}"))?;

    fs::create_dir_all(cache_base.join("thumb")).map_err(|e| e.to_string())?;
    fs::create_dir_all(cache_base.join("full")).map_err(|e| e.to_string())?;

    {
        let thumb = img.resize(128, 128, FilterType::Lanczos3);
        let output = fs::File::create(&thumb_path).map_err(|e| e.to_string())?;
        let mut buf = std::io::BufWriter::new(output);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 75)
            .encode_image(&thumb)
            .map_err(|e| e.to_string())?;
    }

    {
        let full = img.resize(300, 300, FilterType::Lanczos3);
        let output = fs::File::create(&full_path).map_err(|e| e.to_string())?;
        let mut buf = std::io::BufWriter::new(output);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85)
            .encode_image(&full)
            .map_err(|e| e.to_string())?;
    }

    Ok(thumb_path.to_string_lossy().to_string())
}

#[tauri::command]
fn set_track_artwork(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    track_path: String,
    image_base64: String,
    apply_to_album: bool,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use lofty::config::WriteOptions;
    use lofty::picture::{MimeType, Picture, PictureType};

    // Decode base64 → raw bytes
    let raw_bytes = STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("base64 decode: {e}"))?;

    // Validate + re-encode as JPEG (JPEG has no alpha so this also strips it)
    let img = image::load_from_memory(&raw_bytes).map_err(|e| format!("image load: {e}"))?;
    let mut jpeg_bytes: Vec<u8> = Vec::new();
    {
        let mut cur = std::io::Cursor::new(&mut jpeg_bytes);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cur, 90)
            .encode_image(&img)
            .map_err(|e| format!("jpeg encode: {e}"))?;
    }

    // Read album info from the track (needed for cache invalidation)
    let (album, album_artist) = {
        let tf = Probe::open(&track_path)
            .map_err(|e| format!("probe open: {e}"))?
            .read()
            .map_err(|e| format!("probe read: {e}"))?;
        let tag = tf
            .primary_tag()
            .or_else(|| tf.first_tag())
            .ok_or_else(|| "no tag found in track".to_string())?;
        let album = tag.album().map(|s| s.to_string()).unwrap_or_default();
        let aa = tag
            .get_string(&lofty::tag::ItemKey::AlbumArtist)
            .map(|s| s.to_string())
            .or_else(|| tag.artist().map(|s| s.to_string()))
            .unwrap_or_default();
        (album, aa)
    };

    // Embed artwork into a single audio file
    let embed = |path: &str| -> Result<(), String> {
        let pic = Picture::new_unchecked(
            PictureType::CoverFront,
            Some(MimeType::Jpeg),
            None,
            jpeg_bytes.clone(),
        );
        let mut tf = Probe::open(path)
            .map_err(|e| format!("open {path}: {e}"))?
            .read()
            .map_err(|e| format!("read {path}: {e}"))?;
        // Check with an immutable borrow first so we can take a single mutable borrow below.
        let has_primary = tf.primary_tag().is_some();
        let tag = if has_primary { tf.primary_tag_mut() } else { tf.first_tag_mut() }
            .ok_or_else(|| format!("no writable tag in {path}"))?;
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(pic);
        tf.save_to_path(path, WriteOptions::default())
            .map_err(|e| format!("save {path}: {e}"))?;
        Ok(())
    };

    // Update the primary track
    embed(&track_path)?;

    if apply_to_album {
        // Embed the new artwork into every other track in the album.
        let conn = db.0.get().map_err(|e| format!("db pool: {e}"))?;
        let mut stmt = conn
            .prepare("SELECT path FROM tracks WHERE album = ?1 AND path != ?2")
            .map_err(|e| format!("db prepare: {e}"))?;
        let others: Vec<String> = stmt
            .query_map(rusqlite::params![&album, &track_path], |r| r.get(0))
            .map_err(|e| format!("db query: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        for p in &others {
            if let Err(e) = embed(p) {
                eprintln!("set_track_artwork: skipped {p}: {e}");
            }
        }

        // Remove any per-track overrides for this album — they would conflict with the new
        // uniform album artwork.
        let overrides: Vec<String> = conn
            .prepare(
                "SELECT path FROM tracks \
                 WHERE album = ?1 AND album_artist = ?2 AND custom_artwork_hash IS NOT NULL",
            )
            .map_err(|e| format!("db prepare: {e}"))?
            .query_map(rusqlite::params![&album, &album_artist], |r| r.get(0))
            .map_err(|e| format!("db query: {e}"))?
            .filter_map(|r| r.ok())
            .collect();

        if let Ok(cache_base) = app.path().app_cache_dir() {
            for p in &overrides {
                let h = track_path_hash(p);
                for tier in &["thumb", "full", "original"] {
                    let _ = fs::remove_file(
                        cache_base
                            .join("artwork")
                            .join("track-override")
                            .join(tier)
                            .join(format!("{h}.jpg")),
                    );
                }
            }
        }

        conn.execute(
            "UPDATE tracks SET custom_artwork_hash = NULL \
             WHERE album = ?1 AND album_artist = ?2",
            rusqlite::params![&album, &album_artist],
        )
        .map_err(|e| format!("db update: {e}"))?;

        // Invalidate the shared album-level cache so the next request re-reads from the
        // updated audio file tags.
        if let Ok(cache_base) = app.path().app_cache_dir() {
            let hash = album_hash(&album, &album_artist);
            for tier in &["thumb", "full", "original"] {
                let _ = fs::remove_file(
                    cache_base
                        .join("artwork")
                        .join(tier)
                        .join(format!("{hash}.jpg")),
                );
            }
        }
    } else {
        // "This track only": write a per-track override so the album-level cache is left
        // untouched and other tracks/the album card keep their existing artwork.
        let track_hash = track_path_hash(&track_path);
        if let Ok(cache_base) = app.path().app_cache_dir() {
            use image::imageops::FilterType;
            // (tier, max_px, quality, always_resize)
            let tiers: &[(&str, u32, u8, bool)] = &[
                ("thumb", 128, 75, true),
                ("full", 300, 80, true),
                ("original", 1200, 92, false),
            ];
            for (tier, max_px, quality, always_resize) in tiers {
                let dir = cache_base
                    .join("artwork")
                    .join("track-override")
                    .join(tier);
                if fs::create_dir_all(&dir).is_ok() {
                    let out_path = dir.join(format!("{track_hash}.jpg"));
                    if let Ok(img) = image::load_from_memory(&jpeg_bytes) {
                        let img = if *always_resize
                            || img.width() > *max_px
                            || img.height() > *max_px
                        {
                            img.resize(*max_px, *max_px, FilterType::Lanczos3)
                        } else {
                            img
                        };
                        if let Ok(f) = fs::File::create(&out_path) {
                            let mut buf = std::io::BufWriter::new(f);
                            let _ = image::codecs::jpeg::JpegEncoder::new_with_quality(
                                &mut buf,
                                *quality,
                            )
                            .encode_image(&img);
                        }
                    }
                }
            }
        }

        // Record the override hash in the DB so get_artwork can find it.
        let conn = db.0.get().map_err(|e| format!("db pool: {e}"))?;
        conn.execute(
            "UPDATE tracks SET custom_artwork_hash = ?1 WHERE path = ?2",
            rusqlite::params![&track_hash, &track_path],
        )
        .map_err(|e| format!("db update: {e}"))?;
        // The album-level cache is intentionally NOT invalidated: other tracks in the
        // album and the album card itself continue showing the original shared artwork.
    }

    Ok(())
}

#[tauri::command]
fn update_track_metadata(
    db: State<'_, DbState>,
    path: String,
    title: String,
    artist: String,
    album_artist: String,
    album: String,
    year: Option<u32>,
    genre: Option<String>,
    track_number: Option<u32>,
    track_total: Option<u32>,
    disc_number: Option<u32>,
    disc_total: Option<u32>,
) -> Result<(), String> {
    use lofty::config::WriteOptions;
    use lofty::tag::ItemKey;

    // Write updated tags directly into the audio file
    let mut tf = Probe::open(&path)
        .map_err(|e| format!("open: {e}"))?
        .read()
        .map_err(|e| format!("read: {e}"))?;
    let has_primary = tf.primary_tag().is_some();
    let tag = if has_primary { tf.primary_tag_mut() } else { tf.first_tag_mut() }
        .ok_or_else(|| "no writable tag found in file".to_string())?;

    tag.set_title(title.clone());
    tag.set_artist(artist.clone());
    tag.set_album(album.clone());

    if album_artist.is_empty() {
        tag.remove_key(&ItemKey::AlbumArtist);
    } else {
        tag.insert_text(ItemKey::AlbumArtist, album_artist.clone());
    }
    match year {
        Some(y) => { tag.insert_text(ItemKey::Year, y.to_string()); }
        None => { tag.remove_key(&ItemKey::Year); }
    }
    match &genre {
        Some(g) => tag.set_genre(g.clone()),
        None => tag.remove_genre(),
    }
    match track_number {
        Some(n) => tag.set_track(n),
        None => tag.remove_track(),
    }
    match track_total {
        Some(n) => tag.set_track_total(n),
        None => tag.remove_track_total(),
    }
    match disc_number {
        Some(n) => tag.set_disk(n),
        None => tag.remove_disk(),
    }
    match disc_total {
        Some(n) => tag.set_disk_total(n),
        None => tag.remove_disk_total(),
    }

    tf.save_to_path(&path, WriteOptions::default())
        .map_err(|e| format!("save: {e}"))?;

    // Sync the SQLite cache so the UI reflects the change without re-scanning
    let conn = db.0.get().map_err(|e| format!("db pool: {e}"))?;
    conn.execute(
        "UPDATE tracks SET
            title        = ?1,
            artist       = ?2,
            album_artist = ?3,
            album        = ?4,
            year         = ?5,
            genre        = ?6,
            track_number = ?7,
            track_total  = ?8,
            disc_number  = ?9,
            disc_total   = ?10
         WHERE path = ?11",
        rusqlite::params![
            &title,
            &artist,
            &album_artist,
            &album,
            year,
            genre.as_deref().unwrap_or(""),
            track_number,
            track_total,
            disc_number,
            disc_total,
            &path,
        ],
    )
    .map_err(|e| format!("db update: {e}"))?;

    // Keep track_artists in sync so artist-search reflects the rename
    conn.execute(
        "DELETE FROM track_artists WHERE track_path = ?1",
        rusqlite::params![&path],
    )
    .map_err(|e| format!("db delete track_artists: {e}"))?;
    for name in [artist.as_str(), album_artist.as_str()] {
        if !name.is_empty() {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO track_artists (track_path, artist_name) VALUES (?1, ?2)",
                rusqlite::params![&path, name],
            );
        }
    }

    Ok(())
}

fn artist_name_hash(name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    name.to_lowercase().hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[tauri::command]
fn get_artist_image(app: tauri::AppHandle, artist_name: String) -> Option<String> {
    let path = app
        .path()
        .app_cache_dir()
        .ok()?
        .join("artist-images")
        .join(format!("{}.jpg", artist_name_hash(&artist_name)));
    if path.exists() { Some(path.to_string_lossy().to_string()) } else { None }
}

#[tauri::command]
fn get_artist_banner(app: tauri::AppHandle, artist_name: String) -> Option<String> {
    let path = app
        .path()
        .app_cache_dir()
        .ok()?
        .join("artist-banners")
        .join(format!("{}.jpg", artist_name_hash(&artist_name)));
    if path.exists() { Some(path.to_string_lossy().to_string()) } else { None }
}

#[tauri::command]
fn is_artist_banner_custom(app: tauri::AppHandle, artist_name: String) -> bool {
    let Ok(cache_dir) = app.path().app_cache_dir() else { return false; };
    cache_dir
        .join("artist-banners")
        .join(format!("{}.custom", artist_name_hash(&artist_name)))
        .exists()
}

#[tauri::command]
async fn set_artist_banner_custom(
    app: tauri::AppHandle,
    artist_name: String,
    source_path: String,
) -> Result<(), String> {
    let banner_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artist-banners");
    fs::create_dir_all(&banner_dir).map_err(|e| e.to_string())?;

    let hash = artist_name_hash(&artist_name);
    let banner_path = banner_dir.join(format!("{}.jpg", hash));
    let marker_path = banner_dir.join(format!("{}.custom", hash));

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use image::imageops::FilterType;
        let img = image::open(&source_path).map_err(|e| e.to_string())?;
        let img = if img.width() > 1920 || img.height() > 1920 {
            img.resize(1920, 1920, FilterType::Lanczos3)
        } else {
            img
        };
        let file = fs::File::create(&banner_path).map_err(|e| e.to_string())?;
        let mut buf = std::io::BufWriter::new(file);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92)
            .encode_image(&img)
            .map_err(|e| e.to_string())?;
        fs::write(&marker_path, b"").map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn clear_artist_banner_custom(app: tauri::AppHandle, artist_name: String) -> Result<(), String> {
    let Ok(banner_dir) = app.path().app_cache_dir().map(|d| d.join("artist-banners")) else {
        return Ok(());
    };
    let hash = artist_name_hash(&artist_name);
    let _ = fs::remove_file(banner_dir.join(format!("{}.jpg", hash)));
    let _ = fs::remove_file(banner_dir.join(format!("{}.custom", hash)));
    Ok(())
}

#[tauri::command]
fn set_artist_banner_from_base64(
    app: tauri::AppHandle,
    artist_name: String,
    image_base64: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let banner_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artist-banners");
    fs::create_dir_all(&banner_dir).map_err(|e| e.to_string())?;

    let hash = artist_name_hash(&artist_name);
    let bytes = STANDARD.decode(&image_base64).map_err(|e| format!("base64 decode: {e}"))?;
    fs::write(banner_dir.join(format!("{}.jpg", hash)), &bytes).map_err(|e| e.to_string())?;
    fs::write(banner_dir.join(format!("{}.custom", hash)), b"").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn fetch_artist_images(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    control: tauri::State<'_, DownloadControl>,
) -> Result<(), String> {
    control.paused.store(false, Ordering::Relaxed);
    control.cancelled.store(false, Ordering::Relaxed);
    use tauri::Emitter;
    use image::imageops::FilterType;

    // Collect artist names + their most common MBID; drop connection before any await
    let artists: Vec<(String, Option<String>)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT album_artist,
                        (SELECT mbid FROM tracks t2
                         WHERE t2.album_artist = t1.album_artist AND t2.mbid IS NOT NULL
                         GROUP BY t2.mbid ORDER BY COUNT(*) DESC LIMIT 1) AS top_mbid
                 FROM tracks t1 GROUP BY album_artist ORDER BY album_artist",
            )
            .map_err(|e| e.to_string())?;
        let result: Vec<(String, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artist-images");
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let banner_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artist-banners");
    fs::create_dir_all(&banner_dir).map_err(|e| e.to_string())?;

    let total = artists.len();
    let _ = app.emit("artist-images://started", serde_json::json!({ "total": total }));

    let client = reqwest::Client::builder()
        .user_agent("Libera/1.0 (music player app)")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    for (i, (name, artist_mbid)) in artists.iter().enumerate() {
        let hash          = artist_name_hash(name);
        let thumb_path    = cache_dir.join(format!("{}.jpg", &hash));
        let banner_path   = banner_dir.join(format!("{}.jpg", &hash));
        let custom_marker = banner_dir.join(format!("{}.custom", &hash));

        let _ = app.emit(
            "artist-images://progress",
            serde_json::json!({ "completed": i, "total": total, "current": name }),
        );

        let need_thumb  = !thumb_path.exists();
        let need_banner = !banner_path.exists() && !custom_marker.exists();

        if need_thumb || need_banner {
            // One API call per artist covers both thumb and banner fields.
            // Prefer MBID lookup (exact); fall back to name search with exact-name check.
            let artist_json: Option<serde_json::Value> = async {
                if let Some(mbid) = artist_mbid {
                    let url = format!(
                        "https://www.theaudiodb.com/api/v1/json/2/artist-mb.php?i={}",
                        mbid
                    );
                    if let Ok(resp) = client.get(&url).send().await {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if json["artists"][0].is_object() {
                                return Some(json);
                            }
                        }
                    }
                }
                let search_url = format!(
                    "https://www.theaudiodb.com/api/v1/json/2/search.php?s={}",
                    urlencoding::encode(name)
                );
                let resp = client.get(&search_url).send().await.ok()?;
                let json: serde_json::Value = resp.json().await.ok()?;
                let returned_name = json["artists"][0]["strArtist"].as_str()?;
                if returned_name.to_lowercase() != name.to_lowercase() {
                    return None;
                }
                Some(json)
            }
            .await;

            let mut cached_something = false;

            if let Some(ref json) = artist_json {
                let artist = &json["artists"][0];

                // Portrait thumb — used by grid cards (square crop)
                if need_thumb {
                    if let Some(url) = artist["strArtistThumb"].as_str().filter(|s| !s.is_empty()) {
                        if let Ok(resp) = client.get(url).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                if let Ok(img) = image::load_from_memory(&bytes) {
                                    let img = img.resize_to_fill(600, 800, FilterType::Lanczos3);
                                    if let Ok(file) = fs::File::create(&thumb_path) {
                                        let mut buf = std::io::BufWriter::new(file);
                                        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 82);
                                        if enc.encode_image(&img).is_ok() {
                                            cached_something = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Wide banner — used by the artist page header.
                // Priority: dedicated banner → fan art → fan art 2 → fan art 3.
                if need_banner {
                    let banner_url = [
                        artist["strArtistBanner"].as_str(),
                        artist["strArtistFanart"].as_str(),
                        artist["strArtistFanart2"].as_str(),
                        artist["strArtistFanart3"].as_str(),
                    ]
                    .iter()
                    .copied()
                    .flatten()
                    .find(|s| !s.is_empty());

                    if let Some(url) = banner_url {
                        if let Ok(resp) = client.get(url).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                // Only decode+re-encode if we actually need to scale down.
                                // Re-encoding a JPEG at 82% introduces a generation of quality loss —
                                // for small source images (most TheAudioDB fanart) just write raw bytes.
                                let written = if let Ok(img) = image::load_from_memory(&bytes) {
                                    if img.width() > 1920 || img.height() > 1920 {
                                        // Scale down, then re-encode at high quality
                                        let img = img.resize(1920, 1920, FilterType::Lanczos3);
                                        if let Ok(file) = fs::File::create(&banner_path) {
                                            let mut buf = std::io::BufWriter::new(file);
                                            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 92);
                                            enc.encode_image(&img).is_ok()
                                        } else { false }
                                    } else {
                                        // Already within bounds — write raw bytes to avoid re-compression loss
                                        fs::write(&banner_path, &bytes).is_ok()
                                    }
                                } else { false };
                                if written { cached_something = true; }
                            }
                        }
                    }
                }
            }

            if cached_something {
                let _ = app.emit(
                    "artist-images://cached",
                    serde_json::json!({ "artist": name }),
                );
            }

            // Respect TheAudioDB free-tier rate limit (1 req/s)
            tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        }

        // Check cancel before moving to next artist
        if control.cancelled.load(Ordering::Relaxed) {
            let _ = app.emit("artist-images://cancelled", serde_json::json!({}));
            return Ok(());
        }

        // Wait while paused (poll every 300ms)
        while control.paused.load(Ordering::Relaxed) {
            if control.cancelled.load(Ordering::Relaxed) {
                let _ = app.emit("artist-images://cancelled", serde_json::json!({}));
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    }

    let _ = app.emit(
        "artist-images://progress",
        serde_json::json!({ "completed": total, "total": total, "current": "" }),
    );
    let _ = app.emit("artist-images://done", serde_json::json!({ "total": total }));
    Ok(())
}

#[tauri::command]
fn pause_artist_image_download(control: State<'_, DownloadControl>) -> Result<(), String> {
    control.paused.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn resume_artist_image_download(control: State<'_, DownloadControl>) -> Result<(), String> {
    control.paused.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn cancel_artist_image_download(
    app: tauri::AppHandle,
    control: State<'_, DownloadControl>,
) -> Result<(), String> {
    use tauri::Emitter;
    control.cancelled.store(true, Ordering::Relaxed);
    control.paused.store(false, Ordering::Relaxed);
    // Delete all downloaded artist images and banners
    let cache_base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    for dir in &["artist-images", "artist-banners"] {
        let path = cache_base.join(dir);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }
    let _ = app.emit("artist-images://cancelled", serde_json::json!({}));
    Ok(())
}

#[tauri::command]
fn clear_artist_images(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("artist-images");
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn clear_artist_banners(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("artist-banners");
    if path.exists() {
        // Delete only auto-fetched banners; preserve custom ones (.custom marker present)
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map_or(false, |e| e == "jpg") && !p.with_extension("custom").exists() {
                    let _ = fs::remove_file(&p);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn clear_all_data(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    // Clear all tables
    {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "DELETE FROM tracks;
             DELETE FROM track_artists WHERE track_path NOT IN (SELECT path FROM tracks);
             DELETE FROM books;"
        )
        .map_err(|e| e.to_string())?;
    }
    // Remove all cache directories
    let cache_base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    for dir in &["artwork", "artist-images", "artist-banners", "book-covers"] {
        // artwork sub-dirs (thumb, full, original) are removed when "artwork" is deleted
        let path = cache_base.join(dir);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn md5_simple(input: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}

#[tauri::command]
fn get_uncached_tracks(app: tauri::AppHandle, track_paths: Vec<String>) -> Vec<String> {
    let cache_dir = match app.path().app_cache_dir().ok() {
        Some(d) => d.join("artwork").join("thumb"),
        None => return track_paths,
    };

    // Deduplicate by album — only return one track per unique album
    let mut seen_albums = std::collections::HashSet::new();
    let mut uncached: Vec<String> = Vec::new();

    for track_path in track_paths {
        let path = PathBuf::from(&track_path);
        let Ok(tagged_file) = Probe::open(&path).and_then(|p| p.read()) else {
            continue;
        };
        let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) else {
            continue;
        };
        let album = tag.album().map(|s| s.to_string()).unwrap_or_default();
        let album_artist = tag
            .get_string(&lofty::tag::ItemKey::AlbumArtist)
            .map(|s| s.to_string())
            .or_else(|| tag.artist().map(|s| s.to_string()))
            .unwrap_or_default();
        let hash = album_hash(&album, &album_artist);

        if seen_albums.contains(&hash) {
            continue;
        }
        seen_albums.insert(hash.clone());

        let thumb_path = cache_dir.join(format!("{}.jpg", hash));
        if !thumb_path.exists() {
            uncached.push(track_path);
        }
    }
    uncached
}

#[tauri::command]
async fn precache_artwork(app: tauri::AppHandle, track_paths: Vec<String>) -> Result<(), String> {
    use image::imageops::FilterType;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tauri::Emitter;

    let cache_base = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artwork");
    let thumb_dir = cache_base.join("thumb");
    let full_dir = cache_base.join("full");
    fs::create_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&full_dir).map_err(|e| e.to_string())?;

    let total = track_paths.len();
    let completed = Arc::new(AtomicUsize::new(0));
    let app_clone = app.clone();
    let thumb_dir = Arc::new(thumb_dir);
    let full_dir = Arc::new(full_dir);

    let num_threads = std::thread::available_parallelism()
        .map(|n| (n.get() / 2).max(2))
        .unwrap_or(4);

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build()
        .map_err(|e| e.to_string())?;
    pool.install(|| {
        track_paths.par_iter().for_each(|track_path| {
            let path = PathBuf::from(track_path);
            let Ok(tagged_file) = Probe::open(&path).and_then(|p| p.read()) else {
                completed.fetch_add(1, Ordering::Relaxed);
                return;
            };
            let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) else {
                completed.fetch_add(1, Ordering::Relaxed);
                return;
            };
            let album = tag.album().map(|s| s.to_string()).unwrap_or_default();
            let album_artist = tag
                .get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string())
                .or_else(|| tag.artist().map(|s| s.to_string()))
                .unwrap_or_default();
            let hash = album_hash(&album, &album_artist);
            let thumb_path = thumb_dir.join(format!("{}.jpg", hash));
            let full_path = full_dir.join(format!("{}.jpg", hash));

            if !thumb_path.exists() || !full_path.exists() {
                if let Some(picture) = tag.pictures().first() {
                    if let Ok(img) = image::load_from_memory(picture.data()) {
                        if !thumb_path.exists() {
                            let thumb = img.resize(128, 128, FilterType::Lanczos3);
                            if let Ok(output) = fs::File::create(&thumb_path) {
                                let mut buf = std::io::BufWriter::new(output);
                                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(
                                    &mut buf, 75,
                                );
                                let _ = enc.encode_image(&thumb);
                            }
                        }
                        if !full_path.exists() {
                            let full = img.resize(300, 300, FilterType::Lanczos3);
                            if let Ok(output) = fs::File::create(&full_path) {
                                let mut buf = std::io::BufWriter::new(output);
                                let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(
                                    &mut buf, 85,
                                );
                                let _ = enc.encode_image(&full);
                            }
                        }
                    }
                }
            }

            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app_clone.emit(
                "artwork://progress",
                serde_json::json!({
                    "completed": done,
                    "total": total,
                    "current_path": track_path,
                }),
            );
        });
    });

    let _ = app.emit("artwork://done", serde_json::json!({ "total": total }));
    Ok(())
}

#[tauri::command]
fn get_epub_cover(app: tauri::AppHandle, book_path: String) -> Option<String> {
    use std::io::Read;
    let path = PathBuf::from(&book_path);
    let file = fs::File::open(&path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;
    let cache_dir = app.path().app_cache_dir().ok()?.join("book-covers");
    fs::create_dir_all(&cache_dir).ok()?;
    let hash = format!("{:x}", md5_simple(&book_path));
    let cache_path = cache_dir.join(format!("{}.jpg", hash));
    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().to_string());
    }
    let cover_names = [
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "images/cover.jpg",
        "images/cover.jpeg",
        "images/cover.png",
        "OEBPS/cover.jpg",
        "OEBPS/cover.jpeg",
        "OEBPS/cover.png",
        "OEBPS/images/cover.jpg",
        "OEBPS/images/cover.jpeg",
        "OEBPS/images/cover.png",
        "OEBPS/Images/cover.jpg",
        "OEBPS/Images/cover.jpeg",
        "OEBPS/Images/cover.png",
        "OEBPS/Images/default_cover.jpeg",
        "OEBPS/Images/default_cover.jpg",
    ];
    for name in &cover_names {
        if let Ok(mut zip_file) = archive.by_name(name) {
            let mut bytes = Vec::new();
            zip_file.read_to_end(&mut bytes).ok()?;
            use image::imageops::FilterType;
            use image::ImageFormat;
            let img = image::load_from_memory(&bytes).ok()?;
            let img = img.resize(600, 600, FilterType::Lanczos3);
            let mut output = fs::File::create(&cache_path).ok()?;
            img.write_to(&mut std::io::BufWriter::new(&mut output), ImageFormat::Jpeg)
                .ok()?;
            return Some(cache_path.to_string_lossy().to_string());
        }
    }
    None
}

#[tauri::command]
fn list_epub_contents(book_path: String) -> Vec<String> {
    let path = PathBuf::from(&book_path);
    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return vec![],
    };
    let mut names = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            names.push(f.name().to_string());
        }
    }
    names
}

#[tauri::command]
fn open_pdf_viewer(app: tauri::AppHandle, path: String, title: String) -> Result<(), String> {
    let encoded_path = urlencoding::encode(&path).to_string();
    let encoded_title = urlencoding::encode(&title).to_string();
    let url_path = format!(
        "pdf-viewer.html?path={}&title={}",
        encoded_path, encoded_title
    );
    tauri::WebviewWindowBuilder::new(&app, "pdf-viewer", tauri::WebviewUrl::App(url_path.into()))
        .title(&title)
        .inner_size(1100.0, 850.0)
        .resizable(true)
        .build()
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

#[tauri::command]
fn get_albums(state: State<DbState>) -> Result<Vec<Album>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT album, album_artist as artist, MIN(year) as year, COUNT(*) as track_count, MIN(path) as cover_path
         FROM tracks GROUP BY album, album_artist ORDER BY album_artist, album"
    ).map_err(|e| e.to_string())?;
    let albums = stmt
        .query_map([], |row| {
            Ok(Album {
                album: row.get(0)?,
                artist: row.get(1)?,
                year: row.get(2)?,
                track_count: row.get::<_, i64>(3)? as usize,
                cover_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|a| a.ok())
        .collect();
    Ok(albums)
}

#[tauri::command]
fn get_album_tracks(
    state: State<DbState>,
    album: String,
    artist: String,
) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT path, title, artist, album, album_artist, genre, year,
         track_number, track_total, disc_number, disc_total,
         duration_secs, bitrate, sample_rate, channels, file_size, mbid, replay_gain_track, replay_gain_album
         FROM tracks WHERE album = ?1 AND album_artist = ?2
         ORDER BY disc_number, track_number",
        )
        .map_err(|e| e.to_string())?;
    let tracks = stmt
        .query_map(rusqlite::params![album, artist], |row| {
            Ok(Track {
                path: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                album_artist: row.get(4)?,
                genre: row.get(5)?,
                year: row.get(6)?,
                track_number: row.get(7)?,
                track_total: row.get(8)?,
                disc_number: row.get(9)?,
                disc_total: row.get(10)?,
                duration_secs: row.get(11)?,
                bitrate: row.get(12)?,
                sample_rate: row.get(13)?,
                channels: row.get(14)?,
                file_size: row.get(15)?,
                mbid: row.get(16)?,
                replay_gain_track: row.get(17)?,
                replay_gain_album: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|t| t.ok())
        .collect();
    Ok(tracks)
}

#[tauri::command]
fn get_albums_count(state: State<DbState>, query: String) -> Result<usize, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let count: usize = if query.is_empty() {
        conn.query_row(
            "SELECT COUNT(DISTINCT album || '||' || album_artist) FROM tracks",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        conn.query_row(
            "SELECT COUNT(DISTINCT album || '||' || album_artist) FROM tracks WHERE LOWER(album) LIKE ?1 OR LOWER(album_artist) LIKE ?1",
            rusqlite::params![pattern],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(count)
}

#[tauri::command]
fn search_albums(state: State<DbState>, query: String, sort_by: Option<String>) -> Result<Vec<Album>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;

    let order_clause = match sort_by.as_deref() {
        Some("artist") => "ORDER BY album_artist COLLATE NOCASE, album COLLATE NOCASE",
        Some("year_desc") => "ORDER BY year DESC NULLS LAST",
        Some("year_asc") => "ORDER BY year ASC NULLS LAST",
        _ => "ORDER BY album COLLATE NOCASE",
    };

    let select = "SELECT album, album_artist as artist, MIN(year) as year, COUNT(*) as track_count, MIN(path) as cover_path FROM tracks";
    let album_cols = &["LOWER(album)", "LOWER(album_artist)"];

    let map_row = |row: &rusqlite::Row| {
        Ok(Album {
            album: row.get(0)?,
            artist: row.get(1)?,
            year: row.get(2)?,
            track_count: row.get::<_, i64>(3)? as usize,
            cover_path: row.get(4)?,
        })
    };

    let albums = if query.is_empty() {
        let sql = format!("{} GROUP BY album, album_artist {}", select, order_clause);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let x = stmt.query_map([], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|a| a.ok())
            .collect();
        x
    } else {
        let (multi_cond, multi_params) = word_search_params(&query, 2, album_cols);
        if !multi_cond.is_empty() {
            let sql = format!(
                "{} WHERE {} GROUP BY album, album_artist {}",
                select, multi_cond, order_clause
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params_from_iter(multi_params.iter()), map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|a| a.ok())
                .collect();
            x
        } else {
            let pattern = format!("%{}%", query.to_lowercase());
            let sql = format!(
                "{} WHERE LOWER(album) LIKE ?1 OR LOWER(album_artist) LIKE ?1 GROUP BY album, album_artist {}",
                select, order_clause
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params![pattern], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|a| a.ok())
                .collect();
            x
        }
    };

    Ok(albums)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Artist {
    pub name: String,
    pub album_count: usize,
    pub track_count: usize,
    pub cover_path: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Genre {
    pub name: String,
    pub track_count: usize,
    pub cover_path: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_count: usize,
    pub cover_path: String,
    pub custom_cover: Option<String>,
}

#[tauri::command]
fn search_artists(state: State<DbState>, query: String) -> Result<Vec<Artist>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    // Prefer cover_path from tracks where this artist is the primary album_artist;
    // fall back to any track they appear on (e.g. featured collaborators).
    let base = "SELECT ta.artist_name,
                        COUNT(DISTINCT t.album) AS album_count,
                        COUNT(*) AS track_count,
                        COALESCE(
                            MIN(CASE WHEN t.album_artist = ta.artist_name THEN t.path END),
                            MIN(t.path)
                        ) AS cover_path
                 FROM track_artists ta
                 JOIN tracks t ON ta.track_path = t.path";
    let blocked = "LOWER(ta.artist_name) NOT IN ('various artists', 'va', 'various')";

    let map_row = |row: &rusqlite::Row| {
        Ok(Artist {
            name: row.get(0)?,
            album_count: row.get::<_, i64>(1)? as usize,
            track_count: row.get::<_, i64>(2)? as usize,
            cover_path: row.get(3)?,
        })
    };

    let artist_cols = &["LOWER(ta.artist_name)"];
    let artists = if query.is_empty() {
        let sql = format!("{} WHERE {} GROUP BY ta.artist_name ORDER BY ta.artist_name", base, blocked);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let x = stmt.query_map([], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|a| a.ok())
            .collect();
        x
    } else {
        let (multi_cond, multi_params) = word_search_params(&query, 1, artist_cols);
        if !multi_cond.is_empty() {
            let sql = format!(
                "{} WHERE {} AND {} GROUP BY ta.artist_name ORDER BY ta.artist_name",
                base, blocked, multi_cond
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params_from_iter(multi_params.iter()), map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|a| a.ok())
                .collect();
            x
        } else {
            let pattern = format!("%{}%", query.to_lowercase());
            let sql = format!(
                "{} WHERE {} AND LOWER(ta.artist_name) LIKE ? GROUP BY ta.artist_name ORDER BY ta.artist_name",
                base, blocked
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(rusqlite::params![pattern], map_row)
                .map_err(|e| e.to_string())?
                .filter_map(|a| a.ok())
                .collect();
            x
        }
    };
    Ok(artists)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ArtistAlbum {
    pub album: String,
    pub year: Option<u32>,
    pub track_count: usize,
    pub cover_path: String,
    pub tracks: Vec<Track>,
}

#[tauri::command]
fn get_artist_details(state: State<DbState>, artist: String) -> Result<Vec<ArtistAlbum>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;

    // All albums this artist appears on (primary or featuring)
    let mut album_stmt = conn
        .prepare(
            "SELECT t.album, MIN(t.year), COUNT(*), MIN(t.path)
             FROM track_artists ta
             JOIN tracks t ON ta.track_path = t.path
             WHERE ta.artist_name = ?1
             GROUP BY t.album
             ORDER BY MIN(t.year), t.album",
        )
        .map_err(|e| e.to_string())?;

    let albums: Vec<(String, Option<u32>, usize, String)> = album_stmt
        .query_map(rusqlite::params![artist], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<u32>>(1)?,
                row.get::<_, i64>(2)? as usize,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|a| a.ok())
        .collect();

    let mut result = Vec::new();
    for (album_name, year, track_count, cover_path) in albums {
        let mut track_stmt = conn
            .prepare(
                "SELECT t.path, t.title, t.artist, t.album, t.album_artist, t.genre, t.year,
                        t.track_number, t.track_total, t.disc_number, t.disc_total,
                        t.duration_secs, t.bitrate, t.sample_rate, t.channels, t.file_size, t.mbid,
                        t.replay_gain_track, t.replay_gain_album
                 FROM track_artists ta
                 JOIN tracks t ON ta.track_path = t.path
                 WHERE ta.artist_name = ?1 AND t.album = ?2
                 ORDER BY t.disc_number, t.track_number",
            )
            .map_err(|e| e.to_string())?;

        let tracks: Vec<Track> = track_stmt
            .query_map(rusqlite::params![artist, album_name], |row| {
                Ok(Track {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    album_artist: row.get(4)?,
                    genre: row.get(5)?,
                    year: row.get(6)?,
                    track_number: row.get(7)?,
                    track_total: row.get(8)?,
                    disc_number: row.get(9)?,
                    disc_total: row.get(10)?,
                    duration_secs: row.get(11)?,
                    bitrate: row.get(12)?,
                    sample_rate: row.get(13)?,
                    channels: row.get(14)?,
                    file_size: row.get(15)?,
                    mbid: row.get(16)?,
                    replay_gain_track: row.get(17)?,
                    replay_gain_album: row.get(18)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|t| t.ok())
            .collect();

        result.push(ArtistAlbum {
            album: album_name,
            year,
            track_count,
            cover_path,
            tracks,
        });
    }
    Ok(result)
}

#[tauri::command]
fn search_genres(state: State<DbState>, query: String, sort_by: Option<String>) -> Result<Vec<Genre>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let order_clause = match sort_by.as_deref() {
        Some("count") => "ORDER BY track_count DESC",
        _ => "ORDER BY name COLLATE NOCASE",
    };
    let genres: Vec<Genre> = if query.is_empty() {
        let sql = format!(
            "SELECT genre as name, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks
             GROUP BY genre
             {}",
            order_clause
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| Ok(Genre {
            name: row.get(0)?,
            track_count: row.get::<_, i64>(1)? as usize,
            cover_path: row.get(2)?,
        })).map_err(|e| e.to_string())?;
        rows.filter_map(|g| g.ok()).collect()
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        let sql = format!(
            "SELECT genre as name, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks
             WHERE LOWER(genre) LIKE ?1
             GROUP BY genre
             {}",
            order_clause
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([&pattern], |row| Ok(Genre {
            name: row.get(0)?,
            track_count: row.get::<_, i64>(1)? as usize,
            cover_path: row.get(2)?,
        })).map_err(|e| e.to_string())?;
        rows.filter_map(|g| g.ok()).collect()
    };
    Ok(genres)
}

#[tauri::command]
fn get_genre_tracks(
    state: State<DbState>,
    genre: String,
    limit: usize,
    offset: usize,
) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT path, title, artist, album, album_artist, genre, year,
         track_number, track_total, disc_number, disc_total,
         duration_secs, bitrate, sample_rate, channels, file_size, mbid, replay_gain_track, replay_gain_album
         FROM tracks WHERE genre = ?1
         ORDER BY artist, album, track_number
         LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| e.to_string())?;
    let tracks = stmt
        .query_map(rusqlite::params![genre, limit, offset], |row| {
            Ok(Track {
                path: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                album_artist: row.get(4)?,
                genre: row.get(5)?,
                year: row.get(6)?,
                track_number: row.get(7)?,
                track_total: row.get(8)?,
                disc_number: row.get(9)?,
                disc_total: row.get(10)?,
                duration_secs: row.get(11)?,
                bitrate: row.get(12)?,
                sample_rate: row.get(13)?,
                channels: row.get(14)?,
                file_size: row.get(15)?,
                mbid: row.get(16)?,
                replay_gain_track: row.get(17)?,
                replay_gain_album: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|t| t.ok())
        .collect();
    Ok(tracks)
}

#[tauri::command]
fn clear_music_library(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    conn.execute_batch(
        "DELETE FROM tracks;
         DELETE FROM track_artists WHERE track_path NOT IN (SELECT path FROM tracks);"
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_books_library(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    conn.execute("DELETE FROM books", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_artwork_cache(app: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("artwork");
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn create_playlist(state: State<DbState>, name: String) -> Result<i64, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO playlists (name) VALUES (?1)", rusqlite::params![name])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_playlists(state: State<DbState>) -> Result<Vec<Playlist>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.id, p.name,
                COUNT(pt.track_path) as track_count,
                COALESCE(
                    (SELECT pt2.track_path FROM playlist_tracks pt2
                     WHERE pt2.playlist_id = p.id ORDER BY pt2.position LIMIT 1),
                    ''
                ) as cover_path,
                p.custom_cover
         FROM playlists p
         LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
         GROUP BY p.id
         ORDER BY p.created_at DESC"
    ).map_err(|e| e.to_string())?;
    let playlists = stmt.query_map([], |row| {
        Ok(Playlist {
            id: row.get(0)?,
            name: row.get(1)?,
            track_count: row.get::<_, i64>(2)? as usize,
            cover_path: row.get(3)?,
            custom_cover: row.get(4)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|p| p.ok())
    .collect();
    Ok(playlists)
}

#[tauri::command]
fn get_playlist_tracks(state: State<DbState>, playlist_id: i64) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT t.path, t.title, t.artist, t.album, t.album_artist, t.genre, t.year,
                t.track_number, t.track_total, t.disc_number, t.disc_total,
                t.duration_secs, t.bitrate, t.sample_rate, t.channels, t.file_size, t.mbid,
                t.replay_gain_track, t.replay_gain_album
         FROM playlist_tracks pt
         JOIN tracks t ON t.path = pt.track_path
         WHERE pt.playlist_id = ?1
         ORDER BY pt.position"
    ).map_err(|e| e.to_string())?;
    let tracks = stmt.query_map(rusqlite::params![playlist_id], |row| {
        Ok(Track {
            path: row.get(0)?, title: row.get(1)?, artist: row.get(2)?,
            album: row.get(3)?, album_artist: row.get(4)?, genre: row.get(5)?,
            year: row.get(6)?, track_number: row.get(7)?, track_total: row.get(8)?,
            disc_number: row.get(9)?, disc_total: row.get(10)?, duration_secs: row.get(11)?,
            bitrate: row.get(12)?, sample_rate: row.get(13)?, channels: row.get(14)?,
            file_size: row.get(15)?, mbid: row.get(16)?,
            replay_gain_track: row.get(17)?, replay_gain_album: row.get(18)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|t| t.ok())
    .collect();
    Ok(tracks)
}

#[tauri::command]
fn add_tracks_to_playlist(state: State<DbState>, playlist_id: i64, track_paths: Vec<String>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let max_pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
        rusqlite::params![playlist_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let mut pos = max_pos + 1;
    for path in &track_paths {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, ?2, ?3)",
            rusqlite::params![playlist_id, path, pos],
        );
        pos += 1;
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_from_playlist(state: State<DbState>, playlist_id: i64, track_path: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_path = ?2",
        rusqlite::params![playlist_id, track_path],
    ).map_err(|e| e.to_string())?;
    conn.execute_batch(&format!(
        "WITH ranked AS (
            SELECT track_path, (ROW_NUMBER() OVER (ORDER BY position)) - 1 AS new_pos
            FROM playlist_tracks WHERE playlist_id = {id}
         )
         UPDATE playlist_tracks SET position = (
             SELECT new_pos FROM ranked WHERE ranked.track_path = playlist_tracks.track_path
         ) WHERE playlist_id = {id}",
        id = playlist_id
    )).map_err(|e| e.to_string())?;
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reorder_playlist_track(
    state: State<DbState>,
    playlist_id: i64,
    track_path: String,
    new_position: i64,
) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let current_pos: i64 = conn.query_row(
        "SELECT position FROM playlist_tracks WHERE playlist_id = ?1 AND track_path = ?2",
        rusqlite::params![playlist_id, &track_path],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if current_pos == new_position { return Ok(()); }
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlist_tracks SET position = -1 WHERE playlist_id = ?1 AND track_path = ?2",
        rusqlite::params![playlist_id, &track_path],
    ).map_err(|e| e.to_string())?;
    if current_pos < new_position {
        conn.execute(
            "UPDATE playlist_tracks SET position = position - 1
             WHERE playlist_id = ?1 AND position > ?2 AND position <= ?3",
            rusqlite::params![playlist_id, current_pos, new_position],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE playlist_tracks SET position = position + 1
             WHERE playlist_id = ?1 AND position >= ?2 AND position < ?3",
            rusqlite::params![playlist_id, new_position, current_pos],
        ).map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE playlist_tracks SET position = ?2 WHERE playlist_id = ?1 AND track_path = ?3",
        rusqlite::params![playlist_id, new_position, &track_path],
    ).map_err(|e| e.to_string())?;
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_playlist(state: State<DbState>, playlist_id: i64) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", rusqlite::params![playlist_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", rusqlite::params![playlist_id])
        .map_err(|e| e.to_string())?;
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_playlist(state: State<DbState>, playlist_id: i64, name: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET name = ?1 WHERE id = ?2",
        rusqlite::params![name, playlist_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_playlist_cover(state: State<DbState>, playlist_id: i64, image_base64: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET custom_cover = ?1 WHERE id = ?2",
        rusqlite::params![image_base64, playlist_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Clone)]
struct LyricsResult {
    synced_lrc: Option<String>,
    plain_text: Option<String>,
    source: String,
}

fn read_embedded_lyrics(track_path: &str) -> Option<String> {
    let tagged = Probe::open(track_path).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    tag.get_string(&ItemKey::Lyrics).map(|s| s.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_lyrics(state: State<DbState>, track_path: String, text: String) -> Result<(), String> {
    // Detect LRC: at least one line matching [mm:ss.xx] or [mm:ss:xx]
    let is_lrc = text.lines().any(|l| {
        let l = l.trim();
        l.starts_with('[') && l.len() > 7
            && l[1..].chars().next().map_or(false, |c| c.is_ascii_digit())
            && (l.contains(':') && (l.contains('.') || l[1..].chars().filter(|&c| c == ':').count() >= 2))
    });
    let (synced_lrc, plain_text) = if is_lrc {
        (Some(text), None)
    } else {
        (None, Some(text))
    };
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO lyrics_cache (track_path, synced_lrc, plain_text, source, fetched_at)
         VALUES (?1, ?2, ?3, 'manual', ?4)",
        rusqlite::params![track_path, synced_lrc, plain_text, i64::MAX],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn store_lyrics(state: &State<'_, DbState>, track_path: &str, result: &LyricsResult) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    if let Ok(conn) = state.0.get() {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO lyrics_cache (track_path, synced_lrc, plain_text, source, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![track_path, result.synced_lrc, result.plain_text, result.source, now],
        );
    }
}

#[tauri::command]
fn clear_lyrics_cache(state: State<DbState>, track_path: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM lyrics_cache WHERE track_path = ?1", [&track_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_lyrics(
    state: State<'_, DbState>,
    track_path: String,
    artist: String,
    title: String,
    album: String,
    duration: u32,
) -> Result<LyricsResult, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // 1. Read whatever is in cache (may be fresh, stale, or absent)
    let cached: Option<(Option<String>, Option<String>, String, i64)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT synced_lrc, plain_text, source, fetched_at FROM lyrics_cache WHERE track_path = ?1",
            [&track_path],
            |row| Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            )),
        ).ok()
    };

    // Decide if the cached entry is still fresh enough to return as-is.
    // manual entries never expire; not_found retries after 7 days; found lyrics after 90 days.
    if let Some((ref synced_lrc, ref plain_text, ref source, fetched_at)) = cached {
        let ttl = if source == "manual" { i64::MAX } else if source == "not_found" { 7 * 86400 } else { 90 * 86400 };
        if source == "manual" || now - fetched_at < ttl {
            return Ok(LyricsResult {
                synced_lrc: synced_lrc.clone(),
                plain_text: plain_text.clone(),
                source: source.clone(),
            });
        }
    }

    // Cache is stale or absent — try to get fresh lyrics.
    // Helper: does this result actually contain lyrics?
    let has_lyrics = |r: &LyricsResult| r.synced_lrc.is_some() || r.plain_text.is_some();

    // 2. Try embedded tag
    if let Some(lyrics_text) = read_embedded_lyrics(&track_path) {
        let result = LyricsResult {
            synced_lrc: None,
            plain_text: Some(lyrics_text),
            source: "embedded".to_string(),
        };
        store_lyrics(&state, &track_path, &result);
        return Ok(result);
    }

    // Normalize artist: split on common separators, drop "Various Artists" / "VA",
    // take the first real name. Handles tags like "Don Omar / Tego Calderón / Various Artists".
    let search_artist = {
        let skip = ["various artists", "various", "va", "unknown artist", "unknown"];
        artist
            .split([';', '/', ',', '&'])
            .map(|s| s.trim())
            .find(|s| !s.is_empty() && !skip.contains(&s.to_lowercase().as_str()))
            .unwrap_or(artist.trim())
            .to_string()
    };

    // 3. Fetch from LRCLIB — strict lookup first, fuzzy search as fallback
    let fetch_result: Option<LyricsResult> = async {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LrclibTrack {
            duration: Option<f64>,
            synced_lyrics: Option<String>,
            plain_lyrics: Option<String>,
        }

        let client = reqwest::Client::builder()
            .user_agent("Libera/1.0 (music player)")
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .ok()?;

        // Try /api/get: exact match on artist + title + album + duration
        let get_url = format!(
            "https://lrclib.net/api/get?artist_name={}&track_name={}&album_name={}&duration={}",
            urlencoding::encode(&search_artist),
            urlencoding::encode(&title),
            urlencoding::encode(&album),
            duration,
        );
        if let Ok(resp) = client.get(&get_url).send().await {
            if resp.status().is_success() {
                if let Ok(body) = resp.json::<LrclibTrack>().await {
                    if body.synced_lyrics.is_some() || body.plain_lyrics.is_some() {
                        return Some(LyricsResult {
                            synced_lrc: body.synced_lyrics,
                            plain_text: body.plain_lyrics,
                            source: "lrclib".to_string(),
                        });
                    }
                }
            }
        }

        // Fall back to /api/search: fuzzy match on artist + title only,
        // pick the result with lyrics whose duration is closest to the track's.
        let search_url = format!(
            "https://lrclib.net/api/search?artist_name={}&track_name={}",
            urlencoding::encode(&search_artist),
            urlencoding::encode(&title),
        );
        let resp = client.get(&search_url).send().await.ok()?;
        if !resp.status().is_success() { return None; }
        let items = resp.json::<Vec<LrclibTrack>>().await.ok()?;
        let best = items.into_iter()
            .filter(|i| i.synced_lyrics.is_some() || i.plain_lyrics.is_some())
            .min_by_key(|i| {
                i.duration
                    .map(|d| (d - duration as f64).abs() as u64)
                    .unwrap_or(u64::MAX)
            })?;
        Some(LyricsResult {
            synced_lrc: best.synced_lyrics,
            plain_text: best.plain_lyrics,
            source: "lrclib".to_string(),
        })
    }.await;

    match fetch_result {
        // Got a real response from LRCLIB — store it regardless (even if both fields are null,
        // that means the track is known to be instrumental).
        Some(fresh) => {
            store_lyrics(&state, &track_path, &fresh);
            Ok(fresh)
        }
        // Network error, timeout, or bad JSON — never overwrite existing lyrics.
        // If we had stale lyrics, return them and just bump fetched_at so we
        // don't hammer the network on every play.
        None => {
            if let Some((synced_lrc, plain_text, source, _)) = cached {
                if has_lyrics(&LyricsResult { synced_lrc: synced_lrc.clone(), plain_text: plain_text.clone(), source: source.clone() }) {
                    // Bump fetched_at to avoid retrying until the TTL passes again
                    if let Ok(conn) = state.0.get() {
                        let _ = conn.execute(
                            "UPDATE lyrics_cache SET fetched_at = ?1 WHERE track_path = ?2",
                            rusqlite::params![now, &track_path],
                        );
                    }
                    return Ok(LyricsResult { synced_lrc, plain_text, source });
                }
            }
            // No prior lyrics and network failed — store not_found with short TTL
            let not_found = LyricsResult { synced_lrc: None, plain_text: None, source: "not_found".to_string() };
            store_lyrics(&state, &track_path, &not_found);
            Ok(not_found)
        }
    }
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // dbus-send for nautilus or fallback to parent folder
        let parent = std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_path_with_shell(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cancel_metadata_fetch(control: State<MetadataFetchControl>) {
    control.cancelled.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn fetch_missing_metadata(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    control: State<'_, MetadataFetchControl>,
) -> Result<(), String> {
    control.cancelled.store(false, Ordering::Relaxed);

    #[derive(Deserialize)]
    struct MbTag { name: String, count: i32 }
    #[derive(Deserialize)]
    struct MbRecording {
        #[serde(rename = "first-release-date")]
        first_release_date: Option<String>,
        tags: Option<Vec<MbTag>>,
    }
    #[derive(Deserialize)]
    struct MbResponse { recordings: Vec<MbRecording> }

    struct TrackChange {
        artist: String,
        title: String,
        old_year: Option<i32>,
        new_year: Option<i32>,
        old_genre: String,
        new_genre: Option<String>,
    }

    // Collect tracks that are missing year or genre, along with current values
    let tracks: Vec<(String, String, String, Option<i32>, String)> = {
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare(
            "SELECT path, title, artist, year, COALESCE(genre, '') FROM tracks
             WHERE (year IS NULL OR year = 0 OR genre = '' OR genre IS NULL)"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, String, Option<i32>, String)> = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i32>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
        rows
    };

    let total = tracks.len();
    let _ = app.emit("metadata://started", serde_json::json!({ "total": total }));

    let client = reqwest::Client::builder()
        .user_agent("Libera/1.0 (music player)")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut updated = 0usize;
    let mut not_found = 0usize;
    let mut skipped = 0usize;
    let mut changes: Vec<TrackChange> = Vec::new();

    let write_report = |changes: &Vec<TrackChange>, updated: usize, not_found: usize, skipped: usize, cancelled: bool, total: usize| -> Option<String> {
        let log_dir = dirs::data_dir()?.join("libera");
        fs::create_dir_all(&log_dir).ok()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let log_path = log_dir.join(format!("metadata_fetch_{}.txt", now));

        use std::fmt::Write as FmtWrite;
        let mut out = String::new();
        let _ = writeln!(out, "Libera — Metadata Fetch Report");
        let _ = writeln!(out, "Status:    {}", if cancelled { "Cancelled" } else { "Completed" });
        let _ = writeln!(out, "Scanned:   {}", total);
        let _ = writeln!(out, "Updated:   {}", updated);
        let _ = writeln!(out, "Not found: {}", not_found);
        let _ = writeln!(out, "Skipped:   {}", skipped);

        if !changes.is_empty() {
            let _ = writeln!(out, "\n────────────────────────────────────────");
            let _ = writeln!(out, "UPDATED TRACKS");
            let _ = writeln!(out, "────────────────────────────────────────");
            for c in changes {
                let _ = writeln!(out, "\n{} — {}", c.artist, c.title);
                if c.old_year != c.new_year {
                    let old = c.old_year.map(|y| y.to_string()).unwrap_or_else(|| "—".into());
                    let new = c.new_year.map(|y| y.to_string()).unwrap_or_else(|| "—".into());
                    let _ = writeln!(out, "  year:  {} → {}", old, new);
                }
                if c.new_genre.is_some() && c.old_genre.is_empty() {
                    let _ = writeln!(out, "  genre: — → {}", c.new_genre.as_deref().unwrap_or(""));
                }
            }
        }

        fs::write(&log_path, out).ok()?;
        log_path.to_str().map(|s| s.to_string())
    };

    for (i, (path, title, artist, old_year, old_genre)) in tracks.iter().enumerate() {
        if control.cancelled.load(Ordering::Relaxed) {
            let log_path = write_report(&changes, updated, not_found, skipped, true, total);
            let _ = app.emit("metadata://cancelled", serde_json::json!({ "updated": updated, "log_path": log_path }));
            return Ok(());
        }

        let _ = app.emit("metadata://progress", serde_json::json!({
            "completed": i, "total": total, "current": title, "updated": updated
        }));

        if title.is_empty() || artist.is_empty()
            || title.eq_ignore_ascii_case("unknown")
            || artist.eq_ignore_ascii_case("unknown artist")
        {
            skipped += 1;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        }

        let query = format!(
            "recording:\"{}\" AND artist:\"{}\"",
            title.replace('"', ""),
            artist.replace('"', ""),
        );
        let url = format!(
            "https://musicbrainz.org/ws/2/recording/?query={}&limit=1&fmt=json&inc=tags",
            urlencoding::encode(&query),
        );

        let mb_result: Option<MbRecording> = match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.json::<MbResponse>().await.ok()
                    .and_then(|mut r| if r.recordings.is_empty() { None } else { Some(r.recordings.remove(0)) })
            }
            _ => None,
        };

        if let Some(rec) = mb_result {
            let new_year: Option<i32> = rec.first_release_date
                .as_deref()
                .and_then(|d| d.get(..4))
                .and_then(|y| y.parse().ok());

            let new_genre: Option<String> = rec.tags.as_ref().and_then(|tags| {
                tags.iter().max_by_key(|t| t.count).map(|t| t.name.clone())
            });

            let year_changed = new_year.is_some() && (old_year.is_none() || *old_year == Some(0));
            let genre_changed = new_genre.is_some() && old_genre.is_empty();

            if year_changed || genre_changed {
                let conn = state.0.get().map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE tracks SET
                        year  = CASE WHEN (year  IS NULL OR year  = 0)  AND ?2 IS NOT NULL THEN ?2 ELSE year  END,
                        genre = CASE WHEN (genre IS NULL OR genre = '') AND ?3 IS NOT NULL THEN ?3 ELSE genre END
                     WHERE path = ?1",
                    rusqlite::params![path, new_year, new_genre],
                ).unwrap_or(0);

                changes.push(TrackChange {
                    artist: artist.clone(),
                    title: title.clone(),
                    old_year: *old_year,
                    new_year: if year_changed { new_year } else { *old_year },
                    old_genre: old_genre.clone(),
                    new_genre: if genre_changed { new_genre } else { None },
                });
                updated += 1;
            } else {
                not_found += 1;
            }
        } else {
            not_found += 1;
        }

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }

    let log_path = write_report(&changes, updated, not_found, skipped, false, total);
    let _ = app.emit("metadata://done", serde_json::json!({ "total": total, "updated": updated, "log_path": log_path }));
    Ok(())
}

// ─── Photo Section ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Photo {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: u64,
    pub date_taken: Option<i64>,
    pub date_modified: Option<i64>,
    pub is_favorite: bool,
    pub orientation: u32,
    pub camera: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub rating: u32,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PhotoAlbum {
    pub name: String,
    pub folder_path: String,
    pub count: i64,
    pub cover_path: Option<String>,
    pub cover_paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PhotoMetadata {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: u64,
    pub date_taken: Option<i64>,
    pub date_modified: Option<i64>,
    pub is_favorite: bool,
    pub orientation: u32,
    pub camera: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    // EXIF technical data
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub iso: Option<u32>,
    pub focal_length: Option<f64>,
    pub lens: Option<String>,
    pub exposure_bias: Option<f64>,
    pub flash: Option<String>,
}

const PHOTO_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif",
];

fn parse_exif_datetime(s: &str) -> Option<i64> {
    if s.len() < 19 { return None; }
    let year: i64 = s[0..4].parse().ok()?;
    let month: i64 = s[5..7].parse().ok()?;
    let day: i64 = s[8..10].parse().ok()?;
    let hour: i64 = s[11..13].parse().ok()?;
    let min: i64 = s[14..16].parse().ok()?;
    let sec: i64 = s[17..19].parse().ok()?;
    if year < 1970 || month == 0 || month > 12 || day == 0 { return None; }
    let is_leap = |y: i64| (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    let days_in_month = [31i64, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut days = 0i64;
    for y in 1970..year { days += if is_leap(y) { 366 } else { 365 }; }
    for m in 0..(month - 1) as usize {
        days += days_in_month[m];
        if m == 1 && is_leap(year) { days += 1; }
    }
    days += day - 1;
    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}

struct ExifExtra {
    aperture: Option<f64>,
    shutter_speed: Option<String>,
    iso: Option<u32>,
    focal_length: Option<f64>,
    lens: Option<String>,
    exposure_bias: Option<f64>,
    flash: Option<String>,
}

fn read_exif_extra(path: &PathBuf) -> ExifExtra {
    let Ok(file) = fs::File::open(path) else {
        return ExifExtra { aperture: None, shutter_speed: None, iso: None, focal_length: None, lens: None, exposure_bias: None, flash: None };
    };
    let mut reader = std::io::BufReader::new(file);
    let Ok(exif_data) = exif::Reader::new().read_from_container(&mut reader) else {
        return ExifExtra { aperture: None, shutter_speed: None, iso: None, focal_length: None, lens: None, exposure_bias: None, flash: None };
    };
    let mut aperture: Option<f64> = None;
    let mut shutter_speed: Option<String> = None;
    let mut iso: Option<u32> = None;
    let mut focal_length: Option<f64> = None;
    let mut lens: Option<String> = None;
    let mut exposure_bias: Option<f64> = None;
    let mut flash: Option<String> = None;

    for field in exif_data.fields() {
        match field.tag {
            exif::Tag::FNumber => {
                if let exif::Value::Rational(ref v) = field.value {
                    if let Some(r) = v.first() {
                        if r.denom != 0 { aperture = Some(r.num as f64 / r.denom as f64); }
                    }
                }
            }
            exif::Tag::ExposureTime => {
                if let exif::Value::Rational(ref v) = field.value {
                    if let Some(r) = v.first() {
                        if r.num == 0 { shutter_speed = Some("0s".to_string()); }
                        else if r.denom > r.num {
                            let d = (r.denom as f64 / r.num as f64).round() as u64;
                            shutter_speed = Some(format!("1/{}", d));
                        } else {
                            shutter_speed = Some(format!("{}s", r.num as f64 / r.denom as f64));
                        }
                    }
                }
            }
            exif::Tag::PhotographicSensitivity => {
                if let exif::Value::Short(ref v) = field.value {
                    if let Some(&i) = v.first() { iso = Some(i as u32); }
                }
            }
            exif::Tag::FocalLength => {
                if let exif::Value::Rational(ref v) = field.value {
                    if let Some(r) = v.first() {
                        if r.denom != 0 { focal_length = Some(r.num as f64 / r.denom as f64); }
                    }
                }
            }
            exif::Tag::LensModel => {
                let s = field.display_value().to_string().trim_matches('"').to_string();
                if !s.is_empty() { lens = Some(s); }
            }
            exif::Tag::ExposureBiasValue => {
                if let exif::Value::Rational(ref v) = field.value {
                    if let Some(r) = v.first() {
                        if r.denom != 0 { exposure_bias = Some(r.num as f64 / r.denom as f64); }
                    }
                } else if let exif::Value::SRational(ref v) = field.value {
                    if let Some(r) = v.first() {
                        if r.denom != 0 { exposure_bias = Some(r.num as f64 / r.denom as f64); }
                    }
                }
            }
            exif::Tag::Flash => {
                let s = field.display_value().to_string().trim_matches('"').to_string();
                if !s.is_empty() { flash = Some(s); }
            }
            _ => {}
        }
    }
    ExifExtra { aperture, shutter_speed, iso, focal_length, lens, exposure_bias, flash }
}

// Returns (date_taken, orientation, camera, gps_lat, gps_lon, pixel_width, pixel_height).
// pixel_width/height come from ExifIFD PixelXDimension/PixelYDimension so we can skip a
// second file-open in read_photo_metadata for JPEGs that carry these tags.
fn read_jpeg_exif_data(path: &PathBuf) -> (Option<i64>, u32, Option<String>, Option<f64>, Option<f64>, Option<u32>, Option<u32>) {
    let Ok(file) = fs::File::open(path) else { return (None, 1, None, None, None, None, None); };
    let mut reader = std::io::BufReader::new(file);
    match exif::Reader::new().read_from_container(&mut reader) {
        Ok(exif_data) => {
            let mut date_taken: Option<i64> = None;
            let mut orientation: u32 = 1;
            let mut camera: Option<String> = None;
            let mut gps_lat: Option<f64> = None;
            let mut gps_lon: Option<f64> = None;
            let mut pixel_width: Option<u32> = None;
            let mut pixel_height: Option<u32> = None;

            for field in exif_data.fields() {
                match field.tag {
                    exif::Tag::DateTimeOriginal | exif::Tag::DateTime => {
                        if date_taken.is_none() {
                            let s = field.display_value().to_string();
                            date_taken = parse_exif_datetime(&s);
                        }
                    }
                    exif::Tag::Orientation => {
                        if let exif::Value::Short(ref v) = field.value {
                            if let Some(&o) = v.first() { orientation = o as u32; }
                        }
                    }
                    exif::Tag::Make => {
                        let make = field.display_value().to_string().trim_matches('"').to_string();
                        camera = Some(make);
                    }
                    exif::Tag::Model => {
                        let model = field.display_value().to_string().trim_matches('"').to_string();
                        if let Some(ref make) = camera.clone() {
                            if !model.to_lowercase().contains(&make.to_lowercase()) {
                                camera = Some(format!("{} {}", make, model));
                            } else {
                                camera = Some(model);
                            }
                        } else {
                            camera = Some(model);
                        }
                    }
                    exif::Tag::PixelXDimension => {
                        match &field.value {
                            exif::Value::Long(v) => { if let Some(&d) = v.first() { pixel_width = Some(d); } }
                            exif::Value::Short(v) => { if let Some(&d) = v.first() { pixel_width = Some(d as u32); } }
                            _ => {}
                        }
                    }
                    exif::Tag::PixelYDimension => {
                        match &field.value {
                            exif::Value::Long(v) => { if let Some(&d) = v.first() { pixel_height = Some(d); } }
                            exif::Value::Short(v) => { if let Some(&d) = v.first() { pixel_height = Some(d as u32); } }
                            _ => {}
                        }
                    }
                    exif::Tag::GPSLatitude => {
                        if let exif::Value::Rational(ref v) = field.value {
                            if v.len() >= 3 {
                                let d = v[0].num as f64 / v[0].denom as f64;
                                let m = v[1].num as f64 / v[1].denom as f64;
                                let s = v[2].num as f64 / v[2].denom as f64;
                                gps_lat = Some(d + m / 60.0 + s / 3600.0);
                            }
                        }
                    }
                    exif::Tag::GPSLatitudeRef => {
                        if field.display_value().to_string().contains('S') {
                            gps_lat = gps_lat.map(|v| -v.abs());
                        }
                    }
                    exif::Tag::GPSLongitude => {
                        if let exif::Value::Rational(ref v) = field.value {
                            if v.len() >= 3 {
                                let d = v[0].num as f64 / v[0].denom as f64;
                                let m = v[1].num as f64 / v[1].denom as f64;
                                let s = v[2].num as f64 / v[2].denom as f64;
                                gps_lon = Some(d + m / 60.0 + s / 3600.0);
                            }
                        }
                    }
                    exif::Tag::GPSLongitudeRef => {
                        if field.display_value().to_string().contains('W') {
                            gps_lon = gps_lon.map(|v| -v.abs());
                        }
                    }
                    _ => {}
                }
            }
            (date_taken, orientation, camera, gps_lat, gps_lon, pixel_width, pixel_height)
        }
        Err(_) => (None, 1, None, None, None, None, None),
    }
}

fn photo_path_hash(path: &str) -> String {
    format!("{:x}", md5_simple(path))
}

fn read_photo_metadata(path: &PathBuf) -> Option<Photo> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if !PHOTO_EXTS.contains(&ext.as_str()) { return None; }
    let name = path.file_name()?.to_string_lossy().to_string();
    let folder = path.parent()?.to_string_lossy().to_string();
    let meta = fs::metadata(path).ok()?;
    let file_size = meta.len();
    let date_modified = meta.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    // For JPEG/TIFF: read EXIF once — it often contains PixelXDimension/PixelYDimension,
    // saving a second file open.  For other formats: skip EXIF, read header only.
    let (date_taken, orientation, camera, gps_lat, gps_lon, exif_w, exif_h) =
        if ext == "jpg" || ext == "jpeg" || ext == "tiff" || ext == "tif" {
            read_jpeg_exif_data(path)
        } else {
            (None, 1u32, None, None, None, None, None)
        };

    // Use EXIF pixel dimensions when present. Skip image::image_dimensions for non-JPEG or
    // JPEG without EXIF dims — opening the file at scan scale causes I/O pressure and OOM.
    let (width, height) = (exif_w, exif_h);

    Some(Photo {
        path: path.to_string_lossy().to_string(),
        name,
        folder,
        format: ext,
        width,
        height,
        file_size,
        date_taken,
        date_modified,
        is_favorite: false,
        orientation,
        camera,
        gps_lat,
        gps_lon,
        rating: 0,
    })
}

#[tauri::command]
fn scan_photos(path: String) -> Result<Vec<Photo>, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("Folder not found: {}", path));
    }
    // Collect paths first, then process in parallel with rayon
    let file_paths: Vec<PathBuf> = WalkDir::new(&folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.path().to_path_buf();
            let ext = p.extension()?.to_str()?.to_lowercase();
            if PHOTO_EXTS.contains(&ext.as_str()) { Some(p) } else { None }
        })
        .collect();
    let photos = file_paths.par_iter()
        .filter_map(|p| read_photo_metadata(p))
        .collect();
    Ok(photos)
}

#[tauri::command]
fn save_photos(state: State<DbState>, photos: Vec<Photo>) -> Result<usize, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let mut saved = 0usize;
    for p in &photos {
        let res = conn.execute(
            "INSERT OR IGNORE INTO photos
                (path, name, folder, format, width, height, file_size,
                 date_taken, date_modified, is_favorite, orientation, camera, gps_lat, gps_lon)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13)",
            rusqlite::params![
                p.path, p.name, p.folder, p.format,
                p.width, p.height, p.file_size as i64,
                p.date_taken, p.date_modified,
                p.orientation, p.camera, p.gps_lat, p.gps_lon,
            ],
        );
        if res.is_ok() { saved += 1; }
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(saved)
}

/// Parallel scan + incremental save with progress events.
/// Replaces the two-round-trip (scan_photos → save_photos) pattern:
///   • walks the folder and collects file paths (fast, sequential)
///   • processes metadata in parallel using rayon (multi-core)
///   • saves in batches of 200 so the DB is populated incrementally
///   • emits "photos://scan-progress" events after each batch
///   • returns only the saved count — no giant IPC payload
#[tauri::command]
fn scan_and_save_photos(
    app: tauri::AppHandle,
    state: State<DbState>,
    path: String,
) -> Result<usize, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("Folder not found: {}", path));
    }

    // Collect candidate file paths (sequential walk — fast)
    let file_paths: Vec<PathBuf> = WalkDir::new(&folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.path().to_path_buf();
            let ext = p.extension()?.to_str()?.to_lowercase();
            if PHOTO_EXTS.contains(&ext.as_str()) { Some(p) } else { None }
        })
        .collect();

    let total = file_paths.len();
    let _ = app.emit("photos://scan-progress", serde_json::json!({
        "scanned": 0, "total": total, "saved": 0
    }));

    if total == 0 {
        return Ok(0);
    }

    // Bounded pool: limits concurrent file opens to prevent I/O storm and OOM on large imports.
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .map_err(|e| e.to_string())?;

    const BATCH: usize = 100;
    let mut saved_total = 0usize;
    let mut scanned_total = 0usize;

    for chunk in file_paths.chunks(BATCH) {
        // Parallel metadata extraction within this chunk using bounded pool
        let photos: Vec<Photo> = pool.install(|| {
            chunk.par_iter()
                .filter_map(|p| read_photo_metadata(p))
                .collect()
        });

        scanned_total += chunk.len();

        // Batch save to DB under a single transaction
        let conn = state.0.get().map_err(|e| e.to_string())?;
        let _ = conn.execute_batch("BEGIN");
        for p in &photos {
            let res = conn.execute(
                "INSERT OR IGNORE INTO photos
                    (path, name, folder, format, width, height, file_size,
                     date_taken, date_modified, is_favorite, orientation, camera, gps_lat, gps_lon)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13)",
                rusqlite::params![
                    p.path, p.name, p.folder, p.format,
                    p.width, p.height, p.file_size as i64,
                    p.date_taken, p.date_modified,
                    p.orientation, p.camera, p.gps_lat, p.gps_lon,
                ],
            );
            if res.is_ok() { saved_total += 1; }
        }
        let _ = conn.execute_batch("COMMIT");

        // Notify the frontend so it can refresh the grid incrementally
        let _ = app.emit("photos://scan-progress", serde_json::json!({
            "scanned": scanned_total,
            "total": total,
            "saved": saved_total
        }));
    }

    Ok(saved_total)
}

fn build_photo_where(
    query: &str,
    format_filter: &Option<String>,
    year_filter: &Option<i32>,
    month_filter: &Option<i32>,
    album_filter: &Option<String>,
    camera_filter: &Option<String>,
    favorites_only: bool,
    min_rating: Option<u32>,
) -> (String, Vec<String>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();

    if favorites_only { conditions.push("is_favorite = 1".to_string()); }
    if let Some(r) = min_rating {
        if r > 0 {
            conditions.push("rating = ?".to_string());
            params.push(r.to_string());
        }
    }

    if let Some(fmt) = format_filter {
        conditions.push("format = ?".to_string());
        params.push(fmt.clone());
    }

    if let Some(folder) = album_filter {
        conditions.push("folder = ?".to_string());
        params.push(folder.clone());
    }

    if let Some(cam) = camera_filter {
        conditions.push("camera = ?".to_string());
        params.push(cam.clone());
    }

    if let Some(y) = year_filter {
        conditions.push("strftime('%Y', datetime(date_taken, 'unixepoch')) = ?".to_string());
        params.push(y.to_string());
    }

    if let Some(m) = month_filter {
        conditions.push("strftime('%m', datetime(date_taken, 'unixepoch')) = ?".to_string());
        params.push(format!("{:02}", m));
    }

    if !query.is_empty() {
        conditions.push("(LOWER(name) LIKE ? OR LOWER(folder) LIKE ? OR LOWER(COALESCE(camera,'')) LIKE ?)".to_string());
        let pat = format!("%{}%", query.to_lowercase());
        params.push(pat.clone());
        params.push(pat.clone());
        params.push(pat);
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    (where_clause, params)
}

#[tauri::command]
fn get_photos_count(
    state: State<DbState>,
    query: String,
    format_filter: Option<String>,
    year_filter: Option<i32>,
    month_filter: Option<i32>,
    album_filter: Option<String>,
    camera_filter: Option<String>,
    favorites_only: bool,
    tag_filter: Option<String>,
    min_rating: Option<u32>,
) -> Result<usize, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (where_clause, params) = build_photo_where(
        &query, &format_filter, &year_filter, &month_filter, &album_filter, &camera_filter, favorites_only, min_rating,
    );
    let sql = if tag_filter.is_some() {
        format!(
            "SELECT COUNT(*) FROM photos p WHERE p.path IN (SELECT photo_path FROM photo_tags WHERE tag = ?) {}",
            if where_clause.is_empty() { String::new() } else { format!("AND {}", &where_clause[6..]) }
        )
    } else {
        format!("SELECT COUNT(*) FROM photos {}", where_clause)
    };

    let count: usize = if let Some(ref tag) = tag_filter {
        let mut all_params: Vec<String> = vec![tag.clone()];
        all_params.extend(params);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params_from_iter(all_params.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?
    } else {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params_from_iter(params.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?
    };
    Ok(count)
}

#[tauri::command]
fn get_photos_page(
    state: State<DbState>,
    query: String,
    sort_by: Option<String>,
    format_filter: Option<String>,
    year_filter: Option<i32>,
    month_filter: Option<i32>,
    album_filter: Option<String>,
    camera_filter: Option<String>,
    favorites_only: bool,
    tag_filter: Option<String>,
    limit: i64,
    offset: i64,
    min_rating: Option<u32>,
) -> Result<Vec<Photo>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let order = match sort_by.as_deref() {
        Some("name_asc")     => "ORDER BY LOWER(name) ASC",
        Some("name_desc")    => "ORDER BY LOWER(name) DESC",
        Some("size_asc")     => "ORDER BY file_size ASC",
        Some("size_desc")    => "ORDER BY file_size DESC",
        Some("date_asc")     => "ORDER BY COALESCE(date_taken, date_modified) ASC NULLS LAST",
        Some("rating_desc")  => "ORDER BY rating DESC, COALESCE(date_taken, date_modified) DESC NULLS LAST",
        Some("rating_asc")   => "ORDER BY rating ASC, COALESCE(date_taken, date_modified) DESC NULLS LAST",
        _                    => "ORDER BY COALESCE(date_taken, date_modified) DESC NULLS LAST",
    };

    let (where_clause, mut params) = build_photo_where(
        &query, &format_filter, &year_filter, &month_filter, &album_filter, &camera_filter, favorites_only, min_rating,
    );

    let sql = if tag_filter.is_some() {
        format!(
            "SELECT path,name,folder,format,width,height,file_size,date_taken,date_modified,is_favorite,orientation,camera,gps_lat,gps_lon,rating
             FROM photos WHERE path IN (SELECT photo_path FROM photo_tags WHERE tag = ?) {} {} LIMIT ? OFFSET ?",
            if where_clause.is_empty() { String::new() } else { format!("AND {}", &where_clause[6..]) },
            order
        )
    } else {
        format!(
            "SELECT path,name,folder,format,width,height,file_size,date_taken,date_modified,is_favorite,orientation,camera,gps_lat,gps_lon,rating
             FROM photos {} {} LIMIT ? OFFSET ?",
            where_clause, order
        )
    };

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<Photo> {
        Ok(Photo {
            path: row.get(0)?,
            name: row.get(1)?,
            folder: row.get(2)?,
            format: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            file_size: row.get::<_, i64>(6)? as u64,
            date_taken: row.get(7)?,
            date_modified: row.get(8)?,
            is_favorite: row.get::<_, i64>(9)? != 0,
            orientation: row.get::<_, i64>(10)? as u32,
            camera: row.get(11)?,
            gps_lat: row.get(12)?,
            gps_lon: row.get(13)?,
            rating: row.get::<_, i64>(14).unwrap_or(0) as u32,
        })
    };

    let photos: Vec<Photo> = if let Some(ref tag) = tag_filter {
        let mut all_params: Vec<String> = vec![tag.clone()];
        all_params.extend(params);
        all_params.push(limit.to_string());
        all_params.push(offset.to_string());
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params_from_iter(all_params.iter()), map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        params.push(limit.to_string());
        params.push(offset.to_string());
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    Ok(photos)
}

#[tauri::command]
fn get_photo_albums(state: State<DbState>) -> Result<Vec<PhotoAlbum>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT folder, COUNT(*) as count
         FROM photos
         GROUP BY folder
         ORDER BY folder COLLATE NOCASE"
    ).map_err(|e| e.to_string())?;
    let mut albums: Vec<PhotoAlbum> = stmt.query_map([], |row| {
        let folder_path: String = row.get(0)?;
        let count: i64 = row.get(1)?;
        let name = PathBuf::from(&folder_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| folder_path.clone());
        Ok(PhotoAlbum { name, folder_path, count, cover_path: None, cover_paths: vec![] })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|a| a.ok())
    .collect();

    // Fetch up to 4 representative cover paths per album
    for album in &mut albums {
        let mut cov_stmt = conn.prepare(
            "SELECT path FROM photos WHERE folder = ?1
             ORDER BY COALESCE(date_taken, date_modified) DESC NULLS LAST LIMIT 4"
        ).map_err(|e| e.to_string())?;
        let paths: Vec<String> = cov_stmt.query_map(rusqlite::params![album.folder_path], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        album.cover_path = paths.first().cloned();
        album.cover_paths = paths;
    }
    Ok(albums)
}

/// Extract the JPEG thumbnail embedded in the EXIF APP1 segment of a JPEG file.
/// Modern phone photos always contain one — typically 160×120 or 320×240 px.
/// Reads at most 128 KB from the start of the file, so it returns in < 5 ms.
/// This is exactly how Windows Explorer shows thumbnails instantly.
fn extract_jpeg_exif_thumbnail(path: &PathBuf) -> Option<Vec<u8>> {
    let file = fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let mut data = Vec::new();
    reader.take(131_072).read_to_end(&mut data).ok()?;

    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 { return None; }

    let mut pos = 2usize;
    while pos + 3 < data.len() {
        if data[pos] != 0xFF { return None; }
        let marker = data[pos + 1];
        if pos + 4 > data.len() { return None; }
        let seg_len = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
        if seg_len < 2 { return None; }
        let seg_end = pos + 2 + seg_len;
        if seg_end > data.len() { return None; }

        if marker == 0xE1 && seg_len >= 8 {
            // APP1 — check for "Exif\0\0" magic
            if data.get(pos + 4..pos + 10) == Some(b"Exif\0\0") {
                let tiff_start = pos + 10;
                if tiff_start < seg_end {
                    if let Some(bytes) = parse_ifd1_jpeg_thumbnail(&data[tiff_start..seg_end]) {
                        return Some(bytes);
                    }
                }
            }
        }
        // Stop before actual image data markers
        if matches!(marker, 0xDB | 0xC0 | 0xC4 | 0xDA) { break; }
        pos = seg_end;
    }
    None
}

/// Parse the IFD1 (thumbnail) section of a TIFF/EXIF block and return the raw JPEG bytes.
fn parse_ifd1_jpeg_thumbnail(tiff: &[u8]) -> Option<Vec<u8>> {
    if tiff.len() < 8 { return None; }
    let le = match tiff.get(..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let r16 = |off: usize| -> Option<u16> {
        let b: [u8; 2] = tiff.get(off..off + 2)?.try_into().ok()?;
        Some(if le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) })
    };
    let r32 = |off: usize| -> Option<u32> {
        let b: [u8; 4] = tiff.get(off..off + 4)?.try_into().ok()?;
        Some(if le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
    };

    // IFD0 offset (bytes 4–7) → skip to its end to find the IFD1 pointer
    let ifd0_off = r32(4)? as usize;
    if ifd0_off + 2 > tiff.len() { return None; }
    let ifd0_count = r16(ifd0_off)? as usize;
    let ifd1_ptr = ifd0_off + 2 + ifd0_count * 12;
    let ifd1_off = r32(ifd1_ptr)? as usize;
    if ifd1_off == 0 || ifd1_off + 2 > tiff.len() { return None; }

    let ifd1_count = r16(ifd1_off)? as usize;
    let mut thumb_off: Option<usize> = None;
    let mut thumb_len: Option<usize> = None;

    for i in 0..ifd1_count {
        let e = ifd1_off + 2 + i * 12;
        if e + 12 > tiff.len() { break; }
        match r16(e)? {
            0x0201 => { thumb_off = r32(e + 8).map(|v| v as usize); } // JPEGInterchangeFormat
            0x0202 => { thumb_len = r32(e + 8).map(|v| v as usize); } // JPEGInterchangeFormatLength
            _ => {}
        }
    }

    let off = thumb_off?;
    let len = thumb_len?;
    if len < 4 { return None; }
    let end = off.checked_add(len)?;
    if end > tiff.len() { return None; }
    let bytes = &tiff[off..end];
    // Verify JPEG SOI marker
    if bytes[0] != 0xFF || bytes[1] != 0xD8 { return None; }
    Some(bytes.to_vec())
}

#[tauri::command]
async fn get_photo_thumbnail(
    app: tauri::AppHandle,
    sem: State<'_, ThumbSemaphore>,
    path: String,
) -> Result<Option<String>, String> {
    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("photo-thumbs2");
    let _ = fs::create_dir_all(&cache_dir);
    let hash = photo_path_hash(&path);
    let cache_path = cache_dir.join(format!("{}.jpg", hash));

    // Tier 1: already cached
    if cache_path.exists() {
        return Ok(Some(cache_path.to_string_lossy().to_string()));
    }

    let path_buf = PathBuf::from(&path);
    let ext = path_buf.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    // Tier 2: JPEG fast path — extract the embedded EXIF thumbnail (< 5 ms, reads ~64 KB).
    // Same technique Windows Explorer uses for instant previews.
    // Phone JPEGs always embed a 160–320 px thumbnail in the EXIF APP1 segment.
    if ext == "jpg" || ext == "jpeg" {
        if let Some(thumb_bytes) = extract_jpeg_exif_thumbnail(&path_buf) {
            if fs::write(&cache_path, &thumb_bytes).is_ok() {
                return Ok(Some(cache_path.to_string_lossy().to_string()));
            }
        }
    }

    // Tier 3: full decode (PNG, WebP, HEIC, or JPEG without embedded thumbnail).
    // Semaphore limits concurrent full-image decodes to 4.
    // A 4K phone JPEG decoded = ~48 MB; drop(img) frees it before encoding starts.
    let permit = sem.0.clone().acquire_owned().await.map_err(|e| e.to_string())?;

    if cache_path.exists() {
        drop(permit);
        return Ok(Some(cache_path.to_string_lossy().to_string()));
    }

    let result = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let _permit = permit;
        let img = match image::open(&path) {
            Ok(i) => i,
            Err(_) => return Ok(None),
        };
        let thumb = img.thumbnail(400, 400);
        drop(img); // free ~48 MB source buffer before encoding

        let img_path = PathBuf::from(&path);
        let ext = img_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let thumb = if ext == "jpg" || ext == "jpeg" {
            let (_, orientation, _, _, _, _, _) = read_jpeg_exif_data(&img_path);
            apply_orientation(thumb, orientation)
        } else {
            thumb
        };
        let out = match fs::File::create(&cache_path) {
            Ok(f) => f,
            Err(_) => return Ok(None),
        };
        let mut buf = std::io::BufWriter::new(out);
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85)
            .encode_image(&thumb).is_ok()
        {
            Ok(Some(cache_path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    }).await.map_err(|e| e.to_string())?;

    result
}

/// Produce (and cache) a screen-resolution preview of a photo.
///
/// This is the image the lightbox shows the instant you open a photo. At fit-to-screen on
/// any display up to 4K a ~2560px JPEG is visually indistinguishable from the original but
/// decodes ~10× faster, which is what makes opening feel instant on low-end PCs and phones.
/// The true full-resolution original is only loaded by the frontend when the user zooms in.
///
/// Returns:
/// - `Some(cache_path)` — a generated preview to display.
/// - `None` — the original is already within the preview budget; the frontend should load it
///   directly (it decodes fast enough and avoids a needless re-encode / quality loss).
#[tauri::command]
async fn get_photo_preview(
    app: tauri::AppHandle,
    sem: State<'_, PreviewSemaphore>,
    path: String,
    max_edge: Option<u32>,
) -> Result<Option<String>, String> {
    let max_edge = max_edge.unwrap_or(2560).clamp(640, 6144);
    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("photo-previews");
    let _ = fs::create_dir_all(&cache_dir);
    let hash = photo_path_hash(&format!("{}|{}", path, max_edge));
    let cache_path = cache_dir.join(format!("{}.jpg", hash));

    // Tier 1: already cached → instant.
    if cache_path.exists() {
        return Ok(Some(cache_path.to_string_lossy().to_string()));
    }

    // Bound concurrent heavy decodes (current photo + prefetched neighbors).
    let permit = sem.0.clone().acquire_owned().await.map_err(|e| e.to_string())?;
    // Re-check: a concurrent request for the same photo may have just finished it.
    if cache_path.exists() {
        drop(permit);
        return Ok(Some(cache_path.to_string_lossy().to_string()));
    }

    let result = tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let _permit = permit;
        let img_path = PathBuf::from(&path);
        let img = match image::open(&img_path) {
            Ok(i) => i,
            Err(_) => return Ok(None),
        };

        // Original already fits the preview budget → let the frontend use the original directly.
        if img.width() <= max_edge && img.height() <= max_edge {
            return Ok(None);
        }

        // Downscale with `thumbnail` (fast box/area filter). For the large downscale ratios these
        // photos need (e.g. 108MP → 2560px, ~6× linear) it is ~4× faster than Triangle/Lanczos
        // (measured ~0.9s vs ~3.3s on a 108MP image) with no visible quality loss at fit-to-screen
        // — and first-open speed is the entire point of the preview.
        let preview = img.thumbnail(max_edge, max_edge);
        drop(img); // free the full source bitmap before encoding

        // Bake EXIF orientation in (and strip EXIF), so it matches the browser-oriented original.
        let ext = img_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let preview = if ext == "jpg" || ext == "jpeg" {
            let (_, orientation, _, _, _, _, _) = read_jpeg_exif_data(&img_path);
            apply_orientation(preview, orientation)
        } else {
            preview
        };

        // Encode to a temp file then rename — avoids a half-written file being read as "cached".
        let tmp_path = cache_path.with_extension("jpg.tmp");
        {
            let out = match fs::File::create(&tmp_path) {
                Ok(f) => f,
                Err(_) => return Ok(None),
            };
            let mut buf = std::io::BufWriter::new(out);
            if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 88)
                .encode_image(&preview).is_err()
            {
                let _ = fs::remove_file(&tmp_path);
                return Ok(None);
            }
        }
        if fs::rename(&tmp_path, &cache_path).is_err() {
            let _ = fs::remove_file(&tmp_path);
            return Ok(None);
        }
        Ok(Some(cache_path.to_string_lossy().to_string()))
    }).await.map_err(|e| e.to_string())?;

    result
}

/// Generate thumbnails for a batch of paths in parallel (rayon).
/// Skips paths that already have a cached thumbnail.
/// Uses a 2-thread pool to prevent OOM from simultaneous full JPEG decodes.
#[tauri::command]
fn pregen_photo_thumbnails(app: tauri::AppHandle, paths: Vec<String>) -> usize {
    let cache_dir = match app.path().app_cache_dir().ok() {
        Some(d) => d.join("photo-thumbs2"),
        None => return 0,
    };
    let _ = fs::create_dir_all(&cache_dir);

    let pool = match rayon::ThreadPoolBuilder::new().num_threads(2).build() {
        Ok(p) => p,
        Err(_) => return 0,
    };

    pool.install(|| {
        paths.par_iter().filter(|path| {
            let hash = photo_path_hash(path);
            let cache_path = cache_dir.join(format!("{}.jpg", hash));
            if cache_path.exists() { return false; }
            let img_path = PathBuf::from(path.as_str());
            let ext = img_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            let Ok(img) = image::open(&img_path) else { return false; };
            let thumb = img.thumbnail(200, 200);
            let thumb = if ext == "jpg" || ext == "jpeg" {
                let (_, orientation, _, _, _, _, _) = read_jpeg_exif_data(&img_path);
                apply_orientation(thumb, orientation)
            } else {
                thumb
            };
            let Ok(out) = fs::File::create(&cache_path) else { return false; };
            let mut buf = std::io::BufWriter::new(out);
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 82)
                .encode_image(&thumb)
                .is_ok()
        }).count()
    })
}

fn apply_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    use image::DynamicImage;
    match orientation {
        2 => DynamicImage::ImageRgba8(image::imageops::flip_horizontal(&img)),
        3 => DynamicImage::ImageRgba8(image::imageops::rotate180(&img)),
        4 => DynamicImage::ImageRgba8(image::imageops::flip_vertical(&img)),
        5 => DynamicImage::ImageRgba8(image::imageops::rotate90(&image::imageops::flip_horizontal(&img))),
        6 => DynamicImage::ImageRgba8(image::imageops::rotate90(&img)),
        7 => DynamicImage::ImageRgba8(image::imageops::rotate270(&image::imageops::flip_horizontal(&img))),
        8 => DynamicImage::ImageRgba8(image::imageops::rotate270(&img)),
        _ => img,
    }
}

#[tauri::command]
fn toggle_photo_favorite(state: State<DbState>, path: String) -> Result<bool, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let current: i64 = conn
        .query_row("SELECT is_favorite FROM photos WHERE path = ?1", rusqlite::params![path], |r| r.get(0))
        .unwrap_or(0);
    let new_val = if current == 0 { 1i64 } else { 0i64 };
    conn.execute("UPDATE photos SET is_favorite = ?1 WHERE path = ?2", rusqlite::params![new_val, path])
        .map_err(|e| e.to_string())?;
    Ok(new_val == 1)
}

#[tauri::command]
fn add_photo_tag(state: State<DbState>, path: String, tag: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO photo_tags (photo_path, tag) VALUES (?1, ?2)",
        rusqlite::params![path, tag],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_photo_tag(state: State<DbState>, path: String, tag: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM photo_tags WHERE photo_path = ?1 AND tag = ?2",
        rusqlite::params![path, tag],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_photo_tags(state: State<DbState>, path: String) -> Result<Vec<String>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT tag FROM photo_tags WHERE photo_path = ?1 ORDER BY tag")
        .map_err(|e| e.to_string())?;
    let tags = stmt.query_map(rusqlite::params![path], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

#[tauri::command]
fn get_all_photo_tags(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT DISTINCT tag FROM photo_tags ORDER BY tag COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let tags = stmt.query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

#[tauri::command]
fn get_photo_years(state: State<DbState>) -> Result<Vec<i32>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT CAST(strftime('%Y', datetime(COALESCE(date_taken, date_modified), 'unixepoch')) AS INTEGER) as yr
         FROM photos
         WHERE COALESCE(date_taken, date_modified) IS NOT NULL
         ORDER BY yr DESC"
    ).map_err(|e| e.to_string())?;
    let years = stmt.query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(years)
}

#[tauri::command]
fn get_photo_year_stats(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT CAST(strftime('%Y', datetime(COALESCE(date_taken, date_modified), 'unixepoch')) AS INTEGER) as yr, COUNT(*) as cnt
         FROM photos
         WHERE COALESCE(date_taken, date_modified) IS NOT NULL
         GROUP BY yr ORDER BY yr DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        let year: i64 = r.get(0)?;
        let count: i64 = r.get(1)?;
        Ok((year, count))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .map(|(year, count)| serde_json::json!({ "year": year, "count": count }))
    .collect();
    Ok(rows)
}

#[tauri::command]
fn get_photo_months_for_year(state: State<DbState>, year: i32) -> Result<Vec<i32>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT CAST(strftime('%m', datetime(COALESCE(date_taken, date_modified), 'unixepoch')) AS INTEGER) as mo
         FROM photos
         WHERE COALESCE(date_taken, date_modified) IS NOT NULL
           AND CAST(strftime('%Y', datetime(COALESCE(date_taken, date_modified), 'unixepoch')) AS INTEGER) = ?1
         ORDER BY mo ASC"
    ).map_err(|e| e.to_string())?;
    let months = stmt.query_map([year], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(months)
}

#[tauri::command]
fn get_photo_formats(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT DISTINCT format FROM photos ORDER BY format")
        .map_err(|e| e.to_string())?;
    let formats = stmt.query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(formats)
}

#[tauri::command]
fn get_on_this_day_photos(state: State<DbState>) -> Result<Vec<Photo>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    // Get photos from the same month+day in previous years
    let now = chrono::Local::now();
    let month = now.month() as i32;
    let day = now.day() as i32;
    let this_year = now.year() as i32;
    let mut stmt = conn.prepare(
        "SELECT path,name,folder,format,width,height,file_size,date_taken,date_modified,is_favorite,orientation,camera,gps_lat,gps_lon,rating
         FROM photos
         WHERE date_taken IS NOT NULL
           AND CAST(strftime('%m', datetime(date_taken, 'unixepoch')) AS INTEGER) = ?1
           AND CAST(strftime('%d', datetime(date_taken, 'unixepoch')) AS INTEGER) = ?2
           AND CAST(strftime('%Y', datetime(date_taken, 'unixepoch')) AS INTEGER) < ?3
         ORDER BY date_taken DESC
         LIMIT 20"
    ).map_err(|e| e.to_string())?;
    let photos = stmt.query_map(rusqlite::params![month, day, this_year], |row| {
        Ok(Photo {
            path: row.get(0)?,
            name: row.get(1)?,
            folder: row.get(2)?,
            format: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            file_size: row.get::<_, i64>(6)? as u64,
            date_taken: row.get(7)?,
            date_modified: row.get(8)?,
            is_favorite: row.get::<_, i64>(9)? != 0,
            orientation: row.get::<_, i64>(10)? as u32,
            camera: row.get(11)?,
            gps_lat: row.get(12)?,
            gps_lon: row.get(13)?,
            rating: row.get::<_, i64>(14).unwrap_or(0) as u32,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(photos)
}

#[tauri::command]
fn get_gps_photos(state: State<DbState>) -> Result<Vec<Photo>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT path,name,folder,format,width,height,file_size,date_taken,date_modified,is_favorite,orientation,camera,gps_lat,gps_lon,rating
         FROM photos WHERE gps_lat IS NOT NULL AND gps_lon IS NOT NULL
         ORDER BY date_taken DESC LIMIT 2000"
    ).map_err(|e| e.to_string())?;
    let photos = stmt.query_map([], |row| {
        Ok(Photo {
            path: row.get(0)?,
            name: row.get(1)?,
            folder: row.get(2)?,
            format: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            file_size: row.get::<_, i64>(6)? as u64,
            date_taken: row.get(7)?,
            date_modified: row.get(8)?,
            is_favorite: row.get::<_, i64>(9)? != 0,
            orientation: row.get::<_, i64>(10)? as u32,
            camera: row.get(11)?,
            gps_lat: row.get(12)?,
            gps_lon: row.get(13)?,
            rating: row.get::<_, i64>(14).unwrap_or(0) as u32,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(photos)
}

#[tauri::command]
fn get_photo_cameras(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT DISTINCT camera FROM photos WHERE camera IS NOT NULL AND camera != '' ORDER BY camera")
        .map_err(|e| e.to_string())?;
    let cameras: Vec<String> = stmt.query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(cameras)
}

#[tauri::command]
fn get_photo_metadata(state: State<DbState>, path: String) -> Result<PhotoMetadata, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let (photo, notes) = conn.query_row(
        "SELECT path,name,folder,format,width,height,file_size,date_taken,date_modified,is_favorite,orientation,camera,gps_lat,gps_lon,rating,notes
         FROM photos WHERE path = ?1",
        rusqlite::params![path],
        |row| {
            let photo = Photo {
                path: row.get(0)?,
                name: row.get(1)?,
                folder: row.get(2)?,
                format: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                file_size: row.get::<_, i64>(6)? as u64,
                date_taken: row.get(7)?,
                date_modified: row.get(8)?,
                is_favorite: row.get::<_, i64>(9)? != 0,
                orientation: row.get::<_, i64>(10)? as u32,
                camera: row.get(11)?,
                gps_lat: row.get(12)?,
                gps_lon: row.get(13)?,
                rating: row.get::<_, i64>(14).unwrap_or(0) as u32,
            };
            let notes: Option<String> = row.get(15)?;
            Ok((photo, notes))
        },
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT tag FROM photo_tags WHERE photo_path = ?1 ORDER BY tag")
        .map_err(|e| e.to_string())?;
    let tags: Vec<String> = stmt.query_map(rusqlite::params![path], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Read EXIF technical data directly from file (not stored in DB)
    let exif_ext = if photo.format == "jpg" || photo.format == "jpeg" || photo.format == "tiff" || photo.format == "tif" {
        read_exif_extra(&PathBuf::from(&photo.path))
    } else {
        ExifExtra { aperture: None, shutter_speed: None, iso: None, focal_length: None, lens: None, exposure_bias: None, flash: None }
    };

    Ok(PhotoMetadata {
        path: photo.path,
        name: photo.name,
        folder: photo.folder,
        format: photo.format,
        width: photo.width,
        height: photo.height,
        file_size: photo.file_size,
        date_taken: photo.date_taken,
        date_modified: photo.date_modified,
        is_favorite: photo.is_favorite,
        orientation: photo.orientation,
        camera: photo.camera,
        gps_lat: photo.gps_lat,
        gps_lon: photo.gps_lon,
        tags,
        notes,
        aperture: exif_ext.aperture,
        shutter_speed: exif_ext.shutter_speed,
        iso: exif_ext.iso,
        focal_length: exif_ext.focal_length,
        lens: exif_ext.lens,
        exposure_bias: exif_ext.exposure_bias,
        flash: exif_ext.flash,
    })
}

#[tauri::command]
fn set_photo_rating(state: State<DbState>, path: String, rating: u32) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let r = rating.min(5);
    conn.execute("UPDATE photos SET rating = ?1 WHERE path = ?2", rusqlite::params![r, path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_photo_notes(state: State<DbState>, path: String, notes: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let notes_val: Option<&str> = if notes.trim().is_empty() { None } else { Some(&notes) };
    conn.execute(
        "UPDATE photos SET notes = ?1 WHERE path = ?2",
        rusqlite::params![notes_val, path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn copy_selected_photos(paths: Vec<String>, dest_folder: String) -> Result<u32, String> {
    let dest = std::path::Path::new(&dest_folder);
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut copied = 0u32;
    for src_path in &paths {
        let src = std::path::Path::new(src_path);
        if let Some(fname) = src.file_name() {
            let mut dest_file = dest.join(fname);
            // Avoid overwriting: append _2, _3, etc.
            if dest_file.exists() {
                let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("photo");
                let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("");
                let mut n = 2u32;
                loop {
                    let candidate = dest.join(format!("{}_{}.{}", stem, n, ext));
                    if !candidate.exists() { dest_file = candidate; break; }
                    n += 1;
                }
            }
            std::fs::copy(src, &dest_file).map_err(|e| e.to_string())?;
            copied += 1;
        }
    }
    Ok(copied)
}

#[derive(Serialize, Deserialize, Clone)]
struct PhotoCollection {
    id: i64,
    name: String,
    description: Option<String>,
    created_at: i64,
    count: i64,
    cover_path: Option<String>,
}

#[tauri::command]
fn create_photo_collection(state: State<DbState>, name: String, description: Option<String>) -> Result<PhotoCollection, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO photo_collections (name, description) VALUES (?1, ?2)",
        rusqlite::params![name, description],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(PhotoCollection { id, name, description, created_at: chrono::Local::now().timestamp(), count: 0, cover_path: None })
}

#[tauri::command]
fn get_photo_collections(state: State<DbState>) -> Result<Vec<PhotoCollection>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.description, c.created_at,
                COUNT(ci.photo_path) as cnt,
                (SELECT ci2.photo_path FROM photo_collection_items ci2 WHERE ci2.collection_id = c.id ORDER BY ci2.added_at DESC LIMIT 1) as cover
         FROM photo_collections c
         LEFT JOIN photo_collection_items ci ON ci.collection_id = c.id
         GROUP BY c.id
         ORDER BY c.created_at DESC"
    ).map_err(|e| e.to_string())?;
    let collections = stmt.query_map([], |r| {
        Ok(PhotoCollection {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            created_at: r.get(3)?,
            count: r.get(4)?,
            cover_path: r.get(5)?,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(collections)
}

#[tauri::command]
fn delete_photo_collection(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM photo_collections WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_photo_collection(state: State<DbState>, id: i64, name: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("UPDATE photo_collections SET name = ?1 WHERE id = ?2", rusqlite::params![name, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_photos_to_collection(state: State<DbState>, collection_id: i64, paths: Vec<String>) -> Result<u32, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut added = 0u32;
    for path in &paths {
        let r = conn.execute(
            "INSERT OR IGNORE INTO photo_collection_items (collection_id, photo_path) VALUES (?1, ?2)",
            rusqlite::params![collection_id, path],
        ).map_err(|e| e.to_string())?;
        added += r as u32;
    }
    Ok(added)
}

#[tauri::command]
fn remove_from_collection(state: State<DbState>, collection_id: i64, path: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM photo_collection_items WHERE collection_id = ?1 AND photo_path = ?2",
        rusqlite::params![collection_id, path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_collection_photos(state: State<DbState>, collection_id: i64) -> Result<Vec<Photo>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT p.path,p.name,p.folder,p.format,p.width,p.height,p.file_size,p.date_taken,p.date_modified,
                p.is_favorite,p.orientation,p.camera,p.gps_lat,p.gps_lon,p.rating
         FROM photos p
         JOIN photo_collection_items ci ON ci.photo_path = p.path
         WHERE ci.collection_id = ?1
         ORDER BY ci.added_at DESC"
    ).map_err(|e| e.to_string())?;
    let photos = stmt.query_map(rusqlite::params![collection_id], |row| {
        Ok(Photo {
            path: row.get(0)?,
            name: row.get(1)?,
            folder: row.get(2)?,
            format: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            file_size: row.get::<_, i64>(6)? as u64,
            date_taken: row.get(7)?,
            date_modified: row.get(8)?,
            is_favorite: row.get::<_, i64>(9)? != 0,
            orientation: row.get::<_, i64>(10)? as u32,
            camera: row.get(11)?,
            gps_lat: row.get(12)?,
            gps_lon: row.get(13)?,
            rating: row.get::<_, i64>(14).unwrap_or(0) as u32,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(photos)
}

#[tauri::command]
fn find_duplicate_photos(state: State<DbState>) -> Result<Vec<Vec<Photo>>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    // Find name+size combos that appear more than once
    let mut dup_stmt = conn.prepare(
        "SELECT name, file_size FROM photos GROUP BY name, file_size HAVING COUNT(*) > 1"
    ).map_err(|e| e.to_string())?;
    let dupes: Vec<(String, i64)> = dup_stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut groups: Vec<Vec<Photo>> = Vec::new();
    for (name, size) in dupes {
        let mut stmt = conn.prepare(
            "SELECT path,name,folder,format,width,height,file_size,date_taken,date_modified,is_favorite,orientation,camera,gps_lat,gps_lon,rating
             FROM photos WHERE name = ?1 AND file_size = ?2 ORDER BY date_modified ASC"
        ).map_err(|e| e.to_string())?;
        let photos: Vec<Photo> = stmt.query_map(rusqlite::params![name, size], |row| {
            Ok(Photo {
                path: row.get(0)?,
                name: row.get(1)?,
                folder: row.get(2)?,
                format: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                file_size: row.get::<_, i64>(6)? as u64,
                date_taken: row.get(7)?,
                date_modified: row.get(8)?,
                is_favorite: row.get::<_, i64>(9)? != 0,
                orientation: row.get::<_, i64>(10)? as u32,
                camera: row.get(11)?,
                gps_lat: row.get(12)?,
                gps_lon: row.get(13)?,
                rating: row.get::<_, i64>(14).unwrap_or(0) as u32,
            })
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
        if photos.len() > 1 {
            groups.push(photos);
        }
    }
    Ok(groups)
}

#[tauri::command]
fn delete_photo_from_library(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM photo_tags WHERE photo_path = ?1", rusqlite::params![path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM photos WHERE path = ?1", rusqlite::params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_photos_library(app: tauri::AppHandle, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute_batch("DELETE FROM photos; DELETE FROM photo_tags;")
        .map_err(|e| e.to_string())?;
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("photo-thumbs2");
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_photos_stats(state: State<DbState>) -> Result<serde_json::Value, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM photos", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let favorites: i64 = conn.query_row("SELECT COUNT(*) FROM photos WHERE is_favorite = 1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let total_size: i64 = conn.query_row("SELECT COALESCE(SUM(file_size), 0) FROM photos", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let albums: i64 = conn.query_row("SELECT COUNT(DISTINCT folder) FROM photos", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "total": total,
        "favorites": favorites,
        "total_size": total_size,
        "albums": albums,
    }))
}

#[tauri::command]
fn get_photo_format_stats(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT format, COUNT(*) as count, SUM(file_size) as total_size FROM photos GROUP BY format ORDER BY count DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .map(|(fmt, count, size)| serde_json::json!({ "format": fmt, "count": count, "size": size }))
    .collect();
    Ok(rows)
}

#[tauri::command]
fn get_photo_camera_stats(state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT COALESCE(camera, 'Unknown') as cam, COUNT(*) as count FROM photos GROUP BY cam ORDER BY count DESC LIMIT 20"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .map(|(cam, count)| serde_json::json!({ "camera": cam, "count": count }))
    .collect();
    Ok(rows)
}

#[tauri::command]
fn export_playlist_m3u(state: State<DbState>, playlist_id: i64) -> Result<String, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    // Fetch playlist name
    let name: String = conn.query_row(
        "SELECT name FROM playlists WHERE id = ?1",
        rusqlite::params![playlist_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    // Fetch ordered tracks with duration
    let mut stmt = conn.prepare(
        "SELECT t.path, t.duration_secs, t.artist, t.title
         FROM playlist_tracks pt
         JOIN tracks t ON t.path = pt.track_path
         WHERE pt.playlist_id = ?1
         ORDER BY pt.position",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![playlist_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok());

    let mut m3u = format!("#EXTM3U\n#PLAYLIST:{}\n", name);
    for (path, duration, artist, title) in rows {
        m3u.push_str(&format!("#EXTINF:{},{} - {}\n{}\n", duration, artist, title, path));
    }
    Ok(m3u)
}

#[tauri::command]
fn export_playlist_pls(state: State<DbState>, playlist_id: i64) -> Result<String, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT t.path, t.title, t.duration_secs
         FROM playlist_tracks pt
         JOIN tracks t ON t.path = pt.track_path
         WHERE pt.playlist_id = ?1
         ORDER BY pt.position",
    ).map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, i64)> = stmt.query_map(rusqlite::params![playlist_id], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    let total = rows.len();
    let mut pls = "[playlist]\n".to_string();
    for (i, (path, title, duration)) in rows.into_iter().enumerate() {
        let n = i + 1;
        pls.push_str(&format!("File{}={}\nTitle{}={}\nLength{}={}\n", n, path, n, title, n, duration));
    }
    pls.push_str(&format!("\nNumberOfEntries={}\nVersion=2\n", total));
    Ok(pls)
}

// ── Video Library ─────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "mov", "avi", "m4v", "flv", "wmv"];

/// Turn "The.Show.Name_S01E02" separators into spaces and tidy up.
fn clean_media_name(raw: &str) -> String {
    let mut s: String = raw.chars().map(|c| if c == '.' || c == '_' { ' ' } else { c }).collect();
    s = s.trim().trim_matches(|c| c == '-' || c == ' ').to_string();
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Detect "S01E02" / "s1e2" / "1x02" patterns in a filename.
/// Returns (series_prefix_end, season, episode, pattern_end) when found.
fn find_episode_pattern(stem: &str) -> Option<(usize, i64, i64, usize)> {
    let lower = stem.to_lowercase();
    let bytes = lower.as_bytes();
    let digits_at = |mut i: usize| -> Option<(i64, usize)> {
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
        if i == start || i - start > 4 { return None; }
        lower[start..i].parse::<i64>().ok().map(|n| (n, i))
    };
    let mut i = 0;
    while i < bytes.len() {
        // SxxEyy
        if bytes[i] == b's' {
            if let Some((season, after_s)) = digits_at(i + 1) {
                if after_s < bytes.len() && bytes[after_s] == b'e' {
                    if let Some((episode, after_e)) = digits_at(after_s + 1) {
                        return Some((i, season, episode, after_e));
                    }
                }
            }
        }
        // NxNN (e.g. "1x02") — require a digit start preceded by start/non-alphanumeric
        if bytes[i].is_ascii_digit() && (i == 0 || !bytes[i - 1].is_ascii_alphanumeric()) {
            if let Some((season, after_n)) = digits_at(i) {
                if season <= 99 && after_n < bytes.len() && bytes[after_n] == b'x' {
                    if let Some((episode, after_e)) = digits_at(after_n + 1) {
                        // require the episode part to be 2+ digits to avoid "1280x720"
                        if after_e - (after_n + 1) >= 2 && episode <= 999 && season >= 1 {
                            return Some((i, season, episode, after_e));
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Extract (series, season, episode, episode_title) from a video path.
/// Falls back to folder names ("Show/Season 2/...") for the series name.
fn parse_series_info(path: &Path) -> (String, i64, i64, Option<String>) {
    let stem = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s,
        None => return (String::new(), 0, 0, None),
    };

    let folder_series = || -> Option<String> {
        // parent could be "Season 2" → use grandparent as series name
        let parent = path.parent()?;
        let parent_name = parent.file_name()?.to_str()?;
        let pl = parent_name.to_lowercase();
        if pl.starts_with("season") || pl.starts_with("temporada") || pl.starts_with("staffel") {
            let gp = parent.parent()?.file_name()?.to_str()?;
            Some(clean_media_name(gp))
        } else {
            Some(clean_media_name(parent_name))
        }
    };

    if let Some((prefix_end, season, episode, pattern_end)) = find_episode_pattern(stem) {
        let mut series = clean_media_name(&stem[..prefix_end]);
        if series.is_empty() {
            series = folder_series().unwrap_or_default();
        }
        let rest = clean_media_name(&stem[pattern_end..]);
        let ep_title = if rest.is_empty() { None } else { Some(rest) };
        return (series, season, episode, ep_title);
    }
    (String::new(), 0, 0, None)
}

fn scan_video_files(folder: &PathBuf) -> Vec<Video> {
    WalkDir::new(folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|entry| {
            let path = entry.path();
            let ext = path.extension()?.to_str()?.to_lowercase();
            if !VIDEO_EXTENSIONS.contains(&ext.as_str()) { return None; }
            let meta = entry.metadata().ok()?;
            let file_size = meta.len() as i64;
            let stem = path.file_stem()?.to_string_lossy().to_string();
            let date_added = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let (series, season, episode, ep_title) = parse_series_info(path);
            // Episodes show their episode title (or "Episode N"); films show the cleaned stem
            let title = if !series.is_empty() {
                ep_title.unwrap_or_else(|| format!("Episode {episode}"))
            } else {
                clean_media_name(&stem)
            };
            let folder = path.parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            Some(Video {
                id: 0,
                path: path.to_string_lossy().to_string(),
                title: if title.is_empty() { stem } else { title },
                format: ext,
                file_size,
                date_added,
                duration_secs: 0,
                width: 0,
                height: 0,
                folder,
                watched_secs: 0,
                last_watched: 0,
                is_favorite: false,
                series,
                season,
                episode,
            })
        })
        .collect()
}

const VIDEO_COLS: &str = "id, path, title, format, file_size, date_added, duration_secs, width, height,
                          folder, watched_secs, last_watched, is_favorite, series, season, episode";

fn row_to_video(row: &rusqlite::Row) -> rusqlite::Result<Video> {
    Ok(Video {
        id: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        format: row.get(3)?,
        file_size: row.get(4)?,
        date_added: row.get(5)?,
        duration_secs: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
        folder: row.get(9)?,
        watched_secs: row.get(10)?,
        last_watched: row.get(11)?,
        is_favorite: row.get::<_, i64>(12)? != 0,
        series: row.get(13)?,
        season: row.get(14)?,
        episode: row.get(15)?,
    })
}

#[tauri::command]
fn scan_and_save_videos(state: State<DbState>, path: String) -> Result<usize, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("Folder not found: {path}"));
    }
    let videos = scan_video_files(&folder);
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let mut saved = 0usize;
    for v in &videos {
        // Upsert: refresh title/series parsing and file size on rescan, but
        // never touch watch state (watched_secs / last_watched / is_favorite).
        let r = conn.execute(
            "INSERT INTO videos (path, title, format, file_size, date_added, folder, series, season, episode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(path) DO UPDATE SET
               title = excluded.title, format = excluded.format, file_size = excluded.file_size,
               folder = excluded.folder, series = excluded.series,
               season = excluded.season, episode = excluded.episode",
            rusqlite::params![v.path, v.title, v.format, v.file_size, v.date_added, v.folder, v.series, v.season, v.episode],
        ).map_err(|e| e.to_string())?;
        saved += r;
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn get_videos_count(state: State<DbState>) -> Result<i64, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM videos", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
fn get_all_videos(state: State<DbState>) -> Result<Vec<Video>, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("SELECT {VIDEO_COLS} FROM videos ORDER BY title COLLATE NOCASE"))
        .map_err(|e| e.to_string())?;
    let videos: Vec<Video> = stmt
        .query_map([], row_to_video)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(videos)
}

#[tauri::command]
fn update_video_metadata(state: State<DbState>, path: String, duration_secs: i64, width: i64, height: i64) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE videos SET duration_secs = ?2, width = ?3, height = ?4 WHERE path = ?1",
        rusqlite::params![path, duration_secs, width, height],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_video_progress(state: State<DbState>, path: String, watched_secs: i64, duration_secs: i64) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE videos SET watched_secs = ?2, last_watched = strftime('%s','now'),
                           duration_secs = CASE WHEN ?3 > 0 THEN ?3 ELSE duration_secs END
         WHERE path = ?1",
        rusqlite::params![path, watched_secs, duration_secs],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_video_watched(state: State<DbState>, path: String, watched: bool) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    if watched {
        // duration may be 0 if never played; mark with a sentinel so % math still works
        conn.execute(
            "UPDATE videos SET watched_secs = CASE WHEN duration_secs > 0 THEN duration_secs ELSE 1 END,
                               last_watched = strftime('%s','now')
             WHERE path = ?1",
            rusqlite::params![path],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE videos SET watched_secs = 0 WHERE path = ?1",
            rusqlite::params![path],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn toggle_video_favorite(state: State<DbState>, path: String) -> Result<bool, String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE videos SET is_favorite = 1 - is_favorite WHERE path = ?1",
        rusqlite::params![path],
    ).map_err(|e| e.to_string())?;
    let fav: i64 = conn
        .query_row("SELECT is_favorite FROM videos WHERE path = ?1", rusqlite::params![path], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(fav != 0)
}

#[tauri::command]
fn delete_video_from_library(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM videos WHERE path = ?1", rusqlite::params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_videos_library(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM videos", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Video thumbnails ─────────────────────────────────────────────────────────
// The frontend captures a frame once (canvas → JPEG) and persists it here so
// the library grid never has to spin up video decoders for cards again.

fn video_thumb_path(app: &tauri::AppHandle, video_path: &str) -> Option<PathBuf> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    video_path.hash(&mut hasher);
    let dir = app.path().app_cache_dir().ok()?.join("video-thumbs");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("{:x}.jpg", hasher.finish())))
}

#[tauri::command]
fn get_video_thumb(app: tauri::AppHandle, path: String) -> Option<String> {
    let p = video_thumb_path(&app, &path)?;
    if p.exists() { Some(p.to_string_lossy().to_string()) } else { None }
}

#[tauri::command]
fn save_video_thumb(app: tauri::AppHandle, path: String, data_base64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| e.to_string())?;
    let p = video_thumb_path(&app, &path).ok_or("cache dir unavailable")?;
    let tmp = p.with_extension("tmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

// ── Subtitles ────────────────────────────────────────────────────────────────
// Finds sidecar .vtt/.srt files next to the video ("Movie.srt", "Movie.en.srt").
// .srt files are converted to WebVTT in the cache dir since <track> needs VTT.

fn srt_to_vtt(srt: &str) -> String {
    let mut out = String::with_capacity(srt.len() + 16);
    out.push_str("WEBVTT\n\n");
    for line in srt.lines() {
        let trimmed = line.trim_start_matches('\u{feff}');
        // Timestamp lines: replace decimal comma with dot (00:00:01,500 → 00:00:01.500)
        if trimmed.contains("-->") {
            out.push_str(&trimmed.replace(',', "."));
        } else {
            out.push_str(trimmed);
        }
        out.push('\n');
    }
    out
}

#[tauri::command]
fn get_video_subtitles(app: tauri::AppHandle, path: String) -> Result<Vec<SubtitleTrack>, String> {
    let video = PathBuf::from(&path);
    let dir = match video.parent() { Some(d) => d.to_path_buf(), None => return Ok(vec![]) };
    let stem = video.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    if stem.is_empty() { return Ok(vec![]); }

    let mut tracks: Vec<SubtitleTrack> = Vec::new();
    let entries = match fs::read_dir(&dir) { Ok(e) => e, Err(_) => return Ok(vec![]) };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        let ext = match p.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };
        if ext != "srt" && ext != "vtt" { continue; }
        let sub_stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !sub_stem.starts_with(&stem) { continue; }

        // Label: the part between the video stem and the extension ("en", "spanish"…)
        let label_raw = sub_stem[stem.len()..].trim_matches(|c| c == '.' || c == '-' || c == '_' || c == ' ').to_string();
        let label = if label_raw.is_empty() { "Subtitles".to_string() } else { label_raw };

        if ext == "vtt" {
            tracks.push(SubtitleTrack { label, vtt_path: p.to_string_lossy().to_string() });
        } else {
            // Convert .srt → cached .vtt
            let srt_content = match fs::read(&p) {
                Ok(b) => String::from_utf8_lossy(&b).to_string(),
                Err(_) => continue,
            };
            let cache_key = p.to_string_lossy().to_string();
            let Some(mut vtt_path) = video_thumb_path(&app, &cache_key) else { continue };
            vtt_path.set_extension("vtt");
            if !vtt_path.exists() {
                if fs::write(&vtt_path, srt_to_vtt(&srt_content)).is_err() { continue; }
            }
            tracks.push(SubtitleTrack { label, vtt_path: vtt_path.to_string_lossy().to_string() });
        }
    }
    tracks.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(tracks)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("libera")
        .join("libera.db");
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).expect("Failed to create database directory");
    }
    let manager = SqliteConnectionManager::file(&db_path)
        .with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
        )
        .with_init(|conn| {
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;")?;
            Ok(())
        });
    let pool = Pool::builder()
        .max_size(8)
        .build(manager)
        .expect("Failed to create connection pool");
    let conn = pool.get().expect("Failed to get connection");
    initialize_database(&conn).expect("Failed to initialize database");
    populate_track_artists(&conn).expect("Failed to populate track artists");
    drop(conn);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState(pool))
        .manage(ThumbSemaphore(Arc::new(tokio::sync::Semaphore::new(4))))
        .manage(PreviewSemaphore(Arc::new(tokio::sync::Semaphore::new(2))))
        .manage(DownloadControl::new())
        .manage(MetadataFetchControl::new())
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            save_tracks,
            get_tracks,
            get_tracks_count,
            get_tracks_page,
            pick_folder,
            scan_books,
            save_books,
            get_books,
            get_artwork,
            get_artwork_original,
            set_track_artwork,
            update_track_metadata,
            get_epub_cover,
            list_epub_contents,
            open_pdf_viewer,
            get_uncached_tracks,
            precache_artwork,
            get_albums,
            get_album_tracks,
            get_albums_count,
            search_albums,
            search_artists,
            get_artist_details,
            search_genres,
            get_genre_tracks,
            clear_music_library,
            clear_books_library,
            clear_artwork_cache,
            get_artist_image,
            get_artist_banner,
            is_artist_banner_custom,
            set_artist_banner_custom,
            set_artist_banner_from_base64,
            clear_artist_banner_custom,
            fetch_artist_images,
            pause_artist_image_download,
            resume_artist_image_download,
            cancel_artist_image_download,
            clear_artist_images,
            clear_artist_banners,
            clear_all_data,
            get_library_stats,
            create_playlist,
            get_playlists,
            get_playlist_tracks,
            add_tracks_to_playlist,
            remove_from_playlist,
            reorder_playlist_track,
            delete_playlist,
            rename_playlist,
            set_playlist_cover,
            get_lyrics,
            set_lyrics,
            clear_lyrics_cache,
            read_text_file,
            write_text_file,
            fetch_missing_metadata,
            cancel_metadata_fetch,
            open_path_with_shell,
            reveal_in_explorer,
            scan_photos,
            save_photos,
            scan_and_save_photos,
            get_photos_count,
            get_photos_page,
            get_photo_albums,
            get_photo_thumbnail,
            get_photo_preview,
            pregen_photo_thumbnails,
            toggle_photo_favorite,
            add_photo_tag,
            remove_photo_tag,
            get_photo_tags,
            get_all_photo_tags,
            get_photo_years,
            get_photo_year_stats,
            get_photo_months_for_year,
            get_photo_formats,
            get_photo_format_stats,
            get_photo_camera_stats,
            get_photo_cameras,
            get_on_this_day_photos,
            get_gps_photos,
            get_photo_metadata,
            set_photo_rating,
            update_photo_notes,
            copy_selected_photos,
            create_photo_collection,
            get_photo_collections,
            delete_photo_collection,
            rename_photo_collection,
            add_photos_to_collection,
            remove_from_collection,
            get_collection_photos,
            find_duplicate_photos,
            delete_photo_from_library,
            clear_photos_library,
            get_photos_stats,
            export_playlist_m3u,
            export_playlist_pls,
            fetch_missing_artwork,
            scan_and_save_videos,
            get_videos_count,
            get_all_videos,
            update_video_metadata,
            clear_videos_library,
            set_video_progress,
            set_video_watched,
            toggle_video_favorite,
            delete_video_from_library,
            get_video_thumb,
            save_video_thumb,
            get_video_subtitles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── clean_primary_artist ──────────────────────────────────────────────────

    #[test]
    fn test_clean_primary_artist_single() {
        assert_eq!(clean_primary_artist("Radiohead"), "Radiohead");
    }

    #[test]
    fn test_clean_primary_artist_feat() {
        assert_eq!(clean_primary_artist("Drake feat. Future"), "Drake");
        assert_eq!(clean_primary_artist("Jay-Z ft. Beyoncé"), "Jay-Z");
        assert_eq!(clean_primary_artist("Foo featuring Bar"), "Foo");
    }

    #[test]
    fn test_clean_primary_artist_slash() {
        // Bare "/" with prefix > 2 chars
        assert_eq!(clean_primary_artist("Fred again../Baby Keem"), "Fred again..");
        // AC/DC must be preserved (prefix ≤ 2 chars)
        assert_eq!(clean_primary_artist("AC/DC"), "AC/DC");
    }

    #[test]
    fn test_clean_primary_artist_empty() {
        assert_eq!(clean_primary_artist(""), "Unknown Artist");
        assert_eq!(clean_primary_artist("   "), "Unknown Artist");
    }

    // ─── split_all_artists ─────────────────────────────────────────────────────

    #[test]
    fn test_split_all_artists_single() {
        assert_eq!(split_all_artists("Radiohead"), vec!["Radiohead"]);
    }

    #[test]
    fn test_split_all_artists_feat() {
        let result = split_all_artists("Drake feat. Future");
        assert_eq!(result, vec!["Drake", "Future"]);
    }

    #[test]
    fn test_split_all_artists_slash() {
        let result = split_all_artists("Fred again../Baby Keem");
        assert_eq!(result, vec!["Fred again..", "Baby Keem"]);
    }

    #[test]
    fn test_split_all_artists_preserves_acdc() {
        let result = split_all_artists("AC/DC");
        assert_eq!(result, vec!["AC/DC"]);
    }

    #[test]
    fn test_split_all_artists_empty() {
        let result = split_all_artists("");
        assert!(result.is_empty());
    }

    // ─── album_hash / track_path_hash ─────────────────────────────────────────

    #[test]
    fn test_album_hash_deterministic() {
        let h1 = album_hash("OK Computer", "Radiohead");
        let h2 = album_hash("OK Computer", "Radiohead");
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_album_hash_differs_on_input() {
        let h1 = album_hash("OK Computer", "Radiohead");
        let h2 = album_hash("Kid A", "Radiohead");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_album_hash_differs_on_artist() {
        let h1 = album_hash("Debut", "Bjork");
        let h2 = album_hash("Debut", "Other Artist");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_track_path_hash_deterministic() {
        let h = track_path_hash("/music/song.mp3");
        assert_eq!(h, track_path_hash("/music/song.mp3"));
    }

    // ─── word_search_params ────────────────────────────────────────────────────

    #[test]
    fn test_word_search_single_word_returns_empty() {
        let (sql, params) = word_search_params("hello", 2, &["title", "artist"]);
        assert!(sql.is_empty());
        assert!(params.is_empty());
    }

    #[test]
    fn test_word_search_two_words() {
        let (sql, params) = word_search_params("hello world", 2, &["title", "artist"]);
        assert!(!sql.is_empty());
        // 2 words × 2 cols = 4 params
        assert_eq!(params.len(), 4);
        assert!(params.iter().all(|p| p.starts_with('%') && p.ends_with('%')));
    }

    #[test]
    fn test_word_search_special_chars_not_injected() {
        // SQL meta-chars / injection payloads must land in the params array (as LIKE patterns),
        // never in the SQL template string.
        let (sql, params) = word_search_params("rock'; DROP TABLE tracks;--", 1, &["genre"]);
        // Two whitespace-separated tokens → non-empty SQL
        assert!(!sql.is_empty());
        // SQL template must only contain placeholders, not the raw user input
        assert!(!sql.contains("DROP"));
        assert!(!sql.contains("--"));
        assert!(!sql.contains("rock'"));
        // The first token should appear as a LIKE param (lowercased, wrapped in %)
        assert!(params[0].contains("rock'"));
    }

    // ─── SQLite integration — search_genres parameterization ──────────────────

    #[test]
    fn test_sqlite_search_genres_no_injection() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE genres (genre TEXT);
             INSERT INTO genres VALUES ('Rock');
             INSERT INTO genres VALUES ('Classic Rock');
             INSERT INTO genres VALUES ('Jazz');"
        ).unwrap();

        // A payload that would break naive string interpolation
        let malicious = "'; DROP TABLE genres;--";
        let pattern = format!("%{}%", malicious.to_lowercase());
        let mut stmt = conn.prepare(
            "SELECT genre FROM genres WHERE LOWER(genre) LIKE ? ORDER BY genre"
        ).unwrap();
        let rows: Vec<String> = stmt
            .query_map(rusqlite::params![pattern], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // No rows should match, AND the table must still exist (not dropped)
        assert!(rows.is_empty());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM genres", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn test_sqlite_search_genres_special_chars() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE genres (genre TEXT);
             INSERT INTO genres VALUES ('R&B');
             INSERT INTO genres VALUES ('Rock');"
        ).unwrap();

        let pattern = "%r&b%";
        let mut stmt = conn.prepare(
            "SELECT genre FROM genres WHERE LOWER(genre) LIKE ?"
        ).unwrap();
        let rows: Vec<String> = stmt
            .query_map(rusqlite::params![pattern], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(rows, vec!["R&B"]);
    }
}
