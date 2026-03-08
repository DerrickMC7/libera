import { Logo } from "../atoms/Logo";
import { NavButton } from "../atoms/NavButton";

interface NavRailProps {
  activeSection: string;
  onNavigate: (section: string) => void;
}

export function NavRail({ activeSection, onNavigate }: NavRailProps) {
  return (
    <div className="flex flex-col items-center py-[18px] gap-0.5 border-r border-white/5 bg-[#0e0d0b] w-[52px]">
      <Logo />

      <div className="mt-7 flex flex-col items-center gap-0.5 w-full px-2">
        {/* Music */}
        <NavButton
          active={activeSection === "music"}
          onClick={() => onNavigate("music")}
          title="Music"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          }
        />

        {/* Films */}
        <NavButton
          active={activeSection === "films"}
          onClick={() => onNavigate("films")}
          title="Films"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z" />
            </svg>
          }
        />

        {/* Books */}
        <NavButton
          active={activeSection === "books"}
          onClick={() => onNavigate("books")}
          title="Books"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" />
            </svg>
          }
        />

        {/* Search */}
        <NavButton
          active={activeSection === "search"}
          onClick={() => onNavigate("search")}
          title="Search"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
          }
        />
      </div>

      <div className="flex-1" />

      {/* Avatar */}
      <div className="w-[30px] h-[30px] rounded-full bg-[#2a2820] border border-[#3a3628] flex items-center justify-center text-[11px] font-semibold text-[#c8bfa8] cursor-pointer hover:border-[#d4872a] transition-colors select-none">
        D
      </div>
    </div>
  );
}