import { useState, useMemo, useEffect, useRef } from "react";
import type { CorpusInfo, TaxonomyLabel } from "../../api/types";
import type { ProjectionManifest } from "../../utils/projectionLoader";
import type { MapVisibility } from "../../utils/mapLayers";
import { getTaxonomyColor } from "../../utils/taxonomyColors";
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

function depthDisplayName(
  height: number,
  maxHeight: number,
  corpora: CorpusInfo[],
): string {
  const depth = maxHeight - height;
  const names = new Set<string>();
  for (const corpus of corpora) {
    const level = corpus.levels.find((l) => l.height === height);
    if (level) names.add(level.name);
  }
  if (names.size === 0) return `d${depth}`;
  return [...names].slice(0, 3).join(" / ");
}

function corpusVersionDisplayName(
  corpusVersionId: number,
  corpora: CorpusInfo[],
): string {
  for (const corpus of corpora) {
    const version = corpus.versions.find((v) => v.id === corpusVersionId);
    if (!version) continue;
    const versionName = version.translation_name ?? version.language ?? `version ${corpusVersionId}`;
    return `${corpus.name} · ${versionName}`;
  }
  return `version ${corpusVersionId}`;
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
  const initializedRef = useRef(false);

  // Expand both levels by default once corpora load.
  useEffect(() => {
    if (initializedRef.current || corpora.length === 0) return;
    initializedRef.current = true;
    const tIds = new Set<number>();
    const sIds = new Set<number>();
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find((t) => t.level === 0);
      const sub = corpus.taxonomy.find((t) => t.level === 1);
      if (root) tIds.add(root.id);
      if (sub) sIds.add(sub.id);
    }
    setExpandedTraditions(tIds);
    setExpandedSubGroups(sIds);
  }, [corpora]);

  // ── Scatter mode + toggles ────────────────────────────────────────────────

  const mode = visibility.scatterMode;

  const setMode = (next: "corpusVersion" | "height") =>
    onChange({ ...visibility, scatterMode: next });

  // Height-mode toggles
  const toggleScatter = (height: number) =>
    onChange({
      ...visibility,
      scatter: { ...visibility.scatter, [height]: !visibility.scatter[height] },
    });

  const allScatterOn = manifest.heights.every((h) => visibility.scatter[h]);
  const allScatterOff = manifest.heights.every((h) => !visibility.scatter[h]);

  const toggleAllScatter = () => {
    const next = allScatterOn ? false : true;
    const scatter: Record<number, boolean> = {};
    for (const h of manifest.heights) scatter[h] = next;
    onChange({ ...visibility, scatter });
  };

  // Corpus-version-mode toggles
  const toggleScatterCorpusVersion = (corpusVersionId: number) =>
    onChange({
      ...visibility,
      scatterCorpusVersion: {
        ...visibility.scatterCorpusVersion,
        [corpusVersionId]: !visibility.scatterCorpusVersion[corpusVersionId],
      },
    });

  const allCorpusVersionOn = manifest.corpus_version_ids.every(
    (cvid) => visibility.scatterCorpusVersion[cvid] !== false,
  );
  const allCorpusVersionOff = manifest.corpus_version_ids.every(
    (cvid) => !visibility.scatterCorpusVersion[cvid],
  );

  const toggleAllCorpusVersion = () => {
    const next = allCorpusVersionOn ? false : true;
    const scatterCorpusVersion: Record<number, boolean> = {};
    for (const cvid of manifest.corpus_version_ids) scatterCorpusVersion[cvid] = next;
    onChange({ ...visibility, scatterCorpusVersion });
  };

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

      {/* ── Points section ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Points</span>
          <button
            className={styles.bulkToggle}
            onClick={mode === "corpusVersion" ? toggleAllCorpusVersion : toggleAllScatter}
          >
            {(mode === "corpusVersion" ? allCorpusVersionOn : allScatterOn)
              ? "hide all"
              : (mode === "corpusVersion" ? allCorpusVersionOff : allScatterOff)
                ? "show all"
                : "toggle all"}
          </button>
        </div>

        {/* Mode toggle */}
        <div className={styles.modeToggle}>
          <button
            className={`${styles.modeBtn} ${mode === "corpusVersion" ? styles.modeBtnActive : ""}`}
            onClick={() => setMode("corpusVersion")}
          >
            by corpus version
          </button>
          <button
            className={`${styles.modeBtn} ${mode === "height" ? styles.modeBtnActive : ""}`}
            onClick={() => setMode("height")}
          >
            by height
          </button>
        </div>

        {mode === "height" ? (
          <ul className={styles.list}>
            {[...manifest.heights].reverse().map((h) => {
              const visible = visibility.scatter[h] ?? false;
              const count = manifest.point_counts[String(h)] ?? 0;
              const label = depthDisplayName(h, manifest.max_height, corpora);
              return (
                <li key={h} className={styles.item}>
                  <label className={styles.row}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={visible}
                      onChange={() => toggleScatter(h)}
                    />
                    <span className={styles.heightLabel} title={label}>
                      {label}
                    </span>
                    <span className={styles.count}>
                      {count.toLocaleString()}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className={styles.list}>
            {[...manifest.corpus_version_ids].map((cvid) => {
              const visible = visibility.scatterCorpusVersion[cvid] !== false;
              const count = manifest.corpus_version_counts[String(cvid)] ?? 0;
              const label = corpusVersionDisplayName(cvid, corpora);
              return (
                <li key={cvid} className={styles.item}>
                  <label className={styles.row}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={visible}
                      onChange={() => toggleScatterCorpusVersion(cvid)}
                    />
                    <span className={styles.heightLabel} title={label}>{label}</span>
                    <span className={styles.count}>
                      {count.toLocaleString()}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
                    <span
                      className={styles.traditionDot}
                      style={{ background: traditionSolid }}
                    />
                    <label className={styles.groupLabel}>
                      <input
                        type="checkbox"
                        className={styles.check}
                        checked={tAllVis}
                        ref={(el) => {
                          if (el) el.indeterminate = !tAllVis && !tNoneVis;
                        }}
                        onChange={() => toggleGroup(tgCorpora)}
                      />
                      <span
                        className={styles.groupName}
                        title={tg.root.name}
                        style={{ color: traditionSolid }}
                      >
                        {tg.root.name}
                      </span>
                    </label>
                    <button
                      className={`${styles.soloBtn} ${tSoloed ? styles.soloBtnActive : ""}`}
                      onClick={() => soloGroup(tgCorpora)}
                    >
                      solo
                    </button>
                    <button
                      className={styles.expandBtn}
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
                  </div>

                  {/* Level-1 sub-groups */}
                  {tExpanded &&
                    tg.subGroups.map((sg) => {
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
                            <label className={styles.groupLabel}>
                              <input
                                type="checkbox"
                                className={styles.check}
                                checked={sgAllVis}
                                ref={(el) => {
                                  if (el)
                                    el.indeterminate = !sgAllVis && !sgNoneVis;
                                }}
                                onChange={() => toggleGroup(sg.corpora)}
                              />
                              <span
                                className={styles.groupName}
                                title={sg.node.name}
                                style={{ color: subGroupSolid }}
                              >
                                {sg.node.name}
                              </span>
                            </label>
                            <button
                              className={`${styles.soloBtn} ${sgSoloed ? styles.soloBtnActive : ""}`}
                              onClick={() => soloGroup(sg.corpora)}
                            >
                              solo
                            </button>
                            <button
                              className={styles.expandBtn}
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
                          </div>

                          {/* Corpora */}
                          {sgExpanded && (
                            <ul className={styles.corpusList}>
                              {sg.corpora.map((corpus) => {
                                const { solid: corpusSolid } = getTaxonomyColor(
                                  corpus.taxonomy,
                                );
                                const visible = isCorpusVisible(corpus.id);
                                const cSoloed =
                                  visible &&
                                  corpora
                                    .filter((c) => c.id !== corpus.id)
                                    .every((c) => !isCorpusVisible(c.id));
                                return (
                                  <li
                                    key={corpus.id}
                                    className={styles.corpusItem}
                                    style={
                                      {
                                        "--tradition-color": corpusSolid,
                                      } as React.CSSProperties
                                    }
                                  >
                                    <label className={styles.corpusRow}>
                                      <input
                                        type="checkbox"
                                        className={styles.check}
                                        checked={visible}
                                        onChange={() => toggleCorpus(corpus.id)}
                                      />
                                      <span
                                        className={styles.corpusName}
                                        title={corpus.name}
                                        style={{ color: corpusSolid }}
                                      >
                                        {corpus.name}
                                      </span>
                                    </label>
                                    <button
                                      className={`${styles.soloBtn} ${cSoloed ? styles.soloBtnActive : ""}`}
                                      onClick={() => soloCorpus(corpus.id)}
                                    >
                                      solo
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
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
