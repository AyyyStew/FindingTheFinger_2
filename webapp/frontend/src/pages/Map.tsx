import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { compareUnits, fetchCorpora, fetchUnit } from '../api/client';
import type { CompareResponse, SearchResult } from '../api/types';
import { MapCanvas, type HoverInfo, type FlyToTarget, type MapViewMode } from '../components/MapCanvas/MapCanvas';
import { MapViewModeToggle } from '../components/MapViewModeToggle/MapViewModeToggle';
import { LayerPanel } from '../components/LayerPanel/LayerPanel';
import { MapSearchPanel, type MapSearchPanelHandle } from '../components/MapSearchPanel/MapSearchPanel';
import { MapToolsPanel } from '../components/MapToolsPanel/MapToolsPanel';
import { UnitCard } from '../components/UnitCard/UnitCard';
import { useProjectionData } from '../hooks/useProjectionData';
import {
  buildUnitCorpusMap,
  buildUnitPositionMap,
  buildVisibleCorpusIds,
  buildVisibleUnitIds,
  normalizeVisibilityForData,
  visibleDepthRange as getVisibleDepthRange,
  visibleHeightRange as getVisibleHeightRange,
} from '../utils/mapData';
import {
  buildCorpusColorMap,
  buildCorpusLabelMap,
  DEFAULT_OVERLAY_OPTIONS,
  type KdeBreakdown,
  type MapOverlayOptions,
  type MapVisibility,
} from '../utils/mapLayers';
import type { SearchMode } from '../utils/searchModes';
import {
  isPcaRunData,
  resolvePcaData,
  PROJECTION_METHODS,
  METHOD_LABELS,
  type ProjectionMethod,
  type StandardRunData,
  type PcaManifest,
  type LeafLayerData,
} from '../utils/projectionLoader';
import styles from './Map.module.css';

const METHOD_TOOLTIPS: Record<ProjectionMethod, string> = {
  umap:   'UMAP — preserves local neighborhood structure. Best for revealing clusters and local groupings.',
  pca:    'PCA — linear projection onto axes of maximum variance. Good for global structure; axes are interpretable.',
  phate:  'PHATE — diffusion-based geometry. Preserves both local clusters and global continuous trajectories.',
  isomap: 'Isomap — geodesic distances on a manifold. Preserves global curved structure and inter-cluster geometry.',
};

const KDE_BREAKDOWN_LABELS: Record<KdeBreakdown, string> = {
  overall: 'whole view',
  corpus: 'by corpus',
};

function rgbTupleToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** Pan to a point, preserving the current zoom level. */
function flyToPoint(x: number, y: number, z: number): FlyToTarget {
  return { target: [x, y, z] };
}

