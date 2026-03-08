import { motion } from "framer-motion";

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  className?: string;
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled = false,
  className = "",
}: ButtonProps) {
  const base = "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  const variants = {
    primary: "bg-[#d4872a] text-[#0e0d0b] hover:bg-[#e8a84a]",
    ghost: "text-[#7a7060] hover:bg-[#1f1d18] hover:text-[#c8bfa8]",
  };

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </motion.button>
  );
}