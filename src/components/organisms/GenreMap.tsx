import { useEffect, useReducer, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useGenres } from "../../hooks/useGenres";
import { useGenreStats, useGenreCooccurrence } from "../../hooks/useGenreStats";
import { useArtwork } from "../../hooks/useArtwork";
import { usePlayerStore } from "../../store/playerStore";
import { useRecentlyPlayedStore } from "../../store/recentlyPlayedStore";
import { useToastStore } from "../../store/toastStore";
import { useCreatePlaylist, useAddToPlaylist } from "../../hooks/usePlaylist";
import { useGenreMapStore, GenreAlias } from "../../store/genreMapStore";
import { Track } from "../../types/track";
import { TrackRow, TrackRowHeader } from "../molecules/TrackRow";
import {
  TAXONOMY_NODES,
  TAXONOMY_LINKS,
  GENRE_FAMILIES,
  matchUserGenres,
  resolveGenreNode,
  resolveGenreNodesAll,
  normalizeGenre,
  TagInfo,
} from "../../data/genreTaxonomy";

type SizeMetric = "tracks" | "albums" | "artists";

// ─── Simulation types ────────────────────────────────────────────────────────────

interface SimNode {
  id: string;
  label: string;
  family: string;
  color: string;
  depth: number;
  mass: number;
  active: boolean;
  custom: boolean;
  fuzzy: boolean;
  reparented: boolean;
  pinned: boolean;
  count: number;
  albums: number;
  artists: number;
  userGenres: string[];
  x: number; y: number;
  vx: number; vy: number;
  ax: number; ay: number;
  fx: number | null; fy: number | null;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: "family" | "child" | "cross";
  custom: boolean;
  linkId?: string;
  label?: string;
  weight?: number;
  rest: number;
}

interface Sim {
  nodes: SimNode[];
  links: SimLink[];
  byId: Map<string, SimNode>;
  alpha: number;
  running: boolean;
  raf: number;
}

// ─── Force constants ─────────────────────────────────────────────────────────────

const CHARGE = 2600;
const CENTER = 0.009;
const SPRING = 0.045;
const FRICTION = 0.82;
const ALPHA_DECAY = 0.009;
const ALPHA_MIN = 0.02;
const MAX_V = 34;
const THETA = 0.9; // Barnes-Hut accuracy/speed threshold
const FAMILY_COLOR = new Map(GENRE_FAMILIES.map((f) => [f.id, f.color]));
const OTHER_COLOR = FAMILY_COLOR.get("other") ?? "#6b6457";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function restLen(kind: SimLink["kind"], sourceDepth: number): number {
  if (kind === "family") return 340;
  if (kind === "cross") return 180;
  return sourceDepth === 0 ? 110 : 78;
}

function baseRadius(n: SimNode, metric: SizeMetric): number {
  const base = n.depth === 0 ? 13 : n.depth === 1 ? 7 : 5.5;
  if (!n.active) return base * 0.75;
  const v = metric === "albums" ? n.albums : metric === "artists" ? n.artists : n.count;
  const mul = metric === "albums" ? 2.6 : metric === "artists" ? 3.4 : 1.7;
  return base + Math.min(16, Math.sqrt(Math.max(0, v)) * mul);
}

function linkWidthFactor(weight?: number): number {
  if (weight === 1) return 0.9;
  if (weight === 3) return 2.4;
  return 1.4; // 2 / default
}

// Edge curving — control point pulled toward the graph centre (origin) so long
// rim-to-rim edges bundle gently, while short edges only arc a little (the offset
// is capped by edge length so nearby nodes don't get dramatic bows).
const EDGE_CURVE = 0.18;
function edgeCtrl(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dlen = Math.hypot(mx, my) || 1;
  const off = Math.min(EDGE_CURVE * dlen, 0.35 * len); // toward origin, capped by edge length
  return { cx: mx - (mx / dlen) * off, cy: my - (my / dlen) * off };
}

// Shortest path (by hops) between two nodes over the graph edges — for "Path" mode.
function shortestPath(links: SimLink[], fromId: string, toId: string): string[] {
  if (fromId === toId) return [fromId];
  const adj = new Map<string, string[]>();
  const push = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
  for (const l of links) { push(l.source.id, l.target.id); push(l.target.id, l.source.id); }
  const prev = new Map<string, string>();
  const seen = new Set([fromId]);
  const q = [fromId];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === toId) break;
    for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); prev.set(nb, cur); q.push(nb); }
  }
  if (!prev.has(toId)) return [];
  const path = [toId];
  let c = toId;
  while (c !== fromId) { const p = prev.get(c); if (!p) return []; path.unshift(p); c = p; }
  return path;
}

// Convex hull (monotone chain) for family "region" blobs.
function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of s) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: { x: number; y: number }[] = [];
  for (let i = s.length - 1; i >= 0; i--) { const p = s[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Rounded "blob" path through hull points (quadratic through edge midpoints).
function hullPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 3) return "";
  const last = pts[pts.length - 1];
  let d = `M ${(pts[0].x + last.x) / 2} ${(pts[0].y + last.y) / 2}`;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i], next = pts[(i + 1) % pts.length];
    d += ` Q ${cur.x} ${cur.y} ${(cur.x + next.x) / 2} ${(cur.y + next.y) / 2}`;
  }
  return d + " Z";
}

interface CustomNodeDef { id: string; label: string; family: string; }
interface CustomLinkDef { id: string; source: string; target: string; label?: string; weight?: number; }
interface AliasInput { norm: string; tag: string; nodeId: string; mode: "merge" | "move"; }

