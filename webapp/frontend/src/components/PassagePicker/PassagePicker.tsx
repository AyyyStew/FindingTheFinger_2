import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUnitChildren, searchUnits } from '../../api/client'
import type { CorpusInfo, UnitBrief, UnitChildPreview } from '../../api/types'
import { useDebounce } from '../../hooks/useDebounce'
import { getTaxonomyColor } from '../../utils/taxonomyColors'
import styles from './PassagePicker.module.css'

const CHAPTER_CAP = 5

// Lazy-loads and renders all leaf children (verses) of an expanded chapter
function ExpandedChildVerses({ parentId }: { parentId: number }) {
  const { data: verses = [], isLoading } = useQuery({
    queryKey: ['unit-children', parentId],
    queryFn: () => getUnitChildren(parentId),
    staleTime: 60_000,
  })
  if (isLoading) return <p className={styles.childLoading}>Loading…</p>
  return (
    <>
      {verses.map((v) => (
        <div key={v.id} className={styles.verse}>
          {v.reference_label && (
            <span className={styles.verseLabel}>{v.reference_label}</span>
          )}
          {v.text && <span className={styles.verseText}>{v.text}</span>}
        </div>
      ))}
    </>
  )
}

// One collapsible chapter row
// collapsed → label only
// expanded  → first verse + "expand all" link
// fully expanded → all verses + "collapse" link
function ChildRow({ child, expanded, fullyExpanded, onToggle, onExpandAll, onCollapse }: {
  child: UnitChildPreview
  expanded: boolean
  fullyExpanded: boolean
  onToggle: () => void
  onExpandAll: () => void
  onCollapse: () => void
}) {
  return (
    <div className={styles.child}>
      <button className={styles.childHeader} onClick={onToggle}>
        <span className={styles.childToggle}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.childLabel}>
          {child.reference_label ?? `Unit ${child.id}`}
        </span>
        {child.child_count > 0 && (
          <span className={styles.childCount}>{child.child_count}</span>
        )}
      </button>

      {expanded && !fullyExpanded && (
        <div className={styles.childVerses}>
          {child.first_child && (
            <div className={styles.verse}>
              {child.first_child.reference_label && (
                <span className={styles.verseLabel}>{child.first_child.reference_label}</span>
              )}
              {child.first_child.text && (
                <span className={styles.verseText}>{child.first_child.text}</span>
              )}
            </div>
          )}
          {child.child_count > 1 && (
            <button className={styles.showMoreBtn} onClick={(e) => { e.stopPropagation(); onExpandAll() }}>
              Show all {child.child_count}
            </button>
          )}
        </div>
      )}

      {fullyExpanded && (
        <div className={styles.childVerses}>
          <ExpandedChildVerses parentId={child.id} />
          <button className={styles.showMoreBtn} onClick={(e) => { e.stopPropagation(); onCollapse() }}>
            Collapse
          </button>
        </div>
      )}
    </div>
  )
}

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

  // ── Selected-card state ──────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [fullyExpandedIds, setFullyExpandedIds] = useState<Set<number>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const didAutoExpand = useRef(false)

  // Reset on selection change
  useEffect(() => {
    setExpandedIds(new Set())
    setFullyExpandedIds(new Set())
    setShowAll(false)
    didAutoExpand.current = false
  }, [selected?.id])

  const selectedHeight = selected?.height ?? 0
  const hasChildren = selected !== null && selectedHeight > 0

  const { data: children = [] } = useQuery({
    queryKey: ['unit-children', selected?.id],
    queryFn: () => getUnitChildren(selected!.id),
    enabled: hasChildren,
    staleTime: 60_000,
  })

  // Auto-expand first child once children load
  useEffect(() => {
    if (!didAutoExpand.current && children.length > 0) {
      didAutoExpand.current = true
      setExpandedIds(new Set([children[0].id]))
    }
  }, [children])

  const toggleChild = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    // collapsing a chapter also collapses its full expansion
    setFullyExpandedIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const expandAllChild = (id: number) => {
    setExpandedIds((prev) => new Set(prev).add(id))
    setFullyExpandedIds((prev) => new Set(prev).add(id))
  }

  const collapseChild = (id: number) => {
    setFullyExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // ── Handlers ────────────────────────────────────────────────────────────
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

  // ── Selected card ────────────────────────────────────────────────────────
  if (selected) {
    const { solid, dim } = getTaxonomyColor(selected.taxonomy)
    const taxonomyRoot = selected.taxonomy.find((t) => t.level === 0)
    const displayPath = selected.ancestor_path ?? selected.corpus_name

    const visibleChildren = showAll ? children : children.slice(0, CHAPTER_CAP)

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

          {/* Leaf node — just show text */}
          {selected.text && (
            <p className={styles.selectedText}>{selected.text}</p>
          )}

          {/* height=1 (chapter) — flat verse list */}
          {hasChildren && selectedHeight === 1 && children.length > 0 && (
            <div className={styles.children}>
              {children.map((v) => (
                <div key={v.id} className={styles.verse}>
                  {v.reference_label && (
                    <span className={styles.verseLabel}>{v.reference_label}</span>
                  )}
                  {v.text && <span className={styles.verseText}>{v.text}</span>}
                </div>
              ))}
            </div>
          )}

          {/* height>1 (book/etc) — collapsible chapters with show more */}
          {hasChildren && selectedHeight > 1 && children.length > 0 && (
            <div className={styles.children}>
              {visibleChildren.map((child) => (
                <ChildRow
                  key={child.id}
                  child={child}
                  expanded={expandedIds.has(child.id)}
                  fullyExpanded={fullyExpandedIds.has(child.id)}
                  onToggle={() => toggleChild(child.id)}
                  onExpandAll={() => expandAllChild(child.id)}
                  onCollapse={() => collapseChild(child.id)}
                />
              ))}
              {!showAll && children.length > CHAPTER_CAP && (
                <button className={styles.showMoreBtn} onClick={() => setShowAll(true)}>
                  Show all
                </button>
              )}
              {showAll && children.length > CHAPTER_CAP && (
                <button className={styles.showMoreBtn} onClick={() => setShowAll(false)}>
                  Show less
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Search input + dropdown ──────────────────────────────────────────────
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
