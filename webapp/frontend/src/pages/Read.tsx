import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { fetchUnitDetail } from '../api/client'
import styles from './Read.module.css'

export function Read() {
  const { unitId } = useParams()
  const id = Number(unitId)

  const { data, isLoading, error } = useQuery({
    queryKey: ['unit-detail', id],
    queryFn: () => fetchUnitDetail(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 60_000,
  })

  const taxonomyPath = useMemo(() => {
    if (!data) return ''
    return [...data.taxonomy]
      .sort((a, b) => a.level - b.level)
      .map((t) => t.name)
      .join(' / ')
  }, [data])

  if (!Number.isFinite(id) || id <= 0) {
    return <main className={styles.page}><p className={styles.error}>Invalid unit id.</p></main>
  }

  return (
    <main className={styles.page}>
      <div className={styles.backRow}>
        <Link to="/corpus" className={styles.backLink}>← Corpus explorer</Link>
      </div>

      {isLoading && <p className={styles.loading}>Loading passage...</p>}
      {error && <p className={styles.error}>{error instanceof Error ? error.message : 'Failed to load passage'}</p>}

      {data && (
        <>
          <header className={styles.header}>
            <h1 className={styles.title}>{data.reference_label ?? `Unit ${data.id}`}</h1>
            <div className={styles.meta}>
              <span>{data.corpus_name}</span>
              {data.corpus_version_name && <span>• {data.corpus_version_name}</span>}
            </div>
            {data.ancestor_path && <p className={styles.path}>{data.ancestor_path}</p>}
            {taxonomyPath && <p className={styles.taxonomy}>{taxonomyPath}</p>}
          </header>

          <section className={styles.textBlock}>
            <h2 className={styles.blockTitle}>Cleaned Text</h2>
            <p className={styles.cleanedText}>{data.cleaned_text ?? 'No cleaned text available.'}</p>
          </section>

          <section className={styles.textBlockOriginal}>
            <h2 className={styles.blockTitle}>Original Text</h2>
            <p className={styles.originalText}>{data.original_text ?? 'No original text available.'}</p>
          </section>

          <section className={styles.sources}>
            <h2 className={styles.blockTitle}>Source</h2>
            {data.unit_source && <p className={styles.sourceLine}><strong>Unit source:</strong> {data.unit_source}</p>}
            {data.version_source && <p className={styles.sourceLine}><strong>Version source:</strong> {data.version_source}</p>}
            {!data.unit_source && !data.version_source && (
              <p className={styles.sourceFallback}>No source attribution available.</p>
            )}
          </section>
        </>
      )}
    </main>
  )
}
