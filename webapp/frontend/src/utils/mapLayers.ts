/**
 * mapLayers.ts
 *
 * Builds deck.gl layer arrays from loaded UMAP data.
 * Structured for extension: cloud, voronoi, and label layer builders
 * follow the same pattern and slot into buildAllLayers().
 */

import { Delaunay } from 'd3-delaunay';
import { ScatterplotLayer, LineLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { CorpusInfo } from '../api/types';
import { getTaxonomyColor } from './taxonomyColors';
import type { DepthLayerData, HeightLayerData, StandardRunData } from './projectionLoader';

// ── Visibility state ──────────────────────────────────────────────────────────
//
// Designed to extend: add 'cloud', 'voronoi', 'labels' keys without breaking callers.

export interface MapVisibility {
  /** Whether scatter points are grouped by height-from-leaf or depth-from-root. */
  scatterMode: 'height' | 'depth';
  /** height → visible. Leaves (h=0) on by default. */
  scatter: Record<number, boolean>;
  /** depth → visible. All depths on by default. */
  scatterDepth: Record<number, boolean>;
  /** corpus_id → visible. Absent key means visible. Empty object = all visible. */
  corpora: Record<number, boolean>;
}

export type KdeBreakdown = 'overall' | 'corpus' | 'level';

export interface MapOverlayOptions {
  voronoi: boolean;
  kde: boolean;
  labels: boolean;
  hidePoints: boolean;
  kdeBreakdown: KdeBreakdown;
  labelCorpus: boolean;
  labelDepths: number[];
}

export const DEFAULT_OVERLAY_OPTIONS: MapOverlayOptions = {
  voronoi: false,
  kde: false,
  labels: false,
  hidePoints: false,
  kdeBreakdown: 'overall',
  labelCorpus: true,
  labelDepths: [],
};

export function defaultVisibility(heights: number[], depths: number[]): MapVisibility {
  const scatter: Record<number, boolean> = {};
  for (const h of heights) scatter[h] = h === 0; // leaves on by default
  const scatterDepth: Record<number, boolean> = {};
  for (const d of depths) scatterDepth[d] = true; // all depths on by default
  return { scatterMode: 'depth', scatter, scatterDepth, corpora: {} };
}

// ── Color map ─────────────────────────────────────────────────────────────────

/** Maps corpus_id → RGBA tuple [0-255]. */
export type CorpusColorMap = Map<number, [number, number, number]>;
export type CorpusLabelMap = Map<number, string>;

export function buildCorpusColorMap(corpora: CorpusInfo[]): CorpusColorMap {
  const map: CorpusColorMap = new Map();
  for (const corpus of corpora) {
    const { solid } = getTaxonomyColor(corpus.taxonomy);
    map.set(corpus.id, hslStringToRgb(solid));
  }
  return map;
}

export function buildCorpusLabelMap(corpora: CorpusInfo[]): CorpusLabelMap {
  const map: CorpusLabelMap = new Map();
  for (const corpus of corpora) {
    map.set(corpus.id, corpus.name);
  }
  return map;
}

function hslStringToRgb(hsl: string): [number, number, number] {
  // Parses "hsl(H, S%, L%)" from taxonomyColors.ts
  const m = hsl.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
  if (!m) return [140, 140, 140];
  const h = parseFloat(m[1]);
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  return hslToRgb255(h, s, l);
}

function hslToRgb255(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ── Color array builder ───────────────────────────────────────────────────────

function buildPointStyleArrays(
  layer: { count: number; corpusIds: Int32Array },
  colorMap: CorpusColorMap,
  alpha: number,
  hiddenCorpora: Set<number>,
  selectedUnitIds: Set<number> | null,
  unitIds: Int32Array,
): { fillColors: Uint8Array; lineColors: Uint8Array } {
  const fillColors = new Uint8Array(layer.count * 4);
  const lineColors = new Uint8Array(layer.count * 4);
  const fallback: [number, number, number] = [110, 110, 110];
  for (let i = 0; i < layer.count; i++) {
    const corpusId = layer.corpusIds[i];
    const selected = selectedUnitIds?.has(unitIds[i]) ?? false;
    const [r, g, b] = colorMap.get(corpusId) ?? fallback;
    fillColors[i * 4]     = selected ? 201 : r;
    fillColors[i * 4 + 1] = selected ? 169 : g;
    fillColors[i * 4 + 2] = selected ? 110 : b;
    fillColors[i * 4 + 3] = hiddenCorpora.has(corpusId) ? 0 : (selected ? 235 : alpha);
    lineColors[i * 4]     = selected ? 255 : r;
    lineColors[i * 4 + 1] = selected ? 243 : g;
    lineColors[i * 4 + 2] = selected ? 209 : b;
    lineColors[i * 4 + 3] = hiddenCorpora.has(corpusId) ? 0 : (selected ? 235 : 0);
  }
  return { fillColors, lineColors };
}

// ── Scatter layer builder ─────────────────────────────────────────────────────

const MIN_POINT_RADIUS_PX = 5;
const HIGHLIGHT_RADIUS_PX = 6;

/**
 * One ScatterplotLayer per visible height level.
 * Higher heights get larger radii so they remain visible behind leaves.
 */
export function buildScatterLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
  selectedUnitIds: Set<number> | null = null,
): Layer[] {
  const hiddenCorpora = new Set(
    Object.entries(visibility.corpora)
      .filter(([, v]) => !v)
      .map(([k]) => Number(k)),
  );
  return data.manifest.heights
    .filter(h => visibility.scatter[h] !== false)
    .map(h => {
      const layer = data.layers.get(h)!;
      // Leaves: small + semi-transparent so density is visible.
      // Parents: larger, more opaque — rendered on top via layer order.
      const alpha  = h === 0 ? 180 : 230;
      const radius = h === 0 ? 3   : 4 + h * 3;
      const { fillColors, lineColors } = buildPointStyleArrays(
        layer,
        colorMap,
        alpha,
        hiddenCorpora,
        selectedUnitIds,
        layer.unitIds,
      );

      return new ScatterplotLayer({
        id: `scatter-h${h}`,
        // deck.gl v8 binary attribute API: typed arrays go in data.attributes
        data: {
          length: layer.count,
          attributes: {
            getPosition: { value: layer.positions, size: 2 },
            getFillColor: { value: fillColors, size: 4 },
            getLineColor: { value: lineColors, size: 4 },
          },
        },
        getRadius: radius,
        radiusUnits: 'pixels',
        radiusMinPixels: MIN_POINT_RADIUS_PX,
        billboard: true,
        pickable: true,
        stroked: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        parameters: { depthTest: false },
        updateTriggers: { getFillColor: [colorMap.size, alpha, visibility.corpora, selectedUnitIds?.size ?? 0] },
      });
    });
}

// ── Depth scatter layer builder ───────────────────────────────────────────────

/**
 * One ScatterplotLayer per visible depth level.
 * Shallower depths (closer to root) get larger radii — they represent
 * more-aggregated units, mirroring the height-based size logic.
 */
export function buildDepthScatterLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
  selectedUnitIds: Set<number> | null = null,
): Layer[] {
  const hiddenCorpora = new Set(
    Object.entries(visibility.corpora)
      .filter(([, v]) => !v)
      .map(([k]) => Number(k)),
  );

  const maxDepth = data.manifest.max_depth;
  return data.manifest.depths
    .filter(d => visibility.scatterDepth[d] !== false)
    .map(d => {
      const layer = data.depthLayers.get(d) as DepthLayerData;
      if (!layer) return null;
      // Deepest depth = leaves: small + semi-transparent.
      // Shallower depths = parents: larger, more opaque.
      const distFromLeaf = maxDepth - d;
      const alpha  = distFromLeaf === 0 ? 180 : 230;
      const radius = distFromLeaf === 0 ? 3   : 4 + distFromLeaf * 3;
      const { fillColors, lineColors } = buildPointStyleArrays(
        layer,
        colorMap,
        alpha,
        hiddenCorpora,
        selectedUnitIds,
        layer.unitIds,
      );

      return new ScatterplotLayer({
        id: `scatter-d${d}`,
        data: {
          length: layer.count,
          attributes: {
            getPosition: { value: layer.positions, size: 2 },
            getFillColor: { value: fillColors, size: 4 },
            getLineColor: { value: lineColors, size: 4 },
          },
        },
        getRadius: radius,
        radiusUnits: 'pixels',
        radiusMinPixels: MIN_POINT_RADIUS_PX,
        billboard: true,
        pickable: true,
        stroked: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        parameters: { depthTest: false },
        updateTriggers: { getFillColor: [colorMap.size, alpha, visibility.corpora, selectedUnitIds?.size ?? 0] },
      });
    })
    .filter((l): l is ScatterplotLayer => l !== null);
}

