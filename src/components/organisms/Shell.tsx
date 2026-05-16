import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavRail } from "./NavRail";
import { MusicLibrary } from "./MusicLibrary";
import { BookLibrary } from "./BookLibrary";
import { SearchPage } from "../../pages/SearchPage";
import { SettingsPage } from "../../pages/SettingsPage";
import { CacheProgress } from "./CacheProgress";
import { UnderConstruction } from "./UnderConstruction";
import { useCacheStore } from "../../store/cacheStore";

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function Shell() {
  const [activeSection, setActiveSection] = useState("music");
  const { isProcessing, isFirstTime } = useCacheStore();

  function handleNavigate(section: string) {
    if (isProcessing && isFirstTime) return;
    setActiveSection(section);
  }

  return (
    <div className="w-screen h-screen bg-[#0e0d0b] overflow-hidden grid grid-cols-[52px_1fr]">
      <NavRail
        activeSection={activeSection}
        onNavigate={handleNavigate}
        disabled={isProcessing && isFirstTime}
      />
      <main className="overflow-hidden h-full pb-20 flex flex-col">
        <CacheProgress />

        <div className="flex-1 overflow-hidden">
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
              {activeSection === "films" && (
                <UnderConstruction
                  name="Films"
                  description="Video library and player — coming in the next major release."
                />
              )}
              {activeSection === "books" && <BookLibrary />}
              {activeSection === "search" && <SearchPage />}
              {activeSection === "settings" && (
                <UnderConstruction
                  name="Settings"
                  description="App preferences, themes, and equalizer configuration — coming soon."
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}