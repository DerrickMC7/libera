use lofty::prelude::*;
use lofty::probe::Probe;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rayon::prelude::*;
use rusqlite::Result as SqlResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::State;
use walkdir::WalkDir;
use zip::ZipArchive;

pub struct DbState(pub Pool<SqliteConnectionManager>);

pub struct DownloadControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
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
                duration_secs, bitrate, sample_rate, channels, file_size, mbid)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
        .prepare("SELECT path, title, artist, album, album_artist, genre, year, track_number, track_total, disc_number, disc_total, duration_secs, bitrate, sample_rate, channels, file_size, mbid FROM tracks")
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
        let pattern = format!("%{}%", query.to_lowercase());
        conn.query_row(
            "SELECT COUNT(*) FROM tracks WHERE LOWER(title) LIKE ?1 OR LOWER(artist) LIKE ?1 OR LOWER(album) LIKE ?1",
            rusqlite::params![pattern],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
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
    let sql_base = "SELECT path, title, artist, album, album_artist, genre, year, track_number, track_total, disc_number, disc_total, duration_secs, bitrate, sample_rate, channels, file_size, mbid FROM tracks";
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
        let pattern = format!("%{}%", query.to_lowercase());
        let mut stmt = conn.prepare(&format!(
            "{} WHERE LOWER(title) LIKE ?3 OR LOWER(artist) LIKE ?3 OR LOWER(album) LIKE ?3 {} LIMIT ?1 OFFSET ?2",
            sql_base, order_clause
        )).map_err(|e| e.to_string())?;
        let x = stmt
            .query_map(rusqlite::params![limit, offset, pattern], map_row)
            .map_err(|e| e.to_string())?
            .filter_map(|t| t.ok())
            .collect();
        x
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
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Book {
    pub path: String,
    pub title: String,
    pub file_name: String,
    pub format: String,
    pub file_size: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Album {
    pub album: String,
    pub artist: String,
    pub year: Option<u32>,
    pub track_count: usize,
    pub cover_path: String,
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

#[tauri::command]
fn get_artwork(app: tauri::AppHandle, track_path: String, full: Option<bool>) -> Option<String> {
    use image::imageops::FilterType;
    let want_full = full.unwrap_or(false);
    let cache_base = app.path().app_cache_dir().ok()?.join("artwork");
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
fn get_artwork_original(app: tauri::AppHandle, track_path: String) -> Option<String> {
    use image::imageops::FilterType;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .ok()?
        .join("artwork")
        .join("original");
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
        let thumb_path  = cache_dir.join(format!("{}.jpg", artist_name_hash(name)));
        let banner_path = banner_dir.join(format!("{}.jpg", artist_name_hash(name)));

        let _ = app.emit(
            "artist-images://progress",
            serde_json::json!({ "completed": i, "total": total, "current": name }),
        );

        let need_thumb  = !thumb_path.exists();
        let need_banner = !banner_path.exists();

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
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
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
         duration_secs, bitrate, sample_rate, channels, file_size, mbid
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

    let sql = if query.is_empty() {
        format!(
            "SELECT album, album_artist as artist, MIN(year) as year, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks GROUP BY album, album_artist {}",
            order_clause
        )
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        format!(
            "SELECT album, album_artist as artist, MIN(year) as year, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks WHERE LOWER(album) LIKE '{pattern}' OR LOWER(album_artist) LIKE '{pattern}'
             GROUP BY album, album_artist {}",
            order_clause
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
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
    let sql = if query.is_empty() {
        format!("{} WHERE {} GROUP BY ta.artist_name ORDER BY ta.artist_name", base, blocked)
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        format!(
            "{} WHERE {} AND LOWER(ta.artist_name) LIKE '{}' GROUP BY ta.artist_name ORDER BY ta.artist_name",
            base, blocked, pattern
        )
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let artists = stmt
        .query_map([], |row| {
            Ok(Artist {
                name: row.get(0)?,
                album_count: row.get::<_, i64>(1)? as usize,
                track_count: row.get::<_, i64>(2)? as usize,
                cover_path: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|a| a.ok())
        .collect();
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
                        t.duration_secs, t.bitrate, t.sample_rate, t.channels, t.file_size, t.mbid
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
    let mut stmt = if query.is_empty() {
        conn.prepare(&format!(
            "SELECT genre as name, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks
             GROUP BY genre
             {}",
            order_clause
        ))
        .map_err(|e| e.to_string())?
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        conn.prepare(&format!(
            "SELECT genre as name, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks
             WHERE LOWER(genre) LIKE '{pattern}'
             GROUP BY genre
             {}",
            order_clause
        ))
        .map_err(|e| e.to_string())?
    };
    let genres = stmt
        .query_map([], |row| {
            Ok(Genre {
                name: row.get(0)?,
                track_count: row.get::<_, i64>(1)? as usize,
                cover_path: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|g| g.ok())
        .collect();
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
         duration_secs, bitrate, sample_rate, channels, file_size, mbid
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
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
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
        .manage(DownloadControl::new())
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
            fetch_artist_images,
            pause_artist_image_download,
            resume_artist_image_download,
            cancel_artist_image_download,
            clear_artist_images,
            clear_artist_banners,
            clear_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
