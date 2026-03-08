import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-screen h-screen bg-[#0e0d0b] text-[#f0ead8] flex items-center justify-center">
        <p className="font-mono text-sm text-[#d4872a]">Libera is starting...</p>
      </div>
    </QueryClientProvider>
  );
}

export default App;