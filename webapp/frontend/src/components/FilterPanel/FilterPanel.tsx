import type { CorpusInfo } from '../../api/types'
import styles from './FilterPanel.module.css'

export interface Filters {
  corpusId: number | null
  height: number
  limit: number
}

interface Props {
  open: boolean
  filters: Filters
  onChange: (filters: Filters) => void
  corpora: CorpusInfo[]
}

const HEIGHT_OPTIONS = [
  { value: 0, label: 'Verse / Leaf' },
  { value: 1, label: 'Chapter / Section' },
  { value: 2, label: 'Book / Part' },
]

const LIMIT_OPTIONS = [10, 25, 50]

export function FilterPanel({ open, filters, onChange, corpora }: Props) {
  return (
    <div className={`${styles.root} ${open ? styles.rootOpen : ''}`} aria-hidden={!open}>
      <div className={styles.inner}>
        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>Corpus</label>
            <select
              className={styles.select}
              value={filters.corpusId ?? ''}
              onChange={(e) =>
                onChange({ ...filters, corpusId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">All corpora</option>
              {corpora.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Level</label>
            <select
              className={styles.select}
              value={filters.height}
              onChange={(e) => onChange({ ...filters, height: Number(e.target.value) })}
            >
              {HEIGHT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Results</label>
            <select
              className={styles.select}
              value={filters.limit}
              onChange={(e) => onChange({ ...filters, limit: Number(e.target.value) })}
            >
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Embedding model</label>
            <div className={styles.methodInfo}>
              <span className={styles.methodName}>nomic-embed-text-v1.5</span>
              <span className={styles.methodLocked}>768-dim · locked</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
