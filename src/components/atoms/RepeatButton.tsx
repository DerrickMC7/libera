import { motion } from "framer-motion";

type RepeatMode = "off" | "all" | "one";

interface RepeatButtonProps {
  mode: RepeatMode;
  onClick: () => void;
}

export function RepeatButton({ mode, onClick }: RepeatButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className={`relative transition-colors cursor-pointer ${
        mode !== "off" ? "text-[#d4872a]" : "text-[#7a7060] hover:text-[#c8bfa8]"
      }`}
    >
      {mode === "one" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
        </svg>
      )}
      {mode === "one" && (
        <span className="absolute -top-1 -right-1 text-[8px] font-mono font-bold text-[#d4872a]">
          1
        </span>
      )}
    </motion.button>
  );
}