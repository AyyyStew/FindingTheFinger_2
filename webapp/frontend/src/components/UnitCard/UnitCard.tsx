import type { TaxonomyLabel } from "../../api/types";
import { getTaxonomyColor } from "../../utils/taxonomyColors";
import { UnitChildren } from "../UnitChildren/UnitChildren";
import styles from "./UnitCard.module.css";

// Minimal structural type — satisfied by both UnitBrief and SearchResult
export interface UnitCardData {
  id: number;
  reference_label: string | null;
  ancestor_path: string | null;
  corpus_name: string;
  corpus_version_name: string | null;
  text: string | null;
  height: number | null;
  taxonomy: TaxonomyLabel[];
}

export type UnitCardVariant = "full" | "compact" | "micro";

interface Props {
  unit: UnitCardData;
  variant?: UnitCardVariant;
  /** Renders a score badge in the header row. */
  score?: number;
  /** Slot for header-row actions (e.g. clear button). Renders right of title group. */
  actions?: React.ReactNode;
  /** Renders after the text block, before UnitChildren. Use for context-specific extensions. */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

function scoreClass(score: number) {
  if (score >= 0.85) return styles.scoreHigh;
  if (score >= 0.65) return styles.scoreMid;
  return styles.scoreLow;
}

export function UnitCard({
  unit,
  variant = "full",
  score,
  actions,
  children,
  className,
  style,
}: Props) {
  const { solid, dim } = getTaxonomyColor(unit.taxonomy);
  const taxonomyRoot = unit.taxonomy.find((t) => t.level === 0);
  const showChildren = variant !== "micro" && (unit.height ?? 0) > 0;

  return (
    <article
      className={`${styles.card} ${styles[variant]} ${className ?? ""}`}
      style={
        {
          "--tx-solid": solid,
          "--tx-dim": dim,
          ...style,
        } as React.CSSProperties
      }
    >
      <div className={styles.accentBar} />

      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h3 className={styles.reference}>
              {unit.reference_label ?? `Unit ${unit.id}`}
            </h3>
            {unit.ancestor_path && (
              <p className={styles.path}>{unit.ancestor_path}</p>
            )}
          </div>

          {(score != null || actions) && (
            <div className={styles.headerActions}>
              {score != null && (
                <div className={`${styles.scoreBadge} ${scoreClass(score)}`}>
                  <span className={styles.scoreDot} aria-hidden />
                  {Math.round(score * 100)}%
                </div>
              )}
              {actions}
            </div>
          )}
        </div>

        <div className={styles.badges}>
          <span className={styles.taxBadge}>{unit.corpus_name}</span>
          {taxonomyRoot && (
            <span className={styles.badge}>{taxonomyRoot.name}</span>
          )}
          {unit.corpus_version_name && (
            <span className={styles.badge}>{unit.corpus_version_name}</span>
          )}
        </div>

        {unit.text && <p className={styles.text}>{unit.text}</p>}

        {children}

        {showChildren && <UnitChildren unitId={unit.id} height={unit.height} />}
      </div>
    </article>
  );
}
