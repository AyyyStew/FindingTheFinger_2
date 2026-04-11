import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header/Header'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { Map } from './pages/Map'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/map" element={<Map />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
