import { Track } from "../types/track";
import { Album } from "../types/album";
import { Artist, ArtistAlbum } from "../types/artist";
import { Book } from "../types/book";
import { Genre } from "../types/genre";
import { Photo, PhotoAlbum, PhotoMetadata } from "../types/photo";

// ── Demo artwork ─────────────────────────────────────────────────────────────

const COMPOSER_IMAGES: Record<string, string> = {
  beethoven: "/images/beethoven.jpg",
  chopin:    "/images/chopin.jpg",
  bach:      "/images/bach.jpg",
  mozart:    "/images/mozart.jpg",
  debussy:   "/images/debussy.jpg",
};

function makeDemoArtwork(path: string): string {
  const lpath = path.toLowerCase();
  for (const [name, imgPath] of Object.entries(COMPOSER_IMAGES)) {
    if (lpath.includes(name)) return imgPath;
  }
  return "/images/beethoven.jpg"; // generic fallback
}

// ─────────────────────────────────────────────────────────────────────────────

export const DEMO_TRACKS: Track[] = [
  {
    path: "/audio/beethoven-fur-elise.mp3",
    title: "Für Elise",
    artist: "Ludwig van Beethoven",
    album: "Piano Pieces",
    album_artist: "Ludwig van Beethoven",
    genre: "Classical",
    year: 1810,
    track_number: 1,
    track_total: 2,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 170,
    bitrate: 128,
    sample_rate: 44100,
    channels: 2,
    file_size: 1361952,
    mbid: null,
  },
  {
    path: "/audio/beethoven-moonlight-sonata.mp3",
    title: "Moonlight Sonata, Op. 27 No. 2",
    artist: "Ludwig van Beethoven",
    album: "Piano Pieces",
    album_artist: "Ludwig van Beethoven",
    genre: "Classical",
    year: 1801,
    track_number: 2,
    track_total: 2,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 428,
    bitrate: 160,
    sample_rate: 44100,
    channels: 2,
    file_size: 8316510,
    mbid: null,
  },
  {
    path: "/audio/chopin-nocturne-op9-no1.mp3",
    title: "Nocturne in B♭ Minor, Op. 9 No. 1",
    artist: "Frédéric Chopin",
    album: "Nocturnes",
    album_artist: "Frédéric Chopin",
    genre: "Classical",
    year: 1832,
    track_number: 1,
    track_total: 2,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 328,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 7873851,
    mbid: null,
  },
  {
    path: "/audio/chopin-nocturne-op9-no2.mp3",
    title: "Nocturne in E♭ Major, Op. 9 No. 2",
    artist: "Frédéric Chopin",
    album: "Nocturnes",
    album_artist: "Frédéric Chopin",
    genre: "Classical",
    year: 1832,
    track_number: 2,
    track_total: 2,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 240,
    bitrate: 160,
    sample_rate: 44100,
    channels: 2,
    file_size: 4799250,
    mbid: null,
  },
  {
    path: "/audio/bach-bwv-846-prelude.mp3",
    title: "Prelude in C Major, BWV 846",
    artist: "Johann Sebastian Bach",
    album: "The Well-Tempered Clavier",
    album_artist: "Johann Sebastian Bach",
    genre: "Baroque",
    year: 1722,
    track_number: 1,
    track_total: 1,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 166,
    bitrate: 147,
    sample_rate: 44100,
    channels: 2,
    file_size: 3069356,
    mbid: null,
  },
  {
    path: "/audio/mozart-eine-kleine-nachtmusik.mp3",
    title: "Eine kleine Nachtmusik — I. Allegro",
    artist: "Wolfgang Amadeus Mozart",
    album: "Serenade No. 13",
    album_artist: "Wolfgang Amadeus Mozart",
    genre: "Classical",
    year: 1787,
    track_number: 1,
    track_total: 4,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 340,
    bitrate: 160,
    sample_rate: 44100,
    channels: 2,
    file_size: 7567258,
    mbid: null,
  },
  {
    path: "/audio/debussy-clair-de-lune.mp3",
    title: "Clair de lune",
    artist: "Claude Debussy",
    album: "Suite bergamasque",
    album_artist: "Claude Debussy",
    genre: "Impressionist",
    year: 1905,
    track_number: 3,
    track_total: 4,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 207,
    bitrate: 287,
    sample_rate: 44100,
    channels: 2,
    file_size: 7548416,
    mbid: null,
  },
];

