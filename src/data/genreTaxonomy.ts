// A curated taxonomy of the world's music genres, organised into families and
// linked by musical lineage. Used by the Genre Map view to render an
// interconnected node graph; the user's own genres are matched onto these nodes.

export interface TaxonomyNode {
  id: string;
  label: string;
  family: string;   // family id this node belongs to
  color: string;    // family colour (hex)
  depth: number;    // 0 = family hub, 1 = subgenre, 2 = sub-subgenre
  aliases: string[];
}

export interface TaxonomyLink {
  source: string;
  target: string;
  kind: "family" | "child" | "cross"; // family↔family, family→sub, blend
}

type SubDef = string | { label: string; aliases?: string[]; children?: SubDef[] };

interface FamilyDef {
  label: string;
  color: string;
  keywords: string[];      // substrings used for fallback matching
  aliases?: string[];      // extra exact-match aliases for the family hub
  subgenres: SubDef[];
}

// ─── The taxonomy ───────────────────────────────────────────────────────────────

const FAMILIES: FamilyDef[] = [
  {
    label: "Rock", color: "#e2725b", keywords: ["rock"],
    subgenres: [
      "Classic Rock", "Hard Rock",
      { label: "Alternative Rock", aliases: ["alternative", "alt rock", "alt-rock"] },
      { label: "Indie Rock", aliases: ["indie"] },
      { label: "Progressive Rock", aliases: ["prog rock", "prog"] },
      { label: "Psychedelic Rock", aliases: ["psych rock", "psychedelic"] },
      "Garage Rock", "Grunge", "Post-Rock", "Art Rock", "Glam Rock",
      "Surf Rock", "Southern Rock", "Math Rock", "Krautrock",
      "Folk Rock", "Blues Rock", "Country Rock", "Shoegaze", "Noise Rock",
      "Stoner Rock", "Britpop", "Gothic Rock", "Rockabilly", "Jam Band",
      { label: "New Wave", aliases: ["new wave"] },
      { label: "Rock and Roll", aliases: ["rock n roll", "rock & roll", "rocknroll"] },
      "Soft Rock", "Yacht Rock", "Arena Rock", "Heartland Rock", "Post-Grunge",
      "Space Rock", "Funk Rock", "Rap Rock", "Industrial Rock", "Experimental Rock",
      "Roots Rock", "Acid Rock", "Madchester",
    ],
  },
  {
    label: "Metal", color: "#9aa0a6", keywords: ["metal"],
    subgenres: [
      "Heavy Metal", "Thrash Metal", "Death Metal", "Black Metal", "Doom Metal",
      "Power Metal", "Progressive Metal", "Nu Metal", "Metalcore", "Deathcore",
      "Groove Metal", "Folk Metal", "Symphonic Metal", "Sludge Metal",
      "Industrial Metal", "Gothic Metal", "Speed Metal", "Grindcore", "Mathcore",
      "Djent", "Viking Metal", "Drone Metal", "Avant-garde Metal",
      "Melodic Death Metal", "Glam Metal",
      "Post-Metal", "Blackgaze", "Powerviolence", "Funeral Doom",
      "Technical Death Metal", "Atmospheric Black Metal", "Crossover Thrash",
      "Stoner Metal", "Kawaii Metal",
    ],
  },
  {
    label: "Punk", color: "#d64b4b", keywords: ["punk"],
    subgenres: [
      "Punk Rock",
      { label: "Hardcore Punk", aliases: ["hardcore"] },
      "Post-Punk", "Pop Punk", "Ska Punk", "Emo", "Post-Hardcore",
      "Crust Punk", "Anarcho-Punk", "Folk Punk", "Skate Punk", "Oi!",
      "No Wave", "Riot Grrrl", "Garage Punk",
    ],
  },
  {
    label: "Pop", color: "#e6739f", keywords: ["pop"],
    subgenres: [
      "Pop Rock",
      { label: "Synth-Pop", aliases: ["synthpop", "synth pop"] },
      "Electropop", "Dance-Pop", "Indie Pop", "Dream Pop",
      { label: "K-Pop", aliases: ["kpop"] },
      { label: "J-Pop", aliases: ["jpop"] },
      "Power Pop", "Art Pop", "Teen Pop", "Baroque Pop", "Bedroom Pop", "Hyperpop",
      "City Pop", "Chamber Pop", "Sophisti-Pop", "Europop", "Bubblegum Pop",
      "New Romantic", "Jangle Pop",
      "Twee Pop", "Sunshine Pop", "Mandopop", "Cantopop", "Pop Soul",
    ],
  },
  {
    label: "Electronic", color: "#4fb0c6", keywords: ["electronic", "electronica", "edm"],
    aliases: ["electronica", "edm", "dance", "club"],
    subgenres: [
      { label: "House", children: ["Deep House", "Tech House", "Progressive House", "Acid House", "Future House"] },
      { label: "Techno", children: ["Detroit Techno", "Minimal Techno", "Acid Techno"] },
      { label: "Trance", children: ["Psytrance", "Progressive Trance", "Goa Trance"] },
      { label: "Drum and Bass", aliases: ["dnb", "drum n bass", "drum & bass"], children: ["Liquid Funk", "Neurofunk", "Jungle"] },
      { label: "Ambient", children: ["Dark Ambient", "Drone Ambient"] },
      "Dubstep", "IDM", "Synthwave", "Electro", "Breakbeat",
      { label: "Downtempo", aliases: ["chill", "chillout", "chill-out"] },
      "Trip-Hop", "Industrial", "EBM", "Hardstyle", "Glitch",
      "Chiptune", "Future Bass", "UK Garage", "Vaporwave", "Nu Disco",
      "Big Beat", "Eurodance", "Witch House", "Footwork", "Gabber",
      "Electroclash", "Darkwave",
      "Future Garage", "Speed Garage", "2-Step", "Bassline", "Hardcore Techno",
      "Happy Hardcore", "Speedcore", "Frenchcore", "Italo Disco", "Hi-NRG",
      "Chillwave", "Darksynth", "Future Funk", "Lo-fi House", "Dub Techno",
      "Microhouse", "Moombahton", "Electro Swing", "Jersey Club", "Juke",
      "Riddim", "Melodic Dubstep", "Bass House", "Vocal Trance", "Uplifting Trance",
    ],
  },
  {
    label: "Hip-Hop", color: "#e0a458", keywords: ["hip hop", "hiphop", "rap"],
    aliases: ["hip hop", "hiphop", "rap"],
    subgenres: [
      "Trap", "Boom Bap", "Gangsta Rap", "Conscious Hip-Hop",
      { label: "Lo-fi Hip-Hop", aliases: ["lofi", "lo-fi", "lofi hip hop"] },
      "Drill", "Cloud Rap", "East Coast Hip-Hop", "West Coast Hip-Hop",
      "Southern Hip-Hop", "Grime", "Old School Hip-Hop", "Crunk", "Phonk",
      "Jazz Rap", "Alternative Hip-Hop", "UK Drill", "Memphis Rap",
      "Horrorcore", "G-Funk", "Hyphy", "Mumble Rap",
      "Emo Rap", "Pop Rap", "Abstract Hip-Hop", "Hardcore Hip-Hop",
      "Turntablism", "Chopped and Screwed", "Chicano Rap", "Afroswing",
    ],
  },
  {
    label: "R&B / Soul", color: "#b07cc6", keywords: ["soul", "r&b", "rnb", "rhythm and blues"],
    aliases: ["r&b", "rnb", "soul", "rhythm and blues", "rhythm & blues", "randb"],
    subgenres: [
      "Soul", "Contemporary R&B", "Neo-Soul", "Motown",
      { label: "Funk", children: ["P-Funk"] },
      "Disco", "Quiet Storm", "New Jack Swing", "Southern Soul",
      "Northern Soul", "Psychedelic Soul", "Go-Go", "Boogie",
      "Alternative R&B", "Blue-Eyed Soul", "Memphis Soul", "Philly Soul", "Deep Soul",
    ],
  },
  {
    label: "Jazz", color: "#d9a441", keywords: ["jazz"],
    subgenres: [
      "Bebop", "Swing", "Cool Jazz", "Hard Bop", "Free Jazz",
      { label: "Jazz Fusion", aliases: ["fusion"] },
      "Smooth Jazz", "Modal Jazz", "Latin Jazz", "Big Band", "Dixieland",
      "Nu Jazz", "Acid Jazz", "Gypsy Jazz", "Post-Bop", "Spiritual Jazz",
      "Ragtime", "Soul Jazz", "Jazz-Funk", "Avant-garde Jazz",
      "Vocal Jazz", "Chamber Jazz", "Ethio-Jazz", "Crossover Jazz",
    ],
  },
  {
    label: "Blues", color: "#4a78c2", keywords: ["blues"],
    subgenres: [
      "Delta Blues", "Chicago Blues", "Electric Blues", "Country Blues",
      "Jump Blues", "Soul Blues", "Texas Blues", "British Blues",
      "Piedmont Blues", "Hill Country Blues",
    ],
  },
  {
    label: "Country", color: "#c98a3b", keywords: ["country"],
    subgenres: [
      "Classic Country", "Outlaw Country", "Country Pop", "Bluegrass",
      "Americana", "Honky Tonk", "Alt-Country", "Nashville Sound", "Western Swing",
      "Neotraditional Country", "Red Dirt", "Cowpunk", "Bro-Country",
      "Country Folk", "Progressive Country", "Country Rap", "Western",
    ],
  },
  {
    label: "Folk", color: "#7faa6e", keywords: ["folk"], aliases: ["acoustic"],
    subgenres: [
      "Contemporary Folk", "Traditional Folk", "Indie Folk",
      { label: "Singer-Songwriter", aliases: ["singer songwriter"] },
      "Celtic", "Freak Folk", "Anti-Folk", "Sea Shanty", "Old-Time",
      "Chamber Folk", "Nordic Folk",
      "Psychedelic Folk", "Neofolk", "Dark Folk", "Fingerstyle", "Progressive Folk",
    ],
  },
  {
    label: "Classical", color: "#cbb994", keywords: ["classical", "orchestral", "baroque"],
    subgenres: [
      "Baroque", "Romantic", "Renaissance", "Medieval", "Opera", "Orchestral",
      "Chamber Music", "Contemporary Classical", "Minimalism", "Choral", "Symphony",
      "Impressionism", "Serialism", "Neoclassical", "Gregorian Chant",
      "Concerto", "Sonata", "Classical Crossover",
      "Early Music", "Tone Poem", "Oratorio", "Requiem", "Cantata",
      "Solo Piano", "String Quartet",
    ],
  },
  {
    label: "Reggae", color: "#5cb87a", keywords: ["reggae"],
    subgenres: [
      "Ska", "Dub", "Dancehall", "Rocksteady", "Roots Reggae",
      "Lovers Rock", "Ragga", "Mento", "Dub Poetry",
      "Reggae Fusion", "Nyabinghi",
    ],
  },
  {
    label: "Latin", color: "#e8643c", keywords: ["latin"],
    subgenres: [
      "Salsa", "Bachata", "Merengue", "Cumbia",
      { label: "Reggaeton", aliases: ["reggaeton"] },
      "Latin Pop", "Bossa Nova", "Samba", "Tango", "Mariachi", "Bolero",
      "Flamenco", "Latin Rock", "Norteño", "Vallenato", "Ranchera", "Banda",
      "Forró", "Axé", "Pagode", "Timba", "Nueva Canción", "Champeta",
      "Mambo", "Cha-Cha-Chá", "Rumba", "Son Cubano", "Guaracha", "Tropical",
      "Tejano", "Música Mexicana", "Corridos", "Corridos Tumbados", "Sertanejo",
      "Baile Funk", "MPB", "Tropicália", "Choro", "Dembow", "Latin Trap",
      "Quebradita", "Duranguense",
    ],
  },
  {
    label: "World / Traditional", color: "#4bb3a2", keywords: ["world", "traditional", "ethnic"],
    aliases: ["world", "traditional"],
    subgenres: [
      "Afrobeat", "Afropop", "Highlife", "Amapiano", "Bhangra", "Fado",
      "Klezmer", "Gamelan", "Qawwali", "Soca", "Calypso", "Polka", "Enka",
      "Soukous", "Mbalax", "Raï", "Gnawa", "Balkan", "Township Jive",
      "Throat Singing", "Zouk", "Taarab",
      "Afrobeats", "Kwaito", "Kuduro", "Gqom", "Coupé-Décalé", "Makossa",
      "Bongo Flava", "Bollywood", "Filmi", "Carnatic", "Hindustani",
      "Arabic Pop", "Dabke", "Turkish Pop", "Anatolian Rock", "Rebetiko",
      "Chanson", "Yodeling", "Compas",
    ],
  },
  {
    label: "Gospel / Religious", color: "#c9a0dc", keywords: ["gospel", "christian", "worship"],
    aliases: ["gospel", "christian"],
    subgenres: [
      { label: "Contemporary Christian", aliases: ["ccm"] },
      "Spiritual",
      { label: "Worship", aliases: ["praise and worship", "praise & worship"] },
      "Christian Rock", "Southern Gospel", "Black Gospel", "Christian Metal",
      "Christian Hip-Hop", "Hymn",
      "Urban Contemporary Gospel", "Nasheed", "Christian Punk",
    ],
  },
  {
    label: "Experimental", color: "#6f6fae", keywords: ["experimental", "avant-garde", "avant garde"],
    aliases: ["avant-garde", "avant garde"],
    subgenres: [
      "Noise", "Musique Concrète", "Free Improvisation", "Sound Collage",
      "Plunderphonics", "Lowercase", "Drone", "Sound Art",
    ],
  },
  {
    label: "Other", color: "#6b6457", keywords: [],
    subgenres: [
      { label: "Soundtrack", aliases: ["score", "ost", "film score"] },
      "New Age", "Lounge", "Exotica", "Spoken Word", "Comedy",
      "Children's",
      { label: "Holiday", aliases: ["christmas", "xmas"] },
      "Musical Theatre",
      { label: "Video Game Music", aliases: ["vgm", "game music", "video game"] },
      "Library Music", "Meditation",
      "Film Score", "Cast Recording", "Easy Listening", "Audiobook",
      "Karaoke", "Nature Sounds", "White Noise", "ASMR", "Lullaby", "Anime",
    ],
  },
];

