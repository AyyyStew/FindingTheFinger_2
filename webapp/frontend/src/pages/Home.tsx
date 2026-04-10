import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchCorpora,
  searchKeyword,
  searchPassage,
  searchSemantic,
} from '../api/client'
import type { SearchResponse, UnitBrief } from '../api/types'
import { FilterPanel, type Filters } from '../components/FilterPanel/FilterPanel'
import { ResultCard } from '../components/ResultCard/ResultCard'
import { SearchBar, type SearchMode } from '../components/SearchBar/SearchBar'
import styles from './Home.module.css'

const DEFAULT_FILTERS: Filters = { corpusId: null, height: 0, limit: 10 }

export function Home() {
  const [mode, setMode] = useState<SearchMode>('semantic')
  const [textQuery, setTextQuery] = useState('')
  const [selectedUnit, setSelectedUnit] = useState<UnitBrief | null>(null)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const { data: corpora = [] } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  })

  const handleSearch = async () => {
    setIsSearching(true)
    setSearchError(null)

    const shared = {
      height: filters.height,
      corpus_id: filters.corpusId ?? undefined,
      limit: filters.limit,
    }

    try {
      let res: SearchResponse

      if (mode === 'semantic') {
        res = await searchSemantic({ query: textQuery, ...shared })
      } else if (mode === 'keyword') {
        res = await searchKeyword({ query: textQuery, ...shared })
      } else {
        res = await searchPassage({ unit_id: selectedUnit!.id, ...shared })
      }

      setResults(res)
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }

  const showScore = results?.mode === 'semantic' || results?.mode === 'passage'

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Finding the Finger</h1>
        <p className={styles.subtitle}>Cross-tradition semantic search</p>
      </header>

      <section className={styles.searchSection}>
        <SearchBar
          mode={mode}
          onModeChange={setMode}
          textQuery={textQuery}
          onTextQueryChange={setTextQuery}
          selectedUnit={selectedUnit}
          onSelectedUnitChange={setSelectedUnit}
          filtersOpen={filtersOpen}
          onFiltersToggle={() => setFiltersOpen((o) => !o)}
          onSearch={handleSearch}
          isSearching={isSearching}
        />
        <FilterPanel
          open={filtersOpen}
          filters={filters}
          onChange={setFilters}
          corpora={corpora}
        />
      </section>

      {(searchError || results) && (
        <section className={styles.results}>
          {searchError ? (
            <p className={styles.error}>{searchError}</p>
          ) : results && results.results.length === 0 ? (
            <p className={styles.empty}>No results found.</p>
          ) : results ? (
            <>
              <div className={styles.resultsHeader}>
                <span className={styles.resultsTitle}>Results</span>
                <span className={styles.resultsCount}>{results.results.length} passages</span>
                <span className={styles.modeTag}>{results.mode}</span>
              </div>
              <div className={styles.resultList}>
                {results.results.map((r) => (
                  <ResultCard key={r.id} result={r} showScore={showScore} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      )}
    </main>
  )
}
