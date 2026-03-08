use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}