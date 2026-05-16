import { Track } from "../types/track";
import { Album } from "../types/album";
import { Artist, ArtistAlbum } from "../types/artist";
import { Book } from "../types/book";
import { Genre } from "../types/genre";

export const DEMO_TRACKS: Track[] = [
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/d/da/Beethoven_-_Fur_Elise.ogg",
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
    duration_secs: 199,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 4780000,
  },
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/5/54/Beethoven_Moonlight_Sonata_Op._27_No._2.ogg",
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
    duration_secs: 318,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 7630000,
  },
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/b/b8/Chopin_-_Nocturne_op_9_no_1.ogg",
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
    duration_secs: 334,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 8020000,
  },
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/e/e1/Chopin_Nocturne_op9_no2.ogg",
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
    duration_secs: 273,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 6550000,
  },
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/4/41/BWV_846_Prelude.ogg",
    title: "Prelude in C Major, BWV 846",
    artist: "Johann Sebastian Bach",
    album: "The Well-Tempered Clavier",
    album_artist: "Johann Sebastian Bach",
    genre: "Baroque",
    year: 1722,
    track_number: 1,
    track_total: 2,
    disc_number: 1,
    disc_total: 1,
    duration_secs: 150,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 3600000,
  },
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/a/a0/Mozart_-_Eine_kleine_Nachtmusik_-_1._Allegro.ogg",
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
    duration_secs: 357,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 8570000,
  },
  {
    path: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Debussy_-_Clair_de_lune.ogg",
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
    duration_secs: 290,
    bitrate: 192,
    sample_rate: 44100,
    channels: 2,
    file_size: 6960000,
  },
];

export const DEMO_ALBUMS: Album[] = [
  { album: "Nocturnes", artist: "Frédéric Chopin", year: 1832, track_count: 2, cover_path: "" },
  { album: "Piano Pieces", artist: "Ludwig van Beethoven", year: 1810, track_count: 2, cover_path: "" },
  { album: "Serenade No. 13", artist: "Wolfgang Amadeus Mozart", year: 1787, track_count: 1, cover_path: "" },
  { album: "Suite bergamasque", artist: "Claude Debussy", year: 1905, track_count: 1, cover_path: "" },
  { album: "The Well-Tempered Clavier", artist: "Johann Sebastian Bach", year: 1722, track_count: 1, cover_path: "" },
];

export const DEMO_ARTISTS: Artist[] = [
  { name: "Claude Debussy", album_count: 1, track_count: 1, cover_path: "" },
  { name: "Frédéric Chopin", album_count: 1, track_count: 2, cover_path: "" },
  { name: "Johann Sebastian Bach", album_count: 1, track_count: 1, cover_path: "" },
  { name: "Ludwig van Beethoven", album_count: 1, track_count: 2, cover_path: "" },
  { name: "Wolfgang Amadeus Mozart", album_count: 1, track_count: 1, cover_path: "" },
];

export const DEMO_GENRES: Genre[] = [
  { name: "Baroque", track_count: 1, cover_path: "" },
  { name: "Classical", track_count: 5, cover_path: "" },
  { name: "Impressionist", track_count: 1, cover_path: "" },
];

export const DEMO_BOOKS: Book[] = [
  {
    path: "https://www.gutenberg.org/files/1661/1661-pdf.pdf",
    title: "The Adventures of Sherlock Holmes",
    file_name: "sherlock-holmes.pdf",
    format: "pdf",
    file_size: 857000,
  },
  {
    path: "https://www.gutenberg.org/files/1342/1342-pdf.pdf",
    title: "Pride and Prejudice",
    file_name: "pride-and-prejudice.pdf",
    format: "pdf",
    file_size: 704000,
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

    case "search_genres": {
      const filtered = q
        ? DEMO_GENRES.filter((g) => g.name.toLowerCase().includes(q))
        : DEMO_GENRES;
      return Promise.resolve(filtered as unknown as T);
    }

    case "get_books":
      return Promise.resolve(DEMO_BOOKS as unknown as T);

    case "get_artwork":
    case "get_epub_cover":
      return Promise.resolve(null as unknown as T);

    default:
      return Promise.resolve(null as unknown as T);
  }
}
