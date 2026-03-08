import { motion } from "framer-motion";

interface PlayButtonProps {
  isPlaying: boolean;
  onClick: () => void;
}

export function PlayButton({ isPlaying, onClick }: PlayButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className="w-9 h-9 rounded-full bg-[#f0ead8] flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
    >
      {isPlaying ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#0e0d0b">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#0e0d0b">
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </motion.button>
  );
}