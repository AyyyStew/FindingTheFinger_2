import { useCallback, useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { OrbitView, OrthographicView } from '@deck.gl/core';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { StandardRunData } from '../../utils/projectionLoader';
import {
  buildAllLayers,
  buildHighlightLayer,
  buildConstellationLayer,
  DEFAULT_OVERLAY_OPTIONS,
  type MapVisibility,
  type MapOverlayOptions,
  type CorpusColorMap,
  type CorpusLabelMap,
} from '../../utils/mapLayers';
import styles from './MapCanvas.module.css';

export interface HoverInfo {
  unitId: number;
  /** Height of the hovered layer (-1 when in depth mode). */
  height: number;
  /** Depth of the hovered layer (-1 when in height mode). */
  depth: number;
  corpusId: number;
  screenX: number;
  screenY: number;
}

export interface FlyToTarget {
  target: [number, number, number];
  /** Omit to keep the current zoom level and only pan. */
  zoom?: number;
}

export type MapViewMode = '2d' | '3d';

interface DeckViewState {
  target: [number, number, number];
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
  transitionDuration?: number;
}

interface MapCanvasProps {
  data: StandardRunData;
  visibility: MapVisibility;
  colorMap: CorpusColorMap;
  corpusLabelMap: CorpusLabelMap;
  onHover: (info: HoverInfo | null) => void;
  onClick?: (info: HoverInfo) => void;
  /** Positions (up to 10) of search result units. Index 0 = hub/anchor. */
  resultPositions?: [number, number, number][] | null;
  /** Selected comparison unit IDs shown in tools mode. */
  selectedUnitIds?: Set<number> | null;
  /** Selected comparison positions rendered above the scatterplot. */
  selectedPositions?: [number, number, number][] | null;
  /** Selected comparison position currently hovered in the tools table. */
  selectedHoverPosition?: [number, number, number] | null;
  /** When set, shows a pulsing highlight ring at this map position (result card hover). */
  highlightPos?: [number, number, number] | null;
  /** When this changes reference, the map animates to the target position. */
  flyTo?: FlyToTarget | null;
  /** Optional derived views drawn against the current visible point layer(s). */
  overlays?: MapOverlayOptions;
  /** 2D (orthographic) or 3D (orbit) map camera mode. */
  viewMode?: MapViewMode;
  /** Increment to trigger a zoom-to-fit reset. */
  fitToBoundsToken?: number;
  /** Whether Voronoi/KDE/labels derived overlays are enabled for this view mode. */
  enableDerivedOverlays?: boolean;
}

function computeInitialViewState(bounds: StandardRunData['bounds'], viewMode: MapViewMode): DeckViewState {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  if (viewMode === '2d') {
    const rangeX = bounds.maxX - bounds.minX;
    const rangeY = bounds.maxY - bounds.minY;
    const maxRange = Math.max(rangeX, rangeY, 0.1);
    const viewportSize = Math.min(window.innerWidth, window.innerHeight) * 0.7;
    const zoom = Math.log2(viewportSize / maxRange);
    return { target: [cx, cy, 0], zoom, rotationX: 0, rotationOrbit: 0 };
  }

  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const rangeZ = bounds.maxZ - bounds.minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ, 0.1);
  const viewportSize = Math.min(window.innerWidth, window.innerHeight) * 0.7;
  const zoom = Math.log2(viewportSize / maxRange);
  return { target: [cx, cy, cz], zoom, rotationX: 35, rotationOrbit: 20 };
}

