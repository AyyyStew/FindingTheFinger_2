import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchUnits } from '../../api/client'
import type { CorpusInfo, UnitBrief } from '../../api/types'
import { useDebounce } from '../../hooks/useDebounce'
import { getTaxonomyColor } from '../../utils/taxonomyColors'
import { UnitChildren } from '../UnitChildren/UnitChildren'
import styles from './PassagePicker.module.css'

interface Props {
  selected: UnitBrief | null
  onSelect: (unit: UnitBrief | null) => void
  corpora: CorpusInfo[]
  selectedCorpusIds: number[]
}

export function PassagePicker({ selected, onSelect, selectedCorpusIds }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const debouncedQuery = useDebounce(inputValue, 300)

  const { data: units = [] } = useQuery({
    queryKey: ['passage-search', debouncedQuery, selectedCorpusIds],
    queryFn: () =>
      searchUnits(
        debouncedQuery,
        undefined,
        selectedCorpusIds.length > 0 ? selectedCorpusIds : undefined,
      ),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  })

  const grouped = units.reduce<Record<string, UnitBrief[]>>((acc, u) => {
    ;(acc[u.corpus_name] ??= []).push(u)
    return acc
  }, {})

  const flatItems = Object.values(grouped).flat()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => setActiveIndex(-1), [units])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    setIsOpen(e.target.value.length >= 2)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(flatItems[activeIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleSelect = (unit: UnitBrief) => {
    onSelect(unit)
    setInputValue('')
    setIsOpen(false)
    setActiveIndex(-1)
  }

  const handleClear = () => {
    onSelect(null)
    setInputValue('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  if (selected) {
    const { solid, dim } = getTaxonomyColor(selected.taxonomy)
    const taxonomyRoot = selected.taxonomy.find((t) => t.level === 0)
    const displayPath = selected.ancestor_path ?? selected.corpus_name

    return (
      <div
        className={styles.selected}
        style={{ '--tx-solid': solid, '--tx-dim': dim } as React.CSSProperties}
      >
        <div className={styles.selectedAccentBar} />
        <div className={styles.selectedInner}>
          <div className={styles.selectedHeader}>
            <div className={styles.selectedTitleGroup}>
              <h3 className={styles.selectedReference}>
                {selected.reference_label ?? `Unit ${selected.id}`}
              </h3>
              {displayPath && <p className={styles.selectedPath}>{displayPath}</p>}
            </div>
            <button className={styles.clearBtn} onClick={handleClear} aria-label="Clear selection">
              ✕
            </button>
          </div>
          <div className={styles.selectedBadges}>
            {taxonomyRoot && (
              <span className={styles.selectedTaxBadge}>{taxonomyRoot.name}</span>
            )}
            <span className={styles.selectedBadge}>{selected.corpus_name}</span>
            {selected.corpus_version_name && (
              <span className={styles.selectedBadge}>{selected.corpus_version_name}</span>
            )}
          </div>
          {selected.text && (
            <p className={styles.selectedText}>{selected.text}</p>
          )}
          <UnitChildren unitId={selected.id} height={selected.height ?? 0} />
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <input
        ref={inputRef}
        className={styles.input}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => inputValue.length >= 2 && setIsOpen(true)}
        placeholder="Search for a passage, chapter, or book…"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen}
      />

      {isOpen && (
        <div className={styles.dropdown} role="listbox">
          {debouncedQuery.length < 2 ? (
            <p className={styles.dropdownHint}>Type at least 2 characters…</p>
          ) : flatItems.length === 0 ? (
            <p className={styles.dropdownEmpty}>No results for "{debouncedQuery}"</p>
          ) : (
            <div className={styles.list}>
              {Object.entries(grouped).map(([corpusName, items]) => {
                const corpusOffset = flatItems.indexOf(items[0])
                return (
                  <div key={corpusName} className={styles.group}>
                    <div className={styles.groupHeading}>{corpusName}</div>
                    {items.map((unit, i) => {
                      const flatIdx = corpusOffset + i
                      const path = unit.ancestor_path ?? unit.corpus_name
                      const { solid, dim } = getTaxonomyColor(unit.taxonomy)
                      const taxonomyRoot = unit.taxonomy.find((t) => t.level === 0)
                      return (
                        <button
                          key={unit.id}
                          role="option"
                          aria-selected={flatIdx === activeIndex}
                          className={`${styles.item} ${flatIdx === activeIndex ? styles.itemActive : ''}`}
                          style={{ '--tx-solid': solid, '--tx-dim': dim } as React.CSSProperties}
                          onMouseDown={(e) => { e.preventDefault(); handleSelect(unit) }}
                          onMouseEnter={() => setActiveIndex(flatIdx)}
                        >
                          <div className={styles.itemAccentBar} />
                          <div className={styles.itemInner}>
                            <div className={styles.itemHeader}>
                              <span className={styles.itemLabel}>
                                {unit.reference_label ?? `Unit ${unit.id}`}
                              </span>
                            </div>
                            {path && path !== corpusName && (
                              <span className={styles.itemPath}>{path}</span>
                            )}
                            <div className={styles.itemBadges}>
                              {taxonomyRoot && (
                                <span className={styles.itemTaxBadge}>{taxonomyRoot.name}</span>
                              )}
                              {unit.corpus_version_name && (
                                <span className={styles.itemBadge}>{unit.corpus_version_name}</span>
                              )}
                            </div>
                            {unit.text && (
                              <span className={styles.itemPreview}>{unit.text}</span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
