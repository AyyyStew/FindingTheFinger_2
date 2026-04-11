import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUnitChildren } from '../../api/client'
import type { UnitChildPreview } from '../../api/types'
import styles from './UnitChildren.module.css'

const CHAPTER_CAP = 5

// Lazy-loads all verses for a fully-expanded chapter
function ExpandedVerses({ parentId }: { parentId: number }) {
  const { data: verses = [], isLoading } = useQuery({
    queryKey: ['unit-children', parentId],
    queryFn: () => getUnitChildren(parentId),
    staleTime: 60_000,
  })
  if (isLoading) return <p className={styles.loading}>Loading…</p>
  return (
    <>
      {verses.map((v) => (
        <div key={v.id} className={styles.verse}>
          {v.reference_label && <span className={styles.verseLabel}>{v.reference_label}</span>}
          {v.text && <span className={styles.verseText}>{v.text}</span>}
        </div>
      ))}
    </>
  )
}

// One collapsible chapter row
// collapsed        → label only
// expanded         → first verse + "Show all N" link
// fullyExpanded    → all verses + "Collapse" link
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
        <span className={styles.toggle}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.childLabel}>
          {child.reference_label ?? `Unit ${child.id}`}
        </span>
        {child.child_count > 0 && (
          <span className={styles.childCount}>{child.child_count}</span>
        )}
      </button>

      {expanded && !fullyExpanded && (
        <div className={styles.verses}>
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
            <button
              className={styles.actionBtn}
              onClick={(e) => { e.stopPropagation(); onExpandAll() }}
            >
              Show all {child.child_count}
            </button>
          )}
        </div>
      )}

      {fullyExpanded && (
        <div className={styles.verses}>
          <ExpandedVerses parentId={child.id} />
          <button
            className={styles.actionBtn}
            onClick={(e) => { e.stopPropagation(); onCollapse() }}
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  )
}

interface Props {
  unitId: number
  height: number | null
}

export function UnitChildren({ unitId, height }: Props) {
  const h = height ?? 0
  const enabled = h > 0

  const { data: children = [] } = useQuery({
    queryKey: ['unit-children', unitId],
    queryFn: () => getUnitChildren(unitId),
    enabled,
    staleTime: 60_000,
  })

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [fullyExpandedIds, setFullyExpandedIds] = useState<Set<number>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const didAutoExpand = useRef(false)

  // Reset when unitId changes
  useEffect(() => {
    setExpandedIds(new Set())
    setFullyExpandedIds(new Set())
    setShowAll(false)
    didAutoExpand.current = false
  }, [unitId])

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

  if (!enabled || children.length === 0) return null

  // height=1: chapter selected → capped verse list with show all/less
  if (h === 1) {
    const visibleVerses = showAll ? children : children.slice(0, CHAPTER_CAP)
    return (
      <div className={styles.root}>
        {visibleVerses.map((v) => (
          <div key={v.id} className={styles.verse}>
            {v.reference_label && <span className={styles.verseLabel}>{v.reference_label}</span>}
            {v.text && <span className={styles.verseText}>{v.text}</span>}
          </div>
        ))}
        {!showAll && children.length > CHAPTER_CAP && (
          <button className={styles.actionBtn} onClick={() => setShowAll(true)}>
            Show all
          </button>
        )}
        {showAll && children.length > CHAPTER_CAP && (
          <button className={styles.actionBtn} onClick={() => setShowAll(false)}>
            Show less
          </button>
        )}
      </div>
    )
  }

  // height>1: book → collapsible chapters
  const visibleChildren = showAll ? children : children.slice(0, CHAPTER_CAP)

  return (
    <div className={styles.root}>
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
        <button className={styles.actionBtn} onClick={() => setShowAll(true)}>
          Show all
        </button>
      )}
      {showAll && children.length > CHAPTER_CAP && (
        <button className={styles.actionBtn} onClick={() => setShowAll(false)}>
          Show less
        </button>
      )}
    </div>
  )
}
