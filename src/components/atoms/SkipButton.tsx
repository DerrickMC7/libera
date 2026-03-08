import { motion } from "framer-motion";

interface SkipButtonProps {
  direction: "previous" | "next";
  onClick: () => void;
}

export function SkipButton({ direction, onClick }: SkipButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className="text-[#7a7060] hover:text-[#c8bfa8] transition-colors cursor-pointer"
    >
      {direction === "previous" ? (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
) : (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
  </svg>
)}
    </motion.button>
  );
}