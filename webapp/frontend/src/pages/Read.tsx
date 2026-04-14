import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  fetchCorpora,
  fetchUnitAncestors,
  fetchUnitDetail,
  fetchUnitLeaves,
  getUnitChildren,
} from "../api/client";
import { getCorpusColor } from "../utils/taxonomyColors";
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
    () => getCorpusColor(data?.taxonomy ?? [], data?.corpus_name),
    [data?.corpus_name, data?.taxonomy],
  );

  const isNonLeaf = (data?.height ?? 0) > 0;

  const { data: corpora = [] } = useQuery({
    queryKey: ["corpora"],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  });

  const corpus = useMemo(
    () => corpora.find((c) => c.name === data?.corpus_name),
    [corpora, data?.corpus_name],
  );

  const childLevelTitle = useMemo(() => {
    if (!isNonLeaf || !corpus || data?.height == null) return "Levels";
    const childHeight = Math.max(0, data.height - 1);
    const levelName =
      corpus.levels.find((level) => level.height === childHeight)?.name ??
      "Level";
    return levelName.endsWith("s") ? levelName : `${levelName}s`;
  }, [corpus, data?.height, isNonLeaf]);

  const headerSourceText = useMemo(() => {
    if (!data) return null;
    if (data.unit_source && data.version_source) {
      return `Unit: ${data.unit_source} • Version: ${data.version_source}`;
    }
    return data.unit_source ?? data.version_source;
  }, [data]);

  const sourceItems = useMemo(() => {
    if (!data) return [];
    const items: Array<{ label: string; value: string }> = [];
    if (data.unit_source) items.push({ label: "Unit", value: data.unit_source });
    if (data.version_source) {
      items.push({ label: "Version", value: data.version_source });
    }
    return items;
  }, [data]);

  const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

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
          <header className={styles.header}>
            <h1 className={styles.title}>
              {data.reference_label ?? `Unit ${data.id}`}
            </h1>
            {taxonomyPath && <p className={styles.taxonomy}>{taxonomyPath}</p>}
            <div className={styles.meta}>
              <span>{data.corpus_name}</span>
              {data.corpus_version_name && (
                <span>• {data.corpus_version_name}</span>
              )}
            </div>
            {headerSourceText && (
              <p className={styles.headerSource}>
                Source:{" "}
                {sourceItems.map((item, idx) => (
                  <span key={`${item.label}-${idx}`}>
                    {sourceItems.length > 1 ? `${item.label}: ` : ""}
                    {isHttpUrl(item.value) ? (
                      <a
                        className={styles.headerSourceLink}
                        href={item.value}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                    {idx < sourceItems.length - 1 && " • "}
                  </span>
                ))}
              </p>
            )}
          </header>

          {!isNonLeaf && (
            <>
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
            </>
          )}

          {isNonLeaf && (
            <section className={styles.levelSection}>
              <h2 className={styles.blockTitle}>{childLevelTitle}</h2>
              {childrenLoading && (
                <p className={styles.loading}>
                  Loading {childLevelTitle.toLowerCase()}...
                </p>
              )}
              {childrenError && (
                <p className={styles.error}>
                  {childrenError instanceof Error
                    ? childrenError.message
                    : `Failed to load ${childLevelTitle.toLowerCase()}`}
                </p>
              )}
              {!childrenLoading &&
                !childrenError &&
                childLinks.length === 0 && (
                  <p className={styles.sourceFallback}>
                    No {childLevelTitle.toLowerCase()} available.
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
              <h2 className={styles.blockTitle}>Passages</h2>
              {leavesLoading && (
                <p className={styles.loading}>Loading passages...</p>
              )}
              {leavesError && (
                <p className={styles.error}>
                  {leavesError instanceof Error
                    ? leavesError.message
                    : "Failed to load passages"}
                </p>
              )}
              {!leavesLoading && !leavesError && leaves.length === 0 && (
                <p className={styles.sourceFallback}>No passages found.</p>
              )}
              {!leavesLoading && !leavesError && leaves.length > 0 && (
                <>
                  <div className={styles.passageList}>
                    {leaves.map((leaf) => (
                      <article key={leaf.id} className={styles.passageRow}>
                        <div className={styles.passageBody}>
                          <span className={styles.passageLabel}>
                            {leaf.reference_label ?? `Unit ${leaf.id}`}
                          </span>
                          <span className={styles.passageSep}>:</span>
                          <p className={styles.passageText}>
                            {leaf.text ?? "No cleaned text available."}
                          </p>
                        </div>
                        <Link
                          className={styles.inlineReadLink}
                          to={`/read/${leaf.id}`}
                        >
                          Read
                        </Link>
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
