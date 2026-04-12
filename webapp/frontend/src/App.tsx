import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Header } from './components/Header/Header'
import { About } from './pages/About'
import { Corpus } from './pages/Corpus'
import { CorpusDetail } from './pages/CorpusDetail'
import { Home } from './pages/Home'
import { Map } from './pages/Map'
import { Read } from './pages/Read'

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
          <Route path="/corpus" element={<Corpus />} />
          <Route path="/corpus/:id" element={<CorpusDetail />} />
          <Route path="/read/:unitId" element={<Read />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
