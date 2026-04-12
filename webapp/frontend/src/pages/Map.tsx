import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCorpora, fetchUnit } from '../api/client';
import type { SearchResult } from '../api/types';
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
import { MapCanvas, type HoverInfo, type FlyToTarget } from '../components/MapCanvas/MapCanvas';
import { LayerPanel } from '../components/LayerPanel/LayerPanel';
import { MapSearchPanel, type MapSearchPanelHandle, type SearchMode } from '../components/MapSearchPanel/MapSearchPanel';
import { UnitCard } from '../components/UnitCard/UnitCard';
import type { LeafLayerData } from '../utils/projectionLoader';
import styles from './Map.module.css';

/** Build unitId → [x, y] lookup from all layers in a resolved projection. */
function buildUnitPositionMap(data: StandardRunData): globalThis.Map<number, [number, number]> {
  const map = new globalThis.Map<number, [number, number]>();
  for (const [, layer] of data.layers) {
    const pos = layer.positions;
    for (let i = 0; i < layer.count; i++) {
      map.set(layer.unitIds[i], [pos[i * 2], pos[i * 2 + 1]]);
    }
  }
  for (const [, layer] of data.depthLayers) {
    const pos = layer.positions;
    for (let i = 0; i < layer.count; i++) {
      if (!map.has(layer.unitIds[i])) {
        map.set(layer.unitIds[i], [pos[i * 2], pos[i * 2 + 1]]);
      }
    }
  }
  return map;
}

