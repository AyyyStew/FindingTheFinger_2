import { useState, useMemo, useEffect, useRef } from "react";
import type { CorpusInfo, TaxonomyLabel } from "../../api/types";
import type { ProjectionManifest } from "../../utils/projectionLoader";
import type { MapVisibility } from "../../utils/mapLayers";
import { getCorpusColor, getTaxonomyColor, getTranslationColor } from "../../utils/taxonomyColors";
import styles from "./LayerPanel.module.css";

interface LayerPanelProps {
  manifest: ProjectionManifest;
  corpora: CorpusInfo[];
  visibility: MapVisibility;
  onChange: (next: MapVisibility) => void;
}

interface SubGroup {
  node: TaxonomyLabel;
  corpora: CorpusInfo[];
}

interface TraditionGroup {
  root: TaxonomyLabel;
  subGroups: SubGroup[];
}

export function LayerPanel({
  manifest,
  corpora,
  visibility,
  onChange,
}: LayerPanelProps) {
  const [expandedTraditions, setExpandedTraditions] = useState<Set<number>>(
    new Set(),
  );
  const [expandedSubGroups, setExpandedSubGroups] = useState<Set<number>>(
    new Set(),
  );
  const [expandedCorpora, setExpandedCorpora] = useState<Set<number>>(new Set());
  const initializedRef = useRef(false);
  const manifestVersionIds = useMemo(
    () => new Set(manifest.corpus_version_ids),
    [manifest.corpus_version_ids],
  );

  // Expand both levels by default once corpora load.
  useEffect(() => {
    if (initializedRef.current || corpora.length === 0) return;
    initializedRef.current = true;
    const tIds = new Set<number>();
    const sIds = new Set<number>();
    const cIds = new Set<number>();
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find((t) => t.level === 0);
      const sub = corpus.taxonomy.find((t) => t.level === 1);
      const translationCount = corpus.versions.filter(
        (v) =>
          manifestVersionIds.has(v.id) &&
          (v.translation_name ?? "").trim().length > 0,
      ).length;
      if (root) tIds.add(root.id);
      if (sub) sIds.add(sub.id);
      // If exactly one translation exists, start collapsed so the single
      // translation leaf is hidden by default.
      if (translationCount !== 1) cIds.add(corpus.id);
    }
    setExpandedTraditions(tIds);
    setExpandedSubGroups(sIds);
    setExpandedCorpora(cIds);
  }, [corpora, manifestVersionIds]);

  // ── Two-level tradition grouping ──────────────────────────────────────────

  const traditionGroups = useMemo<TraditionGroup[]>(() => {
    const rootMap = new Map<
      number,
      {
        root: TaxonomyLabel;
        subs: Map<number, { node: TaxonomyLabel; corpora: CorpusInfo[] }>;
      }
    >();
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find((t) => t.level === 0);
      const sub = corpus.taxonomy.find((t) => t.level === 1);
      if (!root || !sub) continue;
      if (!rootMap.has(root.id))
        rootMap.set(root.id, { root, subs: new Map() });
      const rootEntry = rootMap.get(root.id)!;
      if (!rootEntry.subs.has(sub.id))
        rootEntry.subs.set(sub.id, { node: sub, corpora: [] });
      rootEntry.subs.get(sub.id)!.corpora.push(corpus);
    }
    return [...rootMap.values()]
      .sort((a, b) => a.root.name.localeCompare(b.root.name))
      .map(({ root, subs }) => ({
        root,
        subGroups: [...subs.values()]
          .sort((a, b) => a.node.name.localeCompare(b.node.name))
          .map(({ node, corpora: sc }) => ({
            node,
            corpora: [...sc].sort((a, b) => a.name.localeCompare(b.name)),
          })),
      }));
  }, [corpora]);

  // ── Corpus visibility helpers ─────────────────────────────────────────────

  const isCorpusVisible = (id: number) => visibility.corpora[id] !== false;
  const anyHidden = corpora.some((c) => visibility.corpora[c.id] === false);

  const setCorpora = (next: Record<number, boolean>) =>
    onChange({ ...visibility, corpora: next });

  const showAllCorpora = () => setCorpora({});

  const toggleCorpus = (id: number) =>
    setCorpora({ ...visibility.corpora, [id]: !isCorpusVisible(id) });

  const toggleGroup = (groupCorpora: CorpusInfo[]) => {
    const allVis = groupCorpora.every((c) => isCorpusVisible(c.id));
    const next = { ...visibility.corpora };
    for (const c of groupCorpora) next[c.id] = !allVis;
    setCorpora(next);
  };

  const isVersionVisible = (id: number) => visibility.corpusVersions[id] !== false;
  const toggleVersion = (id: number) =>
    onChange({
      ...visibility,
      corpusVersions: { ...visibility.corpusVersions, [id]: !isVersionVisible(id) },
    });

  const toggleSpans = () =>
    onChange({
      ...visibility,
      spans: !visibility.spans,
    });

  const soloGroup = (groupCorpora: CorpusInfo[]) => {
    const groupIds = new Set(groupCorpora.map((c) => c.id));
    const isSolo =
      groupCorpora.every((c) => isCorpusVisible(c.id)) &&
      corpora
        .filter((c) => !groupIds.has(c.id))
        .every((c) => !isCorpusVisible(c.id));
    if (isSolo) {
      showAllCorpora();
    } else {
      const next: Record<number, boolean> = {};
      for (const c of corpora) next[c.id] = groupIds.has(c.id);
      setCorpora(next);
    }
  };

  const soloCorpus = (id: number) => {
    const isSolo =
      isCorpusVisible(id) &&
      corpora.filter((c) => c.id !== id).every((c) => !isCorpusVisible(c.id));
    if (isSolo) {
      showAllCorpora();
    } else {
      const next: Record<number, boolean> = {};
      for (const c of corpora) next[c.id] = c.id === id;
      setCorpora(next);
    }
  };

  const toggleExpand = (
    set: Set<number>,
    id: number,
    setter: (s: Set<number>) => void,
  ) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <aside className={styles.panel}>
      <h2 className={styles.title}>Layers</h2>

      {manifest.has_span_layer && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Embedding windows</span>
          </div>
          <div className={styles.corpusItem}>
            <div className={styles.corpusRow}>
              <span className={styles.corpusName}>
                {manifest.embedding_profile?.label ?? "spans"}
              </span>
            </div>
            <input
              type="checkbox"
              className={`${styles.check} ${styles.checkRight}`}
              checked={visibility.spans !== false}
              onChange={toggleSpans}
            />
          </div>
        </section>
      )}

      {/* ── Traditions section ── */}
      {traditionGroups.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Traditions</span>
            {anyHidden && (
              <button className={styles.bulkToggle} onClick={showAllCorpora}>
                show all
              </button>
            )}
          </div>

          <div className={styles.traditionList}>
            {traditionGroups.map((tg) => {
              const { solid: traditionSolid } = getTaxonomyColor([tg.root]);
              const tgCorpora = tg.subGroups.flatMap((sg) => sg.corpora);
              const tAllVis = tgCorpora.every((c) => isCorpusVisible(c.id));
              const tNoneVis = tgCorpora.every((c) => !isCorpusVisible(c.id));
              const tExpanded = expandedTraditions.has(tg.root.id);

              const tgIds = new Set(tgCorpora.map((c) => c.id));
              const tSoloed =
                tAllVis &&
                corpora
                  .filter((c) => !tgIds.has(c.id))
                  .every((c) => !isCorpusVisible(c.id));

              return (
                <div key={tg.root.id} className={styles.traditionBlock}>
                  {/* Level-0 row */}
                  <div className={styles.traditionRow}>
                    <button
                      className={`${styles.expandBtn} ${tExpanded ? styles.expandBtnExpanded : ""}`}
                      onClick={() =>
                        toggleExpand(
                          expandedTraditions,
                          tg.root.id,
                          setExpandedTraditions,
                        )
                      }
                    >
                      {tExpanded ? "▾" : "▸"}
                    </button>
                    <div className={styles.groupLabel}>
                      <span
                        className={styles.groupName}
                        title={tg.root.name}
                        style={{ color: traditionSolid }}
                      >
                        {tg.root.name}
                      </span>
                    </div>
                    <button
                      className={`${styles.soloBtn} ${tSoloed ? styles.soloBtnActive : ""}`}
                      onClick={() => soloGroup(tgCorpora)}
                    >
                      solo
                    </button>
                    <input
                      type="checkbox"
                      className={`${styles.check} ${styles.checkRight}`}
                      checked={tAllVis}
                      ref={(el) => {
                        if (el) el.indeterminate = !tAllVis && !tNoneVis;
                      }}
                      onChange={() => toggleGroup(tgCorpora)}
                    />
                  </div>

                  {/* Level-1 sub-groups */}
                  {tExpanded && (
                    <div className={styles.subGroupList}>
                      {tg.subGroups.map((sg) => {
                      const { solid: subGroupSolid } = getTaxonomyColor(
                        sg.corpora[0]?.taxonomy ?? [],
                      );
                      const sgAllVis = sg.corpora.every((c) =>
                        isCorpusVisible(c.id),
                      );
                      const sgNoneVis = sg.corpora.every(
                        (c) => !isCorpusVisible(c.id),
                      );
                      const sgExpanded = expandedSubGroups.has(sg.node.id);

                      const sgIds = new Set(sg.corpora.map((c) => c.id));
                      const sgSoloed =
                        sgAllVis &&
                        corpora
                          .filter((c) => !sgIds.has(c.id))
                          .every((c) => !isCorpusVisible(c.id));

                      return (
                        <div key={sg.node.id} className={styles.subGroupBlock}>
                          {/* Level-1 row */}
                          <div
                            className={styles.subGroupRow}
                            style={
                              {
                                "--tradition-color": subGroupSolid,
                              } as React.CSSProperties
                            }
                          >
                            <button
                              className={`${styles.expandBtn} ${sgExpanded ? styles.expandBtnExpanded : ""}`}
                              onClick={() =>
                                toggleExpand(
                                  expandedSubGroups,
                                  sg.node.id,
                                  setExpandedSubGroups,
                                )
                              }
                            >
                              {sgExpanded ? "▾" : "▸"}
                            </button>
                            <div className={styles.groupLabel}>
                              <span
                                className={styles.groupName}
                                title={sg.node.name}
                                style={{ color: subGroupSolid }}
                              >
                                {sg.node.name}
                              </span>
                            </div>
                            <button
                              className={`${styles.soloBtn} ${sgSoloed ? styles.soloBtnActive : ""}`}
                              onClick={() => soloGroup(sg.corpora)}
                            >
                              solo
                            </button>
                            <input
                              type="checkbox"
                              className={`${styles.check} ${styles.checkRight}`}
                              checked={sgAllVis}
                              ref={(el) => {
                                if (el)
                                  el.indeterminate = !sgAllVis && !sgNoneVis;
                              }}
                              onChange={() => toggleGroup(sg.corpora)}
                            />
                          </div>

                          {/* Corpora */}
                          {sgExpanded && (
                            <ul className={styles.corpusList}>
                              {sg.corpora.map((corpus) => {
                                const { solid: corpusSolid } = getCorpusColor(
                                  corpus.taxonomy,
                                  corpus.name,
                                );
                                const visible = isCorpusVisible(corpus.id);
                                const corpusExpanded = expandedCorpora.has(corpus.id);
                                const cSoloed =
                                  visible &&
                                  corpora
                                    .filter((c) => c.id !== corpus.id)
                                    .every((c) => !isCorpusVisible(c.id));
                                const corpusVersionsInRun = corpus.versions.filter(
                                  (v) => manifestVersionIds.has(v.id),
                                );
                                const translationVersions =
                                  corpusVersionsInRun.filter(
                                    (v) =>
                                      (v.translation_name ?? "").trim().length > 0,
                                  );
                                const baseVersions = corpusVersionsInRun.filter(
                                  (v) =>
                                    (v.translation_name ?? "").trim().length === 0,
                                );
                                return (
                                  <li
                                    key={corpus.id}
                                    className={styles.corpusBlock}
                                    style={
                                      {
                                        "--tradition-color": corpusSolid,
                                      } as React.CSSProperties
                                    }
                                  >
                                    <div className={styles.corpusItem}>
                                      {corpusVersionsInRun.length > 0 && (
                                        <button
                                          className={`${styles.expandBtn} ${corpusExpanded ? styles.expandBtnExpanded : ""}`}
                                          onClick={() =>
                                            toggleExpand(
                                              expandedCorpora,
                                              corpus.id,
                                              setExpandedCorpora,
                                            )
                                          }
                                        >
                                          {corpusExpanded ? "▾" : "▸"}
                                        </button>
                                      )}
                                      <div className={styles.corpusRow}>
                                        <span
                                          className={styles.corpusName}
                                          title={corpus.name}
                                          style={{ color: corpusSolid }}
                                        >
                                          {corpus.name}
                                        </span>
                                      </div>
                                      <button
                                        className={`${styles.soloBtn} ${cSoloed ? styles.soloBtnActive : ""}`}
                                        onClick={() => soloCorpus(corpus.id)}
                                      >
                                        solo
                                      </button>
                                      <input
                                        type="checkbox"
                                        className={`${styles.check} ${styles.checkRight}`}
                                        checked={visible}
                                        onChange={() => toggleCorpus(corpus.id)}
                                      />
                                    </div>

                                    {corpusExpanded && corpusVersionsInRun.length > 0 && (
                                      <ul className={styles.versionList}>
                                        {baseVersions.map((version) => {
                                          const versionLabel = `corpus version ${version.id}`;
                                          const versionVisible = isVersionVisible(
                                            version.id,
                                          );
                                          return (
                                            <li
                                              key={version.id}
                                              className={styles.versionItem}
                                            >
                                              <div className={styles.versionRow}>
                                                <span
                                                  className={styles.versionName}
                                                  title={versionLabel}
                                                  style={{ color: corpusSolid }}
                                                >
                                                  {versionLabel}
                                                </span>
                                                <input
                                                  type="checkbox"
                                                  className={`${styles.check} ${styles.checkRight}`}
                                                  checked={versionVisible}
                                                  onChange={() =>
                                                    toggleVersion(version.id)
                                                  }
                                                />
                                              </div>
                                            </li>
                                          );
                                        })}

                                        {translationVersions.map((version) => {
                                          const versionLabel =
                                            version.translation_name ??
                                            `translation ${version.id}`;
                                          const versionVisible = isVersionVisible(
                                            version.id,
                                          );
                                          const { solid: translationSolid } =
                                            getTranslationColor(
                                              corpus.taxonomy,
                                              corpus.name,
                                              `${version.id}:${versionLabel}`,
                                            );
                                          return (
                                            <li
                                              key={version.id}
                                              className={styles.versionItem}
                                            >
                                              <div className={styles.versionRow}>
                                                <span
                                                  className={styles.versionName}
                                                  title={versionLabel}
                                                  style={{
                                                    color: translationSolid,
                                                  }}
                                                >
                                                  {versionLabel}
                                                </span>
                                                <input
                                                  type="checkbox"
                                                  className={`${styles.check} ${styles.checkRight}`}
                                                  checked={versionVisible}
                                                  onChange={() =>
                                                    toggleVersion(version.id)
                                                  }
                                                />
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.meta}>
        <span className={styles.metaLabel}>run</span>
        <span className={styles.metaValue} title={manifest.created_at}>
          {manifest.label ?? manifest.run_id}
        </span>
      </div>
    </aside>
  );
}
