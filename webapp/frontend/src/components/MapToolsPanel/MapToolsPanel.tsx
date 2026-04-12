import type { CompareItem, UnitBrief } from '../../api/types';
import styles from './MapToolsPanel.module.css';

interface Props {
  selectedUnitIds: number[];
  selectedUnitLabels: Record<number, string | null | undefined>;
  referenceUnitId: number | null;
  isComparing: boolean;
  compareError: string | null;
  compareResult: { reference_unit: UnitBrief; items: CompareItem[] } | null;
  onClearSelection: () => void;
  onReferenceChange: (unitId: number) => void;
  onRemoveSelection: (unitId: number) => void;
}

function formatSimilarity(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function MapToolsPanel({
  selectedUnitIds,
  selectedUnitLabels,
  referenceUnitId,
  isComparing,
  compareError,
  compareResult,
  onClearSelection,
  onReferenceChange,
  onRemoveSelection,
}: Props) {
  const selectionCount = selectedUnitIds.length;
  const compareItemsById = new globalThis.Map(
    (compareResult?.items ?? []).map((item) => [item.unit.id, item] as const),
  );
  const cardMeta = isComparing
    ? `${selectionCount} selected - comparing...`
    : `${selectionCount} selected`;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.kicker}>Tools</div>
        <h2 className={styles.title}>Compare selected passages</h2>
        <p className={styles.description}>
          Click points on the scatterplot. The comparison updates as soon as you have two.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <div className={styles.cardTitle}>Comparison</div>
            <div className={styles.cardMeta}>
              {cardMeta}
            </div>
          </div>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClearSelection}
            disabled={selectionCount === 0}
          >
            Clear
          </button>
        </div>

        {selectionCount > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Passage</th>
                  <th>Sim</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selectedUnitIds.map((unitId) => {
                  const item = compareItemsById.get(unitId);
                  const isReference =
                    unitId === referenceUnitId ||
                    unitId === compareResult?.reference_unit.id;
                  return (
                    <tr key={unitId} className={isReference ? styles.referenceRow : undefined}>
                      <td>
                        <div className={styles.tablePrimary}>
                          {item?.unit.reference_label ?? selectedUnitLabels[unitId] ?? `Passage #${unitId}`}
                        </div>
                        <div className={styles.tableSecondary}>
                          {item?.unit.corpus_name ? `${item.unit.corpus_name} - #${unitId}` : `#${unitId}`}
                        </div>
                      </td>
                      <td>{item ? formatSimilarity(item.cosine_similarity) : '--'}</td>
                      <td className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.textBtn}
                          onClick={() => onReferenceChange(unitId)}
                          disabled={isReference}
                        >
                          {isReference ? 'Ref' : 'Set ref'}
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => onRemoveSelection(unitId)}
                          aria-label={`Remove ${selectedUnitLabels[unitId] ?? `passage ${unitId}`}`}
                        >
                          x
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.emptyState}>
            Start by clicking a few points on the map.
          </p>
        )}

        {compareError && <p className={styles.error}>{compareError}</p>}
      </div>
    </div>
  );
}
