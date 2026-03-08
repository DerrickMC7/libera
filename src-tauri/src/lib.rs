use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

// Holds the SQLite connection shared across all Tauri commands
pub struct DbState(pub Mutex<Connection>);

// Creates the SQLite database and tables if they don't exist
fn initialize_database(conn: &Connection) -> SqlResult<()> {
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
            file_size       INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

// Tauri command — saves scanned tracks to the database
#[tauri::command]
fn save_tracks(state: State<DbState>, tracks: Vec<Track>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    
    let mut saved = 0;

    for track in &tracks {
        let result = conn.execute(
            "INSERT OR IGNORE INTO tracks 
                (path, title, artist, album, album_artist, genre, year, 
                track_number, track_total, disc_number, disc_total, 
                duration_secs, bitrate, sample_rate, channels, file_size)
            VALUES 
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
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
            ],
        );

        if result.is_ok() {
            saved += 1;
        }
    }

    Ok(saved)
}

// Tauri command — returns all tracks stored in the database
#[tauri::command]
fn get_tracks(state: State<DbState>) -> Result<Vec<Track>, String> {
    let conn = state.0.lock().map_err(|e| format!("Database lock error: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT path, title, artist, album, album_artist, genre, year, track_number, track_total, disc_number, disc_total, duration_secs, bitrate, sample_rate, channels, file_size FROM tracks")
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
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|t| t.ok())
        .collect();

    Ok(tracks)
}

// Represents a single audio track in the library
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
}

// Tauri command — called from the frontend
// Scans a folder for audio files and returns their metadata
#[tauri::command]
fn scan_folder(path: String) -> Result<Vec<Track>, String> {
    let folder = PathBuf::from(&path);

    if !folder.exists() {
        return Err(format!("Folder not found: {}", path));
    }

    let entries = fs::read_dir(&folder)
        .map_err(|e| format!("Error reading folder: {}", e))?;

    // Filter only .mp3 and .flac files
    let audio_files: Vec<PathBuf> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let ext = path.extension()?.to_str()?.to_lowercase();
            if ext == "mp3" || ext == "flac" {
                Some(path)
            } else {
                None
            }
        })
        .collect();

    // Process files in parallel using Rayon
    let tracks: Vec<Track> = audio_files
        .par_iter()
        .filter_map(|file_path| read_track_metadata(file_path))
        .collect();

    Ok(tracks)
}

// Reads metadata from a single audio file using Lofty
// Returns None if the file can't be read
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

    let artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Album".to_string());

    let album_artist = tag
        .and_then(|t| t.get_string(&lofty::tag::ItemKey::AlbumArtist).map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let genre = tag
        .and_then(|t| t.genre().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Genre".to_string());

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
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Open or create the SQLite database file in the app data directory
    let db_path = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("libera")
        .join("libera.db");

    // Create the libera directory if it doesn't exist
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).expect("Failed to create database directory");
    }

    let conn = Connection::open(&db_path).expect("Failed to open database");
    initialize_database(&conn).expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            save_tracks,
            get_tracks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}