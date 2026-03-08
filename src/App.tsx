import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "./components/organisms/Shell";
import { AudioPlayer } from "./components/organisms/AudioPlayer";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
      <AudioPlayer />
    </QueryClientProvider>
  );
}

export default App;