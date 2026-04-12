import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchCorpora } from '../api/client'
import { getTaxonomyColor } from '../utils/taxonomyColors'
import styles from './Corpus.module.css'

function taxonomyPath(levels: { name: string; level: number }[]): string {
  return [...levels]
    .sort((a, b) => a.level - b.level)
    .map((t) => t.name)
    .join(' / ')
}

export function Corpus() {
  const { data: corpora = [], isLoading, error } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  })

  const sorted = useMemo(
    () => [...corpora].sort((a, b) => a.name.localeCompare(b.name)),
    [corpora],
  )

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Corpus Explorer</h1>
        <p className={styles.subtitle}>Browse texts by corpus, then open any passage in Reader.</p>
      </header>

      {isLoading && <p className={styles.state}>Loading corpora...</p>}
      {error && <p className={styles.error}>{error instanceof Error ? error.message : 'Failed to load corpora'}</p>}

      {!isLoading && !error && (
        <section className={styles.grid}>
          {sorted.map((corpus) => {
            const { solid, dim } = getTaxonomyColor(corpus.taxonomy)
            const taxPath = taxonomyPath(corpus.taxonomy)
            return (
              <Link
                key={corpus.id}
                to={`/corpus/${corpus.id}`}
                className={styles.card}
                style={{ '--tx-solid': solid, '--tx-dim': dim } as React.CSSProperties}
              >
                <div className={styles.accent} />
                <div className={styles.cardBody}>
                  <h2 className={styles.cardTitle}>{corpus.name}</h2>
                  {corpus.description && <p className={styles.cardDescription}>{corpus.description}</p>}
                  <div className={styles.metaRow}>
                    <span className={styles.metaBadge}>{corpus.versions.length} version{corpus.versions.length === 1 ? '' : 's'}</span>
                    {taxPath && <span className={styles.taxonomy}>{taxPath}</span>}
                  </div>
                </div>
              </Link>
            )
          })}
        </section>
      )}
    </main>
  )
}
