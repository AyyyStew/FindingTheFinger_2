import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Home } from './pages/Home'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Home />
    </QueryClientProvider>
  )
}
