/**
 * projectionLoader.ts
 *
 * Fetches and parses the static binary files produced by scripts/dimreduction/.
 *
 * Binary format (columnar, little-endian) — shared across all methods:
 *   height_0.bin:
 *     [N:uint32] [unitIds:i32×N]
 *     [comp_0:f32×N] … [comp_{K-1}:f32×N]   ← K from manifest.n_components
 *     [corpusIds:i32×N] [corpusSeqs:i32×N]
 *     [ancestor_h1:i32×N] … [ancestor_hH:i32×N]
 *
 *   height_N.bin (N > 0):
 *     [N:uint32] [unitIds:i32×N]
 *     [comp_0:f32×N] … [comp_{K-1}:f32×N]
 *     [corpusIds:i32×N]
 *
 *   depth_D.bin (all depths, no ancestor columns):
 *     [N:uint32] [unitIds:i32×N]
 *     [comp_0:f32×N] … [comp_{K-1}:f32×N]
 *     [corpusIds:i32×N]
 *
 * Standard methods (UMAP, PHATE, Isomap): K=2 → comp_0=x, comp_1=y.
 * PCA: K=n_components (all retained PCs). Frontend picks any two to display.
 *
 * Depth bins group units by distance-from-root so cross-corpus siblings
 * at the same depth (e.g. Bible books and Raga top-level units) can be
 * toggled together, unlike height bins which group by distance-from-leaf.
 */

const BASE_URL = '/static/dimreduction';

// ── Method type ───────────────────────────────────────────────────────────────

export type ProjectionMethod = 'umap' | 'pca' | 'phate' | 'isomap';

export const PROJECTION_METHODS: ProjectionMethod[] = ['umap', 'pca', 'phate', 'isomap'];

export const METHOD_LABELS: Record<ProjectionMethod, string> = {
  umap:   'UMAP',
  pca:    'PCA',
  phate:  'PHATE',
  isomap: 'Isomap',
};

// ── Manifest types ────────────────────────────────────────────────────────────

interface BaseManifest {
  run_id:           string;
  created_at:       string;
  label:            string | null;
  method:           ProjectionMethod;
  embedding_method: string;
  max_height:       number;
  heights:          number[];
  point_counts:     Record<string, number>;
  /** Number of component columns stored per unit. 2 for standard methods; K for PCA. */
  n_components:     number;
  /** Depth = distance from corpus root. depth_D.bin groups units at this depth. */
  max_depth:        number;
  depths:           number[];
  depth_counts:     Record<string, number>;
}

export interface UmapManifest extends BaseManifest {
  method:      'umap';
  n_neighbors: number;
  min_dist:    number;
  metric:      string;
  sampled:     boolean;
}

export interface PcaManifest extends BaseManifest {
  method:                   'pca';
  variance_threshold:       number;
  explained_variance_ratio: number[];
  cumulative_variance:      number[];
}

export interface PhateManifest extends BaseManifest {
  method:  'phate';
  knn:     number;
  decay:   number;
  sampled: boolean;
}

export interface IsomapManifest extends BaseManifest {
  method:      'isomap';
  n_neighbors: number;
  sampled:     boolean;
}

export type ProjectionManifest =
  | UmapManifest
  | PcaManifest
  | PhateManifest
  | IsomapManifest;

// ── Layer data types ──────────────────────────────────────────────────────────

/**
 * Standard 2D leaf layer (UMAP / PHATE / Isomap).
 * positions is interleaved [x0,y0,x1,y1,…] ready for deck.gl.
 */
export interface LeafLayerData {
  height: 0;
  count: number;
  unitIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
  corpusSeqs: Int32Array;
  /**
   * ancestors[i] = unit IDs at height (i+1).
   * e.g. ancestors[0] = chapter IDs, ancestors[1] = book IDs.
   */
  ancestors: Int32Array[];
}

/** Standard 2D parent layer (UMAP / PHATE / Isomap). */
export interface ParentLayerData {
  height: number;
  count: number;
  unitIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
}

export type HeightLayerData = LeafLayerData | ParentLayerData;

/**
 * PCA leaf layer — stores all K component arrays.
 * Call buildPcaPositions() to get a positions Float32Array for any PC pair.
 */
export interface PcaLeafLayerData {
  height: 0;
  count: number;
  unitIds: Int32Array;
  /** components[k] = Float32Array of N values for the k-th PC (0-indexed). */
  components: Float32Array[];
  corpusIds: Int32Array;
  corpusSeqs: Int32Array;
  ancestors: Int32Array[];
}

export interface PcaParentLayerData {
  height: number;
  count: number;
  unitIds: Int32Array;
  components: Float32Array[];
  corpusIds: Int32Array;
}

export type PcaHeightLayerData = PcaLeafLayerData | PcaParentLayerData;