// Family↔family adjacency (musical lineage / influence).
const FAMILY_LINKS: [string, string][] = [
  ["Blues", "Jazz"], ["Blues", "Rock"], ["Blues", "Country"], ["Blues", "R&B / Soul"], ["Blues", "Gospel / Religious"],
  ["Jazz", "R&B / Soul"], ["Jazz", "Latin"], ["Jazz", "Classical"],
  ["R&B / Soul", "Hip-Hop"], ["R&B / Soul", "Pop"], ["R&B / Soul", "Gospel / Religious"],
  ["Hip-Hop", "Electronic"], ["Hip-Hop", "Reggae"], ["Hip-Hop", "Pop"],
  ["Electronic", "Pop"], ["Electronic", "Metal"],
  ["Rock", "Metal"], ["Rock", "Punk"], ["Rock", "Pop"], ["Rock", "Folk"], ["Rock", "Country"],
  ["Punk", "Metal"],
  ["Folk", "Country"], ["Folk", "World / Traditional"], ["Folk", "Classical"],
  ["Latin", "World / Traditional"], ["Latin", "Reggae"],
  ["Reggae", "World / Traditional"],
  ["Classical", "World / Traditional"], ["Classical", "Other"],
  ["Experimental", "Electronic"], ["Experimental", "Classical"],
  ["Experimental", "Metal"], ["Experimental", "Other"],
];

