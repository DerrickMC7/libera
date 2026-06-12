import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NavRail } from "./NavRail";
import { MusicLibrary } from "./MusicLibrary";
import { BookLibrary } from "./BookLibrary";
import { PhotoLibrary } from "./PhotoLibrary";
import { VideoLibrary } from "./VideoLibrary";
import { SearchPage } from "../../pages/SearchPage";
import { SettingsPage } from "../../pages/SettingsPage";
import { CacheProgress } from "./CacheProgress";
import { useCacheStore } from "../../store/cacheStore";
import { useNavigationStore, registerSectionSetter, syncSection } from "../../store/navigationStore";

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function Shell() {
  const [activeSection, setActiveSection] = useState("music");
  const { isProcessing, isFirstTime } = useCacheStore();
  const pendingArtistName = useNavigationStore((s) => s.pendingArtistName);

  // Register setter so goBack() can drive Shell without prop drilling
  useEffect(() => { registerSectionSetter(setActiveSection); }, []);
  // Keep module-level mirror in sync
  useEffect(() => { syncSection(activeSection); }, [activeSection]);

  useEffect(() => {
    if (pendingArtistName) setActiveSection("music");
  }, [pendingArtistName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey) return;
      if (e.key === "e") {
        e.preventDefault();
        if (!(isProcessing && isFirstTime)) setActiveSection("search");
      } else if (e.key === "f") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-search-bar"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isProcessing, isFirstTime]);

  function handleNavigate(section: string) {
    if (isProcessing && isFirstTime) return;
    setActiveSection(section);
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col-reverse sm:flex-row min-h-0">
      <NavRail
        activeSection={activeSection}
        onNavigate={handleNavigate}
        disabled={isProcessing && isFirstTime}
      />
      <main className="overflow-hidden flex-1 min-h-0 flex flex-col">
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
              {activeSection === "films" && <VideoLibrary />}
              {activeSection === "pictures" && <PhotoLibrary />}
              {activeSection === "books" && <BookLibrary />}
              {activeSection === "search" && <SearchPage />}
              {activeSection === "settings" && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}