/**
 * Depth layer — units grouped by depth (distance from corpus root).
 * Same format for all depths; no ancestor columns.
 * Standard methods: positions interleaved [x0,y0,x1,y1,…].
 */
export interface DepthLayerData {
  depth: number;
  count: number;
  unitIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
}

/** PCA depth layer — raw components, pick any two for positions. */
export interface PcaDepthLayerData {
  depth: number;
  count: number;
  unitIds: Int32Array;
  components: Float32Array[];
  corpusIds: Int32Array;
}

// ── Run data types ────────────────────────────────────────────────────────────

export interface StandardRunData {
  manifest: UmapManifest | PhateManifest | IsomapManifest;
  layers: Map<number, HeightLayerData>;
  depthLayers: Map<number, DepthLayerData>;
  unitLabels: Record<string, string>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface PcaRunData {
  manifest: PcaManifest;
  layers: Map<number, PcaHeightLayerData>;
  depthLayers: Map<number, PcaDepthLayerData>;
  unitLabels: Record<string, string>;
}

export type ProjectionRunData = StandardRunData | PcaRunData;

export function isPcaRunData(d: ProjectionRunData): d is PcaRunData {
  return d.manifest.method === 'pca';
}

// ── PCA utilities ─────────────────────────────────────────────────────────────

/**
 * Build an interleaved positions Float32Array from two PC indices (0-indexed).
 * Used by Map.tsx when the user changes the X/Y PC axis selectors.
 */
type PcaProjectionLayerData = PcaHeightLayerData | PcaDepthLayerData;

function buildInterleavedPositions(
  xArr: Float32Array,
  yArr: Float32Array,
  count: number,
): Float32Array {
  const positions = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    positions[i * 2]     = xArr[i];
    positions[i * 2 + 1] = yArr[i];
  }
  return positions;
}

export function buildPcaPositions(
  layer: PcaProjectionLayerData,
  xPc: number,
  yPc: number,
): Float32Array {
  const xArr = layer.components[xPc];
  const yArr = layer.components[yPc];
  return buildInterleavedPositions(xArr, yArr, layer.count);
}

/**
 * Resolve PcaRunData + PC selection into a StandardRunData-compatible shape
 * (with positions built from the selected PC pair) so the canvas/layers
 * don't need to know about PCA.
 */
