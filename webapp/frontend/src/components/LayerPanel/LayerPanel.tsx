import { useState, useMemo, useEffect, useRef } from 'react';
import type { CorpusInfo, TaxonomyLabel } from '../../api/types';
import type { ProjectionManifest } from '../../utils/projectionLoader';
import type { MapVisibility } from '../../utils/mapLayers';
import { getTaxonomyColor } from '../../utils/taxonomyColors';
import styles from './LayerPanel.module.css';

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

function heightDisplayName(height: number, corpora: CorpusInfo[]): string {
  const names = new Set<string>();
  for (const corpus of corpora) {
    const level = corpus.levels.find(l => l.height === height);
    if (level) names.add(level.name);
  }
  if (names.size === 0) return `h${height}`;
  return [...names].slice(0, 3).join(' / ');
}

export function LayerPanel({ manifest, corpora, visibility, onChange }: LayerPanelProps) {
  const [expandedTraditions, setExpandedTraditions] = useState<Set<number>>(new Set());
  const [expandedSubGroups, setExpandedSubGroups] = useState<Set<number>>(new Set());
  const initializedRef = useRef(false);

  // Expand both levels by default once corpora load.
  useEffect(() => {
    if (initializedRef.current || corpora.length === 0) return;
    initializedRef.current = true;
    const tIds = new Set<number>();
    const sIds = new Set<number>();
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find(t => t.level === 0);
      const sub  = corpus.taxonomy.find(t => t.level === 1);
      if (root) tIds.add(root.id);
      if (sub)  sIds.add(sub.id);
    }
    setExpandedTraditions(tIds);
    setExpandedSubGroups(sIds);
  }, [corpora]);

  // ── Height (scatter) toggles ──────────────────────────────────────────────

  const toggleScatter = (height: number) =>
    onChange({ ...visibility, scatter: { ...visibility.scatter, [height]: !visibility.scatter[height] } });

  const allScatterOn  = manifest.heights.every(h => visibility.scatter[h]);
  const allScatterOff = manifest.heights.every(h => !visibility.scatter[h]);

  const toggleAllScatter = () => {
    const next = allScatterOn ? false : true;
    const scatter: Record<number, boolean> = {};
    for (const h of manifest.heights) scatter[h] = next;
    onChange({ ...visibility, scatter });
  };

  // ── Two-level tradition grouping ──────────────────────────────────────────

  const traditionGroups = useMemo<TraditionGroup[]>(() => {
    const rootMap = new Map<number, { root: TaxonomyLabel; subs: Map<number, { node: TaxonomyLabel; corpora: CorpusInfo[] }> }>();
    for (const corpus of corpora) {
      const root = corpus.taxonomy.find(t => t.level === 0);
      const sub  = corpus.taxonomy.find(t => t.level === 1);
      if (!root || !sub) continue;
      if (!rootMap.has(root.id)) rootMap.set(root.id, { root, subs: new Map() });
      const rootEntry = rootMap.get(root.id)!;
      if (!rootEntry.subs.has(sub.id)) rootEntry.subs.set(sub.id, { node: sub, corpora: [] });
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
  const anyHidden = corpora.some(c => visibility.corpora[c.id] === false);

  const setCorpora = (next: Record<number, boolean>) =>
    onChange({ ...visibility, corpora: next });

  const showAllCorpora = () => setCorpora({});

  const toggleCorpus = (id: number) =>
    setCorpora({ ...visibility.corpora, [id]: !isCorpusVisible(id) });

  const toggleGroup = (groupCorpora: CorpusInfo[]) => {
    const allVis = groupCorpora.every(c => isCorpusVisible(c.id));
    const next = { ...visibility.corpora };
    for (const c of groupCorpora) next[c.id] = !allVis;
    setCorpora(next);
  };

  const soloGroup = (groupCorpora: CorpusInfo[]) => {
    const groupIds = new Set(groupCorpora.map(c => c.id));
    const isSolo =
      groupCorpora.every(c => isCorpusVisible(c.id)) &&
      corpora.filter(c => !groupIds.has(c.id)).every(c => !isCorpusVisible(c.id));
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
      corpora.filter(c => c.id !== id).every(c => !isCorpusVisible(c.id));
    if (isSolo) {
      showAllCorpora();
    } else {
      const next: Record<number, boolean> = {};
      for (const c of corpora) next[c.id] = c.id === id;
      setCorpora(next);
    }
  };

  const toggleExpand = (set: Set<number>, id: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <aside className={styles.panel}>
      <h2 className={styles.title}>Layers</h2>

      {/* ── Scatter / height section ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Points</span>
          <button className={styles.bulkToggle} onClick={toggleAllScatter}>
            {allScatterOn ? 'hide all' : allScatterOff ? 'show all' : 'toggle all'}
          </button>
        </div>
        <ul className={styles.list}>
          {[...manifest.heights].reverse().map(h => {
            const visible = visibility.scatter[h] ?? false;
            const count   = manifest.point_counts[String(h)] ?? 0;
            const label   = heightDisplayName(h, corpora);
            return (
              <li key={h} className={styles.item}>
                <label className={styles.row}>
                  <input type="checkbox" className={styles.check} checked={visible} onChange={() => toggleScatter(h)} />
                  <span className={styles.heightLabel} title={label}>{label}</span>
                  <span className={styles.count}>{count.toLocaleString()}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Traditions section ── */}
      {traditionGroups.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Traditions</span>
            {anyHidden && <button className={styles.bulkToggle} onClick={showAllCorpora}>show all</button>}
          </div>

          <div className={styles.traditionList}>
            {traditionGroups.map(tg => {
              const { solid } = getTaxonomyColor(tg.subGroups[0]?.corpora[0]?.taxonomy ?? []);
              const tgCorpora = tg.subGroups.flatMap(sg => sg.corpora);
              const tAllVis   = tgCorpora.every(c => isCorpusVisible(c.id));
              const tNoneVis  = tgCorpora.every(c => !isCorpusVisible(c.id));
              const tExpanded = expandedTraditions.has(tg.root.id);

              const tgIds   = new Set(tgCorpora.map(c => c.id));
              const tSoloed = tAllVis && corpora.filter(c => !tgIds.has(c.id)).every(c => !isCorpusVisible(c.id));

              return (
                <div key={tg.root.id} className={styles.traditionBlock}>
                  {/* Level-0 row */}
                  <div className={styles.traditionRow}>
                    <span className={styles.traditionDot} style={{ background: solid }} />
                    <label className={styles.groupLabel}>
                      <input
                        type="checkbox"
                        className={styles.check}
                        checked={tAllVis}
                        ref={el => { if (el) el.indeterminate = !tAllVis && !tNoneVis; }}
                        onChange={() => toggleGroup(tgCorpora)}
                      />
                      <span className={styles.groupName} title={tg.root.name}>{tg.root.name}</span>
                    </label>
                    <button
                      className={`${styles.soloBtn} ${tSoloed ? styles.soloBtnActive : ''}`}
                      onClick={() => soloGroup(tgCorpora)}
                    >solo</button>
                    <button
                      className={styles.expandBtn}
                      onClick={() => toggleExpand(expandedTraditions, tg.root.id, setExpandedTraditions)}
                    >
                      {tExpanded ? '▾' : '▸'}
                    </button>
                  </div>

                  {/* Level-1 sub-groups */}
                  {tExpanded && tg.subGroups.map(sg => {
                    const sgAllVis  = sg.corpora.every(c => isCorpusVisible(c.id));
                    const sgNoneVis = sg.corpora.every(c => !isCorpusVisible(c.id));
                    const sgExpanded = expandedSubGroups.has(sg.node.id);

                    const sgIds   = new Set(sg.corpora.map(c => c.id));
                    const sgSoloed = sgAllVis && corpora.filter(c => !sgIds.has(c.id)).every(c => !isCorpusVisible(c.id));

                    return (
                      <div key={sg.node.id} className={styles.subGroupBlock}>
                        {/* Level-1 row */}
                        <div className={styles.subGroupRow}>
                          <label className={styles.groupLabel}>
                            <input
                              type="checkbox"
                              className={styles.check}
                              checked={sgAllVis}
                              ref={el => { if (el) el.indeterminate = !sgAllVis && !sgNoneVis; }}
                              onChange={() => toggleGroup(sg.corpora)}
                            />
                            <span className={styles.groupName} title={sg.node.name}>{sg.node.name}</span>
                          </label>
                          <button
                            className={`${styles.soloBtn} ${sgSoloed ? styles.soloBtnActive : ''}`}
                            onClick={() => soloGroup(sg.corpora)}
                          >solo</button>
                          <button
                            className={styles.expandBtn}
                            onClick={() => toggleExpand(expandedSubGroups, sg.node.id, setExpandedSubGroups)}
                          >
                            {sgExpanded ? '▾' : '▸'}
                          </button>
                        </div>

                        {/* Corpora */}
                        {sgExpanded && (
                          <ul className={styles.corpusList}>
                            {sg.corpora.map(corpus => {
                              const visible = isCorpusVisible(corpus.id);
                              const cSoloed = visible && corpora.filter(c => c.id !== corpus.id).every(c => !isCorpusVisible(c.id));
                              return (
                                <li key={corpus.id} className={styles.corpusItem}>
                                  <label className={styles.corpusRow}>
                                    <input
                                      type="checkbox"
                                      className={styles.check}
                                      checked={visible}
                                      onChange={() => toggleCorpus(corpus.id)}
                                    />
                                    <span className={styles.corpusName} title={corpus.name}>{corpus.name}</span>
                                  </label>
                                  <button
                                    className={`${styles.soloBtn} ${cSoloed ? styles.soloBtnActive : ''}`}
                                    onClick={() => soloCorpus(corpus.id)}
                                  >solo</button>
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
