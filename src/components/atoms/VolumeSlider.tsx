import { useState, useRef, useEffect, useCallback } from "react";

interface VolumeSliderProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
}

export function VolumeSlider({ volume, onVolumeChange }: VolumeSliderProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipOpacity, setTooltipOpacity] = useState(0);
  const rangeRef = useRef<HTMLInputElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const STEP = 0.01;

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const showTooltip = useCallback(() => {
    cancelHide();
    setTooltipVisible(true);
    setTooltipOpacity(1);
  }, [cancelHide]);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      setTooltipOpacity(0);
      setTimeout(() => setTooltipVisible(false), 200);
    }, 150);
  }, [cancelHide]);

  useEffect(() => {
    const range = rangeRef.current;
    if (!range) return;

    const handleMouseDown = () => {
      isDraggingRef.current = true;
      showTooltip();
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        scheduleHide();
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -STEP : STEP;
      const newVol = Math.max(0, Math.min(1, volume + delta));
      onVolumeChange(newVol);
      showTooltip();
      scheduleHide();
    };

    range.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    range.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      range.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      range.removeEventListener("wheel", handleWheel);
    };
  }, [volume, onVolumeChange, showTooltip, scheduleHide]);

  return (
    <div className="flex items-center gap-2 pr-4" style={{ width: "160px" }}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-[#7a7060] shrink-0"
      >
        {volume === 0 ? (
          <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
        ) : (
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        )}
      </svg>
      <div className="flex-1 relative">
        <input
          ref={rangeRef}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-full volume-range"
          style={{ "--volume-pct": `${volume * 100}%` } as React.CSSProperties}
        />
        {tooltipVisible && (
          <div
            ref={tooltipRef}
            className="absolute pointer-events-none bg-[#161410] backdrop-blur-sm text-[#f0ead8] text-xs px-2 py-1 rounded-lg border border-white/10 shadow-lg whitespace-nowrap z-50"
            style={{
              opacity: tooltipOpacity,
              transition: "opacity 0.2s ease",
              top: "-2.5rem",
              left: "50%",
              transform: "translateX(-50%)",
            }}
          >
            {Math.round(volume * 100)}%
          </div>
        )}
      </div>
    </div>
  );
}