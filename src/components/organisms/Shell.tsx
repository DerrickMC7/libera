import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavRail } from "./NavRail";
import { MusicLibrary } from "./MusicLibrary";
import { BookLibrary } from "./BookLibrary";
import { SearchPage } from "../../pages/SearchPage";

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function Shell() {
  const [activeSection, setActiveSection] = useState("music");

  return (
    <div className="w-screen h-screen bg-[#0e0d0b] overflow-hidden grid grid-cols-[52px_1fr]">
      <NavRail activeSection={activeSection} onNavigate={setActiveSection} />
      <main className="overflow-hidden h-full pb-20">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeSection === "music" && <MusicLibrary />}
            {activeSection === "books" && <BookLibrary />}
            {activeSection === "search" && <SearchPage />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}