import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

const CROP_SIZE = 300;

export function PlaylistCoverModal({ playlistId, onClose }: { playlistId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [nat, setNat] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [cx, setCx] = useState(0);
  const [cy, setCy] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  const objUrlRef = useRef<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const mousedownOriginRef = useRef<EventTarget | null>(null);

  const minZoom = Math.max(CROP_SIZE / Math.max(nat.w, 1), CROP_SIZE / Math.max(nat.h, 1));
  const maxZoom = minZoom * 5;

  useEffect(() => () => { if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current); }, []);

  function loadFile(file: File) {
    if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    const url = URL.createObjectURL(file);
    objUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const mz = Math.max(CROP_SIZE / w, CROP_SIZE / h);
      setNat({ w, h });
      setZoom(mz);
      setCx(w / 2);
      setCy(h / 2);
      setImgSrc(url);
      setError(null);
    };
    img.src = url;
  }

  const half = (z: number) => CROP_SIZE / (2 * z);

  function clampCenter(nx: number, ny: number, z: number): [number, number] {
    const h = half(z);
    return [
      Math.max(h, Math.min(nat.w - h, nx)),
      Math.max(h, Math.min(nat.h - h, ny)),
    ];
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, cx, cy };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || e.buttons === 0) return;
    const dx = e.clientX - dragRef.current.px;
    const dy = e.clientY - dragRef.current.py;
    const [nx, ny] = clampCenter(dragRef.current.cx - dx / zoom, dragRef.current.cy - dy / zoom, zoom);
    setCx(nx); setCy(ny);
  }

  function handleZoom(newZoom: number) {
    const [nx, ny] = clampCenter(cx, cy, newZoom);
    setZoom(newZoom); setCx(nx); setCy(ny);
  }

  const imgLeft = CROP_SIZE / 2 - cx * zoom;
  const imgTop  = CROP_SIZE / 2 - cy * zoom;

  async function handleApply() {
    if (!imgSrc) return;
    setSaving(true);
    setError(null);
    const canvas = document.createElement("canvas");
    canvas.width = 500; canvas.height = 500;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    img.onload = async () => {
      const srcX    = cx - CROP_SIZE / (2 * zoom);
      const srcY    = cy - CROP_SIZE / (2 * zoom);
      const srcSize = CROP_SIZE / zoom;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 500, 500);
      const base64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
      try {
        await invoke("set_playlist_cover", { playlistId, imageBase64: base64 });
        queryClient.invalidateQueries({ queryKey: ["playlists"] });
        onClose();
      } catch (err) {
        setError(String(err));
        setSaving(false);
      }
    };
    img.onerror = () => { setError("Failed to read image."); setSaving(false); };
    img.src = imgSrc;
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      onMouseDown={(e) => { mousedownOriginRef.current = e.target; }}
      onClick={() => { if (!modalRef.current?.contains(mousedownOriginRef.current as Node)) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        ref={modalRef}
        initial={{ scale: 0.94, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 12 }}
        transition={{ type: "spring", stiffness: 400, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 bg-[#161410] border border-white/8 rounded-2xl shadow-2xl p-4 sm:p-6 w-[calc(100vw-2rem)] sm:w-[400px] max-w-[400px]"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base text-[#f0ead8]" style={{ fontFamily: "Fraunces, serif" }}>Change Cover</h3>
          <button onClick={onClose} className="text-[#3a3628] hover:text-[#7a7060] transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>

        {!imgSrc ? (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-white/10 hover:border-[var(--accent-a30)] rounded-xl p-10 cursor-pointer transition-colors">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628]">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
            <span className="text-xs text-[#5a5448]">Click to select an image</span>
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
          </label>
        ) : (
          <>
            <div
              className="relative overflow-hidden rounded-xl mx-auto select-none cursor-grab active:cursor-grabbing"
              style={{ width: CROP_SIZE, height: CROP_SIZE }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => { dragRef.current = null; }}
            >
              <img
                src={imgSrc}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  width: nat.w * zoom,
                  height: nat.h * zoom,
                  maxWidth: "none",
                  maxHeight: "none",
                  left: imgLeft,
                  top: imgTop,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
              <div className="absolute inset-0 pointer-events-none" style={{
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
                backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                backgroundSize: "100px 100px",
              }} />
            </div>

            <div className="flex items-center gap-3 mt-4">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="range" min={minZoom} max={maxZoom} step={0.001} value={zoom}
                onChange={(e) => handleZoom(parseFloat(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#3a3628] shrink-0">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </div>

            <label className="inline-block mt-2 text-[10px] font-mono text-[#3a3628] hover:text-[#7a7060] cursor-pointer transition-colors">
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
              Choose different image
            </label>
          </>
        )}

        {error && <p className="text-xs text-[#c85858] mt-3 font-mono">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 text-xs py-2 rounded-lg bg-[#2a2820] text-[#7a7060] hover:text-[#c8bfa8] transition-colors font-mono">Cancel</button>
          <button
            onClick={handleApply}
            disabled={!imgSrc || saving}
            className="flex-1 text-xs py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors font-mono disabled:opacity-30"
            style={{ color: "var(--accent-on)" }}
          >
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
