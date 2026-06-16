import { useEffect, useReducer, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGenres } from "../../hooks/useGenres";
import { usePlayerStore } from "../../store/playerStore";
import { useGenreMapStore } from "../../store/genreMapStore";
import { Track } from "../../types/track";
import { TrackRow, TrackRowHeader } from "../molecules/TrackRow";
import {
  TAXONOMY_NODES,
  TAXONOMY_LINKS,
  GENRE_FAMILIES,
  matchUserGenres,
} from "../../data/genreTaxonomy";

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
  count: number;
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

function baseRadius(n: SimNode): number {
  const base = n.depth === 0 ? 13 : n.depth === 1 ? 7 : 5.5;
  if (n.active) return base + Math.min(16, Math.sqrt(n.count) * 1.7);
  return base * 0.75;
}

function linkWidthFactor(weight?: number): number {
  if (weight === 1) return 0.9;
  if (weight === 3) return 2.4;
  return 1.4; // 2 / default
}

interface CustomNodeDef { id: string; label: string; family: string; }
interface CustomLinkDef { id: string; source: string; target: string; label?: string; weight?: number; }

function buildSim(
  userGenres: { name: string; track_count: number }[],
  customNodes: CustomNodeDef[],
  customLinks: CustomLinkDef[],
  prev: Map<string, { x: number; y: number }>,
): Sim {
  const { matches, unmatched } = matchUserGenres(userGenres);

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
      active: !!m, custom: false, count: m?.count ?? 0, userGenres: m?.userGenres ?? [],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    };
  });

  unmatched.forEach((u, i) => {
    nodes.push({
      id: `extra-${i}`, label: u.name, family: "other", color: OTHER_COLOR, depth: 1,
      mass: 1, active: true, custom: false, count: u.count, userGenres: [u.name],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    });
  });

  for (const c of customNodes) {
    const u = userByNorm.get(norm(c.label));
    nodes.push({
      id: c.id, label: c.label, family: c.family, color: FAMILY_COLOR.get(c.family) ?? OTHER_COLOR,
      depth: 1, mass: 1, active: true, custom: true,
      count: u?.count ?? 0, userGenres: u ? [u.name] : [],
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, fx: null, fy: null,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
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
  const { customNodes, customLinks, addNode, removeNode, addLink, removeLink, updateLink } = useGenreMapStore();

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

  const drag = useRef<{ mode: "none" | "node" | "pan"; node: SimNode | null; lastX: number; lastY: number; moved: number; }>(
    { mode: "none", node: null, lastX: 0, lastY: 0, moved: 0 },
  );

  useEffect(() => {
    if (isLoading) return;
    const prevPos = new Map<string, { x: number; y: number }>();
    if (simRef.current) for (const nd of simRef.current.nodes) prevPos.set(nd.id, { x: nd.x, y: nd.y });
    const firstBuild = !simRef.current;
    const sim = buildSim(
      genres.map((g) => ({ name: g.name, track_count: g.track_count })),
      customNodes, customLinks, prevPos,
    );
    if (!firstBuild) sim.alpha = 0.6;
    simRef.current = sim;
    startLoop();
    return () => { if (sim.raf) cancelAnimationFrame(sim.raf); sim.running = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, genres, customNodes, customLinks]);

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
      else if (search) setSearch("");
      else if (selectedId) setSelectedId(null);
      else onBack();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [addOpen, connectMode, search, selectedId, onBack]);

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

  function onNodePointerDown(e: React.PointerEvent, node: SimNode) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { px, py } = relPoint(e);
    drag.current = { mode: "node", node, lastX: px, lastY: py, moved: 0 };
    node.fx = node.x; node.fy = node.y; reheat(0.3);
  }
  function onSvgPointerDown(e: React.PointerEvent) {
    const { px, py } = relPoint(e);
    drag.current = { mode: "pan", node: null, lastX: px, lastY: py, moved: 0 };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (d.mode === "none") return;
    const { px, py } = relPoint(e);
    const dx = px - d.lastX, dy = py - d.lastY;
    d.moved += Math.abs(dx) + Math.abs(dy); d.lastX = px; d.lastY = py;
    if (d.mode === "node" && d.node) { const w = screenToWorld(px, py); d.node.fx = w.x; d.node.fy = w.y; reheat(0.3); }
    else if (d.mode === "pan") setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }
  function onPointerUp() {
    const d = drag.current;
    if (d.mode === "node" && d.node) {
      if (d.moved < 6) { if (connectMode) handleConnectPick(d.node); else setSelectedId(d.node.id); }
      d.node.fx = null; d.node.fy = null; reheat(0.15);
    } else if (d.mode === "pan") {
      if (d.moved < 6) { if (connectMode) { setConnectMode(false); setConnectFromId(null); } else setSelectedId(null); }
    }
    drag.current = { mode: "none", node: null, lastX: 0, lastY: 0, moved: 0 };
  }

  const sim = simRef.current;
  const selected = (sim && selectedId) ? sim.byId.get(selectedId) ?? null : null;

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
    return sim.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [sim, search]);

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
              <div className="absolute top-full mt-1 left-0 right-0 bg-[#161410] border border-white/10 rounded-lg shadow-2xl py-1 max-h-[240px] overflow-y-auto">
                {searchResults.map((n) => (
                  <button key={n.id} onClick={() => { centerOn(n); setSearch(""); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: n.active ? n.color : "#3a3628" }} />
                    <span className="text-xs text-[#c8bfa8] truncate flex-1">{n.label}</span>
                    {n.active && <span className="text-[9px] font-mono text-[#5a5448]">{n.count}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap justify-end gap-1.5">
            <ToolBtn active={addOpen} onClick={() => { setConnectMode(false); setConnectFromId(null); setAddOpen((v) => !v); }} label="Add" icon={<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />} />
            <ToolBtn active={connectMode} onClick={() => { setAddOpen(false); setConnectMode((v) => !v); setConnectFromId(null); }} label="Connect" icon={<path d="M12 2a3 3 0 0 0-1 5.83V10H7a3 3 0 1 0 0 2h4v2.17a3 3 0 1 0 2 0V12h4a3 3 0 1 0 0-2h-4V7.83A3 3 0 0 0 12 2z" />} />
            <ToolBtn active={constellation} onClick={() => setConstellation((v) => !v)} label="Mine" icon={<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />} />
            <ToolBtn onClick={fitView} label="Fit" icon={<path d="M9 3H3v6h2V5h4V3zm12 0h-6v2h4v4h2V3zM5 15H3v6h6v-2H5v-4zm14 4h-4v2h6v-6h-2v4z" />} />
          </div>

          {/* Scale slider */}
          <div className="w-full flex items-center gap-2 bg-[#1a1814] border border-white/8 rounded-lg px-2.5 py-1.5">
            <span className="text-[9px] font-mono text-[#5a5448]">SIZE</span>
            <input type="range" min={0.5} max={2.2} step={0.05} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} className="flex-1 accent-[var(--accent)]" />
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

        <div
          ref={containerRef}
          className={`absolute inset-0 overflow-hidden touch-none ${connectMode ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
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
                {sim.links.map((l, i) => {
                  if (constellation && !((l.source.active || l.source.depth === 0) && (l.target.active || l.target.depth === 0))) return null;
                  const lit = neighbourIds && neighbourIds.has(l.source.id) && neighbourIds.has(l.target.id);
                  const bothActive = l.source.active && l.target.active;
                  const isoOut = isolatedFamily && l.source.family !== isolatedFamily && l.target.family !== isolatedFamily;
                  const stroke = l.custom
                    ? (lit ? "var(--accent)" : "var(--accent-a40)")
                    : lit ? "rgba(255,255,255,0.55)" : bothActive ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)";
                  const baseW = l.custom ? linkWidthFactor(l.weight) : lit ? 1.4 : l.kind === "family" ? 1.1 : 0.7;
                  const mx = (l.source.x + l.target.x) / 2, my = (l.source.y + l.target.y) / 2;
                  return (
                    <g key={i} style={{ opacity: isoOut ? 0.06 : 1 }}>
                      <line x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} stroke={stroke} strokeWidth={baseW / transform.k} strokeDasharray={l.custom ? `${4 / transform.k} ${3 / transform.k}` : undefined} />
                      {l.custom && l.label && (lit || transform.k > 0.8) && (
                        <text x={mx} y={my} textAnchor="middle" fontSize={9 / transform.k} fontFamily="ui-monospace, monospace" fill="var(--accent)" style={{ paintOrder: "stroke", stroke: "#0e0d0b", strokeWidth: 3 / transform.k, strokeLinejoin: "round", pointerEvents: "none" }}>{l.label}</text>
                      )}
                    </g>
                  );
                })}

                {sim.nodes.map((n) => {
                  if (!nodeVisible(n)) return null;
                  const r = baseRadius(n) * scale;
                  const op = nodeOpacity(n);
                  const isSel = selectedId === n.id;
                  const isConnFrom = connectFromId === n.id;
                  const fill = n.active ? n.color : "#26241e";
                  const showLabel = n.depth === 0 || n.active || hoveredId === n.id || isSel;
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: "pointer", opacity: op }}
                      onPointerDown={(e) => onNodePointerDown(e, n)} onPointerEnter={() => setHoveredId(n.id)} onPointerLeave={() => setHoveredId((h) => (h === n.id ? null : h))}>
                      {(isSel || isConnFrom) && <circle r={r + 4 / transform.k} fill="none" stroke="var(--accent)" strokeWidth={2 / transform.k} />}
                      <circle r={r} fill={fill} stroke={n.custom ? "var(--accent)" : n.active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)"} strokeWidth={(n.custom ? 1.4 : n.active ? 1 : 0.6) / transform.k} strokeDasharray={n.custom ? `${3 / transform.k} ${2 / transform.k}` : undefined} />
                      {showLabel && (
                        <text y={r + (n.depth === 0 ? 15 : 11) / transform.k} textAnchor="middle" fontSize={(n.depth === 0 ? 13 : 9) / transform.k} fontFamily={n.depth === 0 ? "Fraunces, serif" : "ui-monospace, monospace"} fill={n.active ? "#f0ead8" : "#5a5448"} style={{ paintOrder: "stroke", stroke: "#0e0d0b", strokeWidth: 3 / transform.k, strokeLinejoin: "round", pointerEvents: "none", userSelect: "none" }}>{n.label}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
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

      {selected && (
        <GenreDetailPanel
          key={selected.id}
          node={selected}
          connections={selectedConnections}
          onClose={() => setSelectedId(null)}
          onRemoveNode={selected.custom ? () => { removeNode(selected.id); setSelectedId(null); } : undefined}
          onRemoveLink={removeLink}
          onUpdateLink={updateLink}
          onConnectFrom={() => { setSelectedId(null); setConnectMode(true); setConnectFromId(selected.id); }}
        />
      )}
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
  node, connections, onClose, onRemoveNode, onRemoveLink, onUpdateLink, onConnectFrom,
}: {
  node: SimNode;
  connections: { linkId: string; label?: string; weight?: number; otherLabel: string; color: string }[];
  onClose: () => void;
  onRemoveNode?: () => void;
  onRemoveLink: (id: string) => void;
  onUpdateLink: (id: string, patch: { label?: string; weight?: number }) => void;
  onConnectFrom: () => void;
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
              <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#5a5448]">{node.custom ? "Custom genre" : "Genre"}</p>
            </div>
            <h2 className="text-2xl text-[#faf8f2] font-light leading-tight" style={{ fontFamily: "Fraunces, serif" }}>{node.label}</h2>
            <p className="text-[11px] text-[#5a5448] font-mono mt-1.5">{hasMusic ? `${node.count} tracks in your library` : "Not in your library yet"}</p>
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
