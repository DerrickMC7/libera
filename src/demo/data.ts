import { Track } from "../types/track";
import { Album } from "../types/album";
import { Artist, ArtistAlbum } from "../types/artist";
import { Book } from "../types/book";
import { Genre } from "../types/genre";

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

    default:
      return Promise.resolve(null as unknown as T);
  }
}
