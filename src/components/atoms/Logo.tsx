interface LogoProps {
  onClick?: () => void;
}

export function Logo({ onClick }: LogoProps) {
  return (
    <span
      onClick={onClick}
      className="font-serif text-[18px] font-semibold text-[var(--accent)] tracking-[-0.5px] cursor-pointer select-none"
      style={{ fontFamily: "Fraunces, serif" }}
    >
      L
    </span>
  );
}