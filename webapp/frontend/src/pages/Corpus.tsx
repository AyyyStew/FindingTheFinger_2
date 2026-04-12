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

  const grouped = useMemo(() => {
    const byRoot = new Map<string, Map<string, typeof corpora>>()
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find((t) => t.level === 0)?.name ?? 'Uncategorized'
      const levelOne = corpus.taxonomy.find((t) => t.level === 1)?.name ?? 'Other'
      const subMap = byRoot.get(root) ?? new Map<string, typeof corpora>()
      const current = subMap.get(levelOne) ?? []
      current.push(corpus)
      subMap.set(levelOne, current)
      byRoot.set(root, subMap)
    }
    return [...byRoot.entries()]
      .map(([root, subMap]) => {
        const subgroups = [...subMap.entries()]
          .map(([subgroup, items]) => ({
            subgroup,
            items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.subgroup.localeCompare(b.subgroup))
        const count = subgroups.reduce((sum, sg) => sum + sg.items.length, 0)
        return { root, subgroups, count }
      })
      .sort((a, b) => a.root.localeCompare(b.root))
  }, [corpora])

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Corpus Explorer</h1>
        <p className={styles.subtitle}>Browse texts by corpus, then open any passage in Reader.</p>
      </header>

      {isLoading && <p className={styles.state}>Loading corpora...</p>}
      {error && <p className={styles.error}>{error instanceof Error ? error.message : 'Failed to load corpora'}</p>}

      {!isLoading && !error && (
        <section className={styles.groupList}>
          {grouped.map((group) => {
            const sample = group.subgroups[0]?.items[0]
            const { solid, dim } = getTaxonomyColor(sample?.taxonomy ?? [])
            return (
              <article key={group.root} className={styles.group}>
                <header
                  className={styles.groupHeader}
                  style={{ '--tx-solid': solid, '--tx-dim': dim } as React.CSSProperties}
                >
                  <h2 className={styles.groupTitle}>{group.root}</h2>
                  <span className={styles.groupCount}>{group.count}</span>
                </header>
                <div className={styles.subgroupList}>
                  {group.subgroups.map(({ subgroup, items }) => (
                    <section key={`${group.root}-${subgroup}`} className={styles.subgroup}>
                      <div className={styles.subgroupHeader}>
                        <h3 className={styles.subgroupTitle}>{subgroup}</h3>
                        <span className={styles.subgroupCount}>{items.length}</span>
                      </div>
                      <div className={styles.grid}>
                        {items.map((corpus) => {
                          const { solid: cardSolid, dim: cardDim } = getTaxonomyColor(corpus.taxonomy)
                          const taxPath = taxonomyPath(corpus.taxonomy)
                          return (
                            <Link
                              key={corpus.id}
                              to={`/corpus/${corpus.id}`}
                              className={styles.card}
                              style={{ '--tx-solid': cardSolid, '--tx-dim': cardDim } as React.CSSProperties}
                            >
                              <div className={styles.accent} />
                              <div className={styles.cardBody}>
                                <h4 className={styles.cardTitle}>{corpus.name}</h4>
                                {corpus.description && <p className={styles.cardDescription}>{corpus.description}</p>}
                                <div className={styles.metaRow}>
                                  <span className={styles.metaBadge}>{corpus.versions.length} version{corpus.versions.length === 1 ? '' : 's'}</span>
                                  {taxPath && <span className={styles.taxonomy}>{taxPath}</span>}
                                </div>
                              </div>
                            </Link>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </article>
            )
          })}
          {grouped.length === 0 && <p className={styles.state}>No corpora found.</p>}
        </section>
      )}
    </main>
  )
}
