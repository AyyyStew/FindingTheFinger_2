/**
 * projectionLoader.ts
 *
 * Fetches and parses the static binary files produced by scripts/dimreduction/.
 *
 * Binary format (columnar, little-endian) — shared across all methods:
 *   corpus_version_<id>.bin (all units in one corpus version):
 *     [N:uint32] [unitIds:i32×N]
 *     [comp_0:f32×N] … [comp_{K-1}:f32×N]
 *     [corpusIds:i32×N] [corpusVersionIds:i32×N]
 *
 * Standard methods (UMAP, PHATE, Isomap): K>=2; frontend uses xyz when present.
 * PCA: K=n_components (all retained PCs). Frontend picks any three to display.
 *
 * Corpus-version bins group units by corpus_version_id so map visibility can
 * toggle specific versions independently.
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
  /** Hard-cutover bin schema version for corpus_version bins. */
  bin_schema_version: number;
  has_corpus_version_ids: boolean;
  /** Number of component columns stored per unit. 2 for standard methods; K for PCA. */
  n_components:     number;
  max_depth:        number;
  corpus_version_ids: number[];
  corpus_version_counts: Record<string, number>;
  has_span_layer?: boolean;
  span_count?: number;
  embedding_profile?: {
    id: number;
    label: string;
    target_tokens: number;
    overlap_tokens: number;
    min_tokens: number;
    max_tokens: number;
    model_name: string;
  } | null;
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

/**
 * Corpus-version layer — units grouped by corpus_version_id.
 * Same format for all corpus versions; no ancestor columns.
 * Standard methods: positions interleaved [x0,y0,z0,x1,y1,z1,…].
 */
export interface CorpusVersionLayerData {
  corpusVersionId: number;
  count: number;
  unitIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
  corpusVersionIds: Int32Array;
}

export interface SpanLayerData {
  count: number;
  spanIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
  corpusVersionIds: Int32Array;
  startUnitIds: Int32Array;
  endUnitIds: Int32Array;
  primaryUnitIds: Int32Array;
  tokenCounts: Int32Array;
}

/** PCA corpus-version layer — raw components, pick any three for positions. */
export interface PcaCorpusVersionLayerData {
  corpusVersionId: number;
  count: number;
  unitIds: Int32Array;
  components: Float32Array[];
  corpusIds: Int32Array;
  corpusVersionIds: Int32Array;
}

// ── Run data types ────────────────────────────────────────────────────────────

export interface StandardRunData {
  manifest: UmapManifest | PhateManifest | IsomapManifest;
  corpusVersionLayers: Map<number, CorpusVersionLayerData>;
  spanLayer: SpanLayerData | null;
  unitLabels: Record<string, string>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export interface PcaRunData {
  manifest: PcaManifest;
  corpusVersionLayers: Map<number, PcaCorpusVersionLayerData>;
  spanLayer: PcaSpanLayerData | null;
  unitLabels: Record<string, string>;
}

export interface PcaSpanLayerData {
  count: number;
  spanIds: Int32Array;
  components: Float32Array[];
  corpusIds: Int32Array;
  corpusVersionIds: Int32Array;
  startUnitIds: Int32Array;
  endUnitIds: Int32Array;
  primaryUnitIds: Int32Array;
  tokenCounts: Int32Array;
}

export type ProjectionRunData = StandardRunData | PcaRunData;

export function isPcaRunData(d: ProjectionRunData): d is PcaRunData {
  return d.manifest.method === 'pca';
}

// ── PCA utilities ─────────────────────────────────────────────────────────────

/**
 * Build an interleaved positions Float32Array from three PC indices (0-indexed).
 * Used by Map.tsx when the user changes the X/Y/Z PC axis selectors.
 */
type PcaProjectionLayerData = PcaCorpusVersionLayerData | PcaSpanLayerData;

function buildInterleavedPositions3(
  xArr: Float32Array,
  yArr: Float32Array,
  zArr: Float32Array,
  count: number,
): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = xArr[i];
    positions[i * 3 + 1] = yArr[i];
    positions[i * 3 + 2] = zArr[i];
  }
  return positions;
}

