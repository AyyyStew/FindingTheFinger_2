import { useMemo } from 'react'
import type { CorpusInfo } from '../../api/types'
import { getTaxonomyColor } from '../../utils/taxonomyColors'
import styles from './FilterPanel.module.css'

export interface Filters {
  corpusIds: number[]
  heightMin: number
  heightMax: number
  limit: number
}

interface Props {
  open: boolean
  filters: Filters
  onChange: (filters: Filters) => void
  corpora: CorpusInfo[]
}

const LIMIT_OPTIONS = [10, 25, 50]

function taxonomyPath(corpus: CorpusInfo): string {
  return corpus.taxonomy
    .slice()
    .sort((a, b) => a.level - b.level)
    .map((t) => t.name)
    .join(' · ')
}

function levelAtHeight(corpus: CorpusInfo, heightMin: number, heightMax: number): string {
  if (corpus.levels.length === 0) return 'passage'
  const sorted = corpus.levels.slice().sort((a, b) => a.height - b.height)
  const corpusMax = sorted[sorted.length - 1].height

  // Clamp requested heights to this corpus's range
  const clampedMin = Math.min(heightMin, corpusMax)
  const clampedMax = Math.min(heightMax, corpusMax)

  // Find nearest level at or below the clamped value
  const nearest = (target: number) =>
    [...sorted].reverse().find((l) => l.height <= target) ?? sorted[0]

  const lo = nearest(clampedMin)
  const hi = nearest(clampedMax)

  if (lo.name === hi.name) return lo.name
  return `${lo.name} – ${hi.name}`
}

export function FilterPanel({ open, filters, onChange, corpora }: Props) {
  const groups = useMemo(() => {
    const map: Record<string, CorpusInfo[]> = {}
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find((t) => t.level === 0)
      const key = root?.name ?? 'Other'
      ;(map[key] ??= []).push(corpus)
    }
    return Object.entries(map)
  }, [corpora])

  const maxHeight = useMemo(
    () => Math.max(0, ...corpora.flatMap((c) => c.levels.map((l) => l.height))),
    [corpora],
  )

  const toggleCorpus = (id: number) =>
    onChange({
      ...filters,
      corpusIds: filters.corpusIds.includes(id)
        ? filters.corpusIds.filter((cid) => cid !== id)
        : [...filters.corpusIds, id],
    })

  const selectAll = () => onChange({ ...filters, corpusIds: corpora.map((c) => c.id) })
  const deselectAll = () => onChange({ ...filters, corpusIds: [] })
  const selectGroup = (ids: number[]) =>
    onChange({ ...filters, corpusIds: [...new Set([...filters.corpusIds, ...ids])] })
  const deselectGroup = (ids: number[]) =>
    onChange({ ...filters, corpusIds: filters.corpusIds.filter((id) => !ids.includes(id)) })

  const handleMinChange = (raw: number) =>
    onChange({ ...filters, heightMin: Math.min(raw, filters.heightMax) })
  const handleMaxChange = (raw: number) =>
    onChange({ ...filters, heightMax: Math.max(raw, filters.heightMin) })

  const fillLeft = maxHeight > 0 ? (filters.heightMin / maxHeight) * 100 : 0
  const fillRight = maxHeight > 0 ? ((maxHeight - filters.heightMax) / maxHeight) * 100 : 0

  return (
    <div className={`${styles.root} ${open ? styles.rootOpen : ''}`} aria-hidden={!open}>
      <div className={styles.inner}>
        <div className={styles.body}>

          {/* ── Corpus toggles ── */}
          <div className={styles.corpusSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.label}>Corpus</span>
              <div className={styles.actions}>
                <button className={styles.actionLink} onClick={selectAll}>all</button>
                <span className={styles.actionSep}>·</span>
                <button className={styles.actionLink} onClick={deselectAll}>none</button>
              </div>
            </div>

            {groups.map(([groupName, groupCorpora]) => {
              const groupIds = groupCorpora.map((c) => c.id)
              // Use first corpus in group for the group header color
              const { solid } = getTaxonomyColor(groupCorpora[0]?.taxonomy ?? [])
              return (
                <div key={groupName} className={styles.corpusGroup}>
                  <div className={styles.groupHeader}>
                    <span
                      className={styles.groupName}
                      style={{ color: solid }}
                    >
                      {groupName}
                    </span>
                    <div className={styles.actions}>
                      <button className={styles.actionLink} onClick={() => selectGroup(groupIds)}>all</button>
                      <span className={styles.actionSep}>·</span>
                      <button className={styles.actionLink} onClick={() => deselectGroup(groupIds)}>none</button>
                    </div>
                  </div>

                  <div className={styles.corpusToggles}>
                    {groupCorpora.map((corpus) => {
                      const isActive = filters.corpusIds.includes(corpus.id)
                      const { solid: cSolid, dim: cDim } = getTaxonomyColor(corpus.taxonomy)
                      const path = taxonomyPath(corpus)
                      const levelLabel = levelAtHeight(corpus, filters.heightMin, filters.heightMax)
                      return (
                        <button
                          key={corpus.id}
                          className={`${styles.corpusToggle} ${isActive ? styles.corpusToggleActive : ''}`}
                          style={{
                            '--tx-solid': cSolid,
                            '--tx-dim': cDim,
                          } as React.CSSProperties}
                          onClick={() => toggleCorpus(corpus.id)}
                        >
                          <span className={styles.corpusToggleName}>{corpus.name}</span>
                          {path && <span className={styles.corpusTogglePath}>{path}</span>}
                          <span className={styles.corpusToggleLevels}>showing {levelLabel}s</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Other filters ── */}
          <div className={styles.otherFilters}>

            {maxHeight > 0 && (
              <div className={styles.field} style={{ flex: '2 1 200px' }}>
                <div className={styles.sliderHeader}>
                  <span className={styles.label}>Height</span>
                  <span className={styles.sliderValues}>
                    {filters.heightMin === filters.heightMax
                      ? filters.heightMin
                      : `${filters.heightMin} – ${filters.heightMax}`}
                  </span>
                </div>
                <div className={styles.sliderWrapper}>
                  <div className={styles.sliderTrack}>
                    <div
                      className={styles.sliderFill}
                      style={{ left: `${fillLeft}%`, right: `${fillRight}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0} max={maxHeight} step={1}
                    value={filters.heightMin}
                    onChange={(e) => handleMinChange(Number(e.target.value))}
                    className={styles.sliderInput}
                    style={{ zIndex: filters.heightMin === maxHeight ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min={0} max={maxHeight} step={1}
                    value={filters.heightMax}
                    onChange={(e) => handleMaxChange(Number(e.target.value))}
                    className={styles.sliderInput}
                    style={{ zIndex: 4 }}
                  />
                </div>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Results</label>
              <select
                className={styles.select}
                value={filters.limit}
                onChange={(e) => onChange({ ...filters, limit: Number(e.target.value) })}
              >
                {LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
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
    </div>
  )
}
