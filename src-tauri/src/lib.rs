use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use walkdir::WalkDir;
use tauri::Manager;
use zip::ZipArchive;


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
        );
        CREATE TABLE IF NOT EXISTS books (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT NOT NULL UNIQUE,
            title       TEXT NOT NULL,
            file_name   TEXT NOT NULL,
            format      TEXT NOT NULL,
            file_size   INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

// Tauri command — saves scanned tracks to the database
#[tauri::command]
fn save_tracks(state: State<DbState>, tracks: Vec<Track>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    
    // Single transaction for all inserts — much faster for large libraries
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    
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
                track.path, track.title, track.artist, track.album,
                track.album_artist, track.genre, track.year,
                track.track_number, track.track_total, track.disc_number,
                track.disc_total, track.duration_secs, track.bitrate,
                track.sample_rate, track.channels, track.file_size,
            ],
        );
        if result.is_ok() { saved += 1; }
    }
    
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
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

// Tauri command — saves scanned books to the database
#[tauri::command]
fn save_books(state: State<DbState>, books: Vec<Book>) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let mut saved = 0;

    for book in &books {
        let result = conn.execute(
            "INSERT OR REPLACE INTO books (path, title, file_name, format, file_size)
 VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                book.path,
                book.title,
                book.file_name,
                book.format,
                book.file_size,
            ],
        );
        if result.is_ok() {
            saved += 1;
        }
    }

    Ok(saved)
}

// Tauri command — returns all books stored in the database
#[tauri::command]
fn get_books(state: State<DbState>) -> Result<Vec<Book>, String> {
    let conn = state.0.lock().map_err(|e| format!("Database lock error: {}", e))?;

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

// Represents a single book in the library
#[derive(Serialize, Deserialize, Debug)]
pub struct Book {
    pub path: String,
    pub title: String,
    pub file_name: String,
    pub format: String, // "pdf" or "epub"
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

    // Recursive scan with WalkDir
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

    // Limit Rayon parallelism to avoid thread explosion
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

// Tauri command — scans a folder recursively for PDF and EPUB files
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

                // For EPUBs, try to extract the real title
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

// Extracts the title from an EPUB's content.opf metadata file
fn extract_epub_title(path: &PathBuf) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;

    // Try common locations for content.opf
    let opf_names = ["OEBPS/content.opf", "content.opf", "OPS/content.opf"];
    for name in &opf_names {
        if let Ok(mut opf_file) = archive.by_name(name) {
            let mut contents = String::new();
            opf_file.read_to_string(&mut contents).ok()?;

            // Simple regex-free extraction of <dc:title>
            if let Some(start) = contents.find("<dc:title>") {
                let rest = &contents[start + 10..];
                if let Some(end) = rest.find("</dc:title>") {
                    return Some(rest[..end].trim().to_string());
                }
            }
            // Also try with attributes like <dc:title id="...">
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

// Extracts album artwork from an audio file and saves it to cache
// Returns the path to the cached image, or None if no artwork found
#[tauri::command]
fn get_artwork(app: tauri::AppHandle, track_path: String) -> Option<String> {
    use image::imageops::FilterType;
    use image::ImageFormat;

    let path = PathBuf::from(&track_path);
    let tagged_file = Probe::open(&path).ok()?.read().ok()?;
    let tag = tagged_file.primary_tag()?;

    let picture = tag.pictures().first()?;
    let image_data = picture.data();

    // Create cache directory
    let cache_dir = app
        .path()
        .app_cache_dir()
        .ok()?
        .join("artwork");
    fs::create_dir_all(&cache_dir).ok()?;

    let hash = format!("{:x}", md5_simple(&track_path));
    let cache_path = cache_dir.join(format!("{}.jpg", hash));

    // Only process if not already cached
    if !cache_path.exists() {
        // Load image from bytes
        let img = image::load_from_memory(image_data).ok()?;

        // Resize to max 600x600 keeping aspect ratio
        let img = img.resize(600, 600, FilterType::Lanczos3);

        // Save as JPEG with quality 88 — minimal loss, significant size reduction
        let mut output = fs::File::create(&cache_path).ok()?;
        img.write_to(&mut std::io::BufWriter::new(&mut output), ImageFormat::Jpeg).ok()?;
    }

    Some(cache_path.to_string_lossy().to_string())
}

fn md5_simple(input: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}

// Extracts cover image from an EPUB file and saves it to cache
#[tauri::command]
fn get_epub_cover(app: tauri::AppHandle, book_path: String) -> Option<String> {
    use std::io::Read;

    let path = PathBuf::from(&book_path);
    let file = fs::File::open(&path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;

    // Create cache directory
    let cache_dir = app
        .path()
        .app_cache_dir()
        .ok()?
        .join("book-covers");
    fs::create_dir_all(&cache_dir).ok()?;

    let hash = format!("{:x}", md5_simple(&book_path));
    let cache_path = cache_dir.join(format!("{}.jpg", hash));

    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().to_string());
    }

    // Search for cover image inside the EPUB
    let cover_names = [
    "cover.jpg", "cover.jpeg", "cover.png",
    "images/cover.jpg", "images/cover.jpeg", "images/cover.png",
    "OEBPS/cover.jpg", "OEBPS/cover.jpeg", "OEBPS/cover.png",
    "OEBPS/images/cover.jpg", "OEBPS/images/cover.jpeg", "OEBPS/images/cover.png",
    "OEBPS/Images/cover.jpg", "OEBPS/Images/cover.jpeg", "OEBPS/Images/cover.png",
    "OEBPS/Images/default_cover.jpeg", "OEBPS/Images/default_cover.jpg",
];

    for name in &cover_names {
        if let Ok(mut zip_file) = archive.by_name(name) {
            let mut bytes = Vec::new();
            zip_file.read_to_end(&mut bytes).ok()?;

            // Resize and optimize using image crate
            use image::imageops::FilterType;
            use image::ImageFormat;

            let img = image::load_from_memory(&bytes).ok()?;
            let img = img.resize(600, 600, FilterType::Lanczos3);
            let mut output = fs::File::create(&cache_path).ok()?;
            img.write_to(
                &mut std::io::BufWriter::new(&mut output),
                ImageFormat::Jpeg,
            ).ok()?;

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

    tauri::WebviewWindowBuilder::new(
        &app,
        "pdf-viewer",
        tauri::WebviewUrl::App(url_path.into()),
    )
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
    .plugin(tauri_plugin_dialog::init())
    .manage(DbState(Mutex::new(conn)))
.invoke_handler(tauri::generate_handler![
    scan_folder,
    save_tracks,
    get_tracks,
    pick_folder,
    scan_books,
    save_books,
    get_books,
    get_artwork,
    get_epub_cover,
    list_epub_contents,
    open_pdf_viewer,
])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}