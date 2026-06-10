import { useNavigationStore } from "../../store/navigationStore";

interface ArtistLinksProps {
  artist: string;
  className?: string;
}

export function ArtistLinks({ artist, className = "" }: ArtistLinksProps) {
  const navigateToArtist = useNavigationStore((s) => s.navigateToArtist);
  const parts = artist.split(" / ").map((a) => a.trim()).filter(Boolean);

  if (parts.length === 0) return null;

  return (
    <>
      {parts.map((name, i) => (
        <span key={i}>
          <span
            className={`hover:text-[var(--accent)] cursor-pointer transition-colors ${className}`}
            onClick={(e) => { e.stopPropagation(); navigateToArtist(name); }}
          >
            {name}
          </span>
          {i < parts.length - 1 && (
            <span className="pointer-events-none select-none"> / </span>
          )}
        </span>
      ))}
    </>
  );
}
