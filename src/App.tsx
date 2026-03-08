import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MusicLibrary } from "./components/organisms/MusicLibrary";
import { AudioPlayer } from "./components/organisms/AudioPlayer";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-screen h-screen bg-[#0e0d0b] text-[#f0ead8] overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden pb-20">
          <MusicLibrary />
        </div>
        <AudioPlayer />
      </div>
    </QueryClientProvider>
  );
}

export default App;