// Cross-family "blend" links between specific subgenres.
const CROSS_LINKS: [string, string][] = [
  ["Blues Rock", "Blues"], ["Folk Rock", "Folk"], ["Country Rock", "Country"],
  ["Jazz Fusion", "Rock"], ["Latin Jazz", "Latin"], ["Acid Jazz", "Electronic"], ["Nu Jazz", "Electronic"],
  ["Reggaeton", "Reggae"], ["Ska Punk", "Ska"],
  ["Trip-Hop", "Hip-Hop"], ["Disco", "Electronic"], ["Funk", "Hip-Hop"], ["Funk", "Jazz"],
  ["Industrial Metal", "Industrial"],
  ["Synth-Pop", "Electronic"], ["Electropop", "Electronic"], ["Dance-Pop", "Electronic"],
  ["Metalcore", "Hardcore Punk"], ["Nu Metal", "Hip-Hop"],
  ["Country Blues", "Country"], ["Bossa Nova", "Jazz"], ["Lo-fi Hip-Hop", "Electronic"],
  ["Christian Rock", "Rock"], ["Southern Gospel", "Country"], ["Soul", "Gospel / Religious"],
  ["Americana", "Folk"], ["Bluegrass", "Folk"], ["Celtic", "World / Traditional"],
  ["Latin Rock", "Rock"], ["Pop Punk", "Pop"], ["Folk Metal", "Folk"],
  ["Symphonic Metal", "Classical"], ["Folk Punk", "Folk"],
  // newer blends
  ["Shoegaze", "Dream Pop"], ["Gothic Rock", "Post-Punk"], ["Rockabilly", "Blues"],
  ["Rockabilly", "Country"], ["New Wave", "Pop"], ["Darkwave", "Gothic Rock"],
  ["Witch House", "Hip-Hop"], ["Jazz Rap", "Jazz"], ["Jazz-Funk", "Funk"],
  ["Soul Jazz", "Soul"], ["Rock and Roll", "Blues"], ["Ragtime", "Blues"],
  ["Christian Metal", "Metal"], ["Christian Hip-Hop", "Hip-Hop"], ["Black Gospel", "Soul"],
  ["Nu Disco", "Disco"], ["Electroclash", "Synth-Pop"], ["Drone", "Drone Metal"],
  ["Noise", "Noise Rock"], ["Cowpunk", "Punk"], ["Zouk", "Latin"],
  ["Nordic Folk", "World / Traditional"], ["Glam Metal", "Glam Rock"],
  ["Industrial", "Experimental"], ["Musique Concrète", "Classical"],
  ["Video Game Music", "Chiptune"], ["G-Funk", "Funk"], ["Phonk", "Memphis Rap"],
  // expansion-pass blends
  ["Baile Funk", "Funk"], ["Baile Funk", "Hip-Hop"], ["Latin Trap", "Trap"],
  ["Afrobeats", "Afrobeat"], ["Anatolian Rock", "Rock"], ["Chanson", "Pop"],
  ["Funk Rock", "Funk"], ["Rap Rock", "Hip-Hop"], ["Industrial Rock", "Industrial"],
  ["Post-Metal", "Post-Rock"], ["Blackgaze", "Shoegaze"], ["Electro Swing", "Swing"],
  ["Moombahton", "Reggaeton"], ["Future Funk", "Funk"], ["Chillwave", "Synthwave"],
  ["Italo Disco", "Disco"], ["Film Score", "Soundtrack"], ["Anime", "J-Pop"],
  ["Mandopop", "Pop"], ["Cantopop", "Pop"], ["Bollywood", "Filmi"],
  ["Country Rap", "Hip-Hop"], ["Reggae Fusion", "Reggae"], ["Ethio-Jazz", "Jazz"],
  ["Alternative R&B", "Contemporary R&B"], ["Pop Soul", "Soul"], ["Darksynth", "Synthwave"],
  ["Dub Techno", "Techno"], ["Jersey Club", "Juke"], ["Christian Punk", "Punk"],
  ["Neofolk", "Experimental"], ["Dark Folk", "Folk"], ["Space Rock", "Psychedelic Rock"],
  ["Yacht Rock", "Soft Rock"], ["Post-Grunge", "Grunge"], ["Acid Rock", "Psychedelic Rock"],
  ["Blue-Eyed Soul", "Soul"], ["Stoner Metal", "Stoner Rock"], ["Crossover Thrash", "Thrash Metal"],
  ["Vocal Trance", "Trance"], ["Bass House", "House"], ["Future Garage", "UK Garage"],
];

