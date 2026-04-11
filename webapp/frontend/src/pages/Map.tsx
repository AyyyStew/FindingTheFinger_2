import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCorpora, fetchUnit } from '../api/client';
import { useUmapData } from '../hooks/useUmapData';
import { buildCorpusColorMap, defaultVisibility, type MapVisibility } from '../utils/mapLayers';
import { getTaxonomyColor } from '../utils/taxonomyColors';
import { MapCanvas, type HoverInfo } from '../components/MapCanvas/MapCanvas';
import { LayerPanel } from '../components/LayerPanel/LayerPanel';
import type { LeafLayerData } from '../utils/umapLoader';
import styles from './Map.module.css';

export function Map() {
  const { data: umapData, loading, message, error } = useUmapData();

  const { data: corpora = [] } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  });

  const colorMap = useMemo(
    () => buildCorpusColorMap(corpora),
    [corpora],
  );

  const [visibility, setVisibility] = useState<MapVisibility | null>(null);

  const resolvedVisibility = useMemo(() => {
    if (visibility) return visibility;
    if (!umapData) return null;
    return defaultVisibility(umapData.manifest.heights);
  }, [visibility, umapData]);

  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Fetch full unit data on hover (cached by TanStack Query — no re-fetch on re-hover).
  const { data: hoveredUnit } = useQuery({
    queryKey: ['unit', hover?.unitId],
    queryFn: () => fetchUnit(hover!.unitId),
    enabled: hover != null,
    staleTime: Infinity,
  });

  // For non-leaf hovers: find the first leaf descendant unit_id from the ancestor columns.
  const firstLeafUnitId = useMemo(() => {
    if (!hover || hover.height === 0 || !umapData) return null;
    const leafLayer = umapData.layers.get(0);
    if (!leafLayer || leafLayer.height !== 0) return null;
    const ancestorIdx = hover.height - 1;
    const leaf = leafLayer as LeafLayerData;
    if (ancestorIdx >= leaf.ancestors.length) return null;
    const ancestorCol = leaf.ancestors[ancestorIdx];
    const idx = ancestorCol.findIndex(id => id === hover.unitId);
    return idx >= 0 ? leaf.unitIds[idx] : null;
  }, [hover, umapData]);

  const { data: firstLeafUnit } = useQuery({
    queryKey: ['unit', firstLeafUnitId],
    queryFn: () => fetchUnit(firstLeafUnitId!),
    enabled: firstLeafUnitId != null,
    staleTime: Infinity,
  });

  // Tooltip derived values.
  const hoveredCorpus = hover ? corpora.find(c => c.id === hover.corpusId) : null;
  const corpusName = hoveredCorpus?.name ?? (hover ? `Corpus ${hover.corpusId}` : null);
  const levelName = hoveredCorpus?.levels.find(l => l.height === hover?.height)?.name
    ?? (hover ? `h${hover.height}` : null);
  const traditionName = hoveredUnit?.taxonomy.find(t => t.level === 0)?.name ?? null;

  const { solid: txSolid, dim: txDim } = useMemo(
    () => hoveredUnit ? getTaxonomyColor(hoveredUnit.taxonomy) : { solid: 'var(--color-border)', dim: 'var(--color-surface-alt)' },
    [hoveredUnit],
  );

  // Label from UMAP unitLabels map (non-leaf only) or fallback.
  const unitLabel = hover
    ? (umapData?.unitLabels[String(hover.unitId)] ?? hoveredUnit?.reference_label ?? `Unit ${hover.unitId}`)
    : null;

  if (error) {
    return (
      <div className={styles.centred}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (loading || !umapData || !resolvedVisibility) {
    return (
      <div className={styles.centred}>
        <p className={styles.loadingText}>{message}</p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {/* Left sidebar — layer controls */}
      <LayerPanel
        manifest={umapData.manifest}
        corpora={corpora}
        visibility={resolvedVisibility}
        onChange={setVisibility}
      />

      {/* Main canvas */}
      <div className={styles.canvasWrap}>
        <MapCanvas
          data={umapData}
          visibility={resolvedVisibility}
          colorMap={colorMap}
          onHover={setHover}
        />

        {/* Hover tooltip */}
        {hover && (
          <div
            className={styles.tooltip}
            style={{
              left: hover.screenX + 14,
              top: hover.screenY - 10,
              '--tx-solid': txSolid,
              '--tx-dim': txDim,
            } as React.CSSProperties}
          >
            <div className={styles.tooltipAccent} />
            <div className={styles.tooltipContent}>
              <div className={styles.tooltipRef}>{unitLabel}</div>
              {hoveredUnit?.ancestor_path && (
                <div className={styles.tooltipPath}>{hoveredUnit.ancestor_path}</div>
              )}
              <div className={styles.tooltipBadges}>
                {traditionName && (
                  <span className={styles.tooltipTaxBadge}>{traditionName}</span>
                )}
                {corpusName && <span className={styles.tooltipBadge}>{corpusName}</span>}
                {levelName && <span className={styles.tooltipBadge}>{levelName}</span>}
              </div>

              {/* Leaf text for leaf nodes */}
              {hover.height === 0 && hoveredUnit?.text && (
                <>
                  <div className={styles.tooltipDivider} />
                  <div className={styles.tooltipLeafText}>{hoveredUnit.text}</div>
                </>
              )}

              {/* First leaf preview for non-leaf nodes */}
              {hover.height > 0 && firstLeafUnit && (
                <>
                  <div className={styles.tooltipDivider} />
                  {firstLeafUnit.reference_label && (
                    <div className={styles.tooltipLeafRef}>{firstLeafUnit.reference_label}</div>
                  )}
                  {firstLeafUnit.text && (
                    <div className={styles.tooltipLeafText}>{firstLeafUnit.text}</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right sidebar — search (placeholder for next phase) */}
      <aside className={styles.rightPanel}>
        <p className={styles.rightPlaceholder}>Search coming soon</p>
      </aside>
    </div>
  );
}
