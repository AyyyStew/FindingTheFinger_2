import { useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { OrthographicView } from '@deck.gl/core';
import type { PickingInfo } from '@deck.gl/core';
import type { StandardRunData } from '../../utils/projectionLoader';
import {
  buildAllLayers,
  type MapVisibility,
  type CorpusColorMap,
} from '../../utils/mapLayers';
import styles from './MapCanvas.module.css';

export interface HoverInfo {
  unitId: number;
  height: number;
  corpusId: number;
  screenX: number;
  screenY: number;
}

interface MapCanvasProps {
  data: StandardRunData;
  visibility: MapVisibility;
  colorMap: CorpusColorMap;
  onHover: (info: HoverInfo | null) => void;
}

function computeInitialViewState(bounds: StandardRunData['bounds']) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const rangeX = bounds.maxX - bounds.minX;
  const rangeY = bounds.maxY - bounds.minY;
  const maxRange = Math.max(rangeX, rangeY, 0.1);
  // Fit to ~80% of the smaller viewport dimension.
  const viewportSize = Math.min(window.innerWidth, window.innerHeight) * 0.8;
  const zoom = Math.log2(viewportSize / maxRange);
  return { target: [cx, cy, 0] as [number, number, number], zoom };
}

export function MapCanvas({ data, visibility, colorMap, onHover }: MapCanvasProps) {
  const initialViewState = useMemo(
    () => computeInitialViewState(data.bounds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // computed once on mount — user may pan/zoom freely after
  );

  const layers = useMemo(
    () => buildAllLayers(data, visibility, colorMap),
    [data, visibility, colorMap],
  );

  const handleHover = useCallback(
    (info: PickingInfo) => {
      if (!info.picked || info.index < 0) {
        onHover(null);
        return;
      }
      // Layer id encodes height: "scatter-h0", "scatter-h1", …
      const heightMatch = info.layer?.id.match(/scatter-h(\d+)/);
      if (!heightMatch) { onHover(null); return; }

      const height = parseInt(heightMatch[1], 10);
      const layer = data.layers.get(height);
      if (!layer) { onHover(null); return; }

      onHover({
        unitId:   layer.unitIds[info.index],
        height,
        corpusId: layer.corpusIds[info.index],
        screenX:  info.x,
        screenY:  info.y,
      });
    },
    [data, onHover],
  );

  return (
    <div className={styles.canvas}>
      <DeckGL
        views={new OrthographicView({ id: 'map', flipY: false })}
        initialViewState={initialViewState}
        controller
        layers={layers}
        onHover={handleHover}
        getCursor={({ isDragging }: { isDragging: boolean }) => (isDragging ? 'grabbing' : 'crosshair')}
      />
    </div>
  );
}