// ─── Build flat node / link arrays ───────────────────────────────────────────────

function slug(label: string): string {
  return label.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildGraph() {
  const nodes: TaxonomyNode[] = [];
  const links: TaxonomyLink[] = [];
  const byLabel = new Map<string, TaxonomyNode>();

  const addNode = (label: string, family: string, color: string, depth: number, aliases: string[]) => {
    const node: TaxonomyNode = { id: slug(label), label, family, color, depth, aliases };
    nodes.push(node);
    byLabel.set(label, node);
    return node;
  };

  for (const fam of FAMILIES) {
    const famNode = addNode(fam.label, slug(fam.label), fam.color, 0, fam.aliases ?? []);
    const walk = (sub: SubDef, parentLabel: string) => {
      const label = typeof sub === "string" ? sub : sub.label;
      const aliases = typeof sub === "string" ? [] : sub.aliases ?? [];
      const depth = parentLabel === fam.label ? 1 : 2;
      addNode(label, famNode.family, fam.color, depth, aliases);
      links.push({ source: slug(parentLabel), target: slug(label), kind: "child" });
      if (typeof sub !== "string" && sub.children) {
        for (const c of sub.children) walk(c, label);
      }
    };
    for (const sub of fam.subgenres) walk(sub, fam.label);
  }

  for (const [a, b] of FAMILY_LINKS) {
    if (byLabel.has(a) && byLabel.has(b)) links.push({ source: slug(a), target: slug(b), kind: "family" });
  }
  for (const [a, b] of CROSS_LINKS) {
    if (byLabel.has(a) && byLabel.has(b)) links.push({ source: slug(a), target: slug(b), kind: "cross" });
  }

  return { nodes, links };
}

export const { nodes: TAXONOMY_NODES, links: TAXONOMY_LINKS } = buildGraph();

export const GENRE_FAMILIES = FAMILIES.map((f) => ({ id: slug(f.label), label: f.label, color: f.color }));

// ─── Matching user genres onto taxonomy nodes ────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// normalized term → node id (built once)
const NORM_INDEX = new Map<string, string>();
for (const n of TAXONOMY_NODES) {
  NORM_INDEX.set(normalize(n.label), n.id);
  for (const a of n.aliases) NORM_INDEX.set(normalize(a), n.id);
}

// family keyword → family node id, longest keywords first for specificity
const FAMILY_KEYWORDS: { norm: string; id: string }[] = [];
for (const fam of FAMILIES) {
  for (const kw of fam.keywords) FAMILY_KEYWORDS.push({ norm: normalize(kw), id: slug(fam.label) });
}
FAMILY_KEYWORDS.sort((a, b) => b.norm.length - a.norm.length);

// Largest contiguous run of whole words that maps to a node wins. This resolves
// compound tags ("Atmospheric Black Metal" → Black Metal, "Soulful House" → House)
// without needing every variant enumerated in the taxonomy.
function matchByNgram(name: string): string | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;
  for (let size = words.length; size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const id = NORM_INDEX.get(words.slice(i, i + size).join(""));
      if (id) return id;
    }
  }
  return null;
}