// ── Highlight + constellation layers (search results) ────────────────────────

/**
 * Subtle gold cue for search result hover / focus.
 */
export function buildHighlightLayer(
  positions: [number, number][],
  id = 'search-highlight',
  radiusMinPixels = HIGHLIGHT_RADIUS_PX,
  fillAlpha = 175,
): Layer | null {
  if (positions.length === 0) return null;
  const count = positions.length;
  const posArr = new Float32Array(count * 2);
  const fillColors = new Uint8Array(count * 4);
  const lineColors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    posArr[i * 2]     = positions[i][0];
    posArr[i * 2 + 1] = positions[i][1];
    // Dark fill with a gold outline keeps selected points visible on dense scatter.
    fillColors[i * 4]     = 0;
    fillColors[i * 4 + 1] = 0;
    fillColors[i * 4 + 2] = 0;
    fillColors[i * 4 + 3] = fillAlpha;
    lineColors[i * 4]     = 201;
    lineColors[i * 4 + 1] = 169;
    lineColors[i * 4 + 2] = 110;
    lineColors[i * 4 + 3] = 255;
  }
  return new ScatterplotLayer({
    id,
    data: {
      length: count,
      attributes: {
        getPosition: { value: posArr, size: 2 },
        getFillColor: { value: fillColors, size: 4 },
        getLineColor: { value: lineColors, size: 4 },
      },
    },
    getRadius: 4.5,
    radiusUnits: 'pixels',
    radiusMinPixels,
    billboard: true,
    pickable: false,
    stroked: true,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    parameters: { depthTest: false },
  });
}

