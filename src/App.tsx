import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./components/organisms/Shell";
import { MusicLibrary } from "./components/organisms/MusicLibrary";
import { AudioPlayer } from "./components/organisms/AudioPlayer";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell>
        <div className="h-full overflow-hidden pb-20">
          <MusicLibrary />
        </div>
      </Shell>
      <AudioPlayer />
    </QueryClientProvider>
  );
}

export default App;