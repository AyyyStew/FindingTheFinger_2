import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCorpora, fetchUnit } from '../api/client';
import { useProjectionData } from '../hooks/useProjectionData';
import {
  buildCorpusColorMap,
  defaultVisibility,
  type MapVisibility,
} from '../utils/mapLayers';
import {
  isPcaRunData,
  resolvePcaData,
  PROJECTION_METHODS,
  METHOD_LABELS,
  type ProjectionMethod,
  type StandardRunData,
  type PcaManifest,
} from '../utils/projectionLoader';

const METHOD_TOOLTIPS: Record<ProjectionMethod, string> = {
  umap:   'UMAP — preserves local neighborhood structure. Best for revealing clusters and local groupings.',
  pca:    'PCA — linear projection onto axes of maximum variance. Good for global structure; axes are interpretable.',
  phate:  'PHATE — diffusion-based geometry. Preserves both local clusters and global continuous trajectories.',
  isomap: 'Isomap — geodesic distances on a manifold. Preserves global curved structure and inter-cluster geometry.',
};
import { MapCanvas, type HoverInfo } from '../components/MapCanvas/MapCanvas';
import { LayerPanel } from '../components/LayerPanel/LayerPanel';
import { UnitCard } from '../components/UnitCard/UnitCard';
import type { LeafLayerData } from '../utils/projectionLoader';
import styles from './Map.module.css';

export function Map() {
  const [method, setMethod] = useState<ProjectionMethod>('umap');

  // PCA axis selection (0-indexed component indices)
  const [xPc, setXPc] = useState(0);
  const [yPc, setYPc] = useState(1);

  const { data: projData, loading, message, error } = useProjectionData(method);

  const { data: corpora = [] } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  });

  const colorMap = useMemo(() => buildCorpusColorMap(corpora), [corpora]);

  const [visibility, setVisibility] = useState<MapVisibility | null>(null);

  // Resolve projection data into a StandardRunData for the canvas.
  // For PCA: build positions from selected PC pair. Reset when method changes.
  const resolvedData = useMemo<StandardRunData | null>(() => {
    if (!projData) return null;
    if (isPcaRunData(projData)) {
      return resolvePcaData(projData, xPc, yPc);
    }
    return projData;
  }, [projData, xPc, yPc]);

  const resolvedVisibility = useMemo(() => {
    if (visibility) return visibility;
    if (!resolvedData) return null;
    return defaultVisibility(resolvedData.manifest.heights);
  }, [visibility, resolvedData]);

  // Reset visibility when method changes so layer defaults are recalculated.
  const handleMethodChange = (next: ProjectionMethod) => {
    setMethod(next);
    setXPc(0);
    setYPc(1);
  };

  const [hover, setHover] = useState<HoverInfo | null>(null);

  const { data: hoveredUnit } = useQuery({
    queryKey: ['unit', hover?.unitId],
    queryFn: () => fetchUnit(hover!.unitId),
    enabled: hover != null,
    staleTime: Infinity,
  });

  const firstLeafUnitId = useMemo(() => {
    if (!hover || hover.height === 0 || !resolvedData) return null;
    const leafLayer = resolvedData.layers.get(0);
    if (!leafLayer || leafLayer.height !== 0) return null;
    const leaf = leafLayer as LeafLayerData;
    const ancestorIdx = hover.height - 1;
    if (ancestorIdx >= leaf.ancestors.length) return null;
    const ancestorCol = leaf.ancestors[ancestorIdx];
    const idx = ancestorCol.findIndex(id => id === hover.unitId);
    return idx >= 0 ? leaf.unitIds[idx] : null;
  }, [hover, resolvedData]);

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

  // PCA axis selector — shown only when method=pca and data is loaded.
  const pcaManifest = (projData && isPcaRunData(projData))
    ? projData.manifest as PcaManifest
    : null;

  return (
    <div className={styles.layout}>
      {/* Left sidebar */}
      {resolvedData && resolvedVisibility ? (
        <LayerPanel
          manifest={resolvedData.manifest}
          corpora={corpora}
          visibility={resolvedVisibility}
          onChange={setVisibility}
        />
      ) : (
        <aside className={styles.layerPanelPlaceholder} />
      )}

      {/* Main canvas */}
      <div className={styles.canvasWrap}>
        {/* Method selector toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.methodSelector}>
            {PROJECTION_METHODS.map(m => (
              <div key={m} className={styles.methodBtnWrap}>
                <button
                  className={`${styles.methodBtn} ${m === method ? styles.methodBtnActive : ''}`}
                  onClick={() => handleMethodChange(m)}
                >
                  {METHOD_LABELS[m]}
                </button>
                <div className={styles.methodTooltip}>{METHOD_TOOLTIPS[m]}</div>
              </div>
            ))}
          </div>

          {/* PC axis selectors — only visible when method=pca and data loaded */}
          {pcaManifest && (
            <div className={styles.pcaSelectors}>
              <label className={styles.pcaLabel}>
                X
                <select
                  className={styles.pcaSelect}
                  value={xPc}
                  onChange={e => setXPc(Number(e.target.value))}
                >
                  {pcaManifest.explained_variance_ratio.map((ev, i) => (
                    <option key={i} value={i}>
                      PC{i + 1} ({(ev * 100).toFixed(1)}%)
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.pcaLabel}>
                Y
                <select
                  className={styles.pcaSelect}
                  value={yPc}
                  onChange={e => setYPc(Number(e.target.value))}
                >
                  {pcaManifest.explained_variance_ratio.map((ev, i) => (
                    <option key={i} value={i}>
                      PC{i + 1} ({(ev * 100).toFixed(1)}%)
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className={styles.canvasInner}>
          {loading || !resolvedData || !resolvedVisibility || projData?.manifest.method !== method ? (
            <div className={styles.centred}>
              <p className={styles.loadingText}>{message || 'Loading…'}</p>
            </div>
          ) : (
            <>
              <MapCanvas
                key={method}
                data={resolvedData}
                visibility={resolvedVisibility}
                colorMap={colorMap}
                onHover={setHover}
              />

              {hover && (
                <div
                  className={styles.tooltipWrap}
                  style={{ left: hover.screenX + 14, top: hover.screenY - 10 }}
                >
                  {hoveredUnit ? (
                    <UnitCard unit={hoveredUnit} variant="micro">
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
                      {resolvedData.unitLabels[String(hover.unitId)] ?? `Unit ${hover.unitId}`}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right sidebar — search placeholder */}
      <aside className={styles.rightPanel}>
        <p className={styles.rightPlaceholder}>Search coming soon</p>
      </aside>
    </div>
  );
}
