/**
 * mapLayers.ts
 *
 * Builds deck.gl layer arrays from loaded UMAP data.
 * Structured for extension: cloud, voronoi, and label layer builders
 * follow the same pattern and slot into buildAllLayers().
 */

import { ScatterplotLayer, LineLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { CorpusInfo } from '../api/types';
import { getTaxonomyColor } from './taxonomyColors';
import type { DepthLayerData, StandardRunData } from './projectionLoader';

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

export function buildCorpusColorMap(corpora: CorpusInfo[]): CorpusColorMap {
  const map: CorpusColorMap = new Map();
  for (const corpus of corpora) {
    const { solid } = getTaxonomyColor(corpus.taxonomy);
    map.set(corpus.id, hslStringToRgb(solid));
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

function buildColorArray(
  layer: { count: number; corpusIds: Int32Array },
  colorMap: CorpusColorMap,
  alpha: number,
  hiddenCorpora: Set<number>,
): Uint8Array {
  const arr = new Uint8Array(layer.count * 4);
  const fallback: [number, number, number] = [110, 110, 110];
  for (let i = 0; i < layer.count; i++) {
    const corpusId = layer.corpusIds[i];
    const [r, g, b] = colorMap.get(corpusId) ?? fallback;
    arr[i * 4]     = r;
    arr[i * 4 + 1] = g;
    arr[i * 4 + 2] = b;
    arr[i * 4 + 3] = hiddenCorpora.has(corpusId) ? 0 : alpha;
  }
  return arr;
}

// ── Scatter layer builder ─────────────────────────────────────────────────────

/**
 * One ScatterplotLayer per visible height level.
 * Higher heights get larger radii so they remain visible behind leaves.
 */
export function buildScatterLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
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

      return new ScatterplotLayer({
        id: `scatter-h${h}`,
        // deck.gl v8 binary attribute API: typed arrays go in data.attributes
        data: {
          length: layer.count,
          attributes: {
            getPosition: { value: layer.positions, size: 2 },
            getFillColor: { value: buildColorArray(layer, colorMap, alpha, hiddenCorpora), size: 4 },
          },
        },
        getRadius: radius,
        radiusUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        parameters: { depthTest: false },
        updateTriggers: { getFillColor: [colorMap.size, alpha, visibility.corpora] },
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

      return new ScatterplotLayer({
        id: `scatter-d${d}`,
        data: {
          length: layer.count,
          attributes: {
            getPosition: { value: layer.positions, size: 2 },
            getFillColor: { value: buildColorArray(layer, colorMap, alpha, hiddenCorpora), size: 4 },
          },
        },
        getRadius: radius,
        radiusUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 60],
        parameters: { depthTest: false },
        updateTriggers: { getFillColor: [colorMap.size, alpha, visibility.corpora] },
      });
    })
    .filter((l): l is ScatterplotLayer => l !== null);
}

// ── Highlight + constellation layers (search results) ────────────────────────

/**
 * Bright gold ring for each search result position.
 * Rendered on top of the scatter layers.
 */
export function buildHighlightLayer(positions: [number, number][]): Layer | null {
  if (positions.length === 0) return null;
  const count = positions.length;
  const posArr = new Float32Array(count * 2);
  const fillColors = new Uint8Array(count * 4);
  const lineColors = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    posArr[i * 2]     = positions[i][0];
    posArr[i * 2 + 1] = positions[i][1];
    // Gold fill: #c9a96e
    fillColors[i * 4]     = 201;
    fillColors[i * 4 + 1] = 169;
    fillColors[i * 4 + 2] = 110;
    fillColors[i * 4 + 3] = 230;
    // White outline
    lineColors[i * 4]     = 255;
    lineColors[i * 4 + 1] = 255;
    lineColors[i * 4 + 2] = 255;
    lineColors[i * 4 + 3] = 180;
  }
  return new ScatterplotLayer({
    id: 'search-highlight',
    data: {
      length: count,
      attributes: {
        getPosition: { value: posArr, size: 2 },
        getFillColor: { value: fillColors, size: 4 },
        getLineColor: { value: lineColors, size: 4 },
      },
    },
    getRadius: 7,
    radiusUnits: 'pixels',
    pickable: false,
    stroked: true,
    lineWidthMinPixels: 1.5,
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

// ── Future extension points ───────────────────────────────────────────────────
//
// export function buildCloudLayers(
//   data: UmapRunData,
//   visibility: MapVisibility,
//   colorMap: CorpusColorMap,
// ): Layer[] { ... }
//
// export function buildVoronoiLayers(
//   data: UmapRunData,
//   visibility: MapVisibility,
// ): Layer[] { ... }
//
// export function buildLabelLayers(
//   data: UmapRunData,
//   visibility: MapVisibility,
// ): Layer[] { ... }

// ── Master builder ────────────────────────────────────────────────────────────

export function buildAllLayers(
  data: StandardRunData,
  visibility: MapVisibility,
  colorMap: CorpusColorMap,
): Layer[] {
  const scatterLayers = visibility.scatterMode === 'depth'
    ? buildDepthScatterLayers(data, visibility, colorMap)
    : buildScatterLayers(data, visibility, colorMap);
  return [
    ...scatterLayers,
    // ...buildCloudLayers(data, visibility, colorMap),   // future
    // ...buildVoronoiLayers(data, visibility),           // future
    // ...buildLabelLayers(data, visibility),             // future
  ];
}
