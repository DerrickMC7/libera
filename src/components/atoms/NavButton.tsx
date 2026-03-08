import { motion } from "framer-motion";

interface NavButtonProps {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}

export function NavButton({ icon, active = false, onClick, title }: NavButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      title={title}
      className={`
        relative w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer transition-colors duration-150
        ${active
          ? "bg-[rgba(212,135,42,0.12)] text-[#d4872a]"
          : "text-[#7a7060] hover:bg-[#1f1d18] hover:text-[#c8bfa8]"
        }
      `}
    >
      {icon}
      {active && (
        <motion.span
          layoutId="nav-indicator"
          className="absolute -right-[1px] w-[2px] h-4 bg-[#d4872a] rounded-l-sm"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
    </motion.button>
  );
}