export const DEMO_ALBUMS: Album[] = [
  { album: "Nocturnes", artist: "Frédéric Chopin", year: 1832, track_count: 2, cover_path: "demo://Chopin/nocturne-op9-no1" },
  { album: "Piano Pieces", artist: "Ludwig van Beethoven", year: 1810, track_count: 2, cover_path: "demo://Beethoven/fur-elise" },
  { album: "Serenade No. 13", artist: "Wolfgang Amadeus Mozart", year: 1787, track_count: 1, cover_path: "demo://Mozart/eine-kleine-nachtmusik" },
  { album: "Suite bergamasque", artist: "Claude Debussy", year: 1905, track_count: 1, cover_path: "demo://Debussy/clair-de-lune" },
  { album: "The Well-Tempered Clavier", artist: "Johann Sebastian Bach", year: 1722, track_count: 1, cover_path: "demo://Bach/bwv-846-prelude" },
];

export const DEMO_ARTISTS: Artist[] = [
  { name: "Claude Debussy", album_count: 1, track_count: 1, cover_path: "demo://Debussy/clair-de-lune" },
  { name: "Frédéric Chopin", album_count: 1, track_count: 2, cover_path: "demo://Chopin/nocturne-op9-no1" },
  { name: "Johann Sebastian Bach", album_count: 1, track_count: 1, cover_path: "demo://Bach/bwv-846-prelude" },
  { name: "Ludwig van Beethoven", album_count: 1, track_count: 2, cover_path: "demo://Beethoven/fur-elise" },
  { name: "Wolfgang Amadeus Mozart", album_count: 1, track_count: 1, cover_path: "demo://Mozart/eine-kleine-nachtmusik" },
];

export const DEMO_GENRES: Genre[] = [
  { name: "Baroque", track_count: 1, cover_path: "demo://Bach/bwv-846-prelude" },
  { name: "Classical", track_count: 5, cover_path: "demo://Beethoven/fur-elise" },
  { name: "Impressionist", track_count: 1, cover_path: "demo://Debussy/clair-de-lune" },
];

export const DEMO_BOOKS: Book[] = [
  {
    path: "/books/sherlock-holmes.pdf",
    title: "The Adventures of Sherlock Holmes",
    file_name: "sherlock-holmes.pdf",
    format: "pdf",
    file_size: 15450422,
  },
  {
    path: "/books/pride-and-prejudice.pdf",
    title: "Pride and Prejudice",
    file_name: "pride-and-prejudice.pdf",
    format: "pdf",
    file_size: 10702341,
  },
];

