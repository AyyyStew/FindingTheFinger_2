import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  fetchUnitAncestors,
  fetchUnitDetail,
  fetchUnitLeaves,
  getUnitChildren,
} from "../api/client";
import { getTaxonomyColor } from "../utils/taxonomyColors";
import styles from "./Read.module.css";

const LEAF_PAGE_SIZE = 120;

export function Read() {
  const { unitId } = useParams();
  const id = Number(unitId);

  const { data, isLoading, error } = useQuery({
    queryKey: ["unit-detail", id],
    queryFn: () => fetchUnitDetail(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 60_000,
  });

  const taxonomyPath = useMemo(() => {
    if (!data) return "";
    return [...data.taxonomy]
      .sort((a, b) => a.level - b.level)
      .map((t) => t.name)
      .join(" / ");
  }, [data]);
  const taxonomyColor = useMemo(
    () => getTaxonomyColor(data?.taxonomy ?? []),
    [data?.taxonomy],
  );

  const isNonLeaf = (data?.height ?? 0) > 0;

  const { data: ancestors = [], isLoading: ancestorsLoading } = useQuery({
    queryKey: ["unit-ancestors", id],
    queryFn: () => fetchUnitAncestors(id),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 60_000,
  });

  const {
    data: childLinks = [],
    isLoading: childrenLoading,
    error: childrenError,
  } = useQuery({
    queryKey: ["unit-children-links", id],
    queryFn: () => getUnitChildren(id, 500, 0),
    enabled: Number.isFinite(id) && id > 0 && isNonLeaf,
    staleTime: 60_000,
  });

  const {
    data: leavesPages,
    isLoading: leavesLoading,
    error: leavesError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["unit-leaves", id],
    queryFn: ({ pageParam }) => fetchUnitLeaves(id, LEAF_PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === LEAF_PAGE_SIZE
        ? allPages.length * LEAF_PAGE_SIZE
        : undefined,
    enabled: Number.isFinite(id) && id > 0 && isNonLeaf,
    staleTime: 60_000,
  });

  const leaves = useMemo(
    () => (leavesPages?.pages ?? []).flat(),
    [leavesPages],
  );

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>Invalid unit id.</p>
      </main>
    );
  }

  return (
    <main
      className={styles.page}
      style={
        {
          "--tx-solid": taxonomyColor.solid,
          "--tx-dim": taxonomyColor.dim,
        } as React.CSSProperties
      }
    >
      <div className={styles.backRow}>
        <Link to="/corpus" className={styles.backLink}>
          ← Corpus explorer
        </Link>
      </div>

      {isLoading && <p className={styles.loading}>Loading passage...</p>}
      {error && (
        <p className={styles.error}>
          {error instanceof Error ? error.message : "Failed to load passage"}
        </p>
      )}

      {data && (
        <>
          <header className={styles.header}>
            <h1 className={styles.title}>
              {data.reference_label ?? `Unit ${data.id}`}
            </h1>
            <div className={styles.meta}>
              <span>{data.corpus_name}</span>
              {data.corpus_version_name && (
                <span>• {data.corpus_version_name}</span>
              )}
            </div>
            {taxonomyPath && <p className={styles.taxonomy}>{taxonomyPath}</p>}
            {ancestors.length > 0 ? (
              <nav className={styles.path} aria-label="Passage breadcrumbs">
                {ancestors.map((a, idx) => (
                  <span key={a.id} className={styles.pathChunk}>
                    <Link to={`/read/${a.id}`} className={styles.pathLink}>
                      {a.reference_label ?? `Unit ${a.id}`}
                    </Link>
                    {idx < ancestors.length - 1 && (
                      <span className={styles.pathSep}> / </span>
                    )}
                  </span>
                ))}
              </nav>
            ) : (
              data.ancestor_path &&
              !ancestorsLoading && (
                <p className={styles.path}>{data.ancestor_path}</p>
              )
            )}
          </header>

          <section className={styles.textBlock}>
            <h2 className={styles.blockTitle}>Cleaned Text</h2>
            <p className={styles.cleanedText}>
              {data.cleaned_text ?? "No cleaned text available."}
            </p>
          </section>

          <section className={styles.textBlockOriginal}>
            <h2 className={styles.blockTitle}>Original Text</h2>
            <p className={styles.originalText}>
              {data.original_text ?? "No original text available."}
            </p>
          </section>

          <section className={styles.sources}>
            <h2 className={styles.blockTitle}>Source</h2>
            {data.unit_source && (
              <p className={styles.sourceLine}>
                <strong>Unit source:</strong> {data.unit_source}
              </p>
            )}
            {data.version_source && (
              <p className={styles.sourceLine}>
                <strong>Version source:</strong> {data.version_source}
              </p>
            )}
            {!data.unit_source && !data.version_source && (
              <p className={styles.sourceFallback}>
                No source attribution available.
              </p>
            )}
          </section>

          {isNonLeaf && (
            <section className={styles.levelSection}>
              <h2 className={styles.blockTitle}>Levels</h2>
              {childrenLoading && (
                <p className={styles.loading}>Loading levels...</p>
              )}
              {childrenError && (
                <p className={styles.error}>
                  {childrenError instanceof Error
                    ? childrenError.message
                    : "Failed to load levels"}
                </p>
              )}
              {!childrenLoading &&
                !childrenError &&
                childLinks.length === 0 && (
                  <p className={styles.sourceFallback}>
                    No child levels available.
                  </p>
                )}
              {!childrenLoading && !childrenError && childLinks.length > 0 && (
                <div className={styles.levelLinks}>
                  {childLinks.map((child) => (
                    <Link
                      key={child.id}
                      to={`/read/${child.id}`}
                      className={styles.levelLink}
                    >
                      {child.reference_label ?? `Unit ${child.id}`}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {isNonLeaf && (
            <section className={styles.leafSection}>
              <h2 className={styles.blockTitle}>Leaf Passages</h2>
              {leavesLoading && (
                <p className={styles.loading}>Loading leaf passages...</p>
              )}
              {leavesError && (
                <p className={styles.error}>
                  {leavesError instanceof Error
                    ? leavesError.message
                    : "Failed to load leaf passages"}
                </p>
              )}
              {!leavesLoading && !leavesError && leaves.length === 0 && (
                <p className={styles.sourceFallback}>No leaf passages found.</p>
              )}
              {!leavesLoading && !leavesError && leaves.length > 0 && (
                <>
                  <div className={styles.leafList}>
                    {leaves.map((leaf) => (
                      <article key={leaf.id} className={styles.leafCard}>
                        <div className={styles.leafHeader}>
                          <span className={styles.leafLabel}>
                            {leaf.reference_label ?? `Unit ${leaf.id}`}
                          </span>
                          <Link
                            className={styles.inlineReadLink}
                            to={`/read/${leaf.id}`}
                          >
                            Read
                          </Link>
                        </div>
                        {leaf.text ? (
                          <p className={styles.leafText}>{leaf.text}</p>
                        ) : (
                          <p className={styles.leafTextMuted}>
                            No cleaned text available.
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                  {hasNextPage && (
                    <button
                      className={styles.loadMoreBtn}
                      onClick={() => void fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage ? "Loading…" : "Load more"}
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