export function MapCanvas({
  data,
  visibility,
  colorMap,
  corpusLabelMap,
  onHover,
  onClick,
  resultPositions,
  selectedUnitIds,
  selectedPositions,
  selectedHoverPosition,
  highlightPos,
  flyTo,
  overlays = DEFAULT_OVERLAY_OPTIONS,
  viewMode = '2d',
  fitToBoundsToken = 0,
  enableDerivedOverlays = true,
}: MapCanvasProps) {
  const [viewState, setViewState] = useState<DeckViewState>(
    () => computeInitialViewState(data.bounds, viewMode),
  );

  const [selectedHoverFillAlpha, setSelectedHoverFillAlpha] = useState(0);

  // Refit when the dataset (projection) changes.
  useEffect(() => {
    setViewState(computeInitialViewState(data.bounds, viewMode));
  }, [data, viewMode]);

  // Explicit zoom-to-fit trigger from parent controls.
  useEffect(() => {
    setViewState(computeInitialViewState(data.bounds, viewMode));
  }, [fitToBoundsToken, data.bounds, viewMode]);

  // Pan (and optionally zoom) when flyTo changes.
  useEffect(() => {
    if (!flyTo) return;
    const target: [number, number, number] = viewMode === '3d'
      ? flyTo.target
      : [flyTo.target[0], flyTo.target[1], 0];
    setViewState(prev => ({
      ...prev,
      target,
      ...(flyTo.zoom != null ? { zoom: flyTo.zoom } : {}),
      transitionDuration: 250,
    }));
  }, [flyTo, viewMode]);

  useEffect(() => {
    if (!selectedHoverPosition) {
      setSelectedHoverFillAlpha(0);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const phase = ((now - startedAt) / 1950) * Math.PI * 2;
      setSelectedHoverFillAlpha(Math.round((Math.cos(phase) + 1) * 87.5));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [selectedHoverPosition]);

  const handleViewStateChange = useCallback(
    ({ viewState: vs }: { viewState: object }) => {
      const { transitionDuration: _td, ...rest } = vs as DeckViewState & { transitionDuration?: number };
      void _td;
      const next = rest as DeckViewState;
      if (viewMode === '2d') {
        setViewState({ ...next, rotationX: 0, rotationOrbit: 0 });
        return;
      }
      setViewState({
        ...next,
        rotationX: Math.max(10, Math.min(80, next.rotationX ?? 35)),
        rotationOrbit: Math.max(-90, Math.min(90, next.rotationOrbit ?? 20)),
      });
    },
    [viewMode],
  );

  // ── Layers ─────────────────────────────────────────────────────────────────

  const baseLayers = useMemo(() => {
    return buildAllLayers(
      data,
      visibility,
      colorMap,
      corpusLabelMap,
      selectedUnitIds,
      overlays,
      enableDerivedOverlays,
    );
  }, [
    data,
    visibility,
    colorMap,
    corpusLabelMap,
    selectedUnitIds,
    overlays,
    enableDerivedOverlays,
  ]);

  const layers = useMemo(() => {
    const extras: Layer[] = [];
    if (resultPositions && resultPositions.length > 0) {
      const cl = buildConstellationLayer(resultPositions);
      if (cl) extras.push(cl);
    }
    if (selectedPositions && selectedPositions.length > 0) {
      const sl = buildHighlightLayer(selectedPositions, 'selected-comparison-highlight', 9);
      if (sl) extras.push(sl);
    }
    if (selectedHoverPosition) {
      const shl = buildHighlightLayer(
        [selectedHoverPosition],
        'selected-comparison-hover-highlight',
        9,
        selectedHoverFillAlpha,
      );
      if (shl) extras.push(shl);
    }
    if (highlightPos) {
      const hl = buildHighlightLayer([highlightPos]);
      if (hl) extras.push(hl);
    }
    return [...baseLayers, ...extras];
  }, [
    baseLayers,
    selectedPositions,
    selectedHoverPosition,
    selectedHoverFillAlpha,
    resultPositions,
    highlightPos,
  ]);

  // ── Pick handler ───────────────────────────────────────────────────────────

  const resolvePickInfo = useCallback(
    (info: PickingInfo): HoverInfo | null => {
      if (!info.picked || info.index < 0) return null;
      const layerId = info.layer?.id ?? '';
      const heightMatch = layerId.match(/^scatter-h(\d+)$/);
      const depthMatch  = layerId.match(/^scatter-d(\d+)$/);
      if (heightMatch) {
        const height = parseInt(heightMatch[1], 10);
        const layer = data.layers.get(height);
        if (!layer) return null;
        return { unitId: layer.unitIds[info.index], height, depth: -1, corpusId: layer.corpusIds[info.index], screenX: info.x, screenY: info.y };
      } else if (depthMatch) {
        const depth = parseInt(depthMatch[1], 10);
        const layer = data.depthLayers.get(depth);
        if (!layer) return null;
        return { unitId: layer.unitIds[info.index], height: -1, depth, corpusId: layer.corpusIds[info.index], screenX: info.x, screenY: info.y };
      }
      return null;
    },
    [data],
  );

  const handleHover = useCallback(
    (info: PickingInfo) => { onHover(resolvePickInfo(info)); },
    [onHover, resolvePickInfo],
  );

  const handleClick = useCallback(
    (info: PickingInfo) => {
      if (!onClick) return;
      const resolved = resolvePickInfo(info);
      if (resolved) onClick(resolved);
    },
    [onClick, resolvePickInfo],
  );

  return (
    <div className={styles.canvas}>
      <DeckGL
        views={viewMode === '3d'
          ? new OrbitView({ id: 'map' })
          : new OrthographicView({ id: 'map', flipY: false })}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={viewMode === '3d'
          ? { inertia: true, minZoom: -10, maxZoom: 20 }
          : true}
        layers={layers}
        onHover={handleHover}
        onClick={handleClick}
        getCursor={({ isDragging }: { isDragging: boolean }) => (isDragging ? 'grabbing' : 'crosshair')}
      />
    </div>
  );
}