/**
 * Lines from positions[0] (hub/anchor) to every other position.
 * For passage search: hub = the queried passage.
 * For semantic/keyword: hub = the top result.
 */
export function buildConstellationLayer(positions: [number, number][]): Layer | null {
  if (positions.length < 2) return null;
  const [hub, ...spokes] = positions;
  const lines = spokes.map(pos => ({ from: hub, to: pos }));
  return new LineLayer({
    id: 'search-constellation',
    data: lines,
    getSourcePosition: (d: { from: [number, number] }) => d.from,
    getTargetPosition: (d: { to: [number, number] }) => d.to,
    getColor: [201, 169, 110, 255],
    getWidth: 1.5,
    widthUnits: 'pixels',
    pickable: false,
    parameters: { depthTest: false },
  });
}

// ── Derived map views: Voronoi, KDE, labels ──────────────────────────────────

interface VisiblePointLayer {
  id: string;
  level: number;
  label: string;
  count: number;
  unitIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
}

interface CellDatum {
  polygon: [number, number][];
  color: [number, number, number, number];
  lineColor: [number, number, number, number];
}

interface KdeSegmentDatum {
  from: [number, number];
  to: [number, number];
  color: [number, number, number, number];
  width: number;
}

interface LabelDatum {
  position: [number, number];
  text: string;
  color: [number, number, number, number];
}

function hiddenCorpusSet(visibility: MapVisibility): Set<number> {
  return new Set(
    Object.entries(visibility.corpora)
      .filter(([, v]) => !v)
      .map(([k]) => Number(k)),
  );
}

function visiblePointLayers(data: StandardRunData, visibility: MapVisibility): VisiblePointLayer[] {
  if (visibility.scatterMode === 'height') {
    return data.manifest.heights
      .filter(h => visibility.scatter[h] !== false)
      .map(h => {
        const layer = data.layers.get(h) as HeightLayerData | undefined;
        return layer
          ? {
              id: `h${h}`,
              level: h,
              label: `height ${h}`,
              count: layer.count,
              unitIds: layer.unitIds,
              positions: layer.positions,
              corpusIds: layer.corpusIds,
            }
          : null;
      })
      .filter((layer): layer is VisiblePointLayer => layer !== null);
  }

  return data.manifest.depths
    .filter(d => visibility.scatterDepth[d] !== false)
    .map(d => {
      const layer = data.depthLayers.get(d) as DepthLayerData | undefined;
      return layer
        ? {
            id: `d${d}`,
            level: d,
            label: `depth ${d}`,
            count: layer.count,
            unitIds: layer.unitIds,
            positions: layer.positions,
            corpusIds: layer.corpusIds,
          }
        : null;
    })
    .filter((layer): layer is VisiblePointLayer => layer !== null);
}

