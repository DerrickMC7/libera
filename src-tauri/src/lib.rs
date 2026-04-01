use lofty::prelude::*;
use lofty::probe::Probe;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rayon::prelude::*;
use rusqlite::Result as SqlResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri::State;
use walkdir::WalkDir;
use zip::ZipArchive;

pub struct DbState(pub Pool<SqliteConnectionManager>);

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
            file_size       INTEGER NOT NULL
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
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);",
    )?;
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
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(saved)
}

#[tauri::command]
fn get_tracks(state: State<DbState>) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
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
) -> Result<Vec<Track>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let sql_base = "SELECT path, title, artist, album, album_artist, genre, year, track_number, track_total, disc_number, disc_total, duration_secs, bitrate, sample_rate, channels, file_size FROM tracks";
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
        })
    };
    let tracks: Vec<Track> = if query.is_empty() {
        let mut stmt = conn
            .prepare(&format!(
                "{} ORDER BY artist, album, track_number LIMIT ?1 OFFSET ?2",
                sql_base
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
            "{} WHERE LOWER(title) LIKE ?3 OR LOWER(artist) LIKE ?3 OR LOWER(album) LIKE ?3 ORDER BY artist, album, track_number LIMIT ?1 OFFSET ?2",
            sql_base
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
    let artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .unwrap_or_else(|| "Unknown Album".to_string());
    let album_artist = tag
        .and_then(|t| {
            t.get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string())
        })
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
    let tag = tagged_file.primary_tag()?;
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
        let Some(tag) = tagged_file.primary_tag() else {
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
            let Some(tag) = tagged_file.primary_tag() else {
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
         duration_secs, bitrate, sample_rate, channels, file_size
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
fn search_albums(state: State<DbState>, query: String) -> Result<Vec<Album>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;

    let sql = if query.is_empty() {
        "SELECT album, album_artist as artist, MIN(year) as year, COUNT(*) as track_count, MIN(path) as cover_path
         FROM tracks GROUP BY album, album_artist ORDER BY album_artist, album".to_string()
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        format!(
            "SELECT album, album_artist as artist, MIN(year) as year, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks WHERE LOWER(album) LIKE '{pattern}' OR LOWER(album_artist) LIKE '{pattern}'
             GROUP BY album, album_artist ORDER BY album_artist, album"
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
    let mut stmt = if query.is_empty() {
        conn.prepare(
            "SELECT album_artist,
                    COUNT(DISTINCT album) as album_count,
                    COUNT(*) as track_count,
                    MIN(path) as cover_path
             FROM tracks
             GROUP BY album_artist
             ORDER BY album_artist"
        ).map_err(|e| e.to_string())?
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        conn.prepare(&format!(
            "SELECT album_artist,
                    COUNT(DISTINCT album) as album_count,
                    COUNT(*) as track_count,
                    MIN(path) as cover_path
             FROM tracks
             WHERE LOWER(album_artist) LIKE '{pattern}'
             GROUP BY album_artist
             ORDER BY album_artist"
        )).map_err(|e| e.to_string())?
    };
    let artists = stmt.query_map([], |row| {
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

    // Get albums for this artist
    let mut album_stmt = conn.prepare(
        "SELECT album, MIN(year), COUNT(*), MIN(path)
         FROM tracks WHERE album_artist = ?1
         GROUP BY album
         ORDER BY MIN(year), album"
    ).map_err(|e| e.to_string())?;

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
        let mut track_stmt = conn.prepare(
            "SELECT path, title, artist, album, album_artist, genre, year,
             track_number, track_total, disc_number, disc_total,
             duration_secs, bitrate, sample_rate, channels, file_size
             FROM tracks WHERE album_artist = ?1 AND album = ?2
             ORDER BY disc_number, track_number"
        ).map_err(|e| e.to_string())?;

        let tracks: Vec<Track> = track_stmt
            .query_map(rusqlite::params![artist, album_name], |row| {
                Ok(Track {
                    path: row.get(0)?, title: row.get(1)?, artist: row.get(2)?,
                    album: row.get(3)?, album_artist: row.get(4)?, genre: row.get(5)?,
                    year: row.get(6)?, track_number: row.get(7)?, track_total: row.get(8)?,
                    disc_number: row.get(9)?, disc_total: row.get(10)?,
                    duration_secs: row.get(11)?, bitrate: row.get(12)?,
                    sample_rate: row.get(13)?, channels: row.get(14)?, file_size: row.get(15)?,
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
fn search_genres(state: State<DbState>, query: String) -> Result<Vec<Genre>, String> {
    let conn = state.0.get().map_err(|e| format!("Pool error: {}", e))?;
    let mut stmt = if query.is_empty() {
        conn.prepare(
            "SELECT genre, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks
             GROUP BY genre
             ORDER BY genre"
        ).map_err(|e| e.to_string())?
    } else {
        let pattern = format!("%{}%", query.to_lowercase());
        conn.prepare(&format!(
            "SELECT genre, COUNT(*) as track_count, MIN(path) as cover_path
             FROM tracks
             WHERE LOWER(genre) LIKE '{pattern}'
             GROUP BY genre
             ORDER BY genre"
        )).map_err(|e| e.to_string())?
    };
    let genres = stmt.query_map([], |row| {
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
    let mut stmt = conn.prepare(
        "SELECT path, title, artist, album, album_artist, genre, year,
         track_number, track_total, disc_number, disc_total,
         duration_secs, bitrate, sample_rate, channels, file_size
         FROM tracks WHERE genre = ?1
         ORDER BY artist, album, track_number
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;
    let tracks = stmt.query_map(rusqlite::params![genre, limit, offset], |row| {
        Ok(Track {
            path: row.get(0)?, title: row.get(1)?, artist: row.get(2)?,
            album: row.get(3)?, album_artist: row.get(4)?, genre: row.get(5)?,
            year: row.get(6)?, track_number: row.get(7)?, track_total: row.get(8)?,
            disc_number: row.get(9)?, disc_total: row.get(10)?,
            duration_secs: row.get(11)?, bitrate: row.get(12)?,
            sample_rate: row.get(13)?, channels: row.get(14)?, file_size: row.get(15)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|t| t.ok())
    .collect();
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
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
            Ok(())
        });
    let pool = Pool::builder()
        .max_size(8)
        .build(manager)
        .expect("Failed to create connection pool");
    let conn = pool.get().expect("Failed to get connection");
    initialize_database(&conn).expect("Failed to initialize database");
    drop(conn);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState(pool))
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
            get_epub_cover,
            list_epub_contents,
            open_pdf_viewer,
            get_uncached_tracks,
            precache_artwork,
            get_albums,
            get_album_tracks,
            get_albums_count,
            search_albums,
            search_artists, get_artist_details, search_genres, get_genre_tracks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
