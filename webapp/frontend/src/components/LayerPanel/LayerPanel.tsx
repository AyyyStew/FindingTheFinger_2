import type { UmapManifest } from '../../utils/umapLoader';
import type { MapVisibility } from '../../utils/mapLayers';
import styles from './LayerPanel.module.css';

interface LayerPanelProps {
  manifest: UmapManifest;
  visibility: MapVisibility;
  onChange: (next: MapVisibility) => void;
}

/**
 * Left sidebar — layer visibility controls.
 *
 * Currently exposes scatter point toggles per height level.
 * Future: add cloud / voronoi / label toggle sections following the same pattern.
 */
export function LayerPanel({ manifest, visibility, onChange }: LayerPanelProps) {
  const toggleScatter = (height: number) => {
    onChange({
      ...visibility,
      scatter: {
        ...visibility.scatter,
        [height]: !visibility.scatter[height],
      },
    });
  };

  const allScatterOn  = manifest.heights.every(h => visibility.scatter[h]);
  const allScatterOff = manifest.heights.every(h => !visibility.scatter[h]);

  const toggleAllScatter = () => {
    const next = allScatterOn ? false : true;
    const scatter: Record<number, boolean> = {};
    for (const h of manifest.heights) scatter[h] = next;
    onChange({ ...visibility, scatter });
  };

  return (
    <aside className={styles.panel}>
      <h2 className={styles.title}>Layers</h2>

      {/* ── Scatter section ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Points</span>
          <button
            className={styles.bulkToggle}
            onClick={toggleAllScatter}
            aria-label={allScatterOn ? 'Hide all point layers' : 'Show all point layers'}
          >
            {allScatterOn ? 'hide all' : allScatterOff ? 'show all' : 'toggle all'}
          </button>
        </div>

        <ul className={styles.list}>
          {[...manifest.heights].reverse().map(h => {
            const visible = visibility.scatter[h] ?? false;
            const count   = manifest.point_counts[String(h)] ?? 0;
            return (
              <li key={h} className={styles.item}>
                <label className={styles.row}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={visible}
                    onChange={() => toggleScatter(h)}
                  />
                  <span className={styles.heightLabel}>
                    h{h}
                    {/* corpus-specific level names can replace h{n} once corpus data is wired in */}
                  </span>
                  <span className={styles.count}>{count.toLocaleString()}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/*
        Future sections:
        <section>  Density Clouds  </section>
        <section>  Voronoi Cells   </section>
        <section>  Labels          </section>
      */}

      <div className={styles.meta}>
        <span className={styles.metaLabel}>run</span>
        <span className={styles.metaValue} title={manifest.created_at}>
          {manifest.label ?? manifest.run_id}
        </span>
      </div>
    </aside>
  );
}
