import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { fetchCorpora, fetchCorpusRoots, getUnitChildren } from '../api/client'
import type { UnitBrief, UnitChildPreview } from '../api/types'
import styles from './CorpusDetail.module.css'

interface TreeNodeProps {
  node: UnitBrief
  depth: number
  corpusVersionId: number
}

function TreeNode({ node, depth, corpusVersionId }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const queryClient = useQueryClient()
  const hasChildren = (node.height ?? 0) > 0

  const { data: children = [], isFetching } = useQuery({
    queryKey: ['corpus-tree-children', corpusVersionId, node.id],
    queryFn: () => getUnitChildren(node.id, 200, 0),
    enabled: expanded && hasChildren,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!expanded || children.length === 0) return
    for (const child of children) {
      if ((child.height ?? 0) <= 0) continue
      queryClient.prefetchQuery({
        queryKey: ['corpus-tree-children', corpusVersionId, child.id],
        queryFn: () => getUnitChildren(child.id, 200, 0),
        staleTime: 60_000,
      })
    }
  }, [children, corpusVersionId, expanded, queryClient])

  return (
    <li>
      <div className={styles.nodeRow} style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        {hasChildren ? (
          <button
            className={styles.expandButton}
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse node' : 'Expand node'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className={styles.leafMark}>•</span>
        )}

        <div className={styles.nodeBody}>
          <div className={styles.nodeTopLine}>
            <span className={styles.nodeLabel}>{node.reference_label ?? `Unit ${node.id}`}</span>
            <span className={styles.nodeMeta}>{node.height != null ? `h${node.height}` : ''}</span>
            <Link className={styles.readLink} to={`/read/${node.id}`}>Read</Link>
          </div>
          {node.text && <p className={styles.nodeText}>{node.text}</p>}
        </div>
      </div>

      {expanded && hasChildren && (
        <ul className={styles.childList}>
          {isFetching && children.length === 0 ? (
            <li className={styles.loading}>Loading...</li>
          ) : (
            children.map((child: UnitChildPreview) => (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                corpusVersionId={corpusVersionId}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}

export function CorpusDetail() {
  const { id } = useParams()
  const corpusId = Number(id)
  const [corpusVersionId, setCorpusVersionId] = useState<number | null>(null)

  const { data: corpora = [], isLoading: corporaLoading, error: corporaError } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  })

  const corpus = corpora.find((c) => c.id === corpusId)

  useEffect(() => {
    if (!corpus || corpus.versions.length === 0) return
    setCorpusVersionId((current) => {
      if (current && corpus.versions.some((v) => v.id === current)) return current
      return corpus.versions[0].id
    })
  }, [corpus])

  const { data: roots = [], isLoading: rootsLoading, error: rootsError } = useQuery({
    queryKey: ['corpus-roots', corpusId, corpusVersionId],
    queryFn: () => fetchCorpusRoots(corpusId, corpusVersionId ?? undefined),
    enabled: Number.isFinite(corpusId) && corpusId > 0 && corpusVersionId != null,
    staleTime: 60_000,
  })

  if (!Number.isFinite(corpusId) || corpusId <= 0) {
    return <main className={styles.page}><p className={styles.error}>Invalid corpus id.</p></main>
  }

  return (
    <main className={styles.page}>
      <div className={styles.backRow}>
        <Link to="/corpus" className={styles.backLink}>← All corpora</Link>
      </div>

      {corporaLoading && <p className={styles.loading}>Loading corpus...</p>}
      {corporaError && <p className={styles.error}>{corporaError instanceof Error ? corporaError.message : 'Failed to load corpus'}</p>}

      {!corporaLoading && !corporaError && !corpus && (
        <p className={styles.error}>Corpus not found.</p>
      )}

      {corpus && (
        <>
          <header className={styles.header}>
            <h1 className={styles.title}>{corpus.name}</h1>
            {corpus.description && <p className={styles.description}>{corpus.description}</p>}
          </header>

          <section className={styles.controls}>
            <label className={styles.versionLabel} htmlFor="version-select">Version</label>
            <select
              id="version-select"
              className={styles.versionSelect}
              value={corpusVersionId ?? ''}
              onChange={(e) => setCorpusVersionId(Number(e.target.value))}
            >
              {corpus.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.translation_name ?? `Version ${v.id}`}
                  {v.language ? ` (${v.language})` : ''}
                </option>
              ))}
            </select>
          </section>

          <section className={styles.treeSection}>
            {rootsLoading && <p className={styles.loading}>Loading text tree...</p>}
            {rootsError && <p className={styles.error}>{rootsError instanceof Error ? rootsError.message : 'Failed to load roots'}</p>}
            {!rootsLoading && !rootsError && roots.length === 0 && (
              <p className={styles.empty}>No units found for this corpus/version.</p>
            )}
            {!rootsLoading && !rootsError && roots.length > 0 && (
              <ul className={styles.treeRoot}>
                {roots.map((root) => (
                  <TreeNode
                    key={root.id}
                    node={root}
                    depth={0}
                    corpusVersionId={corpusVersionId!}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}
