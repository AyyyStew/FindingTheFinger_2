import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchUnits } from '../../api/client'
import type { UnitBrief } from '../../api/types'
import { useDebounce } from '../../hooks/useDebounce'
import styles from './PassagePicker.module.css'

interface Props {
  selected: UnitBrief | null
  onSelect: (unit: UnitBrief | null) => void
}

export function PassagePicker({ selected, onSelect }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const debouncedQuery = useDebounce(inputValue, 300)

  const { data: units = [] } = useQuery({
    queryKey: ['passage-search', debouncedQuery],
    queryFn: () => searchUnits(debouncedQuery, 0),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  })

  // Group results by corpus
  const grouped = units.reduce<Record<string, UnitBrief[]>>((acc, u) => {
    ;(acc[u.corpus_name] ??= []).push(u)
    return acc
  }, {})

  // Flat list for keyboard nav
  const flatItems = Object.values(grouped).flat()

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset active index when results change
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
    return (
      <div className={styles.selected}>
        <div className={styles.selectedInfo}>
          <div className={styles.selectedMeta}>
            <span className={styles.selectedCorpus}>{selected.corpus_name}</span>
            {selected.corpus_version_name && (
              <span className={styles.selectedCorpus}>· {selected.corpus_version_name}</span>
            )}
          </div>
          <div className={styles.selectedLabel}>{selected.reference_label ?? `Unit ${selected.id}`}</div>
          {selected.text && (
            <p className={styles.selectedText}>{selected.text.slice(0, 200)}{selected.text.length > 200 ? '…' : ''}</p>
          )}
        </div>
        <button className={styles.clearBtn} onClick={handleClear} aria-label="Clear selection">
          ✕
        </button>
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
        placeholder="Search for a passage (e.g. John 3, love thy neighbour…)"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen}
      />

      {isOpen && (
        <div className={styles.dropdown} role="listbox">
          {debouncedQuery.length < 2 ? (
            <p className={styles.dropdownHint}>Type at least 2 characters…</p>
          ) : flatItems.length === 0 ? (
            <p className={styles.dropdownEmpty}>No passages found for "{debouncedQuery}"</p>
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
                      return (
                        <button
                          key={unit.id}
                          role="option"
                          aria-selected={flatIdx === activeIndex}
                          className={`${styles.item} ${flatIdx === activeIndex ? styles.itemActive : ''}`}
                          onMouseDown={(e) => { e.preventDefault(); handleSelect(unit) }}
                          onMouseEnter={() => setActiveIndex(flatIdx)}
                        >
                          <span className={styles.itemLabel}>
                            {unit.reference_label ?? `Unit ${unit.id}`}
                          </span>
                          {path && path !== corpusName && (
                            <span className={styles.itemPath}>{path}</span>
                          )}
                          {unit.text && (
                            <span className={styles.itemPreview}>{unit.text}</span>
                          )}
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