function visibleLayerPoints(layer: VisiblePointLayer, hiddenCorpora: Set<number>) {
  const points: { unitId: number; corpusId: number; position: [number, number] }[] = [];
  for (let i = 0; i < layer.count; i++) {
    const corpusId = layer.corpusIds[i];
    if (hiddenCorpora.has(corpusId)) continue;
    points.push({
      unitId: layer.unitIds[i],
      corpusId,
      position: [layer.positions[i * 2], layer.positions[i * 2 + 1]],
    });
  }
  return points;
}

function boundsBox(data: StandardRunData): [number, number, number, number] {
  const padX = Math.max((data.bounds.maxX - data.bounds.minX) * 0.04, 0.01);
  const padY = Math.max((data.bounds.maxY - data.bounds.minY) * 0.04, 0.01);
  return [
    data.bounds.minX - padX,
    data.bounds.minY - padY,
    data.bounds.maxX + padX,
    data.bounds.maxY + padY,
  ];
}

export function buildVoronoiLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
): Layer[] {
  const hiddenCorpora = hiddenCorpusSet(visibility);
  const bbox = boundsBox(data);
  return visiblePointLayers(data, visibility).map((layer, layerIndex) => {
    const points = visibleLayerPoints(layer, hiddenCorpora);
    if (points.length < 2) return null;
    const delaunay = Delaunay.from(points, p => p.position[0], p => p.position[1]);
    const voronoi = delaunay.voronoi(bbox);
    const levelAlpha = Math.max(18, 52 - layerIndex * 7);
    const lineAlpha = Math.max(70, 150 - layerIndex * 18);
    const cellData: CellDatum[] = [];

    for (let i = 0; i < points.length; i++) {
      const poly = voronoi.cellPolygon(i);
      if (!poly || poly.length < 4) continue;
      const [r, g, b] = colorMap.get(points[i].corpusId) ?? [126, 126, 126];
      cellData.push({
        polygon: poly.slice(0, -1).map(([x, y]) => [x, y]),
        color: [r, g, b, levelAlpha],
        lineColor: [r, g, b, lineAlpha],
      });
    }

    return new SolidPolygonLayer({
      id: `voronoi-${visibility.scatterMode}-${layer.id}`,
      data: cellData,
      getPolygon: (d: CellDatum) => d.polygon,
      getFillColor: (d: CellDatum) => d.color,
      getLineColor: (d: CellDatum) => d.lineColor,
      stroked: true,
      filled: true,
      lineWidthUnits: 'pixels',
      getLineWidth: layerIndex === 0 ? 1.2 : 0.7,
      pickable: false,
      parameters: { depthTest: false },
    });
  }).filter((layer): layer is SolidPolygonLayer => layer !== null);
}

function kdeGroups(
  layers: VisiblePointLayer[],
  hiddenCorpora: Set<number>,
  breakdown: KdeBreakdown,
  colorMap: CorpusColorMap,
) {
  const groups = new Map<string, { color: [number, number, number]; points: [number, number][] }>();
  for (const layer of layers) {
    const points = visibleLayerPoints(layer, hiddenCorpora);
    for (const point of points) {
      const key =
        breakdown === 'corpus' ? `corpus-${point.corpusId}` :
        breakdown === 'level' ? `level-${layer.id}` :
        'overall';
      const fallbackColor: [number, number, number] =
        breakdown === 'overall' ? [118, 166, 160] :
        breakdown === 'level' ? [201, 169, 110] :
        [126, 126, 126];
      const color = breakdown === 'corpus'
        ? colorMap.get(point.corpusId) ?? fallbackColor
        : fallbackColor;
      const existing = groups.get(key);
      if (existing) {
        existing.points.push(point.position);
      } else {
        groups.set(key, { color, points: [point.position] });
      }
    }
  }
  return [...groups.values()].filter(group => group.points.length > 1);
}

