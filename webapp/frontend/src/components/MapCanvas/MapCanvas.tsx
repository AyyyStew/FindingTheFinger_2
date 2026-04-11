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
  /** Height of the hovered layer (-1 when in depth mode). */
  height: number;
  /** Depth of the hovered layer (-1 when in height mode). */
  depth: number;
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

      const layerId = info.layer?.id ?? '';
      const heightMatch = layerId.match(/^scatter-h(\d+)$/);
      const depthMatch  = layerId.match(/^scatter-d(\d+)$/);

      if (heightMatch) {
        const height = parseInt(heightMatch[1], 10);
        const layer = data.layers.get(height);
        if (!layer) { onHover(null); return; }
        onHover({
          unitId:   layer.unitIds[info.index],
          height,
          depth:    -1,
          corpusId: layer.corpusIds[info.index],
          screenX:  info.x,
          screenY:  info.y,
        });
      } else if (depthMatch) {
        const depth = parseInt(depthMatch[1], 10);
        const layer = data.depthLayers.get(depth);
        if (!layer) { onHover(null); return; }
        onHover({
          unitId:   layer.unitIds[info.index],
          height:   -1,
          depth,
          corpusId: layer.corpusIds[info.index],
          screenX:  info.x,
          screenY:  info.y,
        });
      } else {
        onHover(null);
      }
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