export function Map() {
  const [method, setMethod] = useState<ProjectionMethod>('umap');
  const [viewMode, setViewMode] = useState<MapViewMode>('2d');
  const [rightPanelTab, setRightPanelTab] = useState<'search' | 'tools'>('search');
  const [overlays, setOverlays] = useState<MapOverlayOptions>(DEFAULT_OVERLAY_OPTIONS);
  const [fitToBoundsToken, setFitToBoundsToken] = useState(0);
  const [flyTo, setFlyTo] = useState<FlyToTarget | null>(null);

  // PCA axis selection (0-indexed component indices)
  const [xPc, setXPc] = useState(0);
  const [yPc, setYPc] = useState(1);
  const [zPc, setZPc] = useState(2);

  const { data: projData, loading, message, error } = useProjectionData(method);

  const { data: corpora = [] } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  });

  const colorMap = useMemo(() => buildCorpusColorMap(corpora), [corpora]);
  const corpusLabelMap = useMemo(() => buildCorpusLabelMap(corpora), [corpora]);

  const [visibility, setVisibility] = useState<MapVisibility | null>(null);

  // Resolve projection data into a StandardRunData for the canvas.
  const resolvedData = useMemo<StandardRunData | null>(() => {
    if (!projData) return null;
    if (isPcaRunData(projData)) {
      return resolvePcaData(projData, xPc, yPc, zPc);
    }
    return projData;
  }, [projData, xPc, yPc, zPc]);

  const resolvedVisibility = useMemo(() => {
    if (!resolvedData) return null;
    return normalizeVisibilityForData(visibility, resolvedData);
  }, [visibility, resolvedData]);

  const labelDepths = useMemo(() => {
    if (!resolvedData) return [];
    return [...resolvedData.depthLayers.keys()]
      .filter(depth => {
        const layer = resolvedData.depthLayers.get(depth);
        if (!layer) return false;
        for (let i = 0; i < layer.count; i++) {
          if (resolvedData.unitLabels[String(layer.unitIds[i])]) return true;
        }
        return false;
      })
      .sort((a, b) => a - b);
  }, [resolvedData]);

  // Reset embedding-specific selections + search results when method changes.
  const handleMethodChange = (next: ProjectionMethod) => {
    setMethod(next);
    setXPc(0);
    setYPc(1);
    setZPc(2);
    setFitToBoundsToken(t => t + 1);
    setFlyTo(null);
    setHighlightPos(null);
    setSearchResults(null);
    setAnchorUnitId(null);
  };

  const toggleOverlay = useCallback((key: 'voronoi' | 'kde' | 'labels' | 'hidePoints') => {
    setOverlays(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setKdeBreakdown = useCallback((kdeBreakdown: KdeBreakdown) => {
    setOverlays(prev => ({ ...prev, kdeBreakdown }));
  }, []);

  const toggleLabelDepth = useCallback((depth: number) => {
    setOverlays(prev => {
      const labelDepths = prev.labelDepths.includes(depth)
        ? prev.labelDepths.filter(d => d !== depth)
        : [...prev.labelDepths, depth].sort((a, b) => a - b);
      return { ...prev, labelDepths };
    });
  }, []);

  const toggleCorpusLabels = useCallback(() => {
    setOverlays(prev => ({ ...prev, labelCorpus: !prev.labelCorpus }));
  }, []);

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
  const [compareSelectionIds, setCompareSelectionIds] = useState<number[]>([]);
  const [compareReferenceId, setCompareReferenceId] = useState<number | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareHoverUnitId, setCompareHoverUnitId] = useState<number | null>(null);

  /** Map from unitId → [x, y] built once from all height+depth layers. */
  const unitPositionMap = useMemo(
    () => resolvedData ? buildUnitPositionMap(resolvedData) : new globalThis.Map<number, [number, number, number]>(),
    [resolvedData],
  );

  const unitCorpusMap = useMemo(
    () => resolvedData ? buildUnitCorpusMap(resolvedData) : new globalThis.Map<number, number>(),
    [resolvedData],
  );

  /**
   * Unit IDs that are currently visible on the map — i.e. in an enabled
   * layer AND in a visible corpus. Search results are filtered to this set.
   */
  const visibleUnitIds = useMemo(() => {
    if (!resolvedData || !resolvedVisibility) return null;
    return buildVisibleUnitIds(resolvedData, resolvedVisibility);
  }, [resolvedData, resolvedVisibility]);

  const visibleCorpusIds = useMemo(() => {
    if (!resolvedVisibility) return null;
    return buildVisibleCorpusIds(corpora, resolvedVisibility);
  }, [corpora, resolvedVisibility]);

  const visibleHeightRange = useMemo(() => {
    if (!resolvedData || !resolvedVisibility) return { min: null, max: null };
    return getVisibleHeightRange(resolvedData, resolvedVisibility);
  }, [resolvedData, resolvedVisibility]);

  const visibleDepthRange = useMemo(() => {
    if (!resolvedData || !resolvedVisibility) return { min: null, max: null };
    return getVisibleDepthRange(resolvedData, resolvedVisibility);
  }, [resolvedData, resolvedVisibility]);

  const searchScatterMode = resolvedVisibility?.scatterMode ?? 'depth';

  /**
   * Positions for the constellation. Index 0 = hub (anchor for passage mode,
   * top result otherwise). Indices 1..N = result spokes.
   */
  const resultPositions = useMemo<[number, number, number][] | null>(() => {
    if (!searchResults || searchResults.length === 0) return null;
    const positions: [number, number, number][] = [];
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

  const visibleResultPositions = rightPanelTab === 'search' ? resultPositions : null;

  const compareSelectionSet = useMemo(() => new globalThis.Set(compareSelectionIds), [compareSelectionIds]);
  const compareSelectionPositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    for (const unitId of compareSelectionIds) {
      if (unitId === compareHoverUnitId) continue;
      const pos = unitPositionMap.get(unitId);
      if (pos) positions.push(pos);
    }
    return positions;
  }, [compareHoverUnitId, compareSelectionIds, unitPositionMap]);

  const compareHoverPosition = useMemo(() => {
    if (compareHoverUnitId == null || !compareSelectionIds.includes(compareHoverUnitId)) return null;
    return unitPositionMap.get(compareHoverUnitId) ?? null;
  }, [compareHoverUnitId, compareSelectionIds, unitPositionMap]);

  const selectedUnitQueries = useQueries({
    queries: compareSelectionIds.map(unitId => ({
      queryKey: ['unit', unitId],
      queryFn: () => fetchUnit(unitId),
      staleTime: Infinity,
    })),
  });

  const handleSearchResults = useCallback((results: SearchResult[], _mode: SearchMode, _label: string, anchor?: number) => {
    setSearchResults(results.length > 0 ? results : null);
    setAnchorUnitId(anchor ?? null);
    // Fly to anchor (passage mode) or first result.
    const flyTarget = anchor ?? results.find(r => unitPositionMap.has(r.id))?.id;
    if (flyTarget != null) {
      const pos = unitPositionMap.get(flyTarget);
      if (pos) setFlyTo(flyToPoint(pos[0], pos[1], pos[2]));
    }
  }, [unitPositionMap]);

  const [highlightPos, setHighlightPos] = useState<[number, number, number] | null>(null);

  useEffect(() => {
    if (rightPanelTab === 'tools') {
      setHighlightPos(null);
    }
  }, [rightPanelTab]);

  const searchPanelRef = useRef<MapSearchPanelHandle>(null);

  const handleToolsMapClick = useCallback((info: HoverInfo) => {
    setCompareSelectionIds(prev => {
      const exists = prev.includes(info.unitId);
      const next = exists
        ? prev.filter(id => id !== info.unitId)
        : [...prev, info.unitId];

      setCompareResult(null);
      setCompareError(null);
      if (compareReferenceId != null && !next.includes(compareReferenceId)) {
        setCompareReferenceId(next[0] ?? null);
      } else if (compareReferenceId == null && next.length > 0) {
        setCompareReferenceId(next[0]);
      }
      return next;
    });
  }, [compareReferenceId]);

  const handleMapClick = useCallback((info: HoverInfo) => {
    if (rightPanelTab === 'tools') {
      handleToolsMapClick(info);
      return;
    }
    searchPanelRef.current?.triggerPassageSearch(info.unitId);
  }, [handleToolsMapClick, rightPanelTab]);

  const handleResultHover = useCallback((result: SearchResult | null) => {
    if (!result) {
      setHighlightPos(null);
      return;
    }
    const pos = unitPositionMap.get(result.id);
    if (pos) {
      setHighlightPos(pos);
      setFlyTo(flyToPoint(pos[0], pos[1], pos[2]));
    }
  }, [unitPositionMap]);

  useEffect(() => {
    if (compareSelectionIds.length < 2) {
      setCompareResult(null);
      setIsComparing(false);
      return;
    }

    const referenceUnitId = compareReferenceId ?? compareSelectionIds[0];
    if (referenceUnitId == null || !compareSelectionIds.includes(referenceUnitId)) return;

    let cancelled = false;
    setIsComparing(true);
    setCompareError(null);

    compareUnits({
      reference_unit_id: referenceUnitId,
      unit_ids: compareSelectionIds,
    })
      .then(response => {
        if (cancelled) return;
        setCompareResult(response);
        setCompareReferenceId(response.reference_unit.id);
      })
      .catch(e => {
        if (cancelled) return;
        setCompareError(e instanceof Error ? e.message : 'Compare failed');
      })
      .finally(() => {
        if (!cancelled) setIsComparing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [compareReferenceId, compareSelectionIds]);

  const handleReferenceChange = useCallback((unitId: number) => {
    setCompareReferenceId(unitId);
  }, []);

  const handleClearSelection = useCallback(() => {
    setCompareSelectionIds([]);
    setCompareReferenceId(null);
    setCompareResult(null);
    setCompareError(null);
    setCompareHoverUnitId(null);
  }, []);

  const handleRemoveSelection = useCallback((unitId: number) => {
    setCompareSelectionIds(prev => {
      const next = prev.filter(id => id !== unitId);
      setCompareResult(null);
      setCompareError(null);
      setCompareHoverUnitId(current => current === unitId ? null : current);
      setCompareReferenceId(current => {
        if (current !== unitId) return current;
        return next[0] ?? null;
      });
      return next;
    });
  }, []);

  const handleZoomToSelection = useCallback((unitId: number) => {
    const pos = unitPositionMap.get(unitId);
    if (pos) setFlyTo({ target: [pos[0], pos[1], pos[2]], zoom: 8 });
  }, [unitPositionMap]);

  const selectedUnitLabels = useMemo(() => {
    const labels: Record<number, string | null> = {};
    for (let i = 0; i < compareSelectionIds.length; i++) {
      const unitId = compareSelectionIds[i];
      const fetchedUnit = selectedUnitQueries[i]?.data;
      labels[unitId] =
        fetchedUnit?.reference_label ??
        resolvedData?.unitLabels[String(unitId)] ??
        null;
    }
    if (compareResult) {
      labels[compareResult.reference_unit.id] = compareResult.reference_unit.reference_label;
      for (const item of compareResult.items) {
        labels[item.unit.id] = item.unit.reference_label;
      }
    }
    return labels;
  }, [compareSelectionIds, compareResult, resolvedData, selectedUnitQueries]);

  const selectedUnitLabelColors = useMemo(() => {
    const colors: Record<number, string> = {};
    for (const unitId of compareSelectionIds) {
      const corpusId = unitCorpusMap.get(unitId);
      const color = corpusId == null ? null : colorMap.get(corpusId);
      if (color) colors[unitId] = rgbTupleToCss(color);
    }
    return colors;
  }, [colorMap, compareSelectionIds, unitCorpusMap]);

  const pcaManifest = (projData && isPcaRunData(projData))
    ? projData.manifest as PcaManifest
    : null;

  useEffect(() => {
    if (!pcaManifest) return;
    const maxIndex = Math.max(0, pcaManifest.n_components - 1);
    setXPc(prev => Math.min(prev, maxIndex));
    setYPc(prev => Math.min(prev, maxIndex));
    setZPc(prev => Math.min(prev, maxIndex));
  }, [pcaManifest]);

  if (error) {
    return (
      <div className={styles.centred}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  return (
    <>
      <section className={styles.mobileFallback} aria-label="Map screen size notice">
        <div className={styles.mobileFallbackCard}>
          <span className={styles.mobileFallbackKicker}>Map view</span>
          <h2 className={styles.mobileFallbackTitle}>Best experienced on larger screens</h2>
          <p className={styles.mobileFallbackBody}>
            The full projection map includes high-density WebGL rendering and multi-panel controls.
            For smooth exploration, open this page on tablet, laptop, or desktop.
          </p>
          <span className={styles.mobileFallbackCta}>Use a larger screen for full map tools</span>
        </div>
      </section>

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
              <label className={styles.pcaLabel}>
                Z
                <select
                  className={styles.pcaSelect}
                  value={zPc}
                  onChange={e => setZPc(Number(e.target.value))}
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
              <MapViewModeToggle
                viewMode={viewMode}
                onChange={setViewMode}
                onZoomToFit={() => setFitToBoundsToken(t => t + 1)}
              />
              <div className={styles.overlayToolbar} aria-label="Map view overlays">
                {viewMode === '2d' && (
                  <>
                    <button
                      type="button"
                      className={`${styles.overlayBtn} ${overlays.voronoi ? styles.overlayBtnActive : ''}`}
                      onClick={() => toggleOverlay('voronoi')}
                    >
                      Voronoi
                    </button>
                    <button
                      type="button"
                      className={`${styles.overlayBtn} ${overlays.kde ? styles.overlayBtnActive : ''}`}
                      onClick={() => toggleOverlay('kde')}
                    >
                      KDE
                    </button>
                    <select
                      className={styles.overlaySelect}
                      value={overlays.kdeBreakdown}
                      onChange={e => setKdeBreakdown(e.target.value as KdeBreakdown)}
                      disabled={!overlays.kde}
                      aria-label="KDE breakdown"
                    >
                      {Object.entries(KDE_BREAKDOWN_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  className={`${styles.overlayBtn} ${overlays.labels ? styles.overlayBtnActive : ''}`}
                  onClick={() => toggleOverlay('labels')}
                >
                  Labels
                </button>
                <div className={styles.overlayDepthGroup} aria-label="Label depths">
                  <button
                    type="button"
                    className={`${styles.overlayBtn} ${overlays.labelCorpus ? styles.overlayBtnActive : ''}`}
                    onClick={toggleCorpusLabels}
                    disabled={!overlays.labels}
                  >
                    corpus
                  </button>
                  {labelDepths.map(depth => (
                      <button
                        key={depth}
                        type="button"
                        className={`${styles.overlayBtn} ${overlays.labelDepths.includes(depth) ? styles.overlayBtnActive : ''}`}
                        onClick={() => toggleLabelDepth(depth)}
                        disabled={!overlays.labels}
                      >
                        d{depth}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  className={`${styles.overlayBtn} ${overlays.hidePoints ? styles.overlayBtnActive : ''}`}
                  onClick={() => toggleOverlay('hidePoints')}
                >
                  Hide points
                </button>
              </div>
              <MapCanvas
                key={`${method}-${viewMode}`}
                data={resolvedData}
                visibility={resolvedVisibility}
                colorMap={colorMap}
                corpusLabelMap={corpusLabelMap}
                overlays={overlays}
                viewMode={viewMode}
                fitToBoundsToken={fitToBoundsToken}
                enablePlanarDerivedOverlays={viewMode === '2d'}
                onHover={setHover}
                onClick={handleMapClick}
                resultPositions={visibleResultPositions}
                selectedUnitIds={rightPanelTab === 'tools' ? compareSelectionSet : null}
                selectedPositions={rightPanelTab === 'tools' ? compareSelectionPositions : null}
                selectedHoverPosition={rightPanelTab === 'tools' ? compareHoverPosition : null}
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
        <div className={styles.rightPanelTabs} role="tablist" aria-label="Map side panel">
          <button
            type="button"
            className={`${styles.rightPanelTab} ${rightPanelTab === 'search' ? styles.rightPanelTabActive : ''}`}
            role="tab"
            aria-selected={rightPanelTab === 'search'}
            onClick={() => setRightPanelTab('search')}
          >
            Search
          </button>
          <button
            type="button"
            className={`${styles.rightPanelTab} ${rightPanelTab === 'tools' ? styles.rightPanelTabActive : ''}`}
            role="tab"
            aria-selected={rightPanelTab === 'tools'}
            onClick={() => setRightPanelTab('tools')}
          >
            Tools
          </button>
        </div>

        <div className={styles.rightPanelBody}>
          <section
            className={styles.rightPanelPane}
            aria-hidden={rightPanelTab !== 'search'}
            hidden={rightPanelTab !== 'search'}
          >
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
          </section>

          <section
            className={styles.rightPanelPane}
            aria-hidden={rightPanelTab !== 'tools'}
            hidden={rightPanelTab !== 'tools'}
          >
            <MapToolsPanel
              selectedUnitIds={compareSelectionIds}
              selectedUnitLabels={selectedUnitLabels}
              selectedUnitLabelColors={selectedUnitLabelColors}
              referenceUnitId={compareReferenceId}
              isComparing={isComparing}
              compareError={compareError}
              compareResult={compareResult}
              onClearSelection={handleClearSelection}
              onReferenceChange={handleReferenceChange}
              onZoomToSelection={handleZoomToSelection}
              onSelectionHover={setCompareHoverUnitId}
              onRemoveSelection={handleRemoveSelection}
            />
          </section>
        </div>
        </aside>
      </div>
    </>
  );
}