export function buildKdeCloudLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
  breakdown: KdeBreakdown,
): Layer[] {
  const layers = visiblePointLayers(data, visibility);
  const hiddenCorpora = hiddenCorpusSet(visibility);
  const [minX, minY, maxX, maxY] = boundsBox(data);
  const width = maxX - minX;
  const height = maxY - minY;
  const grid = 48;
  const cellW = width / grid;
  const cellH = height / grid;
  const bandwidth = Math.max(width, height) / 18;
  const bandwidthSq = bandwidth * bandwidth;
  const radiusSq = bandwidthSq * 9;

  return kdeGroups(layers, hiddenCorpora, breakdown, colorMap).map((group, groupIndex) => {
    const fieldSize = grid + 1;
    const densities = new Float32Array(fieldSize * fieldSize);
    let maxDensity = 0;

    for (let gy = 0; gy <= grid; gy++) {
      const y = minY + gy * cellH;
      for (let gx = 0; gx <= grid; gx++) {
        const x = minX + gx * cellW;
        let density = 0;
        for (const [px, py] of group.points) {
          const dx = x - px;
          const dy = y - py;
          const distSq = dx * dx + dy * dy;
          if (distSq <= radiusSq) density += Math.exp(-distSq / (2 * bandwidthSq));
        }
        densities[gy * fieldSize + gx] = density;
        if (density > maxDensity) maxDensity = density;
      }
    }

    if (maxDensity <= 0) return null;
    const segments: KdeSegmentDatum[] = [];
    const thresholds = [0.18, 0.32, 0.48, 0.66].map(t => t * maxDensity);
    const [r, g, b] = group.color;

    for (const threshold of thresholds) {
      const intensity = threshold / maxDensity;
      const color: [number, number, number, number] = [r, g, b, Math.round(96 + intensity * 130)];
      const lineWidth = 0.7 + intensity * 2;
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const x0 = minX + gx * cellW;
          const y0 = minY + gy * cellH;
          const x1 = x0 + cellW;
          const y1 = y0 + cellH;
          const p0: [number, number] = [x0, y0];
          const p1: [number, number] = [x1, y0];
          const p2: [number, number] = [x1, y1];
          const p3: [number, number] = [x0, y1];
          const v0 = densities[gy * fieldSize + gx];
          const v1 = densities[gy * fieldSize + gx + 1];
          const v2 = densities[(gy + 1) * fieldSize + gx + 1];
          const v3 = densities[(gy + 1) * fieldSize + gx];
          const crossings = contourCellIntersections(
            threshold,
            [[p0, v0], [p1, v1], [p2, v2], [p3, v3]],
          );
          if (crossings.length === 2) {
            segments.push({ from: crossings[0], to: crossings[1], color, width: lineWidth });
          } else if (crossings.length === 4) {
            segments.push({ from: crossings[0], to: crossings[1], color, width: lineWidth });
            segments.push({ from: crossings[2], to: crossings[3], color, width: lineWidth });
          }
        }
      }
    }

    return new LineLayer({
      id: `kde-contours-${breakdown}-${groupIndex}`,
      data: segments,
      getSourcePosition: (d: KdeSegmentDatum) => d.from,
      getTargetPosition: (d: KdeSegmentDatum) => d.to,
      getColor: (d: KdeSegmentDatum) => d.color,
      getWidth: (d: KdeSegmentDatum) => d.width,
      widthUnits: 'pixels',
      pickable: false,
      parameters: { depthTest: false },
    });
  }).filter((layer): layer is LineLayer => layer !== null);
}

function contourCellIntersections(
  threshold: number,
  corners: [[number, number], number][],
): [number, number][] {
  const crossings: [number, number][] = [];
  for (let i = 0; i < corners.length; i++) {
    const [aPos, aValue] = corners[i];
    const [bPos, bValue] = corners[(i + 1) % corners.length];
    const aSide = aValue >= threshold;
    const bSide = bValue >= threshold;
    if (aSide === bSide) continue;
    const denom = bValue - aValue;
    const t = denom === 0 ? 0.5 : (threshold - aValue) / denom;
    crossings.push([
      aPos[0] + (bPos[0] - aPos[0]) * t,
      aPos[1] + (bPos[1] - aPos[1]) * t,
    ]);
  }
  return crossings;
}