export type MatchMethod = "exact" | "segment" | "ngram" | "family";

/** Resolve a tag to a node id + the method used (for confidence display). */
export function resolveGenreNodeDetailed(name: string): { id: string; method: MatchMethod } | null {
  const raw = name.trim();
  if (!raw) return null;
  const n = normalize(raw);
  if (!n) return null;

  // 1) exact label / alias match
  const exact = NORM_INDEX.get(n);
  if (exact) return { id: exact, method: "exact" };

  // 2) compound tags ("Rock/Pop", "Hip-Hop; Trap", "Funk - Soul"): each segment whole
  const segments = raw.split(/[/;,|·]| - | x /i).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    for (const seg of segments) {
      const id = NORM_INDEX.get(normalize(seg));
      if (id) return { id, method: "segment" };
    }
  }

  // 3) word-n-gram against node labels/aliases (the big one)
  const ngram = matchByNgram(raw);
  if (ngram) return { id: ngram, method: "ngram" };

  // 4) family-keyword fallback (longest keyword first)
  for (const fk of FAMILY_KEYWORDS) {
    if (fk.norm && n.includes(fk.norm)) return { id: fk.id, method: "family" };
  }
  return null;
}

/** Resolve a single user genre string to a taxonomy node id, or null. */
export function resolveGenreNode(name: string): string | null {
  return resolveGenreNodeDetailed(name)?.id ?? null;
}

