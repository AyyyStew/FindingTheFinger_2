import { useCallback, useEffect, useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { OrthographicView } from '@deck.gl/core';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { StandardRunData } from '../../utils/projectionLoader';
import {
  buildAllLayers,
  buildHighlightLayer,
  buildConstellationLayer,
  type MapVisibility,
  type CorpusColorMap,
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

interface DeckViewState {
  target: [number, number, number];
  zoom: number;
  transitionDuration?: number;
}

interface MapCanvasProps {
  data: StandardRunData;
  visibility: MapVisibility;
  colorMap: CorpusColorMap;
  onHover: (info: HoverInfo | null) => void;
  onClick?: (info: HoverInfo) => void;
  /** Positions (up to 10) of search result units. Index 0 = hub/anchor. */
  resultPositions?: [number, number][] | null;
  /** Selected comparison unit IDs shown in tools mode. */
  selectedUnitIds?: Set<number> | null;
  /** Selected comparison positions rendered above the scatterplot. */
  selectedPositions?: [number, number][] | null;
  /** Selected comparison position currently hovered in the tools table. */
  selectedHoverPosition?: [number, number] | null;
  /** When set, shows a pulsing highlight ring at this map position (result card hover). */
  highlightPos?: [number, number] | null;
  /** When this changes reference, the map animates to the target position. */
  flyTo?: FlyToTarget | null;
}

function computeInitialViewState(bounds: StandardRunData['bounds']): DeckViewState {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const maxRange = Math.max(rangeX, rangeY, 0.1);
  const viewportSize = Math.min(window.innerWidth, window.innerHeight) * 0.8;
  const zoom = Math.log2(viewportSize / maxRange);
  return { target: [cx, cy, 0], zoom };
}

export function MapCanvas({
  data,
  visibility,
  colorMap,
  onHover,
  onClick,
  resultPositions,
  selectedUnitIds,
  selectedPositions,
  selectedHoverPosition,
  highlightPos,
  flyTo,
}: MapCanvasProps) {
  const [viewState, setViewState] = useState<DeckViewState>(
    () => computeInitialViewState(data.bounds),
  );

  const [selectedHoverFillAlpha, setSelectedHoverFillAlpha] = useState(0);

  // Refit when the dataset (projection) changes.
  useEffect(() => {
    setViewState(computeInitialViewState(data.bounds));
  }, [data]);

  // Pan (and optionally zoom) when flyTo changes.
  useEffect(() => {
    if (!flyTo) return;
    setViewState(prev => ({
      ...prev,
      target: flyTo.target,
      ...(flyTo.zoom != null ? { zoom: flyTo.zoom } : {}),
      transitionDuration: 250,
    }));
  }, [flyTo]);

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
      setViewState(rest as DeckViewState);
    },
    [],
  );

  // ── Layers ─────────────────────────────────────────────────────────────────

  const layers = useMemo(() => {
    const base = buildAllLayers(data, visibility, colorMap, selectedUnitIds);
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
    return [...base, ...extras];
  }, [
    data,
    visibility,
    colorMap,
    selectedUnitIds,
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
        views={new OrthographicView({ id: 'map', flipY: false })}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller
        layers={layers}
        onHover={handleHover}
        onClick={handleClick}
        getCursor={({ isDragging }: { isDragging: boolean }) => (isDragging ? 'grabbing' : 'crosshair')}
      />
    </div>
  );
}