export function buildLabelLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
  corpusLabelMap: CorpusLabelMap,
  includeCorpusLabels: boolean,
  depths: number[],
): Layer[] {
  const hiddenCorpora = hiddenCorpusSet(visibility);
  const labels: LabelDatum[] = [];
  if (includeCorpusLabels) {
    const corpusLayer = data.depthLayers.get(0);
    if (corpusLayer) {
      const corpusCentroids = new Map<number, { x: number; y: number; count: number }>();
      for (let i = 0; i < corpusLayer.count; i++) {
        const corpusId = corpusLayer.corpusIds[i];
        if (hiddenCorpora.has(corpusId)) continue;
        const current = corpusCentroids.get(corpusId) ?? { x: 0, y: 0, count: 0 };
        current.x += corpusLayer.positions[i * 2];
        current.y += corpusLayer.positions[i * 2 + 1];
        current.count += 1;
        corpusCentroids.set(corpusId, current);
      }

      for (const [corpusId, centroid] of corpusCentroids) {
        const text = corpusLabelMap.get(corpusId);
        if (!text) continue;
        const [r, g, b] = colorMap.get(corpusId) ?? [210, 210, 210];
        labels.push({
          position: [centroid.x / centroid.count, centroid.y / centroid.count],
          text,
          color: [r, g, b, 245],
        });
      }
    }
  }

  const selectedDepths = [...new Set(depths)]
    .filter(depth => depth >= 0 && depth <= data.manifest.max_depth)
    .sort((a, b) => a - b);
  for (const depth of selectedDepths) {
    const layer = data.depthLayers.get(depth);
    if (!layer) continue;
    for (let i = 0; i < layer.count; i++) {
      const corpusId = layer.corpusIds[i];
      if (hiddenCorpora.has(corpusId)) continue;
      const text = data.unitLabels[String(layer.unitIds[i])];
      if (!text) continue;
      const [r, g, b] = colorMap.get(corpusId) ?? [210, 210, 210];
      labels.push({
        position: [layer.positions[i * 2], layer.positions[i * 2 + 1]],
        text,
        color: [r, g, b, depth === 0 ? 245 : depth === 1 ? 225 : 195],
      });
    }
  }

  if (labels.length === 0) return [];
  return [
    new TextLayer({
      id: `depth-centroid-labels-${includeCorpusLabels ? 'corpus' : 'units'}-${selectedDepths.join('-')}`,
      data: labels,
      getPosition: (d: LabelDatum) => d.position,
      getText: (d: LabelDatum) => d.text,
      getColor: (d: LabelDatum) => d.color,
      getSize: 12,
      getAngle: 0,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      background: true,
      getBackgroundColor: [10, 10, 10, 180],
      backgroundPadding: [4, 2],
      billboard: true,
      pickable: false,
      parameters: { depthTest: false },
    }),
  ];
}

// ── Master builder ────────────────────────────────────────────────────────────

export function buildAllLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
  corpusLabelMap: CorpusLabelMap,
  selectedUnitIds: Set<number> | null = null,
  overlays: MapOverlayOptions = DEFAULT_OVERLAY_OPTIONS,
): Layer[] {
  const scatterLayers = visibility.scatterMode === 'depth'
    ? buildDepthScatterLayers(data, visibility, colorMap, selectedUnitIds)
    : buildScatterLayers(data, visibility, colorMap, selectedUnitIds);
  return [
    ...(overlays.kde ? buildKdeCloudLayers(data, visibility, colorMap, overlays.kdeBreakdown) : []),
    ...(overlays.voronoi ? buildVoronoiLayers(data, visibility, colorMap) : []),
    ...(overlays.hidePoints ? [] : scatterLayers),
    ...(overlays.labels ? buildLabelLayers(
      data,
      visibility,
      colorMap,
      corpusLabelMap,
      overlays.labelCorpus,
      overlays.labelDepths,
    ) : []),
  ];
}