export function buildPcaPositions(
  layer: PcaProjectionLayerData,
  xPc: number,
  yPc: number,
  zPc: number,
): Float32Array {
  const xArr = layer.components[xPc];
  const yArr = layer.components[yPc];
  const zArr = layer.components[zPc] ?? new Float32Array(layer.count);
  return buildInterleavedPositions3(xArr, yArr, zArr, layer.count);
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
  zPc: number,
): StandardRunData {
  const corpusVersionLayers = new Map<number, CorpusVersionLayerData>();
  for (const [corpusVersionId, pcaCorpusVersionLayer] of raw.corpusVersionLayers) {
    corpusVersionLayers.set(corpusVersionId, {
      corpusVersionId,
      count: pcaCorpusVersionLayer.count,
      unitIds: pcaCorpusVersionLayer.unitIds,
      positions: buildPcaPositions(pcaCorpusVersionLayer, xPc, yPc, zPc),
      corpusIds: pcaCorpusVersionLayer.corpusIds,
      corpusVersionIds: pcaCorpusVersionLayer.corpusVersionIds,
    });
  }

  return {
    manifest: raw.manifest as unknown as UmapManifest,  // shape-compatible for LayerPanel
    corpusVersionLayers,
    spanLayer: raw.spanLayer
      ? {
          count: raw.spanLayer.count,
          spanIds: raw.spanLayer.spanIds,
          positions: buildPcaPositions(raw.spanLayer, xPc, yPc, zPc),
          corpusIds: raw.spanLayer.corpusIds,
          corpusVersionIds: raw.spanLayer.corpusVersionIds,
          startUnitIds: raw.spanLayer.startUnitIds,
          endUnitIds: raw.spanLayer.endUnitIds,
          primaryUnitIds: raw.spanLayer.primaryUnitIds,
          tokenCounts: raw.spanLayer.tokenCounts,
        }
      : null,
    unitLabels: raw.unitLabels,
    bounds: computeBounds(corpusVersionLayers),
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export async function fetchLatestRunId(method: ProjectionMethod, profileLabel?: string): Promise<string> {
  let res = profileLabel
    ? await fetch(`${BASE_URL}/${method}/${profileLabel}/latest.json`)
    : await fetch(`${BASE_URL}/${method}/latest.json`);
  if (!res.ok && profileLabel === 'window-50') {
    res = await fetch(`${BASE_URL}/${method}/latest.json`);
  }
  if (!res.ok) throw new Error(`Failed to load ${method}/latest.json (${res.status})`);
  const { run_id } = await res.json();
  return run_id as string;
}

export async function fetchManifest(
  runId: string,
  method: ProjectionMethod,
  profileLabel?: string,
): Promise<ProjectionManifest> {
  // New layout: /static/dimreduction/<method>/<run>/...
  // Backward compatibility: /static/dimreduction/<run>/<method>/...
  let res = profileLabel
    ? await fetch(`${BASE_URL}/${method}/${profileLabel}/${runId}/manifest.json`)
    : await fetch(`${BASE_URL}/${method}/${runId}/manifest.json`);
  if (!res.ok) {
    res = await fetch(`${BASE_URL}/${runId}/${method}/manifest.json`);
  }
  if (!res.ok && profileLabel) {
    res = await fetch(`${BASE_URL}/${method}/${runId}/manifest.json`);
  }
  if (!res.ok) throw new Error(`Failed to load ${method} manifest (${res.status})`);
  const manifest = await res.json() as ProjectionManifest;
  if (
    manifest.bin_schema_version < 5 ||
    manifest.has_corpus_version_ids !== true
  ) {
    throw new Error(
      `Unsupported ${method} projection schema for run ${runId}. Regenerate dimreduction artifacts with schema v5 corpus-version bins.`,
    );
  }
  return manifest;
}

export async function fetchUnitLabels(
  runId: string,
  method: ProjectionMethod,
  profileLabel?: string,
): Promise<Record<string, string>> {
  let res = profileLabel
    ? await fetch(`${BASE_URL}/${method}/${profileLabel}/${runId}/unit_labels.json`)
    : await fetch(`${BASE_URL}/${method}/${runId}/unit_labels.json`);
  if (!res.ok) {
    res = await fetch(`${BASE_URL}/${runId}/${method}/unit_labels.json`);
  }
  if (!res.ok && profileLabel) {
    res = await fetch(`${BASE_URL}/${method}/${runId}/unit_labels.json`);
  }
  if (!res.ok) throw new Error(`Failed to load ${method} unit_labels (${res.status})`);
  return res.json() as Promise<Record<string, string>>;
}

export async function fetchCorpusVersionBin(
  runId: string,
  method: ProjectionMethod,
  corpusVersionId: number,
  manifest: ProjectionManifest,
  profileLabel?: string,
): Promise<CorpusVersionLayerData | PcaCorpusVersionLayerData> {
  let res = profileLabel
    ? await fetch(`${BASE_URL}/${method}/${profileLabel}/${runId}/corpus_version_${corpusVersionId}.bin`)
    : await fetch(`${BASE_URL}/${method}/${runId}/corpus_version_${corpusVersionId}.bin`);
  if (!res.ok) {
    res = await fetch(`${BASE_URL}/${runId}/${method}/corpus_version_${corpusVersionId}.bin`);
  }
  if (!res.ok && profileLabel) {
    res = await fetch(`${BASE_URL}/${method}/${runId}/corpus_version_${corpusVersionId}.bin`);
  }
  if (!res.ok) throw new Error(`Failed to load ${method}/corpus_version_${corpusVersionId}.bin (${res.status})`);
  const buffer = await res.arrayBuffer();
  return parseCorpusVersionBin(buffer, corpusVersionId, manifest);
}

export async function fetchSpanBin(
  runId: string,
  method: ProjectionMethod,
  manifest: ProjectionManifest,
  profileLabel?: string,
): Promise<SpanLayerData | PcaSpanLayerData | null> {
  if (!manifest.has_span_layer) return null;
  let res = profileLabel
    ? await fetch(`${BASE_URL}/${method}/${profileLabel}/${runId}/spans.bin`)
    : await fetch(`${BASE_URL}/${method}/${runId}/spans.bin`);
  if (!res.ok && profileLabel) {
    res = await fetch(`${BASE_URL}/${method}/${runId}/spans.bin`);
  }
  if (!res.ok) throw new Error(`Failed to load ${method}/spans.bin (${res.status})`);
  const buffer = await res.arrayBuffer();
  return parseSpanBin(buffer, manifest);
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

/**
 * Parse a corpus_version_<id>.bin buffer.
 * Format: [N][unitIds][comp_0]…[comp_K-1][corpusIds][corpusVersionIds]
 * No ancestor columns.
 */
function parseCorpusVersionBin(
  buffer: ArrayBuffer,
  corpusVersionId: number,
  manifest: ProjectionManifest,
): CorpusVersionLayerData | PcaCorpusVersionLayerData {
  const reader = createBinaryReader(buffer);
  const N = reader.readU32();
  const K = manifest.n_components;
  const isPca = manifest.method === 'pca';

  const unitIds = reader.readI32(N);
  const compCols: Float32Array[] = [];
  for (let k = 0; k < K; k++) compCols.push(reader.readF32(N));
  const corpusIds = reader.readI32(N);
  const corpusVersionIds = reader.readI32(N);

  if (isPca) {
    return {
      corpusVersionId,
      count: N,
      unitIds,
      components: compCols,
      corpusIds,
      corpusVersionIds,
    } as PcaCorpusVersionLayerData;
  }

  const x = compCols[0];
  const y = compCols[1];
  const z = compCols[2] ?? new Float32Array(N);
  const positions = buildInterleavedPositions3(x, y, z, N);
  return {
    corpusVersionId,
    count: N,
    unitIds,
    positions,
    corpusIds,
    corpusVersionIds,
  } as CorpusVersionLayerData;
}

function parseSpanBin(
  buffer: ArrayBuffer,
  manifest: ProjectionManifest,
): SpanLayerData | PcaSpanLayerData {
  const reader = createBinaryReader(buffer);
  const N = reader.readU32();
  const K = manifest.n_components;
  const isPca = manifest.method === 'pca';

  const spanIds = reader.readI32(N);
  const compCols: Float32Array[] = [];
  for (let k = 0; k < K; k++) compCols.push(reader.readF32(N));
  const corpusIds = reader.readI32(N);
  const corpusVersionIds = reader.readI32(N);
  const startUnitIds = reader.readI32(N);
  const endUnitIds = reader.readI32(N);
  const primaryUnitIds = reader.readI32(N);
  const tokenCounts = reader.readI32(N);

  if (isPca) {
    return {
      count: N,
      spanIds,
      components: compCols,
      corpusIds,
      corpusVersionIds,
      startUnitIds,
      endUnitIds,
      primaryUnitIds,
      tokenCounts,
    };
  }

  const x = compCols[0];
  const y = compCols[1];
  const z = compCols[2] ?? new Float32Array(N);
  return {
    count: N,
    spanIds,
    positions: buildInterleavedPositions3(x, y, z, N),
    corpusIds,
    corpusVersionIds,
    startUnitIds,
    endUnitIds,
    primaryUnitIds,
    tokenCounts,
  };
}

// ── Bounds ────────────────────────────────────────────────────────────────────

export function computeBounds(
  layers: Map<number, CorpusVersionLayerData>,
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const layer of layers.values()) {
    const pos = layer.positions;
    for (let i = 0; i < pos.length; i += 3) {
      const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
  }
  if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
  return { minX, maxX, minY, maxY, minZ, maxZ };
}