export function normalizeGenre(s: string): string {
  return normalize(s);
}

export interface GenreMatch {
  count: number;        // total tracks across matched user genres
  userGenres: string[]; // original user genre strings that mapped here
  fuzzy: boolean;       // true only if every contributing tag was a guess (ngram/family)
}

export type TagMethod = MatchMethod | "alias";

export interface TagInfo {
  tag: string;
  count: number;
  nodeId: string | null;          // null = unmatched (goes to "Other")
  method: TagMethod | null;
}

export interface MatchResult {
  matches: Map<string, GenreMatch>;             // nodeId → match
  unmatched: { name: string; count: number }[]; // user genres with no taxonomy home
  tags: TagInfo[];                              // per-tag resolution detail (diagnostics)
}

export function matchUserGenres(
  userGenres: { name: string; track_count: number }[],
  overrides?: Map<string, string>, // normalized tag → forced nodeId (user aliases)
): MatchResult {
  const matches = new Map<string, GenreMatch>();
  const unmatched: { name: string; count: number }[] = [];
  const tags: TagInfo[] = [];
  for (const g of userGenres) {
    let id: string | null = null;
    let method: TagMethod | null = null;
    const ov = overrides?.get(normalize(g.name));
    if (ov) { id = ov; method = "alias"; }
    else { const d = resolveGenreNodeDetailed(g.name); if (d) { id = d.id; method = d.method; } }

    tags.push({ tag: g.name, count: g.track_count, nodeId: id, method });
    if (!id) { if (g.name.trim()) unmatched.push({ name: g.name, count: g.track_count }); continue; }

    const m = matches.get(id) ?? { count: 0, userGenres: [], fuzzy: true };
    m.count += g.track_count;
    if (!m.userGenres.includes(g.name)) m.userGenres.push(g.name);
    if (method === "exact" || method === "segment" || method === "alias") m.fuzzy = false;
    matches.set(id, m);
  }
  return { matches, unmatched, tags };
}
