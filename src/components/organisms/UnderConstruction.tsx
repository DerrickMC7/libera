interface Props {
  name: string;
  description?: string;
}

export function UnderConstruction({ name, description }: Props) {
  return (
    <div className="flex flex-col h-full bg-[#0e0d0b] items-center justify-center gap-6 select-none">
      <div className="flex flex-col items-center gap-5">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          className="text-[var(--accent)] opacity-60"
        >
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <div className="text-center">
          <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-[var(--accent)] mb-2">
            Under Construction
          </p>
          <h2
            className="text-[32px] leading-none tracking-[-1px] text-[#faf8f2] font-light mb-3"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            {name}{" "}
            <em className="italic text-[#c8bfa8] font-light">coming soon</em>
          </h2>
          <p className="text-[#3a3628] text-sm max-w-xs">
            {description ?? "This section is actively being built. Check back soon."}
          </p>
        </div>

        <div className="flex items-center gap-1.5 mt-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-40"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

