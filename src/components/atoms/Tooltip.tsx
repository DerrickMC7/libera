import { useState, useRef, Fragment } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  children: React.ReactNode;
  shortcut: string;       // e.g. "Ctrl+E", "Space", "E"
  altShortcut?: string;   // optional second binding shown after "/"
  label?: string;         // optional description shown before the key badges
  delay?: number;         // ms before appearing, default 1200
}

export function Tooltip({ children, shortcut, altShortcut, label, delay = 1200 }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function show(e: React.MouseEvent) {
    clearTimeout(timerRef.current);
    const { clientX: x, clientY: y } = e;
    timerRef.current = setTimeout(() => setPos({ x, y }), delay);
  }

  function hide() {
    clearTimeout(timerRef.current);
    setPos(null);
  }

  const parts = shortcut.split("+").map((k) => k.trim());

  return (
    <div style={{ display: "contents" }} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos !== null &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: pos.x,
              top: pos.y - 12,
              transform: "translateX(-50%) translateY(-100%)",
            }}
          >
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#1e1c17] border border-white/10 shadow-2xl whitespace-nowrap">
              {label && (
                <span className="text-[10px] font-mono text-[#7a7060] pr-1.5 border-r border-white/8 mr-0.5">
                  {label}
                </span>
              )}
              {parts.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && (
                    <span className="text-[9px] text-[#3a3628] mx-0.5">+</span>
                  )}
                  <kbd className="px-1.5 py-0.5 rounded bg-[#2a2820] border border-white/10 text-[10px] font-mono text-[#c8bfa8] leading-none">
                    {part}
                  </kbd>
                </Fragment>
              ))}
              {altShortcut && (
                <>
                  <span className="text-[9px] text-[#3a3628] mx-1">/</span>
                  {altShortcut.split("+").map((part, i) => (
                    <Fragment key={i}>
                      {i > 0 && (
                        <span className="text-[9px] text-[#3a3628] mx-0.5">+</span>
                      )}
                      <kbd className="px-1.5 py-0.5 rounded bg-[#2a2820] border border-white/10 text-[10px] font-mono text-[#c8bfa8] leading-none">
                        {part}
                      </kbd>
                    </Fragment>
                  ))}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
