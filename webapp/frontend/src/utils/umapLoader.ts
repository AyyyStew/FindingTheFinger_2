/**
 * umapLoader.ts
 *
 * Fetches and parses the static UMAP binary files produced by scripts/compute_umap.py.
 *
 * Binary format (columnar, little-endian):
 *   height_0.bin  → [N:u32] [unitIds:i32×N] [x:f32×N] [y:f32×N] [corpusIds:i32×N]
 *                   [corpusSeqs:i32×N] [ancestor_h1:i32×N] ... [ancestor_hK:i32×N]
 *   height_N.bin  → [N:u32] [unitIds:i32×N] [x:f32×N] [y:f32×N] [corpusIds:i32×N]
 */

const BASE_URL = '/static/umap_runs';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UmapManifest {
  run_id: string;
  created_at: string;
  label: string | null;
  method: string;
  n_neighbors: number;
  min_dist: number;
  max_height: number;
  heights: number[];
  point_counts: Record<string, number>;
}

/** height=0 (leaf/verse) layer. Includes ancestor IDs for grouping by book/chapter/etc. */
export interface LeafLayerData {
  height: 0;
  count: number;
  unitIds: Int32Array;
  /** Interleaved [x0, y0, x1, y1, …] — ready for deck.gl binary attribute. */
  positions: Float32Array;
  corpusIds: Int32Array;
  corpusSeqs: Int32Array;
  /**
   * ancestors[i] holds unit IDs at height (i+1).
   * e.g. ancestors[0] = chapter IDs, ancestors[1] = book IDs.
   * Use these to group leaves for KDE clouds / voronoi cells / labels.
   */
  ancestors: Int32Array[];
}

/** height>0 (chapter, book, …) aggregated layer. */
export interface ParentLayerData {
  height: number;
  count: number;
  unitIds: Int32Array;
  positions: Float32Array;
  corpusIds: Int32Array;
}

export type HeightLayerData = LeafLayerData | ParentLayerData;

export interface UmapRunData {
  manifest: UmapManifest;
  /** Keyed by height integer. */
  layers: Map<number, HeightLayerData>;
  /** unit_id (as string key) → reference_label for non-leaf units (books, chapters, …). */
  unitLabels: Record<string, string>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export async function fetchLatestRunId(): Promise<string> {
  const res = await fetch(`${BASE_URL}/latest.json`);
  if (!res.ok) throw new Error(`Failed to load latest.json (${res.status})`);
  const { run_id } = await res.json();
  return run_id as string;
}

export async function fetchManifest(runId: string): Promise<UmapManifest> {
  const res = await fetch(`${BASE_URL}/${runId}/manifest.json`);
  if (!res.ok) throw new Error(`Failed to load manifest (${res.status})`);
  return res.json() as Promise<UmapManifest>;
}

export async function fetchUnitLabels(runId: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE_URL}/${runId}/unit_labels.json`);
  if (!res.ok) throw new Error(`Failed to load unit_labels (${res.status})`);
  return res.json() as Promise<Record<string, string>>;
}

export async function fetchHeightBin(
  runId: string,
  height: number,
  maxHeight: number,
): Promise<HeightLayerData> {
  const res = await fetch(`${BASE_URL}/${runId}/height_${height}.bin`);
  if (!res.ok) throw new Error(`Failed to load height_${height}.bin (${res.status})`);
  const buffer = await res.arrayBuffer();
  return parseHeightBin(buffer, height, maxHeight);
}

// ── Binary parser ─────────────────────────────────────────────────────────────

function parseHeightBin(
  buffer: ArrayBuffer,
  height: number,
  maxHeight: number,
): HeightLayerData {
  // All columns are 4 bytes wide; header is uint32 (4 bytes) → always 4-byte aligned.
  const N = new DataView(buffer).getUint32(0, /* littleEndian= */ true);
  let byteOffset = 4;

  const readI32 = (n: number): Int32Array => {
    const arr = new Int32Array(buffer, byteOffset, n);
    byteOffset += n * 4;
    return arr;
  };

  const readF32 = (n: number): Float32Array => {
    const arr = new Float32Array(buffer, byteOffset, n);
    byteOffset += n * 4;
    return arr;
  };

  const unitIds = readI32(N);
  const x = readF32(N);
  const y = readF32(N);
  const corpusIds = readI32(N);

  // Interleave x,y into a single Float32Array for zero-copy deck.gl attributes.
  const positions = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    positions[i * 2]     = x[i];
    positions[i * 2 + 1] = y[i];
  }

  if (height === 0) {
    const corpusSeqs = readI32(N);
    const ancestors: Int32Array[] = [];
    for (let h = 1; h <= maxHeight; h++) {
      ancestors.push(readI32(N));
    }
    return { height: 0, count: N, unitIds, positions, corpusIds, corpusSeqs, ancestors };
  }

  return { height, count: N, unitIds, positions, corpusIds };
}

// ── Bounds ────────────────────────────────────────────────────────────────────

export function computeBounds(
  layers: Map<number, HeightLayerData>,
): { minX: number; maxX: number; minY: number; maxY: number } {
  // Derive from leaf layer (most representative).
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
