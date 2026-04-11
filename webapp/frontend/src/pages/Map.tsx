import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCorpora, fetchUnit } from '../api/client';
import { useUmapData } from '../hooks/useUmapData';
import { buildCorpusColorMap, defaultVisibility, type MapVisibility } from '../utils/mapLayers';
import { MapCanvas, type HoverInfo } from '../components/MapCanvas/MapCanvas';
import { LayerPanel } from '../components/LayerPanel/LayerPanel';
import { UnitCard } from '../components/UnitCard/UnitCard';
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

  // Fetch full unit data on hover (cached — no re-fetch on re-hover).
  const { data: hoveredUnit } = useQuery({
    queryKey: ['unit', hover?.unitId],
    queryFn: () => fetchUnit(hover!.unitId),
    enabled: hover != null,
    staleTime: Infinity,
  });

  // For non-leaf hovers: find the first leaf unit_id from the ancestor columns.
  const firstLeafUnitId = useMemo(() => {
    if (!hover || hover.height === 0 || !umapData) return null;
    const leafLayer = umapData.layers.get(0);
    if (!leafLayer || leafLayer.height !== 0) return null;
    const leaf = leafLayer as LeafLayerData;
    const ancestorIdx = hover.height - 1;
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
      {/* Left sidebar */}
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
            className={styles.tooltipWrap}
            style={{ left: hover.screenX + 14, top: hover.screenY - 10 }}
          >
            {hoveredUnit ? (
              <UnitCard unit={hoveredUnit} variant="micro">
                {/* First leaf preview for non-leaf hovers */}
                {hover.height > 0 && firstLeafUnit && (
                  <div className={styles.leafPreview}>
                    {firstLeafUnit.reference_label && (
                      <div className={styles.leafRef}>{firstLeafUnit.reference_label}</div>
                    )}
                    {firstLeafUnit.text && (
                      <div className={styles.leafText}>{firstLeafUnit.text}</div>
                    )}
                  </div>
                )}
              </UnitCard>
            ) : (
              <div className={styles.tooltipSkeleton}>
                {umapData.unitLabels[String(hover.unitId)] ?? `Unit ${hover.unitId}`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right sidebar — search placeholder */}
      <aside className={styles.rightPanel}>
        <p className={styles.rightPlaceholder}>Search coming soon</p>
      </aside>
    </div>
  );
}
