import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MusicLibrary } from "./components/organisms/MusicLibrary";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-screen h-screen bg-[#0e0d0b] text-[#f0ead8] overflow-hidden">
        <MusicLibrary />
      </div>
    </QueryClientProvider>
  );
}

export default App;