export function resolvePcaData(
  raw: PcaRunData,
  xPc: number,
  yPc: number,
): StandardRunData {
  const layers = new Map<number, HeightLayerData>();

  for (const [height, pcaLayer] of raw.layers) {
    const positions = buildPcaPositions(pcaLayer, xPc, yPc);

    if (height === 0) {
      const leaf = pcaLayer as PcaLeafLayerData;
      layers.set(height, {
        height: 0,
        count: leaf.count,
        unitIds: leaf.unitIds,
        positions,
        corpusIds: leaf.corpusIds,
        corpusSeqs: leaf.corpusSeqs,
        ancestors: leaf.ancestors,
      });
    } else {
      layers.set(height, {
        height,
        count: pcaLayer.count,
        unitIds: pcaLayer.unitIds,
        positions,
        corpusIds: pcaLayer.corpusIds,
      });
    }
  }

  const depthLayers = new Map<number, DepthLayerData>();
  for (const [depth, pcaDepthLayer] of raw.depthLayers) {
    depthLayers.set(depth, {
      depth,
      count: pcaDepthLayer.count,
      unitIds: pcaDepthLayer.unitIds,
      positions: buildPcaPositions(pcaDepthLayer, xPc, yPc),
      corpusIds: pcaDepthLayer.corpusIds,
    });
  }

  return {
    manifest: raw.manifest as unknown as UmapManifest,  // shape-compatible for LayerPanel
    layers,
    depthLayers,
    unitLabels: raw.unitLabels,
    bounds: computeBounds(layers),
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export async function fetchLatestRunId(method: ProjectionMethod): Promise<string> {
  const res = await fetch(`${BASE_URL}/${method}/latest.json`);
  if (!res.ok) throw new Error(`Failed to load ${method}/latest.json (${res.status})`);
  const { run_id } = await res.json();
  return run_id as string;
}

export async function fetchManifest(
  runId: string,
  method: ProjectionMethod,
): Promise<ProjectionManifest> {
  const res = await fetch(`${BASE_URL}/${runId}/${method}/manifest.json`);
  if (!res.ok) throw new Error(`Failed to load ${method} manifest (${res.status})`);
  return res.json() as Promise<ProjectionManifest>;
}

export async function fetchUnitLabels(
  runId: string,
  method: ProjectionMethod,
): Promise<Record<string, string>> {
  const res = await fetch(`${BASE_URL}/${runId}/${method}/unit_labels.json`);
  if (!res.ok) throw new Error(`Failed to load ${method} unit_labels (${res.status})`);
  return res.json() as Promise<Record<string, string>>;
}

export async function fetchHeightBin(
  runId: string,
  method: ProjectionMethod,
  height: number,
  manifest: ProjectionManifest,
): Promise<HeightLayerData | PcaHeightLayerData> {
  const res = await fetch(`${BASE_URL}/${runId}/${method}/height_${height}.bin`);
  if (!res.ok) throw new Error(`Failed to load ${method}/height_${height}.bin (${res.status})`);
  const buffer = await res.arrayBuffer();
  return parseHeightBin(buffer, height, manifest);
}

export async function fetchDepthBin(
  runId: string,
  method: ProjectionMethod,
  depth: number,
  manifest: ProjectionManifest,
): Promise<DepthLayerData | PcaDepthLayerData> {
  const res = await fetch(`${BASE_URL}/${runId}/${method}/depth_${depth}.bin`);
  if (!res.ok) throw new Error(`Failed to load ${method}/depth_${depth}.bin (${res.status})`);
  const buffer = await res.arrayBuffer();
  return parseDepthBin(buffer, depth, manifest);
}

// ── Binary parser ─────────────────────────────────────────────────────────────

function createBinaryReader(buffer: ArrayBuffer) {
  let byteOffset = 0;

  return {
    readU32(): number {
      const value = new DataView(buffer).getUint32(byteOffset, true);
      byteOffset += 4;
      return value;
    },
    readI32(n: number): Int32Array {
      const arr = new Int32Array(buffer, byteOffset, n);
      byteOffset += n * 4;
      return arr;
    },
    readF32(n: number): Float32Array {
      const arr = new Float32Array(buffer, byteOffset, n);
      byteOffset += n * 4;
      return arr;
    },
  };
}

function parseHeightBin(
  buffer: ArrayBuffer,
  height: number,
  manifest: ProjectionManifest,
): HeightLayerData | PcaHeightLayerData {
  const reader = createBinaryReader(buffer);
  const N = reader.readU32();
  const K = manifest.n_components;
  const isPca = manifest.method === 'pca';

  const unitIds = reader.readI32(N);

  // Read K component columns
  const compCols: Float32Array[] = [];
  for (let k = 0; k < K; k++) {
    compCols.push(reader.readF32(N));
  }

  const corpusIds = reader.readI32(N);

  if (isPca) {
    // PCA path: return raw components without interleaving
    if (height === 0) {
      const corpusSeqs = reader.readI32(N);
      const ancestors: Int32Array[] = [];
      for (let h = 1; h <= manifest.max_height; h++) {
        ancestors.push(reader.readI32(N));
      }
      return {
        height: 0, count: N, unitIds,
        components: compCols, corpusIds, corpusSeqs, ancestors,
      } as PcaLeafLayerData;
    }
    return {
      height, count: N, unitIds,
      components: compCols, corpusIds,
    } as PcaParentLayerData;
  }

  // Standard path: interleave comp_0 and comp_1 as positions
  const x = compCols[0];
  const y = compCols[1];
  const positions = buildInterleavedPositions(x, y, N);

  if (height === 0) {
    const corpusSeqs = reader.readI32(N);
    const ancestors: Int32Array[] = [];
    for (let h = 1; h <= manifest.max_height; h++) {
      ancestors.push(reader.readI32(N));
    }
    return {
      height: 0, count: N, unitIds,
      positions, corpusIds, corpusSeqs, ancestors,
    } as LeafLayerData;
  }

  return { height, count: N, unitIds, positions, corpusIds } as ParentLayerData;
}

/**
 * Parse a depth_D.bin buffer.
 * Format: [N][unitIds][comp_0]…[comp_K-1][corpusIds]
 * No ancestor columns — simpler than height bins.
 */
function parseDepthBin(
  buffer: ArrayBuffer,
  depth: number,
  manifest: ProjectionManifest,
): DepthLayerData | PcaDepthLayerData {
  const reader = createBinaryReader(buffer);
  const N = reader.readU32();
  const K = manifest.n_components;
  const isPca = manifest.method === 'pca';

  const unitIds = reader.readI32(N);
  const compCols: Float32Array[] = [];
  for (let k = 0; k < K; k++) compCols.push(reader.readF32(N));
  const corpusIds = reader.readI32(N);

  if (isPca) {
    return { depth, count: N, unitIds, components: compCols, corpusIds } as PcaDepthLayerData;
  }

  const x = compCols[0];
  const y = compCols[1];
  const positions = buildInterleavedPositions(x, y, N);
  return { depth, count: N, unitIds, positions, corpusIds } as DepthLayerData;
}

// ── Bounds ────────────────────────────────────────────────────────────────────

export function computeBounds(
  layers: Map<number, HeightLayerData>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const leaf = layers.get(0);
  if (!leaf) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };

  const pos = leaf.positions;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 2) {
    const px = pos[i], py = pos[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { minX, maxX, minY, maxY };
}