// ─── Demo Photos ──────────────────────────────────────────────────────────────
// Using Wikimedia Commons public-domain images as demo photo URLs
const DEMO_PHOTO_ITEMS = [
  // Classic paintings
  { name: "Starry Night.jpg",       folder: "Paintings/Post-Impressionism", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg", w: 1280, h: 1014, fmt: "jpg", dateStr: "1889-06-15", cam: null, fav: false, tags: ["painting", "van gogh"] },
  { name: "Mona Lisa.jpg",          folder: "Paintings/Renaissance",        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/800px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg", w: 800, h: 1200, fmt: "jpg", dateStr: "1503-03-10", cam: null, fav: true, tags: ["painting", "portrait"] },
  { name: "The Birth of Venus.jpg", folder: "Paintings/Renaissance",        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg/1024px-Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg", w: 1024, h: 690, fmt: "jpg", dateStr: "1486-01-20", cam: null, fav: false, tags: ["painting"] },
  { name: "Guernica.jpg",           folder: "Paintings/Cubism",             url: "https://upload.wikimedia.org/wikipedia/en/7/74/PicassoGuernica.jpg", w: 1024, h: 455, fmt: "jpg", dateStr: "1937-07-12", cam: null, fav: false, tags: ["painting", "picasso"] },
  { name: "The Persistence.jpg",    folder: "Paintings/Surrealism",         url: "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Persistence_of_Memory.jpg", w: 1024, h: 806, fmt: "jpg", dateStr: "1931-09-01", cam: null, fav: true, tags: ["painting", "surrealism"] },
  { name: "Girl with Pearl.jpg",    folder: "Paintings/Baroque",            url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/1665_Girl_with_a_Pearl_Earring.jpg/800px-1665_Girl_with_a_Pearl_Earring.jpg", w: 800, h: 959, fmt: "jpg", dateStr: "1665-04-01", cam: null, fav: false, tags: ["portrait", "baroque"] },
  { name: "Sunflowers.jpg",         folder: "Paintings/Post-Impressionism", url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Vincent_van_Gogh_-_Sunflowers.jpg/800px-Vincent_van_Gogh_-_Sunflowers.jpg", w: 800, h: 1000, fmt: "jpg", dateStr: "1888-08-01", cam: null, fav: true, tags: ["painting", "van gogh"] },
  { name: "Water Lilies.jpg",       folder: "Paintings/Impressionism",      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg/1280px-Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg", w: 1280, h: 971, fmt: "jpg", dateStr: "1906-02-14", cam: null, fav: false, tags: ["painting", "monet"] },
  { name: "The Scream.jpg",         folder: "Paintings/Expressionism",      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg/800px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg", w: 800, h: 993, fmt: "jpg", dateStr: "1893-11-01", cam: null, fav: false, tags: ["painting", "expressionism"] },
  { name: "Great Wave.jpg",         folder: "Paintings/Ukiyo-e",            url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Tsunami_by_hokusai_19th_century.jpg/1280px-Tsunami_by_hokusai_19th_century.jpg", w: 1280, h: 860, fmt: "jpg", dateStr: "1831-05-01", cam: null, fav: false, tags: ["painting", "hokusai"] },
  { name: "Nighthawks.jpg",         folder: "Paintings/Realism",            url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Edward_Hopper_Nighthawks_1942.jpg", w: 1024, h: 610, fmt: "jpg", dateStr: "1942-01-21", cam: null, fav: false, tags: ["painting"] },
  { name: "American Gothic.jpg",    folder: "Paintings/Realism",            url: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg/800px-Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg", w: 800, h: 997, fmt: "jpg", dateStr: "1930-10-30", cam: null, fav: false, tags: ["portrait", "painting"] },
  // Nature & landscape photography (modern)
  { name: "Earth from Apollo 17.jpg", folder: "Nature/Space",              url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/1024px-The_Earth_seen_from_Apollo_17.jpg", w: 1024, h: 1024, fmt: "jpg", dateStr: "1972-12-07", cam: "Hasselblad 500EL", fav: true, tags: ["space", "earth", "nasa"] },
  { name: "Pillars of Creation.jpg", folder: "Nature/Space",               url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg/1024px-Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg", w: 1024, h: 1194, fmt: "jpg", dateStr: "2014-04-01", cam: "Hubble WFC3", fav: true, tags: ["space", "nebula", "nasa"] },
  { name: "Hubble Deep Field.jpg",   folder: "Nature/Space",               url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Hubble_ultra_deep_field.jpg/1024px-Hubble_ultra_deep_field.jpg", w: 1024, h: 994, fmt: "jpg", dateStr: "2004-03-09", cam: "Hubble ACS", fav: false, tags: ["space", "galaxy", "nasa"] },
  { name: "Grand Canyon Sunset.jpg", folder: "Nature/Landscapes",          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Grand_Canyon_National_Park%2C_September_2011_-_panoramio_%281%29.jpg/1280px-Grand_Canyon_National_Park%2C_September_2011_-_panoramio_%281%29.jpg", w: 1280, h: 854, fmt: "jpg", dateStr: "2011-09-15", cam: "Canon EOS 5D", fav: false, tags: ["landscape", "nature"] },
  { name: "Northern Lights.jpg",     folder: "Nature/Landscapes",          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Illo_de_folie_nature_nordique_3.jpg/1280px-Illo_de_folie_nature_nordique_3.jpg", w: 1280, h: 853, fmt: "jpg", dateStr: "2019-01-08", cam: "Nikon D750", fav: true, tags: ["aurora", "night", "landscape"] },
  { name: "Yosemite Valley.jpg",     folder: "Nature/Landscapes",          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg/1280px-Yosemite_Valley%2C_Yosemite_NP_-_Diliff.jpg", w: 1280, h: 960, fmt: "jpg", dateStr: "2010-06-20", cam: "Canon EOS 5D", fav: false, tags: ["landscape", "nature", "usa"] },
  { name: "Antelope Canyon.jpg",     folder: "Nature/Landscapes",          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Antelope_Canyon_X_exposure.jpg/1024px-Antelope_Canyon_X_exposure.jpg", w: 1024, h: 683, fmt: "jpg", dateStr: "2016-03-11", cam: "Sony A7R II", fav: true, tags: ["landscape", "canyon", "light"] },
  { name: "Mount Fuji.jpg",          folder: "Nature/Landscapes",          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Pleine_lune_au-dessus_de_Fuji%2C_2012_%28retouched%29.jpg/1280px-Pleine_lune_au-dessus_de_Fuji%2C_2012_%28retouched%29.jpg", w: 1280, h: 853, fmt: "jpg", dateStr: "2012-07-25", cam: "Nikon D800", fav: false, tags: ["landscape", "japan", "mountain"] },
  // Wildlife
  { name: "Bald Eagle.jpg",          folder: "Nature/Wildlife",            url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Bald_Eagle_Portrait.jpg/1024px-Bald_Eagle_Portrait.jpg", w: 1024, h: 768, fmt: "jpg", dateStr: "2020-02-14", cam: "Canon EOS R5", fav: false, tags: ["bird", "wildlife", "eagle"] },
  { name: "Polar Bear.jpg",          folder: "Nature/Wildlife",            url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Polar_Bear_-_Alaska_%28cropped%29.jpg/1024px-Polar_Bear_-_Alaska_%28cropped%29.jpg", w: 1024, h: 742, fmt: "jpg", dateStr: "2018-08-03", cam: "Nikon D5", fav: true, tags: ["wildlife", "bear", "arctic"] },
  { name: "Monarch Butterfly.jpg",   folder: "Nature/Wildlife",            url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Monarch_butterfly_danaus_plexippus_male_2664px.jpg/1024px-Monarch_butterfly_danaus_plexippus_male_2664px.jpg", w: 1024, h: 707, fmt: "jpg", dateStr: "2021-09-22", cam: "Canon EOS 90D", fav: false, tags: ["butterfly", "macro", "wildlife"] },
  // Architecture & cities
  { name: "Eiffel Tower Night.jpg",  folder: "Architecture/Europe",        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/1024px-Tour_Eiffel_Wikimedia_Commons.jpg", w: 1024, h: 1362, fmt: "jpg", dateStr: "2015-04-30", cam: "Sony A6000", fav: false, tags: ["architecture", "paris", "france"] },
  { name: "Colosseum.jpg",           folder: "Architecture/Europe",        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/1280px-Colosseo_2020.jpg", w: 1280, h: 853, fmt: "jpg", dateStr: "2020-09-10", cam: "Fujifilm X-T4", fav: true, tags: ["architecture", "rome", "italy"] },
  { name: "Sagrada Familia.jpg",     folder: "Architecture/Europe",        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Sagrada_Familia_nave_roof_detail.jpg/1024px-Sagrada_Familia_nave_roof_detail.jpg", w: 1024, h: 768, fmt: "jpg", dateStr: "2023-05-18", cam: "iPhone 15 Pro", fav: false, tags: ["architecture", "barcelona", "gaudi"] },
  { name: "Tokyo Shibuya.jpg",       folder: "Architecture/Asia",          url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Shinjuku_skyscrapers-AP.jpg/1024px-Shinjuku_skyscrapers-AP.jpg", w: 1024, h: 683, fmt: "jpg", dateStr: "2022-11-03", cam: "Sony A7 IV", fav: false, tags: ["city", "tokyo", "japan"] },
  // Portrait & people
  { name: "Afghan Girl.jpg",         folder: "Portraits",                  url: "https://upload.wikimedia.org/wikipedia/en/a/a7/Sharbat_Gula.jpg", w: 620, h: 784, fmt: "jpg", dateStr: "1984-06-01", cam: "Nikon FM2", fav: true, tags: ["portrait", "photojournalism"] },
];

// GPS coords for photos that have known real-world locations
const GPS_COORDS: Record<string, [number, number]> = {
  "Eiffel Tower Night.jpg":  [48.8584, 2.2945],
  "Colosseum.jpg":           [41.8902, 12.4922],
  "Sagrada Familia.jpg":     [41.4036, 2.1744],
  "Tokyo Shibuya.jpg":       [35.6762, 139.6503],
  "Grand Canyon Sunset.jpg": [36.1069, -112.1129],
  "Northern Lights.jpg":     [69.6496, 18.9560],
  "Yosemite Valley.jpg":     [37.7459, -119.5332],
  "Antelope Canyon.jpg":     [36.8619, -111.3743],
  "Mount Fuji.jpg":          [35.3606, 138.7274],
};

const DEMO_PHOTOS: Photo[] = DEMO_PHOTO_ITEMS.map((item, i) => ({
  path: item.url,
  name: item.name,
  folder: item.folder,
  format: item.fmt,
  width: item.w,
  height: item.h,
  file_size: 800_000 + i * 150_000,
  date_taken: Math.floor(new Date(item.dateStr).getTime() / 1000),
  date_modified: Math.floor(Date.now() / 1000) - i * 86400,
  is_favorite: item.fav,
  orientation: 1,
  camera: item.cam ?? null,
  gps_lat: GPS_COORDS[item.name]?.[0] ?? null,
  gps_lon: GPS_COORDS[item.name]?.[1] ?? null,
  rating: item.fav ? 5 : i % 3 === 0 ? 4 : 0,
}));

const DEMO_PHOTO_ALBUMS: PhotoAlbum[] = Array.from(
  new Map(DEMO_PHOTOS.map((p) => [p.folder, p]))
).map(([folder, cover]) => {
  const folderPhotos = DEMO_PHOTOS.filter((p) => p.folder === folder);
  return {
    name: folder.split("/").pop()!,
    folder_path: folder,
    count: folderPhotos.length,
    cover_path: cover.path,
    cover_paths: folderPhotos.slice(0, 4).map((p) => p.path),
  };
});

const DEMO_PHOTO_COLLECTIONS: { id: number; name: string; description: string | null; created_at: number; count: number; cover_path: string | null }[] = [
  { id: 1, name: "Best of 2024", description: "Highlights from the year", created_at: Math.floor(Date.now() / 1000) - 86400 * 30, count: 3, cover_path: DEMO_PHOTOS[0]?.path ?? null },
  { id: 2, name: "Nature Shots", description: null, created_at: Math.floor(Date.now() / 1000) - 86400 * 7, count: 2, cover_path: DEMO_PHOTOS[2]?.path ?? null },
];
const DEMO_COLLECTION_ITEMS: Record<number, string[]> = {
  1: DEMO_PHOTOS.slice(0, 3).map((p) => p.path),
  2: DEMO_PHOTOS.slice(3, 5).map((p) => p.path),
};

export function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const q = ((args?.query as string) || "").toLowerCase();

  switch (command) {
    case "get_tracks_count": {
      const count = q
        ? DEMO_TRACKS.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.artist.toLowerCase().includes(q) ||
              t.album.toLowerCase().includes(q)
          ).length
        : DEMO_TRACKS.length;
      return Promise.resolve(count as unknown as T);
    }

    case "get_tracks_page": {
      const offset = (args?.offset as number) || 0;
      const limit = (args?.limit as number) || 100;
      const filtered = q
        ? DEMO_TRACKS.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.artist.toLowerCase().includes(q) ||
              t.album.toLowerCase().includes(q)
          )
        : DEMO_TRACKS;
      return Promise.resolve(filtered.slice(offset, offset + limit) as unknown as T);
    }

    case "search_albums": {
      const filtered = q
        ? DEMO_ALBUMS.filter(
            (a) => a.album.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
          )
        : DEMO_ALBUMS;
      return Promise.resolve(filtered as unknown as T);
    }

    case "search_artists": {
      const filtered = q
        ? DEMO_ARTISTS.filter((a) => a.name.toLowerCase().includes(q))
        : DEMO_ARTISTS;
      return Promise.resolve(filtered as unknown as T);
    }

    case "get_artist_details": {
      const artistName = args?.artist as string;
      const artistTracks = DEMO_TRACKS.filter((t) => t.artist === artistName);
      const albumMap = new Map<string, ArtistAlbum>();
      artistTracks.forEach((t) => {
        if (!albumMap.has(t.album)) {
          albumMap.set(t.album, {
            album: t.album,
            year: t.year,
            track_count: 0,
            cover_path: "",
            tracks: [],
          });
        }
        const a = albumMap.get(t.album)!;
        a.tracks.push(t);
        a.track_count++;
      });
      return Promise.resolve(Array.from(albumMap.values()) as unknown as T);
    }

    case "get_album_tracks": {
      const albumName = args?.album as string;
      const tracks = DEMO_TRACKS.filter((t) => t.album === albumName);
      return Promise.resolve(tracks as unknown as T);
    }

    case "get_genre_tracks": {
      const genreName = args?.genre as string;
      const tracks = DEMO_TRACKS.filter((t) => t.genre === genreName);
      return Promise.resolve(tracks as unknown as T);
    }

    case "search_genres": {
      const filtered = q
        ? DEMO_GENRES.filter((g) => g.name.toLowerCase().includes(q))
        : DEMO_GENRES;
      return Promise.resolve(filtered as unknown as T);
    }

    case "get_books":
      return Promise.resolve(DEMO_BOOKS as unknown as T);

    case "get_artwork": {
      const trackPath = args?.trackPath as string ?? "";
      return Promise.resolve(makeDemoArtwork(trackPath) as unknown as T);
    }

    case "get_epub_cover":
      return Promise.resolve(null as unknown as T);

    // ─── Photo commands ───────────────────────────────────────────────────────
    case "get_photos_count": {
      const favOnly = args?.favoritesOnly as boolean;
      const albumFilt = args?.albumFilter as string | null;
      const tagFilt = args?.tagFilter as string | null;
      const fmtFilt = args?.formatFilter as string | null;
      const camFilt = args?.cameraFilter as string | null;
      const yearFilt = args?.yearFilter as number | null;
      const monthFilt = args?.monthFilter as number | null;
      const minRat = args?.minRating as number | null;
      let filtered = DEMO_PHOTOS;
      if (favOnly) filtered = filtered.filter((p) => p.is_favorite);
      if (albumFilt) filtered = filtered.filter((p) => p.folder === albumFilt);
      if (fmtFilt) filtered = filtered.filter((p) => p.format === fmtFilt);
      if (camFilt) filtered = filtered.filter((p) => p.camera === camFilt);
      if (yearFilt) filtered = filtered.filter((p) => p.date_taken && new Date(p.date_taken * 1000).getFullYear() === yearFilt);
      if (monthFilt) filtered = filtered.filter((p) => p.date_taken && new Date(p.date_taken * 1000).getMonth() + 1 === monthFilt);
      if (minRat && minRat > 0) filtered = filtered.filter((p) => p.rating >= minRat);
      if (tagFilt) {
        const pathsWithTag = new Set(DEMO_PHOTO_ITEMS.filter((i) => i.tags.includes(tagFilt!)).map((i) => i.url));
        filtered = filtered.filter((p) => pathsWithTag.has(p.path));
      }
      if (q) filtered = filtered.filter((p) => p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q) || (p.camera ?? "").toLowerCase().includes(q));
      return Promise.resolve(filtered.length as unknown as T);
    }

    case "get_photos_page": {
      const offset2 = (args?.offset as number) || 0;
      const limit2 = (args?.limit as number) || 60;
      const sortBy2 = (args?.sortBy as string) || "date_desc";
      const favOnly2 = args?.favoritesOnly as boolean;
      const albumFilt2 = args?.albumFilter as string | null;
      const tagFilt2 = args?.tagFilter as string | null;
      const fmtFilt2 = args?.formatFilter as string | null;
      const camFilt2 = args?.cameraFilter as string | null;
      const yearFilt2 = args?.yearFilter as number | null;
      const monthFilt2 = args?.monthFilter as number | null;
      const minRat2 = args?.minRating as number | null;
      let filtered2 = [...DEMO_PHOTOS];
      if (favOnly2) filtered2 = filtered2.filter((p) => p.is_favorite);
      if (albumFilt2) filtered2 = filtered2.filter((p) => p.folder === albumFilt2);
      if (fmtFilt2) filtered2 = filtered2.filter((p) => p.format === fmtFilt2);
      if (camFilt2) filtered2 = filtered2.filter((p) => p.camera === camFilt2);
      if (yearFilt2) filtered2 = filtered2.filter((p) => p.date_taken && new Date(p.date_taken * 1000).getFullYear() === yearFilt2);
      if (monthFilt2) filtered2 = filtered2.filter((p) => p.date_taken && new Date(p.date_taken * 1000).getMonth() + 1 === monthFilt2);
      if (minRat2 && minRat2 > 0) filtered2 = filtered2.filter((p) => p.rating >= minRat2);
      if (tagFilt2) {
        const pathsWithTag2 = new Set(DEMO_PHOTO_ITEMS.filter((i) => i.tags.includes(tagFilt2!)).map((i) => i.url));
        filtered2 = filtered2.filter((p) => pathsWithTag2.has(p.path));
      }
      if (q) filtered2 = filtered2.filter((p) => p.name.toLowerCase().includes(q) || p.folder.toLowerCase().includes(q) || (p.camera ?? "").toLowerCase().includes(q));
      filtered2.sort((a, b) => {
        switch (sortBy2) {
          case "date_asc":  return (a.date_taken ?? 0) - (b.date_taken ?? 0);
          case "date_desc": return (b.date_taken ?? 0) - (a.date_taken ?? 0);
          case "name_asc":  return a.name.localeCompare(b.name);
          case "name_desc": return b.name.localeCompare(a.name);
          case "size_asc":    return a.file_size - b.file_size;
          case "size_desc":   return b.file_size - a.file_size;
          case "rating_desc": return b.rating - a.rating;
          case "rating_asc":  return a.rating - b.rating;
          default: return 0;
        }
      });
      return Promise.resolve(filtered2.slice(offset2, offset2 + limit2) as unknown as T);
    }

    case "get_photo_albums":
      return Promise.resolve(DEMO_PHOTO_ALBUMS as unknown as T);

    case "get_photo_years": {
      const years = [...new Set(DEMO_PHOTOS.map((p) => {
        if (!p.date_taken) return null;
        return new Date(p.date_taken * 1000).getFullYear();
      }).filter(Boolean))].sort((a, b) => b! - a!);
      return Promise.resolve(years as unknown as T);
    }

    case "get_photo_year_stats": {
      const yearMap = new Map<number, number>();
      DEMO_PHOTOS.forEach((p) => {
        if (!p.date_taken) return;
        const yr = new Date(p.date_taken * 1000).getFullYear();
        yearMap.set(yr, (yearMap.get(yr) ?? 0) + 1);
      });
      const result = [...yearMap.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
      return Promise.resolve(result as unknown as T);
    }

    case "get_photo_months_for_year": {
      const yr = args?.year as number;
      const months = [...new Set(DEMO_PHOTOS
        .filter((p) => p.date_taken && new Date(p.date_taken * 1000).getFullYear() === yr)
        .map((p) => new Date(p.date_taken! * 1000).getMonth() + 1)
      )].sort((a, b) => a - b);
      return Promise.resolve(months as unknown as T);
    }

    case "get_photo_formats": {
      const fmts = [...new Set(DEMO_PHOTOS.map((p) => p.format))].sort();
      return Promise.resolve(fmts as unknown as T);
    }

    case "get_photo_cameras": {
      const cams = [...new Set(DEMO_PHOTOS.map((p) => p.camera).filter(Boolean))].sort() as string[];
      return Promise.resolve(cams as unknown as T);
    }

    case "get_gps_photos": {
      return Promise.resolve(DEMO_PHOTOS.filter((p) => p.gps_lat != null && p.gps_lon != null) as unknown as T);
    }

    case "get_photo_format_stats": {
      const fmtMap = new Map<string, { count: number; size: number }>();
      for (const p of DEMO_PHOTOS) {
        const entry = fmtMap.get(p.format) ?? { count: 0, size: 0 };
        entry.count++;
        entry.size += p.file_size;
        fmtMap.set(p.format, entry);
      }
      const result = Array.from(fmtMap.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([format, { count, size }]) => ({ format, count, size }));
      return Promise.resolve(result as unknown as T);
    }

    case "get_photo_camera_stats": {
      const camMap = new Map<string, number>();
      for (const p of DEMO_PHOTOS) {
        const cam = p.camera ?? "Unknown";
        camMap.set(cam, (camMap.get(cam) ?? 0) + 1);
      }
      const result = Array.from(camMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([camera, count]) => ({ camera, count }));
      return Promise.resolve(result as unknown as T);
    }

    case "get_on_this_day_photos": {
      // Return photos from previous years on today's date (use random subset in demo)
      const today = new Date();
      const mm = today.getMonth() + 1;
      const dd = today.getDate();
      const matches = DEMO_PHOTOS.filter((p) => {
        if (!p.date_taken) return false;
        const d = new Date(p.date_taken * 1000);
        return d.getMonth() + 1 === mm && d.getDate() === dd && d.getFullYear() < today.getFullYear();
      });
      // Fall back to a few random photos if no exact matches (demo has fixed dates)
      const result = matches.length >= 1 ? matches : DEMO_PHOTOS.filter((p) => p.is_favorite).slice(0, 5);
      return Promise.resolve(result as unknown as T);
    }

    case "get_all_photo_tags": {
      const tags = [...new Set(DEMO_PHOTO_ITEMS.flatMap((p) => p.tags))].sort();
      return Promise.resolve(tags as unknown as T);
    }

    case "get_photo_thumbnail":
      return Promise.resolve(args?.path as unknown as T);

    case "get_photo_preview":
      // Demo: no separate preview; null tells the frontend to use the original directly.
      return Promise.resolve(null as unknown as T);

    case "get_photo_metadata": {
      const p = DEMO_PHOTOS.find((ph) => ph.path === args?.path);
      if (!p) return Promise.resolve(null as unknown as T);
      const item = DEMO_PHOTO_ITEMS.find((i) => i.url === args?.path);
      return Promise.resolve({ ...p, tags: item?.tags ?? [], notes: null, aperture: p.rating > 3 ? 1.8 : p.rating > 1 ? 2.8 : null, shutter_speed: p.rating > 2 ? "1/250" : null, iso: p.rating > 1 ? 100 : null, focal_length: 50, lens: null, exposure_bias: 0, flash: null } as unknown as T);
    }

    case "set_photo_rating": {
      const ph = DEMO_PHOTOS.find((p) => p.path === args?.path);
      if (ph) ph.rating = Number(args?.rating ?? 0);
      return Promise.resolve(undefined as unknown as T);
    }

    case "update_photo_notes":
      return Promise.resolve(undefined as unknown as T);

    case "copy_selected_photos":
      return Promise.resolve(0 as unknown as T);

    case "find_duplicate_photos": {
      // Group demo photos by name+size to simulate duplicates
      const groups = new Map<string, typeof DEMO_PHOTOS[0][]>();
      DEMO_PHOTOS.forEach((p) => {
        const key = `${p.name}::${p.file_size}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      });
      const dupeGroups = Array.from(groups.values()).filter((g) => g.length > 1);
      return Promise.resolve(dupeGroups as unknown as T);
    }

    case "delete_photo_from_library": {
      const idx = DEMO_PHOTOS.findIndex((p) => p.path === args?.path);
      if (idx !== -1) DEMO_PHOTOS.splice(idx, 1);
      return Promise.resolve(undefined as unknown as T);
    }

    case "toggle_photo_favorite": {
      const ph = DEMO_PHOTOS.find((p) => p.path === args?.path);
      if (ph) ph.is_favorite = !ph.is_favorite;
      return Promise.resolve((ph?.is_favorite ?? false) as unknown as T);
    }

    case "get_photos_stats":
      return Promise.resolve({
        total: DEMO_PHOTOS.length,
        favorites: DEMO_PHOTOS.filter((p) => p.is_favorite).length,
        total_size: DEMO_PHOTOS.reduce((s, p) => s + p.file_size, 0),
        albums: DEMO_PHOTO_ALBUMS.length,
      } as unknown as T);

    case "get_photo_collections":
      return Promise.resolve(DEMO_PHOTO_COLLECTIONS as unknown as T);

    case "create_photo_collection": {
      const newCol = {
        id: DEMO_PHOTO_COLLECTIONS.length + 1,
        name: (args?.name as string) || "New Collection",
        description: (args?.description as string | null) ?? null,
        created_at: Math.floor(Date.now() / 1000),
        count: 0,
        cover_path: null,
      };
      DEMO_PHOTO_COLLECTIONS.push(newCol);
      return Promise.resolve(newCol as unknown as T);
    }

    case "delete_photo_collection": {
      const colIdx = DEMO_PHOTO_COLLECTIONS.findIndex((c) => c.id === args?.id);
      if (colIdx !== -1) DEMO_PHOTO_COLLECTIONS.splice(colIdx, 1);
      return Promise.resolve(undefined as unknown as T);
    }

    case "rename_photo_collection": {
      const col = DEMO_PHOTO_COLLECTIONS.find((c) => c.id === args?.id);
      if (col) col.name = (args?.name as string) || col.name;
      return Promise.resolve(undefined as unknown as T);
    }

    case "add_photos_to_collection": {
      const cid = args?.collectionId as number;
      const ps = args?.paths as string[];
      const col2 = DEMO_PHOTO_COLLECTIONS.find((c) => c.id === cid);
      if (col2) {
        col2.count += (ps ?? []).length;
        if (!col2.cover_path && ps?.[0]) col2.cover_path = ps[0];
      }
      DEMO_COLLECTION_ITEMS[cid] = [...(DEMO_COLLECTION_ITEMS[cid] ?? []), ...(ps ?? [])];
      return Promise.resolve((ps ?? []).length as unknown as T);
    }

    case "remove_from_collection": {
      const cid2 = args?.collectionId as number;
      const rpath = args?.path as string;
      if (DEMO_COLLECTION_ITEMS[cid2]) {
        DEMO_COLLECTION_ITEMS[cid2] = DEMO_COLLECTION_ITEMS[cid2].filter((p) => p !== rpath);
        const col3 = DEMO_PHOTO_COLLECTIONS.find((c) => c.id === cid2);
        if (col3) col3.count = DEMO_COLLECTION_ITEMS[cid2].length;
      }
      return Promise.resolve(undefined as unknown as T);
    }

    case "get_collection_photos": {
      const cid3 = args?.collectionId as number;
      const paths = DEMO_COLLECTION_ITEMS[cid3] ?? [];
      const result = paths.map((p) => DEMO_PHOTOS.find((ph) => ph.path === p)).filter(Boolean);
      return Promise.resolve(result as unknown as T);
    }

    case "add_photo_tag":
    case "remove_photo_tag":
    case "scan_photos":
    case "save_photos":
    case "clear_photos_library":
      return Promise.resolve(null as unknown as T);

    default:
      return Promise.resolve(null as unknown as T);
  }
}