/** Pan to a point, preserving the current zoom level. */
function flyToPoint(x: number, y: number): FlyToTarget {
  return { target: [x, y, 0] };
}

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
    return defaultVisibility(resolvedData.manifest.heights, resolvedData.manifest.depths);
  }, [visibility, resolvedData]);

  // Reset visibility + search results when method changes.
  const handleMethodChange = (next: ProjectionMethod) => {
    setMethod(next);
    setXPc(0);
    setYPc(1);
    setVisibility(null);
    setSearchResults(null);
    setAnchorUnitId(null);
  };

  const [hover, setHover] = useState<HoverInfo | null>(null);

  const { data: hoveredUnit } = useQuery({
    queryKey: ['unit', hover?.unitId],
    queryFn: () => fetchUnit(hover!.unitId),
    enabled: hover != null,
    staleTime: Infinity,
  });

  const firstLeafUnitId = useMemo(() => {
    if (!hover || hover.height <= 0 || !resolvedData) return null;
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

  // ── Search result highlighting ─────────────────────────────────────────────

  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [anchorUnitId, setAnchorUnitId] = useState<number | null>(null);

  /** Map from unitId → [x, y] built once from all height+depth layers. */
  const unitPositionMap = useMemo(
    () => resolvedData ? buildUnitPositionMap(resolvedData) : new globalThis.Map<number, [number, number]>(),
    [resolvedData],
  );

  /**
   * Unit IDs that are currently visible on the map — i.e. in an enabled
   * layer AND in a visible corpus. Search results are filtered to this set.
   */
  const visibleUnitIds = useMemo(() => {
    if (!resolvedData || !resolvedVisibility) return null;
    const set = new globalThis.Set<number>();
    const hiddenCorpora = new globalThis.Set(
      Object.entries(resolvedVisibility.corpora)
        .filter(([, v]) => !v)
        .map(([k]) => Number(k)),
    );

    if (resolvedVisibility.scatterMode === 'height') {
      for (const [h, layer] of resolvedData.layers) {
        if (resolvedVisibility.scatter[h] === false) continue;
        for (let i = 0; i < layer.count; i++) {
          if (!hiddenCorpora.has(layer.corpusIds[i])) set.add(layer.unitIds[i]);
        }
      }
    } else {
      for (const [d, layer] of resolvedData.depthLayers) {
        if (resolvedVisibility.scatterDepth[d] === false) continue;
        for (let i = 0; i < layer.count; i++) {
          if (!hiddenCorpora.has(layer.corpusIds[i])) set.add(layer.unitIds[i]);
        }
      }
    }
    return set;
  }, [resolvedData, resolvedVisibility]);

  const visibleCorpusIds = useMemo(() => {
    if (!resolvedVisibility) return null;
    return corpora
      .filter((corpus) => resolvedVisibility.corpora[corpus.id] !== false)
      .map((corpus) => corpus.id);
  }, [corpora, resolvedVisibility]);

  const visibleHeightRange = useMemo(() => {
    if (!resolvedVisibility || resolvedVisibility.scatterMode !== 'height' || !resolvedData) {
      return { min: null as number | null, max: null as number | null };
    }
    const visibleHeights = resolvedData.manifest.heights.filter((h) => resolvedVisibility.scatter[h] !== false);
    if (visibleHeights.length === 0) {
      return { min: null, max: null };
    }
    return {
      min: Math.min(...visibleHeights),
      max: Math.max(...visibleHeights),
    };
  }, [resolvedData, resolvedVisibility]);

  const visibleDepthRange = useMemo(() => {
    if (!resolvedVisibility || resolvedVisibility.scatterMode !== 'depth' || !resolvedData) {
      return { min: null as number | null, max: null as number | null };
    }
    const visibleDepths = resolvedData.manifest.depths.filter((d) => resolvedVisibility.scatterDepth[d] !== false);
    if (visibleDepths.length === 0) {
      return { min: null, max: null };
    }
    return {
      min: Math.min(...visibleDepths),
      max: Math.max(...visibleDepths),
    };
  }, [resolvedData, resolvedVisibility]);

  const searchScatterMode = resolvedVisibility?.scatterMode ?? 'depth';

  /**
   * Positions for the constellation. Index 0 = hub (anchor for passage mode,
   * top result otherwise). Indices 1..N = result spokes.
   */
  const resultPositions = useMemo<[number, number][] | null>(() => {
    if (!searchResults || searchResults.length === 0) return null;
    const positions: [number, number][] = [];
    // Prepend anchor as hub when available (passage search).
    if (anchorUnitId != null) {
      const ap = unitPositionMap.get(anchorUnitId);
      if (ap) positions.push(ap);
    }
    for (const r of searchResults) {
      const p = unitPositionMap.get(r.id);
      if (p) positions.push(p);
    }
    return positions.length > 0 ? positions : null;
  }, [searchResults, anchorUnitId, unitPositionMap]);

  const [flyTo, setFlyTo] = useState<FlyToTarget | null>(null);

  const handleSearchResults = useCallback((results: SearchResult[], _mode: SearchMode, _label: string, anchor?: number) => {
    setSearchResults(results.length > 0 ? results : null);
    setAnchorUnitId(anchor ?? null);
    // Fly to anchor (passage mode) or first result.
    const flyTarget = anchor ?? results.find(r => unitPositionMap.has(r.id))?.id;
    if (flyTarget != null) {
      const pos = unitPositionMap.get(flyTarget);
      if (pos) setFlyTo(flyToPoint(pos[0], pos[1]));
    }
  }, [unitPositionMap]);

  const [highlightPos, setHighlightPos] = useState<[number, number] | null>(null);

  const searchPanelRef = useRef<MapSearchPanelHandle>(null);

  const handleMapClick = useCallback((info: HoverInfo) => {
    searchPanelRef.current?.triggerPassageSearch(info.unitId);
  }, []);

  const handleResultHover = useCallback((result: SearchResult | null) => {
    if (!result) {
      setHighlightPos(null);
      return;
    }
    const pos = unitPositionMap.get(result.id);
    if (pos) {
      setHighlightPos(pos);
      setFlyTo(flyToPoint(pos[0], pos[1]));
    }
  }, [unitPositionMap]);

  if (error) {
    return (
      <div className={styles.centred}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

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
                onClick={handleMapClick}
                resultPositions={resultPositions}
                highlightPos={highlightPos}
                flyTo={flyTo}
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

      {/* Right sidebar — search */}
      <aside className={styles.rightPanel}>
        <MapSearchPanel
          ref={searchPanelRef}
          corpora={corpora}
          scatterMode={searchScatterMode}
          visibleUnitIds={visibleUnitIds}
          visibleCorpusIds={visibleCorpusIds}
          visibleHeightMin={visibleHeightRange.min}
          visibleHeightMax={visibleHeightRange.max}
          visibleDepthMin={visibleDepthRange.min}
          visibleDepthMax={visibleDepthRange.max}
          onResults={handleSearchResults}
          onResultHover={handleResultHover}
        />
      </aside>
    </div>
  );
}