function buildSim(
  userGenres: { name: string; track_count: number }[],
  customNodes: CustomNodeDef[],
  customLinks: CustomLinkDef[],
  prev: Map<string, { x: number; y: number }>,
  aliases: AliasInput[],
  statsByNorm: Map<string, { albums: number; artists: number }>,
  pinnedById: Map<string, { x: number; y: number }>,
): Sim {
  // "merge" aliases force a tag onto a node; "move" aliases keep the tag as its
  // own node, so they're excluded from normal matching and built separately.
  const mergeOverrides = new Map(aliases.filter((a) => a.mode !== "move").map((a) => [a.norm, a.nodeId]));
  const reparents = aliases.filter((a) => a.mode === "move");
  const reparentNorms = new Set(reparents.map((a) => a.norm));
  const forMatch = userGenres.filter((g) => !reparentNorms.has(norm(g.name)));
  const { matches, unmatched } = matchUserGenres(forMatch, mergeOverrides);

  const userByNorm = new Map<string, { count: number; name: string }>();
  for (const g of userGenres) {
    const k = norm(g.name);
    if (!k) continue;
    const e = userByNorm.get(k);
    if (e) e.count += g.track_count;
    else userByNorm.set(k, { count: g.track_count, name: g.name });
  }

  const nodes: SimNode[] = TAXONOMY_NODES.map((n) => {
    const m = matches.get(n.id);
    return {
      id: n.id, label: n.label, family: n.family, color: n.color, depth: n.depth,
      mass: n.depth === 0 ? 2.2 : 1,
      active: !!m, custom: false, fuzzy: m?.fuzzy ?? false, reparented: false, pinned: false, count: m?.count ?? 0, albums: 0, artists: 0, userGenres: m?.userGenres ?? [],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    };
  });

  unmatched.forEach((u, i) => {
    nodes.push({
      id: `extra-${i}`, label: u.name, family: "other", color: OTHER_COLOR, depth: 1,
      mass: 1, active: true, custom: false, fuzzy: false, reparented: false, pinned: false, count: u.count, albums: 0, artists: 0, userGenres: [u.name],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    });
  });

  for (const c of customNodes) {
    const u = userByNorm.get(norm(c.label));
    const m = matches.get(c.id); // tags the user aliased onto this custom node
    const ug = new Set<string>();
    if (u) ug.add(u.name);
    if (m) for (const g of m.userGenres) ug.add(g);
    nodes.push({
      id: c.id, label: c.label, family: c.family, color: FAMILY_COLOR.get(c.family) ?? OTHER_COLOR,
      depth: 1, mass: 1, active: true, custom: true, fuzzy: false, reparented: false, pinned: false,
      count: (u?.count ?? 0) + (m?.count ?? 0), albums: 0, artists: 0, userGenres: [...ug],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    });
  }

  // "move" aliases: the tag stays as its own node, linked to the chosen node.
  for (const r of reparents) {
    const u = userByNorm.get(r.norm);
    nodes.push({
      id: `reparent-${r.norm}`, label: r.tag, family: "other", color: OTHER_COLOR,
      depth: 1, mass: 1, active: !!u, custom: false, fuzzy: false, reparented: true, pinned: false,
      count: u?.count ?? 0, albums: 0, artists: 0, userGenres: u ? [u.name] : [],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // colour reparent nodes by their parent's family (now that byId exists)
  for (const r of reparents) {
    const node = byId.get(`reparent-${r.norm}`);
    const parent = byId.get(r.nodeId);
    if (node && parent) { node.family = parent.family; node.color = parent.color; }
  }

  // Aggregate album/artist counts per node from its contributing tags.
  for (const nd of nodes) {
    let alb = 0, art = 0;
    for (const ug of nd.userGenres) {
      const s = statsByNorm.get(norm(ug));
      if (s) { alb += s.albums; art += s.artists; }
    }
    nd.albums = alb; nd.artists = art;
  }
  const links: SimLink[] = [];
  for (const l of TAXONOMY_LINKS) {
    const s = byId.get(l.source), t = byId.get(l.target);
    if (s && t) links.push({ source: s, target: t, kind: l.kind, custom: false, rest: restLen(l.kind, s.depth) });
  }
  const other = byId.get("other");
  if (other) {
    unmatched.forEach((_, i) => {
      const t = byId.get(`extra-${i}`);
      if (t) links.push({ source: other, target: t, kind: "child", custom: false, rest: 78 });
    });
  }
  for (const l of customLinks) {
    const s = byId.get(l.source), t = byId.get(l.target);
    if (s && t) links.push({ source: s, target: t, kind: "cross", custom: true, linkId: l.id, label: l.label, weight: l.weight, rest: 180 });
  }
  for (const r of reparents) {
    const s = byId.get(`reparent-${r.norm}`);
    const t = byId.get(r.nodeId) ?? byId.get("other");
    if (s && t) links.push({ source: s, target: t, kind: "cross", custom: true, rest: 120 });
  }

  const fams = GENRE_FAMILIES;
  const R0 = 580;
  fams.forEach((f, fi) => {
    const hub = byId.get(f.id);
    if (!hub) return;
    const p = prev.get(hub.id);
    if (p) { hub.x = p.x; hub.y = p.y; }
    else { const ang = (fi / fams.length) * Math.PI * 2; hub.x = Math.cos(ang) * R0; hub.y = Math.sin(ang) * R0; }
  });
  const counters = new Map<string, number>();
  for (const n of nodes) {
    if (n.depth === 0) continue;
    const p = prev.get(n.id);
    if (p) { n.x = p.x; n.y = p.y; continue; }
    const idx = counters.get(n.family) ?? 0;
    counters.set(n.family, idx + 1);
    if (n.custom) continue;
    const hub = byId.get(n.family);
    const a = idx * 2.39996;
    const r = 95 + (n.depth - 1) * 46 + idx * 4;
    const hx = hub ? hub.x : 0, hy = hub ? hub.y : 0;
    n.x = hx + Math.cos(a) * r + ((idx % 5) - 2) * 3;
    n.y = hy + Math.sin(a) * r + ((idx % 3) - 1) * 3;
  }
  let ci = 0;
  for (const c of customNodes) {
    const node = byId.get(c.id);
    if (!node || prev.get(c.id)) continue;
    const link = customLinks.find((l) => l.source === c.id || l.target === c.id);
    const anchorId = link ? (link.source === c.id ? link.target : link.source) : null;
    const anchor = anchorId ? byId.get(anchorId) : null;
    if (anchor) { node.x = anchor.x + 30 + (ci % 3) * 8; node.y = anchor.y + 30 - (ci % 3) * 8; }
    else { node.x = ((ci % 4) - 1.5) * 26; node.y = ((ci % 4) - 1.5) * 26; }
    ci++;
  }

  // Pinned nodes: fix them where the user dropped them.
  for (const [id, pos] of pinnedById) {
    const n = byId.get(id);
    if (n) { n.x = pos.x; n.y = pos.y; n.fx = pos.x; n.fy = pos.y; n.pinned = true; }
  }

  return { nodes, links, byId, alpha: 1, running: false, raf: 0 };
}

// ─── Barnes-Hut quadtree (charge) ────────────────────────────────────────────────

interface QCell {
  x0: number; y0: number; size: number;
  cx: number; cy: number; mass: number;
  body: SimNode | null;
  children: QCell[] | null;
}

function makeCell(x0: number, y0: number, size: number): QCell {
  return { x0, y0, size, cx: 0, cy: 0, mass: 0, body: null, children: null };
}

function insert(cell: QCell, n: SimNode) {
  // accumulate centre of mass
  const m = cell.mass + n.mass;
  cell.cx = (cell.cx * cell.mass + n.x * n.mass) / m;
  cell.cy = (cell.cy * cell.mass + n.y * n.mass) / m;
  cell.mass = m;

  if (!cell.children && cell.body === null) { cell.body = n; return; }

  if (!cell.children) {
    const existing = cell.body;
    cell.body = null;
    const half = cell.size / 2;
    cell.children = [
      makeCell(cell.x0, cell.y0, half),
      makeCell(cell.x0 + half, cell.y0, half),
      makeCell(cell.x0, cell.y0 + half, half),
      makeCell(cell.x0 + half, cell.y0 + half, half),
    ];
    if (existing && half > 0.5) insertChild(cell, existing);
    else if (existing) { /* coincident bodies: drop into mass only */ }
  }
  if (cell.size / 2 > 0.5) insertChild(cell, n);
}

function insertChild(cell: QCell, n: SimNode) {
  const half = cell.size / 2;
  const idx = (n.x >= cell.x0 + half ? 1 : 0) + (n.y >= cell.y0 + half ? 2 : 0);
  insert(cell.children![idx], n);
}

function applyCharge(cell: QCell, n: SimNode) {
  if (cell.mass === 0) return;
  if (cell.body) {
    if (cell.body === n) return;
    accum(n, cell.cx, cell.cy, cell.mass);
    return;
  }
  let dx = cell.cx - n.x, dy = cell.cy - n.y;
  let d2 = dx * dx + dy * dy;
  if (d2 < 1e-6) d2 = 1e-6;
  const d = Math.sqrt(d2);
  if (cell.size / d < THETA) { accum(n, cell.cx, cell.cy, cell.mass, dx, dy, d2, d); return; }
  if (cell.children) for (const c of cell.children) applyCharge(c, n);
  else accum(n, cell.cx, cell.cy, cell.mass);
}

function accum(n: SimNode, cx: number, cy: number, mass: number, dxIn?: number, dyIn?: number, d2In?: number, dIn?: number) {
  let dx = dxIn ?? cx - n.x;
  let dy = dyIn ?? cy - n.y;
  let d2 = d2In ?? dx * dx + dy * dy;
  if (d2 < 25) { d2 = 25; if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; } }
  const d = dIn && d2In ? dIn : Math.sqrt(d2);
  const f = (CHARGE * n.mass * mass) / d2;
  n.ax -= (dx / d) * f;
  n.ay -= (dy / d) * f;
}

function tickPhysics(sim: Sim) {
  const { nodes, links } = sim;
  const n = nodes.length;
  if (n === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const nd = nodes[i]; nd.ax = 0; nd.ay = 0;
    if (nd.x < minX) minX = nd.x; if (nd.x > maxX) maxX = nd.x;
    if (nd.y < minY) minY = nd.y; if (nd.y > maxY) maxY = nd.y;
  }
  const size = Math.max(maxX - minX, maxY - minY, 1) + 2;
  const root = makeCell(minX - 1, minY - 1, size);
  for (let i = 0; i < n; i++) insert(root, nodes[i]);
  for (let i = 0; i < n; i++) applyCharge(root, nodes[i]);

  for (const l of links) {
    const s = l.source, t = l.target;
    let dx = t.x - s.x, dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const diff = (d - l.rest) * SPRING;
    const fx = (dx / d) * diff, fy = (dy / d) * diff;
    s.ax += fx; s.ay += fy;
    t.ax -= fx; t.ay -= fy;
  }

  const alpha = sim.alpha;
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    node.ax += -node.x * CENTER;
    node.ay += -node.y * CENTER;
    if (node.fx != null) { node.x = node.fx; node.vx = 0; }
    else {
      node.vx = (node.vx + node.ax * alpha) * FRICTION;
      if (node.vx > MAX_V) node.vx = MAX_V; else if (node.vx < -MAX_V) node.vx = -MAX_V;
      node.x += node.vx;
    }
    if (node.fy != null) { node.y = node.fy; node.vy = 0; }
    else {
      node.vy = (node.vy + node.ay * alpha) * FRICTION;
      if (node.vy > MAX_V) node.vy = MAX_V; else if (node.vy < -MAX_V) node.vy = -MAX_V;
      node.y += node.vy;
    }
  }
  sim.alpha = Math.max(0, sim.alpha - ALPHA_DECAY);
}

// ─── Component ───────────────────────────────────────────────────────────────────

interface GenreMapProps { onBack: () => void; }

export function GenreMap({ onBack }: GenreMapProps) {
  const { data: genres = [], isLoading } = useGenres("", true, "count");
  const hasTrack = usePlayerStore((s) => !!s.currentTrack);
  const { customNodes, customLinks, aliases, pins, addNode, removeNode, addLink, removeLink, updateLink, setAlias, removeAlias, setPin, removePin, clearPins } = useGenreMapStore();
  const pinnedById = useMemo(() => new Map(pins.map((p) => [p.id, { x: p.x, y: p.y }])), [pins]);
  const { data: genreStats = [] } = useGenreStats();
  const statsByNorm = useMemo(() => {
    const m = new Map<string, { albums: number; artists: number }>();
    for (const s of genreStats) m.set(normalizeGenre(s.name), { albums: s.albums, artists: s.artists });
    return m;
  }, [genreStats]);

  const simRef = useRef<Sim | null>(null);
  const [, forceRender] = useReducer((c) => c + 1, 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 0.45 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const centeredRef = useRef(false);

  // Tools
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addFamily, setAddFamily] = useState("other");
  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [constellation, setConstellation] = useState(false);
  const [isolatedFamily, setIsolatedFamily] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>("tracks");
  const [affinity, setAffinity] = useState(false);
  const [regions, setRegions] = useState(false);
  const [recent, setRecent] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const recentTracks = useRecentlyPlayedStore((s) => s.tracks);
  // Discovery (Phase 4)
  const [discover, setDiscover] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [pathFromId, setPathFromId] = useState<string | null>(null);
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const createPlaylist = useCreatePlaylist();
  const addToPlaylist = useAddToPlaylist();
  const showToast = useToastStore((s) => s.show);
  const queryClient = useQueryClient();
  const [selectionTracks, setSelectionTracks] = useState<Track[]>([]);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [pathSteps, setPathSteps] = useState<{ id: string; label: string; color: string; track: Track | null }[]>([]);
  const [pathTail, setPathTail] = useState<Track[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);

  const drag = useRef<{ mode: "none" | "node" | "pan" | "lasso"; node: SimNode | null; lastX: number; lastY: number; moved: number; }>(
    { mode: "none", node: null, lastX: 0, lastY: 0, moved: 0 },
  );

  // Data-driven affinity edges (only fetched when the overlay is on).
  const { data: cooccur = [] } = useGenreCooccurrence(affinity);

  useEffect(() => {
    if (isLoading) return;
    const prevPos = new Map<string, { x: number; y: number }>();
    if (simRef.current) for (const nd of simRef.current.nodes) prevPos.set(nd.id, { x: nd.x, y: nd.y });
    const firstBuild = !simRef.current;
    const sim = buildSim(
      genres.map((g) => ({ name: g.name, track_count: g.track_count })),
      customNodes, customLinks, prevPos, aliases, statsByNorm, pinnedById,
    );
    if (!firstBuild) sim.alpha = 0.6;
    simRef.current = sim;
    startLoop();
    return () => { if (sim.raf) cancelAnimationFrame(sim.raf); sim.running = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, genres, customNodes, customLinks, aliases, statsByNorm, pinnedById]);

  // Fetch the union of tracks for the current multi-selection.
  useEffect(() => {
    const s = simRef.current;
    if (!s || selection.size === 0) { setSelectionTracks([]); return; }
    let cancelled = false; setSelectionLoading(true);
    (async () => {
      const all: Track[] = []; const seen = new Set<string>();
      for (const id of selection) {
        const n = s.byId.get(id);
        if (!n || !n.active) continue;
        for (const g of n.userGenres) {
          try {
            const t = await invoke<Track[]>("get_genre_tracks", { genre: g, limit: 500, offset: 0 });
            for (const tr of t ?? []) if (!seen.has(tr.path)) { seen.add(tr.path); all.push(tr); }
          } catch { /* skip */ }
        }
      }
      if (!cancelled) { setSelectionTracks(all); setSelectionLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selection]);

  function startLoop() {
    const sim = simRef.current;
    if (!sim || sim.running) return;
    sim.running = true;
    const step = () => {
      const s = simRef.current;
      if (!s || !s.running) return;
      tickPhysics(s); tickPhysics(s); tickPhysics(s);
      forceRender();
      if (s.alpha <= ALPHA_MIN) { s.running = false; return; }
      s.raf = requestAnimationFrame(step);
    };
    sim.raf = requestAnimationFrame(step);
  }
  function reheat(target = 0.4) {
    const sim = simRef.current; if (!sim) return;
    sim.alpha = Math.max(sim.alpha, target);
    startLoop();
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => { const r = entries[0].contentRect; setSize({ w: r.width, h: r.height }); });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (size.w > 0 && size.h > 0 && !centeredRef.current) {
      centeredRef.current = true;
      setTransform({ x: size.w / 2, y: size.h / 2, k: 0.45 });
    }
  }, [size]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const k = Math.max(0.12, Math.min(3.5, t.k * factor));
        const wx = (px - t.x) / t.k, wy = (py - t.y) / t.k;
        return { x: px - wx * k, y: py - wy * k, k };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (addOpen) setAddOpen(false);
      else if (connectMode) { setConnectMode(false); setConnectFromId(null); }
      else if (pathMode) { setPathMode(false); setPathFromId(null); }
      else if (selectMode) setSelectMode(false);
      else if (selection.size) setSelection(new Set());
      else if (pathIds.length) { setPathIds([]); setPathSteps([]); setPathTail([]); }
      else if (search) setSearch("");
      else if (selectedId) setSelectedId(null);
      else onBack();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [addOpen, connectMode, pathMode, selectMode, selection, pathIds, search, selectedId, onBack]);

  function screenToWorld(px: number, py: number) {
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  }
  function relPoint(e: React.PointerEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function centerOn(node: SimNode, zoom = 1.1) {
    setTransform({ x: size.w / 2 - node.x * zoom, y: size.h / 2 - node.y * zoom, k: zoom });
    setSelectedId(node.id);
  }
  function jumpTo(id: string) {
    const n = simRef.current?.byId.get(id);
    if (!n) return;
    const zoom = Math.max(transform.k, 1.0);
    setTransform({ x: size.w / 2 - n.x * zoom, y: size.h / 2 - n.y * zoom, k: zoom });
  }

  function fitView() {
    const sim = simRef.current; if (!sim || size.w === 0) return;
    const visible = sim.nodes.filter((n) => !(constellation && !n.active));
    if (!visible.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visible) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const k = Math.max(0.12, Math.min(1.4, Math.min((size.w - 120) / w, (size.h - 160) / h)));
    setTransform({ x: size.w / 2 - (minX + maxX) / 2 * k, y: size.h / 2 - (minY + maxY) / 2 * k, k });
  }

  function handleConnectPick(node: SimNode) {
    if (!connectFromId) { setConnectFromId(node.id); return; }
    if (node.id !== connectFromId) addLink(connectFromId, node.id);
    setConnectMode(false); setConnectFromId(null);
  }
  function handlePathPick(node: SimNode) {
    setPathSteps([]); setPathTail([]);
    if (!pathFromId) { setPathFromId(node.id); setPathIds([node.id]); return; }
    const s = simRef.current;
    if (s) setPathIds(shortestPath(s.links, pathFromId, node.id));
    setPathFromId(null); setPathMode(false);
  }
  function commitLasso() {
    const l = lasso, s = simRef.current;
    if (!l || !s) return;
    const xmin = Math.min(l.x0, l.x1), xmax = Math.max(l.x0, l.x1), ymin = Math.min(l.y0, l.y1), ymax = Math.max(l.y0, l.y1);
    if (xmax - xmin < 4 && ymax - ymin < 4) return;
    const next = new Set(selection);
    for (const n of s.nodes) {
      if (!nodeVisible(n)) continue;
      const sx = n.x * transform.k + transform.x, sy = n.y * transform.k + transform.y;
      if (sx >= xmin && sx <= xmax && sy >= ymin && sy <= ymax) next.add(n.id);
    }
    setSelection(next);
  }

  function onNodePointerDown(e: React.PointerEvent, node: SimNode) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { px, py } = relPoint(e);
    drag.current = { mode: "node", node, lastX: px, lastY: py, moved: 0 };
    node.fx = node.x; node.fy = node.y; reheat(0.3);
  }
  function onSvgPointerDown(e: React.PointerEvent) {
    const { px, py } = relPoint(e);
    if (selectMode) { drag.current = { mode: "lasso", node: null, lastX: px, lastY: py, moved: 0 }; setLasso({ x0: px, y0: py, x1: px, y1: py }); }
    else drag.current = { mode: "pan", node: null, lastX: px, lastY: py, moved: 0 };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (d.mode === "none") return;
    const { px, py } = relPoint(e);
    const dx = px - d.lastX, dy = py - d.lastY;
    d.moved += Math.abs(dx) + Math.abs(dy); d.lastX = px; d.lastY = py;
    if (d.mode === "node" && d.node) { const w = screenToWorld(px, py); d.node.fx = w.x; d.node.fy = w.y; reheat(0.3); }
    else if (d.mode === "pan") setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    else if (d.mode === "lasso") setLasso((cur) => (cur ? { ...cur, x1: px, y1: py } : cur));
  }
  function onPointerUp() {
    const d = drag.current;
    if (d.mode === "node" && d.node) {
      if (d.moved < 6) {
        if (connectMode) handleConnectPick(d.node);
        else if (pathMode) handlePathPick(d.node);
        else if (selectMode) setSelection((s) => { const n = new Set(s); if (n.has(d.node!.id)) n.delete(d.node!.id); else n.add(d.node!.id); return n; });
        else setSelectedId(d.node.id);
        d.node.fx = null; d.node.fy = null;
      } else {
        setPin(d.node.id, d.node.x, d.node.y); d.node.pinned = true; // dragged → pin
      }
      reheat(0.15);
    } else if (d.mode === "lasso") {
      commitLasso(); setLasso(null);
    } else if (d.mode === "pan") {
      if (d.moved < 6) {
        if (connectMode) { setConnectMode(false); setConnectFromId(null); }
        else if (pathMode) { setPathMode(false); setPathFromId(null); }
        else setSelectedId(null);
      }
    }
    drag.current = { mode: "none", node: null, lastX: 0, lastY: 0, moved: 0 };
  }

  function playSelection(shuffle = false) {
    const t = [...selectionTracks];
    if (!t.length) return;
    if (shuffle) for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    const ps = usePlayerStore.getState(); ps.setQueue(t, 0); ps.setIsPlaying(true);
    showToast(`Playing ${t.length} tracks`);
  }
  function queueSelection() {
    if (!selectionTracks.length) return;
    const ps = usePlayerStore.getState();
    for (const tr of selectionTracks) ps.addToQueue(tr);
    showToast(`Queued ${selectionTracks.length} tracks`);
  }
  async function playlistSelection() {
    if (!selectionTracks.length) return;
    const name = `Genre mix (${selection.size})`;
    const id = await createPlaylist.mutateAsync(name);
    await addToPlaylist.mutateAsync({ playlistId: id as unknown as number, trackPaths: selectionTracks.map((x) => x.path) });
    showToast(`Created "${name}" · ${selectionTracks.length} tracks`);
  }

  // A3: opt-in metadata cleanup — rewrite genre tags in the files (user-confirmed).
  async function mergeCluster(variants: string[], target: string) {
    try {
      const res = await invoke<{ updated: number; file_failed: number }>("rewrite_genre_tag", { fromGenres: variants, toGenre: target });
      // Force the genre data to reload so the diagnostics + map recompute now.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["genres"] }),
        queryClient.refetchQueries({ queryKey: ["genre-stats"] }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["genre-cooccurrence"] });
      queryClient.invalidateQueries({ queryKey: ["album-tracks"] });
      queryClient.invalidateQueries({ queryKey: ["tracks-page"] });
      queryClient.invalidateQueries({ queryKey: ["tracks-count"] });
      showToast(
        res.file_failed > 0
          ? `Merged ${res.updated} → ${target} · ${res.file_failed} file(s) locked, not written to disk`
          : `Merged ${res.updated} tracks → ${target}`,
      );
    } catch (e) {
      showToast(`Merge failed: ${String(e)}`);
    }
  }

  // Path "transition": queue one song from each genre along the path, in order,
  // then keep playing the destination genre (so it doesn't loop back to the start).
  async function buildTransition() {
    const s = simRef.current;
    if (!s || pathIds.length < 1) return;
    const steps: { id: string; label: string; color: string; track: Track | null }[] = [];
    const queue: Track[] = [];
    let destPool: Track[] = [];
    const lastId = pathIds[pathIds.length - 1];
    for (const id of pathIds) {
      const n = s.byId.get(id);
      if (!n) continue;
      let track: Track | null = null;
      if (n.active && n.userGenres.length) {
        const pool: Track[] = []; const seen = new Set<string>();
        for (const g of n.userGenres) {
          try {
            const t = await invoke<Track[]>("get_genre_tracks", { genre: g, limit: 200, offset: 0 });
            for (const tr of t ?? []) if (!seen.has(tr.path)) { seen.add(tr.path); pool.push(tr); }
          } catch { /* skip */ }
        }
        if (pool.length) { track = pool[Math.floor(Math.random() * pool.length)]; queue.push(track); }
        if (id === lastId) destPool = pool;
      }
      steps.push({ id, label: n.label, color: n.active ? n.color : "#3a3628", track });
    }
    // Tail: the rest of the destination genre (shuffled) so playback settles there.
    let tail: Track[] = [];
    if (destPool.length > 1) {
      const usedPath = queue[queue.length - 1]?.path;
      tail = destPool.filter((t) => t.path !== usedPath);
      for (let i = tail.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tail[i], tail[j]] = [tail[j], tail[i]]; }
      tail = tail.slice(0, 40);
      queue.push(...tail);
    }
    setPathSteps(steps);
    setPathTail(tail);
    if (queue.length) { const ps = usePlayerStore.getState(); ps.setQueue(queue, 0); ps.setIsPlaying(true); showToast(`Transitioning to ${s.byId.get(lastId)?.label ?? "destination"}`); }
  }

  const sim = simRef.current;
  const selected = (sim && selectedId) ? sim.byId.get(selectedId) ?? null : null;

  const affinityEdges = useMemo(() => {
    if (!sim || !affinity || cooccur.length === 0) return [];
    const agg = new Map<string, { a: SimNode; b: SimNode; strength: number }>();
    for (const c of cooccur) {
      const ai = resolveGenreNode(c.a), bi = resolveGenreNode(c.b);
      if (!ai || !bi || ai === bi) continue;
      const na = sim.byId.get(ai), nb = sim.byId.get(bi);
      if (!na || !nb) continue;
      const key = ai < bi ? `${ai}|${bi}` : `${bi}|${ai}`;
      const e = agg.get(key);
      if (e) e.strength += c.shared;
      else agg.set(key, { a: na, b: nb, strength: c.shared });
    }
    return [...agg.values()].sort((x, y) => y.strength - x.strength).slice(0, 300);
  }, [sim, affinity, cooccur]);
  const affinityMax = affinityEdges.reduce((m, e) => Math.max(m, e.strength), 1);

  // Family "region" hulls (recomputed while the layout settles).
  const hulls = useMemo(() => {
    if (!sim || !regions) return [];
    const byFam = new Map<string, { x: number; y: number }[]>();
    for (const n of sim.nodes) {
      if (constellation && !n.active && n.depth !== 0) continue;
      const arr = byFam.get(n.family) ?? [];
      arr.push({ x: n.x, y: n.y });
      byFam.set(n.family, arr);
    }
    const out: { color: string; d: string }[] = [];
    for (const [fam, pts] of byFam) {
      if (pts.length < 3) continue;
      const hull = convexHull(pts);
      if (hull.length < 3) continue;
      const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
      const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
      const padded = hull.map((p) => { const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1; return { x: p.x + (dx / d) * 18, y: p.y + (dy / d) * 18 }; });
      out.push({ color: FAMILY_COLOR.get(fam) ?? OTHER_COLOR, d: hullPath(padded) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, regions, constellation, forceRenderTick(sim)]);

  // Recently-played heat per node (last 20 plays; multi-genre aware).
  const recentByNode = useMemo(() => {
    const m = new Map<string, number>();
    if (!recent) return m;
    for (const t of recentTracks) {
      for (const r of resolveGenreNodesAll(t.genre || "")) m.set(r.id, (m.get(r.id) ?? 0) + 1);
    }
    return m;
  }, [recent, recentTracks]);
  const recentMax = Math.max(1, ...recentByNode.values());

  const pathSet = useMemo(() => new Set(pathIds), [pathIds]);

  // Recommendations: inactive nodes bridging ≥2 of your library genres.
  const recommendedIds = useMemo(() => {
    if (!sim || !discover) return new Set<string>();
    const score = new Map<string, number>();
    for (const l of sim.links) {
      if (l.source.active && !l.target.active && !l.target.custom) score.set(l.target.id, (score.get(l.target.id) ?? 0) + 1);
      if (l.target.active && !l.source.active && !l.source.custom) score.set(l.source.id, (score.get(l.source.id) ?? 0) + 1);
    }
    const ids = new Set<string>();
    for (const [id, c] of score) if (c >= 2) ids.add(id);
    return ids;
  }, [sim, discover]);

  const selectedNeighbors = useMemo(() => {
    if (!sim || !selected) return [];
    const out: { id: string; label: string; color: string; active: boolean }[] = [];
    const seen = new Set<string>();
    for (const l of sim.links) {
      const other = l.source.id === selected.id ? l.target : l.target.id === selected.id ? l.source : null;
      if (other && !seen.has(other.id)) { seen.add(other.id); out.push({ id: other.id, label: other.label, color: other.active ? other.color : "#3a3628", active: other.active }); }
    }
    return out.sort((a, b) => Number(b.active) - Number(a.active)).slice(0, 12);
  }, [sim, selected]);

  const selectedNodes = useMemo(() => (sim ? [...selection].map((id) => sim.byId.get(id)).filter((n): n is SimNode => !!n) : []), [sim, selection]);
  const pathNodes = useMemo(() => (sim ? pathIds.map((id) => sim.byId.get(id)).filter((n): n is SimNode => !!n) : []), [sim, pathIds]);

  const focusId = hoveredId ?? selectedId ?? connectFromId ?? null;
  const neighbourIds = useMemo(() => {
    if (!sim || !focusId) return null;
    const set = new Set<string>([focusId]);
    for (const l of sim.links) {
      if (l.source.id === focusId) set.add(l.target.id);
      if (l.target.id === focusId) set.add(l.source.id);
    }
    return set;
  }, [sim, focusId]);

  const nodeCount = sim ? sim.nodes.length : TAXONOMY_NODES.length;
  const linkCount = sim ? sim.links.length : TAXONOMY_LINKS.length;
  const activeCount = sim ? sim.nodes.filter((n) => n.active && !n.custom).length : 0;
  const customLinkCount = sim ? sim.links.filter((l) => l.custom).length : 0;

  const searchResults = useMemo(() => {
    if (!sim || search.trim().length < 1) return [];
    const q = search.toLowerCase();
    return sim.nodes
      .filter((n) => n.label.toLowerCase().includes(q) || n.userGenres.some((g) => g.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [sim, search]);

  // ── Tag diagnostics (unmatched / fuzzy / casing duplicates) ──
  const mergeOverrides = useMemo(() => new Map(aliases.filter((a) => a.mode !== "move").map((a) => [a.norm, a.nodeId])), [aliases]);
  const reparentNormSet = useMemo(() => new Set(aliases.filter((a) => a.mode === "move").map((a) => a.norm)), [aliases]);
  const idToLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of TAXONOMY_NODES) m.set(n.id, n.label);
    for (const c of customNodes) m.set(c.id, c.label);
    return m;
  }, [customNodes]);
  const nodeOptions = useMemo(() => {
    const opts = TAXONOMY_NODES.map((n) => ({ id: n.id, label: n.label, color: n.color }));
    for (const c of customNodes) opts.push({ id: c.id, label: c.label, color: FAMILY_COLOR.get(c.family) ?? OTHER_COLOR });
    return opts;
  }, [customNodes]);
  const diag = useMemo(() => {
    const list = genres.map((g) => ({ name: g.name, track_count: g.track_count }));
    const res = matchUserGenres(list, mergeOverrides);
    const byNorm = new Map<string, { name: string; count: number }[]>();
    for (const g of genres) {
      const k = normalizeGenre(g.name);
      if (!k) continue;
      const arr = byNorm.get(k) ?? [];
      arr.push({ name: g.name, count: g.track_count });
      byNorm.set(k, arr);
    }
    const clusters = [...byNorm.values()]
      .filter((v) => v.length > 1)
      .sort((a, b) => b.reduce((s, x) => s + x.count, 0) - a.reduce((s, x) => s + x.count, 0));
    const moved = (s: string) => reparentNormSet.has(normalizeGenre(s));
    const unmatched = res.unmatched.filter((u) => !moved(u.name));
    const fuzzy = res.tags.filter((t) => (t.method === "ngram" || t.method === "family") && !moved(t.tag));
    return { tags: res.tags, unmatched, fuzzy, clusters };
  }, [genres, mergeOverrides, reparentNormSet]);

  const selectedConnections = useMemo(() => {
    if (!sim || !selected) return [];
    const out: { linkId: string; label?: string; weight?: number; otherLabel: string; color: string }[] = [];
    for (const l of sim.links) {
      if (!l.custom || !l.linkId) continue;
      if (l.source.id === selected.id) out.push({ linkId: l.linkId, label: l.label, weight: l.weight, otherLabel: l.target.label, color: l.target.color });
      else if (l.target.id === selected.id) out.push({ linkId: l.linkId, label: l.label, weight: l.weight, otherLabel: l.source.label, color: l.source.color });
    }
    return out;
  }, [sim, selected]);

  function submitAdd() { const id = addNode(addLabel, addFamily); if (id) { setAddLabel(""); setAddOpen(false); } }

  function nodeVisible(n: SimNode) { return !(constellation && !n.active && n.depth !== 0); }
  function nodeOpacity(n: SimNode) {
    if (isolatedFamily && n.family !== isolatedFamily) return 0.08;
    if (neighbourIds && !neighbourIds.has(n.id)) return 0.22;
    return 1;
  }

  // Mini-map geometry (family hubs + active nodes only, to keep it light)
  const mini = useMemo(() => {
    if (!sim) return null;
    const W = 150, H = 108, pad = 8;
    const dots = sim.nodes.filter((n) => n.depth === 0 || n.active);
    if (!dots.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of sim.nodes) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    const bw = maxX - minX || 1, bh = maxY - minY || 1;
    const k = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    const toMini = (x: number, y: number) => ({ mx: pad + (x - minX) * k, my: pad + (y - minY) * k });
    return { W, H, dots, toMini, minX, minY, k, pad };
    // recomputed each render (positions change while settling) — cheap
  }, [sim, forceRenderTick(sim)]);

  function miniRecenter(e: React.MouseEvent) {
    if (!mini || !sim) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const wx = mini.minX + (mx - mini.pad) / mini.k;
    const wy = mini.minY + (my - mini.pad) / mini.k;
    setTransform((t) => ({ ...t, x: size.w / 2 - wx * t.k, y: size.h / 2 - wy * t.k }));
  }

  return createPortal(
    <div className={`fixed top-0 right-0 left-0 sm:left-[52px] ${hasTrack ? "bottom-16 sm:bottom-20" : "bottom-0"} z-40 flex bg-[#0e0d0b]`}>
      <div className="relative flex-1 min-w-0">
        {/* Header */}
        <div className="absolute top-0 inset-x-0 z-20 px-4 sm:px-8 pt-4 sm:pt-6 pb-8 bg-gradient-to-b from-[#0e0d0b] via-[#0e0d0b]/80 to-transparent pointer-events-none">
          <div className="pointer-events-auto inline-block">
            <button onClick={onBack} className="flex items-center gap-1.5 text-[#7a7060] hover:text-[#c8bfa8] transition-colors mb-3 text-xs font-mono">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
              Genres
            </button>
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-1">Genre Map</p>
            <h1 className="text-[22px] sm:text-[30px] leading-none tracking-[-1px] text-[#faf8f2] font-light" style={{ fontFamily: "Fraunces, serif" }}>
              The Web of <em className="italic text-[#c8bfa8]">Genres</em>
            </h1>
            <p className="text-[11px] text-[#5a5448] font-mono mt-2">
              <span className="text-[#c8bfa8]">{nodeCount}</span> genres · <span className="text-[#c8bfa8]">{linkCount}</span> connections
              {customLinkCount > 0 && <> · <span className="text-[var(--accent)]">{customLinkCount}</span> yours</>}
              {" · "}<span className="text-[var(--accent)]">{activeCount}</span> in your library
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="absolute top-4 sm:top-6 right-4 sm:right-6 z-30 flex flex-col items-end gap-2 w-[230px]">
          {/* Search */}
          <div className="relative w-full">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5a5448]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && searchResults[0]) { centerOn(searchResults[0]); setSearch(""); } e.stopPropagation(); }}
              placeholder="Jump to genre…"
              className="w-full bg-[#1a1814] border border-white/8 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-[#f0ead8] placeholder-[#5a5448] outline-none focus:border-[var(--accent)]"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-[#161410] border border-white/10 rounded-lg shadow-2xl py-1 max-h-[240px] overflow-y-auto">
                {searchResults.map((n) => {
                  const ql = search.toLowerCase();
                  const viaTag = n.label.toLowerCase().includes(ql) ? null : n.userGenres.find((g) => g.toLowerCase().includes(ql));
                  return (
                    <button key={n.id} onClick={() => { centerOn(n); setSearch(""); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: n.active ? n.color : "#3a3628" }} />
                      <span className="text-xs text-[#c8bfa8] truncate" style={{ maxWidth: viaTag ? "55%" : undefined }}>{n.label}</span>
                      {viaTag ? <span className="text-[9px] font-mono text-[#5a5448] truncate flex-1">← {viaTag}</span> : <span className="flex-1" />}
                      {n.active && <span className="text-[9px] font-mono text-[#5a5448] shrink-0">{n.count}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tools (create / modes) */}
          <div className="flex flex-wrap justify-end gap-1.5">
            <ToolBtn active={addOpen} onClick={() => { setConnectMode(false); setConnectFromId(null); setAddOpen((v) => !v); }} label="Add" icon={<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />} />
            <ToolBtn active={connectMode} onClick={() => { setAddOpen(false); setPathMode(false); setSelectMode(false); setConnectMode((v) => !v); setConnectFromId(null); }} label="Connect" icon={<path d="M12 2a3 3 0 0 0-1 5.83V10H7a3 3 0 1 0 0 2h4v2.17a3 3 0 1 0 2 0V12h4a3 3 0 1 0 0-2h-4V7.83A3 3 0 0 0 12 2z" />} />
            <ToolBtn active={pathMode} onClick={() => { setAddOpen(false); setConnectMode(false); setSelectMode(false); setPathMode((v) => !v); setPathFromId(null); if (pathMode) { setPathIds([]); setPathSteps([]); setPathTail([]); } }} label="Path" icon={<path d="M3 17h2v-2H3v2zM3 9h2V7H3v2zm0 4h2v-2H3v2zm4 4h2v-2H7v2zM7 9h2V7H7v2zm0 4h2v-2H7v2zm4 4h2v-2h-2v2zm0-8h2V7h-2v2zm0 4h2v-2h-2v2zm6-6v2h2V7h-2zm0 6h2v-2h-2v2zm-2 4h4v-2h-4v2z" />} />
            <ToolBtn active={selectMode} onClick={() => { setAddOpen(false); setConnectMode(false); setPathMode(false); setSelectMode((v) => !v); }} label="Select" icon={<path d="M3 5h2V3H3v2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2V3h-2zM5 21v-2H3v2h2zM3 17h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8h2v-2h-2v2zm-4 0h2v-2h-2v2zm4-12h2V7h-2v2zm0-4v2h2V3h-2zm-4 2h2V3h-2v2z" />} />
          </div>

          {/* Views / actions */}
          <div className="flex flex-wrap justify-end gap-1.5">
            <ToolBtn active={viewsOpen || constellation || discover || affinity || regions || recent} onClick={() => setViewsOpen((v) => !v)} label="Views" icon={<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />} />
            <ToolBtn onClick={fitView} label="Fit" icon={<path d="M9 3H3v6h2V5h4V3zm12 0h-6v2h4v4h2V3zM5 15H3v6h6v-2H5v-4zm14 4h-4v2h6v-6h-2v4z" />} />
            {pins.length > 0 && (
              <ToolBtn onClick={() => clearPins()} label="Reset" icon={<path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />} />
            )}
            <button onClick={() => setDiagOpen(true)} title="Tag diagnostics"
              className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-colors border bg-[#1a1814] text-[#c8bfa8] border-white/8 hover:bg-[#2a2820]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 7.5L4.21 6 12 2.5 19.79 6 12 9.5zM2 17l10 5 10-5-2.1-1.05L12 19.6 4.1 15.95 2 17zm0-5l10 5 10-5-2.1-1.05L12 14.6 4.1 10.95 2 12z" /></svg>
              Tags
              {diag.unmatched.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[#c98a3b] text-[#0e0d0b] text-[8px] font-bold flex items-center justify-center">{diag.unmatched.length}</span>
              )}
            </button>
            <ToolBtn onClick={() => setHelpOpen(true)} label="?" icon={<path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" />} />
          </div>

          {viewsOpen && (
            <div className="bg-[#161410] border border-white/10 rounded-xl shadow-2xl p-1.5 w-full">
              {[
                { key: "Mine", on: constellation, toggle: () => setConstellation((v) => !v), desc: "Only your library" },
                { key: "Discover", on: discover, toggle: () => setDiscover((v) => !v), desc: "Bridge suggestions" },
                { key: "Affinity", on: affinity, toggle: () => setAffinity((v) => !v), desc: "Links from your library" },
                { key: "Regions", on: regions, toggle: () => setRegions((v) => !v), desc: "Family blobs" },
                { key: "Recent", on: recent, toggle: () => setRecent((v) => !v), desc: "Recently played" },
              ].map((v) => (
                <button key={v.key} onClick={v.toggle} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
                  <span className="text-left">
                    <span className={`block text-[11px] font-mono ${v.on ? "text-[var(--accent)]" : "text-[#c8bfa8]"}`}>{v.key}</span>
                    <span className="block text-[9px] text-[#5a5448]">{v.desc}</span>
                  </span>
                  <span className={`w-7 h-4 rounded-full relative shrink-0 transition-colors ${v.on ? "bg-[var(--accent)]" : "bg-[#2a2820]"}`}>
                    <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: v.on ? 14 : 2 }} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Size: metric + scale */}
          <div className="w-full flex items-center gap-1 bg-[#1a1814] border border-white/8 rounded-lg px-2 py-1.5">
            {(["tracks", "albums", "artists"] as SizeMetric[]).map((m) => (
              <button key={m} onClick={() => setSizeMetric(m)} title={`Size by ${m}`}
                className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 ${sizeMetric === m ? "bg-[var(--accent-a12)] text-[var(--accent)]" : "text-[#5a5448] hover:text-[#c8bfa8]"}`}>
                {m === "tracks" ? "Trk" : m === "albums" ? "Alb" : "Art"}
              </button>
            ))}
            <input type="range" min={0.5} max={2.2} step={0.05} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} className="flex-1 min-w-0 accent-[var(--accent)]" />
          </div>

          {addOpen && (
            <div className="bg-[#161410] border border-white/10 rounded-xl shadow-2xl p-3 w-full">
              <p className="text-[10px] font-mono text-[#7a7060] uppercase tracking-wider mb-2">New genre</p>
              <input autoFocus value={addLabel} onChange={(e) => setAddLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); e.stopPropagation(); }} placeholder="Genre name…" className="w-full bg-[#1f1d18] border border-white/8 rounded-lg px-2.5 py-1.5 text-xs text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)] mb-2" />
              <select value={addFamily} onChange={(e) => setAddFamily(e.target.value)} className="w-full bg-[#1f1d18] border border-white/8 rounded-lg px-2 py-1.5 text-xs text-[#c8bfa8] outline-none focus:border-[var(--accent)] mb-2.5">
                {GENRE_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <div className="flex gap-1.5">
                <button onClick={() => setAddOpen(false)} className="flex-1 text-[11px] py-1.5 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] font-mono transition-colors">Cancel</button>
                <button onClick={submitAdd} disabled={!addLabel.trim()} className="flex-1 text-[11px] py-1.5 rounded-lg bg-[var(--accent)] font-mono disabled:opacity-30 transition-colors" style={{ color: "var(--accent-on)" }}>Add</button>
              </div>
            </div>
          )}
        </div>

        {connectMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-full bg-[#1a1814] border border-[var(--accent-a30)] shadow-xl">
            <span className="text-[11px] font-mono text-[var(--accent)]">{connectFromId ? "Now click a second genre to link" : "Click a genre to connect from"}</span>
            <button onClick={() => { setConnectMode(false); setConnectFromId(null); }} className="text-[#7a7060] hover:text-[#c8bfa8] text-[11px] font-mono">Cancel</button>
          </div>
        )}
        {pathMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-full bg-[#1a1814] border border-[var(--accent-a30)] shadow-xl">
            <span className="text-[11px] font-mono text-[var(--accent)]">{pathFromId ? "Now click the destination genre" : "Click the starting genre"}</span>
            <button onClick={() => { setPathMode(false); setPathFromId(null); }} className="text-[#7a7060] hover:text-[#c8bfa8] text-[11px] font-mono">Cancel</button>
          </div>
        )}
        {selectMode && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-full bg-[#1a1814] border border-[var(--accent-a30)] shadow-xl">
            <span className="text-[11px] font-mono text-[var(--accent)]">Drag a box or click genres to select</span>
            <button onClick={() => setSelectMode(false)} className="text-[#7a7060] hover:text-[#c8bfa8] text-[11px] font-mono">Done</button>
          </div>
        )}

        <div
          ref={containerRef}
          className={`absolute inset-0 overflow-hidden touch-none ${connectMode || pathMode || selectMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
          onPointerDown={onSvgPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" /></svg>
            </div>
          )}

          {sim && size.w > 0 && (
            <svg width={size.w} height={size.h} className="block">
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                {regions && hulls.map((h, i) => (
                  <path key={`hull-${i}`} d={h.d} fill={h.color} fillOpacity={0.06} stroke={h.color} strokeOpacity={0.14} strokeWidth={1.5 / transform.k} />
                ))}

                {sim.links.map((l, i) => {
                  if (constellation && !((l.source.active || l.source.depth === 0) && (l.target.active || l.target.depth === 0))) return null;
                  const lit = neighbourIds && neighbourIds.has(l.source.id) && neighbourIds.has(l.target.id);
                  const bothActive = l.source.active && l.target.active;
                  const isoOut = isolatedFamily && l.source.family !== isolatedFamily && l.target.family !== isolatedFamily;
                  const stroke = l.custom
                    ? (lit ? "var(--accent)" : "var(--accent-a40)")
                    : lit ? "rgba(255,255,255,0.55)" : bothActive ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
                  const baseW = l.custom ? linkWidthFactor(l.weight) : lit ? 1.4 : l.kind === "family" ? 1.1 : 0.7;
                  const { cx, cy } = edgeCtrl(l.source.x, l.source.y, l.target.x, l.target.y);
                  const lx = 0.25 * l.source.x + 0.5 * cx + 0.25 * l.target.x;
                  const ly = 0.25 * l.source.y + 0.5 * cy + 0.25 * l.target.y;
                  return (
                    <g key={i} style={{ opacity: isoOut ? 0.06 : affinity ? 0.18 : 1 }}>
                      <path d={`M${l.source.x} ${l.source.y} Q${cx} ${cy} ${l.target.x} ${l.target.y}`} fill="none" stroke={stroke} strokeWidth={baseW / transform.k} strokeDasharray={l.custom ? `${4 / transform.k} ${3 / transform.k}` : undefined} />
                      {l.custom && l.label && (lit || transform.k > 0.8) && (
                        <text x={lx} y={ly} textAnchor="middle" fontSize={9 / transform.k} fontFamily="ui-monospace, monospace" fill="var(--accent)" style={{ paintOrder: "stroke", stroke: "#0e0d0b", strokeWidth: 3 / transform.k, strokeLinejoin: "round", pointerEvents: "none" }}>{l.label}</text>
                      )}
                    </g>
                  );
                })}

                {affinity && affinityEdges.map((e, i) => {
                  const w = (0.8 + (e.strength / affinityMax) * 3) / transform.k;
                  const op = 0.25 + (e.strength / affinityMax) * 0.5;
                  const { cx, cy } = edgeCtrl(e.a.x, e.a.y, e.b.x, e.b.y);
                  return <path key={`aff-${i}`} d={`M${e.a.x} ${e.a.y} Q${cx} ${cy} ${e.b.x} ${e.b.y}`} fill="none" stroke="#4bb3a2" strokeOpacity={op} strokeWidth={w} strokeLinecap="round" />;
                })}

                {pathIds.length > 1 && pathIds.slice(0, -1).map((id, i) => {
                  const a = sim.byId.get(id), b = sim.byId.get(pathIds[i + 1]);
                  if (!a || !b) return null;
                  const { cx, cy } = edgeCtrl(a.x, a.y, b.x, b.y);
                  return <path key={`path-${i}`} d={`M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`} fill="none" stroke="var(--accent)" strokeWidth={2.6 / transform.k} strokeOpacity={0.9} strokeLinecap="round" />;
                })}

                {sim.nodes.map((n) => {
                  if (!nodeVisible(n)) return null;
                  const r = baseRadius(n, sizeMetric) * scale;
                  const op = nodeOpacity(n);
                  const isSel = selectedId === n.id;
                  const isConnFrom = connectFromId === n.id || pathFromId === n.id;
                  const isRec = recommendedIds.has(n.id);
                  const isPathNode = pathSet.has(n.id);
                  const isMultiSel = selection.has(n.id);
                  const fill = n.active ? n.color : "#26241e";
                  const showLabel = n.depth === 0 || n.active || hoveredId === n.id || isSel || isRec || isPathNode || isMultiSel;
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: "pointer", opacity: op }}
                      onPointerDown={(e) => onNodePointerDown(e, n)} onPointerEnter={() => setHoveredId(n.id)} onPointerLeave={() => setHoveredId((h) => (h === n.id ? null : h))}>
                      {recent && !!recentByNode.get(n.id) && <circle r={r + (6 + (recentByNode.get(n.id)! / recentMax) * 14) / transform.k} fill="#e8643c" opacity={0.14 + (recentByNode.get(n.id)! / recentMax) * 0.32} />}
                      {isRec && <circle r={r + 4 / transform.k} fill="none" stroke="#7faa6e" strokeWidth={1.3 / transform.k} strokeDasharray={`${2.5 / transform.k} ${2.5 / transform.k}`} />}
                      {isPathNode && <circle r={r + 5 / transform.k} fill="none" stroke="var(--accent)" strokeWidth={2 / transform.k} strokeOpacity={0.85} />}
                      {isMultiSel && <circle r={r + 3 / transform.k} fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeWidth={1.6 / transform.k} />}
                      {(isSel || isConnFrom) && <circle r={r + 4 / transform.k} fill="none" stroke="var(--accent)" strokeWidth={2 / transform.k} />}
                      <circle r={r} fill={fill} stroke={(n.custom || n.reparented) ? "var(--accent)" : n.active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"} strokeWidth={((n.custom || n.reparented) ? 1.4 : n.active ? 1 : 0.6) / transform.k} strokeDasharray={(n.custom || n.reparented) ? `${3 / transform.k} ${2 / transform.k}` : undefined} />
                      {n.active && n.fuzzy && !n.custom && (
                        <circle r={r + 3 / transform.k} fill="none" stroke="#d9a441" strokeOpacity={0.55} strokeWidth={0.9 / transform.k} strokeDasharray={`${2 / transform.k} ${2 / transform.k}`} />
                      )}
                      {showLabel && (
                        <text y={r + (n.depth === 0 ? 15 : 11) / transform.k} textAnchor="middle" fontSize={(n.depth === 0 ? 13 : 9) / transform.k} fontFamily={n.depth === 0 ? "Fraunces, serif" : "ui-monospace, monospace"} fill={n.active ? "#f0ead8" : "#5a5448"} style={{ paintOrder: "stroke", stroke: "#0e0d0b", strokeWidth: 3 / transform.k, strokeLinejoin: "round", pointerEvents: "none", userSelect: "none" }}>{n.label}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          {/* Lasso selection rectangle */}
          {lasso && (
            <div className="absolute border border-[var(--accent)] bg-[var(--accent-a12)] pointer-events-none z-20"
              style={{ left: Math.min(lasso.x0, lasso.x1), top: Math.min(lasso.y0, lasso.y1), width: Math.abs(lasso.x1 - lasso.x0), height: Math.abs(lasso.y1 - lasso.y0) }} />
          )}

          {/* Mini-map */}
          {mini && (
            <div className="absolute bottom-3 right-3 z-20 rounded-lg overflow-hidden border border-white/10 bg-[#0e0d0b]/80 backdrop-blur-sm">
              <svg width={mini.W} height={mini.H} onClick={miniRecenter} className="block cursor-pointer">
                {mini.dots.map((n) => { const { mx, my } = mini.toMini(n.x, n.y); return <circle key={n.id} cx={mx} cy={my} r={n.depth === 0 ? 2 : 1.3} fill={n.active ? n.color : "#3a3628"} />; })}
                {(() => {
                  const tl = { x: (0 - transform.x) / transform.k, y: (0 - transform.y) / transform.k };
                  const br = { x: (size.w - transform.x) / transform.k, y: (size.h - transform.y) / transform.k };
                  const a = mini.toMini(tl.x, tl.y), b = mini.toMini(br.x, br.y);
                  return <rect x={a.mx} y={a.my} width={Math.max(2, b.mx - a.mx)} height={Math.max(2, b.my - a.my)} fill="none" stroke="var(--accent)" strokeWidth={1} />;
                })()}
              </svg>
            </div>
          )}

          {/* Legend — click to isolate a family */}
          <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-x-2 gap-y-1 max-w-[52%]">
            {GENRE_FAMILIES.map((f) => {
              const on = isolatedFamily === f.id;
              return (
                <button key={f.id} onClick={() => setIsolatedFamily(on ? null : f.id)}
                  className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-colors ${on ? "bg-white/10" : "hover:bg-white/5"} ${isolatedFamily && !on ? "opacity-40" : ""}`}>
                  <span className="w-2 h-2 rounded-full" style={{ background: f.color }} />
                  <span className="text-[9px] font-mono text-[#7a7060]">{f.label}</span>
                </button>
              );
            })}
            {isolatedFamily && (
              <button onClick={() => setIsolatedFamily(null)} className="text-[9px] font-mono text-[var(--accent)] px-1.5 py-0.5">clear ✕</button>
            )}
          </div>
        </div>
      </div>

      {selection.size > 0 ? (
        <MultiSelectPanel
          nodes={selectedNodes}
          tracks={selectionTracks}
          loading={selectionLoading}
          onClose={() => setSelection(new Set())}
          onRemove={(id) => setSelection((s) => { const n = new Set(s); n.delete(id); return n; })}
          onJump={jumpTo}
          onPlay={() => playSelection(false)}
          onShuffle={() => playSelection(true)}
          onQueue={queueSelection}
          onPlaylist={playlistSelection}
        />
      ) : pathIds.length > 0 ? (
        <PathPanel
          nodes={pathNodes}
          steps={pathSteps}
          tail={pathTail}
          onClose={() => { setPathIds([]); setPathSteps([]); setPathTail([]); }}
          onJump={jumpTo}
          onTransition={buildTransition}
        />
      ) : selected ? (
        <GenreDetailPanel
          key={selected.id}
          node={selected}
          connections={selectedConnections}
          onClose={() => setSelectedId(null)}
          onRemoveNode={selected.custom ? () => { removeNode(selected.id); setSelectedId(null); } : undefined}
          onResetReparent={selected.reparented ? () => { removeAlias(selected.id.replace(/^reparent-/, "")); setSelectedId(null); } : undefined}
          onRemoveLink={removeLink}
          onUpdateLink={updateLink}
          onConnectFrom={() => { setSelectedId(null); setConnectMode(true); setConnectFromId(selected.id); }}
          neighbors={selectedNeighbors}
          onJumpNode={(id) => { const n = sim?.byId.get(id); if (n) centerOn(n); }}
          onUnpin={selected.pinned ? () => { removePin(selected.id); const n = sim?.byId.get(selected.id); if (n) { n.fx = null; n.fy = null; } reheat(0.3); } : undefined}
        />
      ) : null}

      {diagOpen && (
        <TagDiagnostics
          tags={diag.tags}
          unmatched={diag.unmatched}
          fuzzy={diag.fuzzy}
          clusters={diag.clusters}
          aliases={aliases}
          idToLabel={idToLabel}
          nodeOptions={nodeOptions}
          onAlias={setAlias}
          onRemoveAlias={removeAlias}
          onMergeCluster={mergeCluster}
          onJump={(id) => { const n = sim?.byId.get(id); if (n) { centerOn(n); setDiagOpen(false); } }}
          onClose={() => setDiagOpen(false)}
        />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>,
    document.body,
  );
}

// stable-ish dependency so the mini-map memo recomputes each settle frame
function forceRenderTick(sim: Sim | null) { return sim ? sim.alpha : 0; }

function ToolBtn({ active, onClick, label, icon }: { active?: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-colors border ${active ? "bg-[var(--accent-a12)] text-[var(--accent)] border-[var(--accent-a30)]" : "bg-[#1a1814] text-[#c8bfa8] border-white/8 hover:bg-[#2a2820]"}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">{icon}</svg>
      {label}
    </button>
  );
}

// ─── Detail panel ────────────────────────────────────────────────────────────────

function GenreDetailPanel({
  node, connections, neighbors, onClose, onRemoveNode, onResetReparent, onUnpin, onRemoveLink, onUpdateLink, onConnectFrom, onJumpNode,
}: {
  node: SimNode;
  connections: { linkId: string; label?: string; weight?: number; otherLabel: string; color: string }[];
  neighbors: { id: string; label: string; color: string; active: boolean }[];
  onClose: () => void;
  onRemoveNode?: () => void;
  onResetReparent?: () => void;
  onUnpin?: () => void;
  onRemoveLink: (id: string) => void;
  onUpdateLink: (id: string, patch: { label?: string; weight?: number }) => void;
  onConnectFrom: () => void;
  onJumpNode: (id: string) => void;
}) {
  const { setQueue, setIsPlaying, currentTrack } = usePlayerStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [editLink, setEditLink] = useState<string | null>(null);
  const genreKey = node.userGenres.join("|");

  useEffect(() => {
    if (!node.active || node.userGenres.length === 0) { setTracks([]); return; }
    let cancelled = false; setLoading(true);
    (async () => {
      const all: Track[] = []; const seen = new Set<string>();
      for (const name of node.userGenres) {
        try {
          const t = await invoke<Track[]>("get_genre_tracks", { genre: name, limit: 500, offset: 0 });
          for (const tr of t ?? []) if (!seen.has(tr.path)) { seen.add(tr.path); all.push(tr); }
        } catch { /* skip */ }
      }
      if (!cancelled) { setTracks(all); setLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, genreKey]);

  const topArtists = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) { const a = t.artist || "Unknown"; m.set(a, (m.get(a) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [tracks]);
  const topAlbums = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) { if (!t.album) continue; m.set(t.album, (m.get(t.album) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [tracks]);

  function shuffle() {
    const s = [...tracks];
    for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
    setQueue(s, 0); setIsPlaying(true);
  }

  const hasMusic = node.userGenres.length > 0;

  return (
    <div className="w-[340px] sm:w-[400px] shrink-0 h-full border-l border-white/6 bg-[#0e0d0b] flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-white/6 overflow-y-auto max-h-[55%]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: node.active ? node.color : "#3a3628" }} />
              <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#5a5448]">{node.reparented ? "Moved tag" : node.custom ? "Custom genre" : "Genre"}</p>
            </div>
            <h2 className="text-2xl text-[#faf8f2] font-light leading-tight" style={{ fontFamily: "Fraunces, serif" }}>{node.label}</h2>
            <p className="text-[11px] text-[#5a5448] font-mono mt-1.5">{hasMusic ? `${node.count} tracks · ${node.albums} albums · ${node.artists} artists` : "Not in your library yet"}</p>
            {node.active && node.fuzzy && (
              <span className="inline-flex items-center gap-1.5 mt-1.5 text-[10px] font-mono text-[#d9a441]">
                <span className="w-1.5 h-1.5 rounded-full border border-[#d9a441]" />
                fuzzy match — guessed from your tag
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060] transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          {hasMusic && tracks.length > 0 && (
            <>
              <button onClick={() => { setQueue(tracks, 0); setIsPlaying(true); }} className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-4 py-2.5 rounded-full transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Play
              </button>
              <button onClick={shuffle} className="flex items-center gap-1.5 text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>Shuffle
              </button>
            </>
          )}
          <button onClick={onConnectFrom} className="flex items-center gap-1.5 text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a3 3 0 0 0-1 5.83V10H7a3 3 0 1 0 0 2h4v2.17a3 3 0 1 0 2 0V12h4a3 3 0 1 0 0-2h-4V7.83A3 3 0 0 0 12 2z" /></svg>Connect
          </button>
          {onResetReparent && (
            <button onClick={onResetReparent} className="flex items-center gap-1.5 text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" /></svg>Reset placement
            </button>
          )}
          {onUnpin && (
            <button onClick={onUnpin} className="flex items-center gap-1.5 text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 9V4h1V2H7v2h1v5l-2 2v2h5.2v7h1.6v-7H18v-2l-2-2z" /></svg>Unpin
            </button>
          )}
          {onRemoveNode && (
            <button onClick={onRemoveNode} className="flex items-center gap-1.5 text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c85858] hover:bg-[#c85858]/10 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z" /></svg>Remove
            </button>
          )}
        </div>

        {/* Top artists / albums */}
        {hasMusic && (topArtists.length > 0 || topAlbums.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {topArtists.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448] mb-1.5">Top artists</p>
                <div className="flex flex-col gap-1">
                  {topArtists.map(([a, c]) => (
                    <div key={a} className="flex items-center justify-between gap-2"><span className="text-[11px] text-[#c8bfa8] truncate">{a}</span><span className="text-[9px] font-mono text-[#3a3628]">{c}</span></div>
                  ))}
                </div>
              </div>
            )}
            {topAlbums.length > 0 && (
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448] mb-1.5">Top albums</p>
                <div className="flex flex-col gap-1">
                  {topAlbums.map(([a, c]) => (
                    <div key={a} className="flex items-center justify-between gap-2"><span className="text-[11px] text-[#c8bfa8] truncate">{a}</span><span className="text-[9px] font-mono text-[#3a3628]">{c}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Related genres (recommendations context) */}
        {neighbors.length > 0 && (
          <div className="mt-4">
            <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448] mb-1.5">
              {node.active ? "Related genres" : "Related to your library"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {neighbors.map((nb) => (
                <button key={nb.id} onClick={() => onJumpNode(nb.id)}
                  className={`flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border transition-colors ${nb.active ? "bg-[#1f1d18] border-white/6 hover:border-white/15" : "bg-transparent border-white/5 hover:border-white/10"}`}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: nb.color }} />
                  <span className={`text-[10px] font-mono ${nb.active ? "text-[#c8bfa8]" : "text-[#5a5448]"}`}>{nb.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom connections (editable) */}
        {connections.length > 0 && (
          <div className="mt-4">
            <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448] mb-1.5">Your connections</p>
            <div className="flex flex-col gap-1.5">
              {connections.map((c) => (
                <div key={c.linkId} className="rounded-lg bg-[#1f1d18] border border-white/6">
                  <div className="flex items-center gap-1.5 pl-2 pr-1 py-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                    <button onClick={() => setEditLink(editLink === c.linkId ? null : c.linkId)} className="flex-1 text-left min-w-0">
                      <span className="text-[10px] font-mono text-[#c8bfa8] truncate">{c.otherLabel}{c.label ? ` · ${c.label}` : ""}</span>
                    </button>
                    <button onClick={() => onRemoveLink(c.linkId)} className="text-[#5a5448] hover:text-[#c85858] transition-colors p-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                    </button>
                  </div>
                  {editLink === c.linkId && (
                    <div className="px-2 pb-2 flex flex-col gap-1.5">
                      <input defaultValue={c.label ?? ""} onKeyDown={(e) => { if (e.key === "Enter") { onUpdateLink(c.linkId, { label: (e.target as HTMLInputElement).value.trim() }); setEditLink(null); } e.stopPropagation(); }} onBlur={(e) => onUpdateLink(c.linkId, { label: e.target.value.trim() })} placeholder="Label (influence, fusion…)" className="bg-[#0e0d0b] border border-white/8 rounded px-2 py-1 text-[11px] text-[#f0ead8] placeholder-[#3a3628] outline-none focus:border-[var(--accent)]" />
                      <div className="flex gap-1">
                        {([1, 2, 3] as const).map((w) => (
                          <button key={w} onClick={() => onUpdateLink(c.linkId, { weight: w })} className={`flex-1 text-[9px] font-mono py-1 rounded ${(c.weight ?? 2) === w ? "bg-[var(--accent-a12)] text-[var(--accent)]" : "bg-[#0e0d0b] text-[#5a5448] hover:text-[#c8bfa8]"}`}>{w === 1 ? "Thin" : w === 2 ? "Medium" : "Thick"}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!hasMusic && (
          <p className="text-xs text-[#3a3628] px-2 py-6 text-center leading-relaxed">
            {node.custom ? "This genre isn't tagged on any of your tracks yet. It still lives on your map — connect it to related genres." : "You don't have any music tagged with this genre. Explore the coloured nodes to see what's in your library."}
          </p>
        )}
        {hasMusic && loading && (
          <div className="flex flex-col gap-1">{Array.from({ length: 8 }).map((_, i) => (<div key={i} className="h-11 rounded bg-[#1a1814] animate-pulse" style={{ opacity: 1 - i * 0.1 }} />))}</div>
        )}
        {hasMusic && !loading && tracks.length > 0 && (
          <>
            <TrackRowHeader showArtistColumn showAlbumColumn />
            {tracks.map((track, idx) => (
              <TrackRow key={track.path} track={track} isActive={currentTrack?.path === track.path} onClick={() => { setQueue(tracks, idx); setIsPlaying(true); }} showArtistColumn showAlbumColumn />
            ))}
          </>
        )}
        {hasMusic && !loading && tracks.length === 0 && (<p className="text-xs text-[#3a3628] px-2 py-6 text-center">No tracks found.</p>)}
      </div>
    </div>
  );
}

// ─── Tag diagnostics modal ───────────────────────────────────────────────────────

function NodePicker({ label, options, onPick }: { label: string; options: { id: string; label: string; color: string }[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options).slice(0, 14);
  }, [q, options]);
  if (!open) return <button onClick={() => setOpen(true)} className="text-[10px] font-mono px-2 py-1 rounded bg-[#2a2820] text-[#c8bfa8] hover:text-[var(--accent)] shrink-0">{label}</button>;
  return (
    <div className="relative shrink-0">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="search…" className="w-28 bg-[#0e0d0b] border border-[var(--accent-a30)] rounded px-2 py-1 text-[10px] text-[#f0ead8] outline-none" />
      <div className="absolute right-0 top-full mt-1 w-44 bg-[#0e0d0b] border border-white/10 rounded-lg shadow-2xl py-1 max-h-[200px] overflow-y-auto z-10">
        {results.map((o) => (
          <button key={o.id} onMouseDown={() => { onPick(o.id); setOpen(false); setQ(""); }} className="w-full flex items-center gap-2 px-2 py-1 hover:bg-white/5 text-left">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: o.color }} />
            <span className="text-[10px] text-[#c8bfa8] truncate">{o.label}</span>
          </button>
        ))}
        {results.length === 0 && <p className="text-[10px] text-[#3a3628] px-2 py-1">no match</p>}
      </div>
    </div>
  );
}

function TagDiagnostics({
  tags, unmatched, fuzzy, clusters, aliases, idToLabel, nodeOptions, onAlias, onRemoveAlias, onMergeCluster, onJump, onClose,
}: {
  tags: TagInfo[];
  unmatched: { name: string; count: number }[];
  fuzzy: TagInfo[];
  clusters: { name: string; count: number }[][];
  aliases: GenreAlias[];
  idToLabel: Map<string, string>;
  nodeOptions: { id: string; label: string; color: string }[];
  onAlias: (tag: string, nodeId: string, mode: "merge" | "move") => void;
  onRemoveAlias: (norm: string) => void;
  onMergeCluster: (variants: string[], target: string) => void;
  onJump: (nodeId: string) => void;
  onClose: () => void;
}) {
  const matched = tags.filter((t) => t.nodeId).length;
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()} className="relative z-10 w-[560px] max-w-full max-h-[82vh] flex flex-col bg-[#161410] border border-white/8 rounded-2xl shadow-2xl">
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/6">
          <div>
            <h3 className="text-lg text-[#f0ead8]" style={{ fontFamily: "Fraunces, serif" }}>Tag Diagnostics</h3>
            <p className="text-[11px] text-[#5a5448] font-mono mt-1">
              {tags.length} tags · <span className="text-[#7faa6e]">{matched} matched</span>
              {unmatched.length > 0 && <> · <span className="text-[#c98a3b]">{unmatched.length} unmatched</span></>}
              {clusters.length > 0 && <> · <span className="text-[#b07cc6]">{clusters.length} casing dupes</span></>}
            </p>
          </div>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060]"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          <p className="text-[10px] text-[#5a5448] leading-relaxed">
            <span className="text-[#c8bfa8]">Merge</span> folds a tag's tracks into a genre (the tag stops being its own node).{" "}
            <span className="text-[#c8bfa8]">Move</span> keeps the tag as its own node, just connected to that genre. Both are reversible here and never touch your files.
          </p>
          <section>
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#c98a3b] mb-2">Unmatched · {unmatched.length}</p>
            {unmatched.length === 0 ? (
              <p className="text-[11px] text-[#5a5448]">Every tag found a home. 🎉</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {unmatched.map((u) => (
                  <div key={u.name} className="flex items-center gap-2 bg-[#1f1d18] rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] text-[#f0ead8] truncate flex-1">{u.name}</span>
                    <span className="text-[9px] font-mono text-[#5a5448]">{u.count}</span>
                    <NodePicker label="Merge…" options={nodeOptions} onPick={(id) => onAlias(u.name, id, "merge")} />
                    <NodePicker label="Move…" options={nodeOptions} onPick={(id) => onAlias(u.name, id, "move")} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {fuzzy.length > 0 && (
            <section>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#d9a441] mb-2">Fuzzy / guessed · {fuzzy.length}</p>
              <div className="flex flex-col gap-1.5">
                {fuzzy.map((t) => (
                  <div key={t.tag} className="flex items-center gap-2 bg-[#1f1d18] rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] text-[#f0ead8] truncate max-w-[40%]">{t.tag}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
                    <button onClick={() => t.nodeId && onJump(t.nodeId)} className="text-[11px] text-[#c8bfa8] hover:text-[var(--accent)] truncate flex-1 text-left">{t.nodeId ? idToLabel.get(t.nodeId) ?? t.nodeId : "?"}</button>
                    <span className="text-[8px] font-mono text-[#5a5448] uppercase shrink-0">{t.method}</span>
                    <NodePicker label="Merge…" options={nodeOptions} onPick={(id) => onAlias(t.tag, id, "merge")} />
                    <NodePicker label="Move…" options={nodeOptions} onPick={(id) => onAlias(t.tag, id, "move")} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {clusters.length > 0 && (
            <section>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#b07cc6] mb-1.5">Casing / spacing duplicates · {clusters.length}</p>
              <p className="text-[10px] text-[#5a5448] mb-2 leading-relaxed">The map already merges these; your library still lists them apart. “Merge” rewrites the tag in those files to the most common spelling — this edits your files.</p>
              <div className="flex flex-col gap-1.5">
                {clusters.map((c, i) => {
                  const target = [...c].sort((a, b) => b.count - a.count)[0].name;
                  const variants = c.map((v) => v.name);
                  const total = c.reduce((s, v) => s + v.count, 0);
                  return (
                    <div key={i} className="bg-[#1f1d18] rounded-lg px-2.5 py-1.5">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                        {c.map((v) => (<span key={v.name} className="text-[11px] text-[#c8bfa8]">"{v.name}" <span className="text-[#5a5448] font-mono text-[9px]">×{v.count}</span></span>))}
                      </div>
                      {confirmIdx === i ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[#c98a3b] flex-1">Rewrite {total} files → "{target}"?</span>
                          <button onClick={() => setConfirmIdx(null)} className="text-[10px] font-mono px-2 py-1 rounded bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8]">Cancel</button>
                          <button onClick={() => { onMergeCluster(variants, target); setConfirmIdx(null); }} className="text-[10px] font-mono px-2 py-1 rounded bg-[var(--accent)]" style={{ color: "var(--accent-on)" }}>Confirm</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmIdx(i)} className="text-[10px] font-mono px-2 py-1 rounded bg-[#2a2820] text-[#c8bfa8] hover:text-[var(--accent)]">Merge → "{target}"</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {aliases.length > 0 && (
            <section>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--accent)] mb-2">Your reassignments · {aliases.length}</p>
              <div className="flex flex-col gap-1.5">
                {aliases.map((a) => (
                  <div key={a.norm} className="flex items-center gap-2 bg-[#1f1d18] rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] text-[#f0ead8] truncate max-w-[36%]">{a.tag}</span>
                    <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 ${a.mode === "move" ? "bg-[var(--accent-a12)] text-[var(--accent)]" : "bg-[#2a2820] text-[#7a7060]"}`}>{a.mode === "move" ? "move" : "merge"}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
                    <span className="text-[11px] text-[var(--accent)] truncate flex-1">{idToLabel.get(a.nodeId) ?? a.nodeId}</span>
                    <button onClick={() => onRemoveAlias(a.norm)} title="Reverse" className="text-[#5a5448] hover:text-[#c85858] p-0.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg></button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Multi-selection panel ───────────────────────────────────────────────────────

function MultiSelectPanel({
  nodes, tracks, loading, onClose, onRemove, onJump, onPlay, onShuffle, onQueue, onPlaylist,
}: {
  nodes: SimNode[];
  tracks: Track[];
  loading: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  onJump: (id: string) => void;
  onPlay: () => void;
  onShuffle: () => void;
  onQueue: () => void;
  onPlaylist: () => void;
}) {
  const { currentTrack, setQueue, setIsPlaying } = usePlayerStore();
  return (
    <div className="w-[340px] sm:w-[400px] shrink-0 h-full border-l border-white/6 bg-[#0e0d0b] flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-white/6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#5a5448] mb-1.5">Selection</p>
            <h2 className="text-2xl text-[#faf8f2] font-light leading-tight" style={{ fontFamily: "Fraunces, serif" }}>{nodes.length} genres</h2>
            <p className="text-[11px] text-[#5a5448] font-mono mt-1.5">{loading ? "Loading…" : `${tracks.length} tracks combined`}</p>
          </div>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060] transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3 max-h-[96px] overflow-y-auto">
          {nodes.map((n) => (
            <span key={n.id} className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-[#1f1d18] border border-white/6">
              <button onClick={() => onJump(n.id)} className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: n.active ? n.color : "#3a3628" }} />
                <span className="text-[10px] font-mono text-[#c8bfa8] truncate max-w-[120px]">{n.label}</span>
              </button>
              <button onClick={() => onRemove(n.id)} className="text-[#5a5448] hover:text-[#c85858] p-0.5">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </span>
          ))}
        </div>

        {tracks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button onClick={onPlay} className="flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-4 py-2.5 rounded-full transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Play
            </button>
            <button onClick={onShuffle} className="flex items-center gap-1.5 text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" /></svg>Shuffle
            </button>
            <button onClick={onQueue} className="text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">Queue</button>
            <button onClick={onPlaylist} className="text-xs font-mono px-3 py-2.5 rounded-full bg-[#1f1d18] text-[#c8bfa8] hover:bg-[#2a2820] transition-colors">+ Playlist</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading && (
          <div className="flex flex-col gap-1">{Array.from({ length: 8 }).map((_, i) => (<div key={i} className="h-11 rounded bg-[#1a1814] animate-pulse" style={{ opacity: 1 - i * 0.1 }} />))}</div>
        )}
        {!loading && tracks.length > 0 && (
          <>
            <TrackRowHeader showArtistColumn showAlbumColumn />
            {tracks.map((track, idx) => (
              <TrackRow key={track.path} track={track} isActive={currentTrack?.path === track.path} onClick={() => { setQueue(tracks, idx); setIsPlaying(true); }} showArtistColumn showAlbumColumn />
            ))}
          </>
        )}
        {!loading && tracks.length === 0 && <p className="text-xs text-[#3a3628] px-2 py-6 text-center">No tracks in the selected genres.</p>}
      </div>
    </div>
  );
}

// ─── Path / transition panel ───────────────────────────────────────────────────

function PathThumb({ path }: { path: string }) {
  const { data: url } = useArtwork(path, false, true);
  return (
    <div className="w-9 h-9 rounded bg-[#1f1d18] overflow-hidden shrink-0">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-[#2a2820]"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
        </div>
      )}
    </div>
  );
}

function PathPanel({
  nodes, steps, tail, onClose, onJump, onTransition,
}: {
  nodes: SimNode[];
  steps: { id: string; label: string; color: string; track: Track | null }[];
  tail: Track[];
  onClose: () => void;
  onJump: (id: string) => void;
  onTransition: () => void;
}) {
  const from = nodes[0], to = nodes[nodes.length - 1];
  const rows = steps.length ? steps : nodes.map((n) => ({ id: n.id, label: n.label, color: n.active ? n.color : "#3a3628", track: null as Track | null }));
  return (
    <div className="w-[340px] sm:w-[400px] shrink-0 h-full border-l border-white/6 bg-[#0e0d0b] flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-white/6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#5a5448] mb-1.5">Transition path</p>
            <h2 className="text-xl text-[#faf8f2] font-light leading-tight" style={{ fontFamily: "Fraunces, serif" }}>
              {from?.label} <span className="text-[#5a5448]">→</span> {to?.label}
            </h2>
            <p className="text-[11px] text-[#5a5448] font-mono mt-1.5">{nodes.length} genres on the way</p>
          </div>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060] transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>
        {nodes.length > 1 && (
          <>
            <button onClick={onTransition} className="mt-4 flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-mono tracking-widest uppercase px-5 py-2.5 rounded-full transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Play transition
            </button>
            <p className="text-[10px] text-[#5a5448] mt-2 leading-relaxed">One song from each genre on the path, in order, then keeps playing {to?.label}.</p>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col">
          {rows.map((s, i) => (
            <div key={s.id + i} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center pt-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                {i < rows.length - 1 && <span className="w-px flex-1 bg-white/10 my-0.5" style={{ minHeight: 26 }} />}
              </div>
              {s.track ? <PathThumb path={s.track.path} /> : <div className="w-9 h-9 shrink-0" />}
              <button onClick={() => onJump(s.id)} className="flex-1 text-left min-w-0 pb-2.5">
                <p className="text-xs text-[#c8bfa8] truncate">{s.label}</p>
                {s.track ? (
                  <p className="text-[10px] text-[#5a5448] truncate">{s.track.title} · {s.track.artist}</p>
                ) : (
                  <p className="text-[10px] text-[#3a3628]">{steps.length ? "no tracks here" : ""}</p>
                )}
              </button>
            </div>
          ))}
        </div>

        {tail.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/6">
            <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5448] mb-2">
              Then keeps playing {to?.label} · {tail.length}
            </p>
            <div className="flex flex-col gap-0.5">
              {tail.map((t) => (
                <div key={t.path} className="flex items-center gap-2.5 py-1">
                  <PathThumb path={t.path} />
                  <div className="min-w-0">
                    <p className="text-xs text-[#c8bfa8] truncate">{t.title}</p>
                    <p className="text-[10px] text-[#5a5448] truncate">{t.artist}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Help / legend modal ─────────────────────────────────────────────────────────

const HELP_ITEMS: { name: string; desc: string }[] = [
  { name: "Search", desc: "Type a genre and jump the camera to it. Also finds a node by a tag it absorbed (searching “OST” finds Soundtrack)." },
  { name: "Add", desc: "Create your own genre node and drop it on the map. It's saved across sessions." },
  { name: "Connect", desc: "Draw your own link between two genres. You can label it (“influence”, “fusion”) and set its thickness." },
  { name: "Path", desc: "Pick two genres to reveal the shortest chain of related genres between them. Then “Play transition” queues one song from each genre on the way, easing from one to the other." },
  { name: "Select", desc: "Drag a box (or click) to multi-select genres, then Play / Shuffle / Queue them or save the union as a playlist — all from the side panel." },
  { name: "Mine", desc: "Constellation mode: hides every genre you don't own, leaving only your library (family hubs stay as anchors)." },
  { name: "Discover", desc: "Highlights genres you don't have yet that bridge two or more genres you do — suggestions worth exploring (green dashed ring)." },
  { name: "Affinity", desc: "Swaps the static map links for connections from YOUR library: two genres link when artists you own span both. Thicker = more shared artists." },
  { name: "Regions", desc: "Draws a soft coloured blob behind each family so the regions read at a glance." },
  { name: "Recent", desc: "Warm glow on the genres of your last 20 played tracks — what you've been into lately." },
  { name: "Size · Trk/Alb/Art", desc: "Size the nodes by number of tracks, albums, or artists. The slider scales every node up or down." },
  { name: "Fit", desc: "Zoom and centre so the whole web fits on screen." },
  { name: "Reset", desc: "Releases all the nodes you pinned by dragging, back into the automatic layout." },
  { name: "Tags", desc: "Diagnose your library's genre tags — unmatched, fuzzy-guessed, or duplicated by capitalisation — and reassign them. Never touches your files." },
  { name: "Drag a node", desc: "Pins it where you drop it (remembered across sessions). Unpin it from its panel, or with Reset." },
  { name: "Mini-map", desc: "Overview at the bottom-right; click it to reposition the camera." },
];

const HELP_CUES: { color: string; label: string; dashed?: boolean }[] = [
  { color: "var(--accent)", label: "Your custom nodes & connections", dashed: true },
  { color: "#d9a441", label: "Fuzzy match — the map guessed this genre", dashed: true },
  { color: "#7faa6e", label: "Recommended (Discover)", dashed: true },
  { color: "#e8643c", label: "Recently played (Recent)" },
  { color: "#4bb3a2", label: "Affinity links" },
  { color: "#3a3628", label: "Grey = not in your library yet" },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()} className="relative z-10 w-[600px] max-w-full max-h-[82vh] flex flex-col bg-[#161410] border border-white/8 rounded-2xl shadow-2xl">
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/6">
          <div>
            <h3 className="text-lg text-[#f0ead8]" style={{ fontFamily: "Fraunces, serif" }}>Genre Map — Guide</h3>
            <p className="text-[11px] text-[#5a5448] font-mono mt-1">What every tool does. Nothing here changes your files unless it says so.</p>
          </div>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060]"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-2.5">
            {HELP_ITEMS.map((it) => (
              <div key={it.name} className="flex gap-3">
                <span className="text-[11px] font-mono text-[var(--accent)] shrink-0 w-[96px] pt-0.5">{it.name}</span>
                <span className="text-[11px] text-[#c8bfa8] leading-relaxed">{it.desc}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-white/6">
            <p className="text-[10px] font-mono uppercase tracking-wider text-[#5a5448] mb-2.5">What the colours mean</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {HELP_CUES.map((c) => (
                <div key={c.label} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ border: `1.5px ${c.dashed ? "dashed" : "solid"} ${c.color}`, background: c.dashed ? "transparent" : c.color }} />
                  <span className="text-[10px] text-[#c8bfa8]">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
