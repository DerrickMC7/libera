import { useState } from "react";
import { NavRail } from "./NavRail";

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [activeSection, setActiveSection] = useState("music");

  return (
    <div className="w-screen h-screen bg-[#0e0d0b] overflow-hidden grid grid-cols-[52px_1fr]">
      <NavRail activeSection={activeSection} onNavigate={setActiveSection} />
      <main className="overflow-hidden">
        {children}
      </main>
    </div>
  );
}