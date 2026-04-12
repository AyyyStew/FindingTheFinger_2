import type { CorpusInfo } from '../api/types';
import { defaultVisibility, type MapVisibility } from './mapLayers';
import type { StandardRunData } from './projectionLoader';

export interface NullableRange {
  min: number | null;
  max: number | null;
}

export function buildUnitPositionMap(data: StandardRunData): globalThis.Map<number, [number, number]> {
  const map = new globalThis.Map<number, [number, number]>();
  for (const [, layer] of data.layers) {
    const pos = layer.positions;
    for (let i = 0; i < layer.count; i++) {
      map.set(layer.unitIds[i], [pos[i * 2], pos[i * 2 + 1]]);
    }
  }
  for (const [, layer] of data.depthLayers) {
    const pos = layer.positions;
    for (let i = 0; i < layer.count; i++) {
      if (!map.has(layer.unitIds[i])) {
        map.set(layer.unitIds[i], [pos[i * 2], pos[i * 2 + 1]]);
      }
    }
  }
  return map;
}

export function buildUnitCorpusMap(data: StandardRunData): globalThis.Map<number, number> {
  const map = new globalThis.Map<number, number>();
  for (const [, layer] of data.layers) {
    for (let i = 0; i < layer.count; i++) {
      map.set(layer.unitIds[i], layer.corpusIds[i]);
    }
  }
  for (const [, layer] of data.depthLayers) {
    for (let i = 0; i < layer.count; i++) {
      if (!map.has(layer.unitIds[i])) {
        map.set(layer.unitIds[i], layer.corpusIds[i]);
      }
    }
  }
  return map;
}

export function normalizeVisibilityForData(
  current: MapVisibility | null,
  data: StandardRunData,
): MapVisibility {
  const defaults = defaultVisibility(data.manifest.heights, data.manifest.depths);
  if (!current) return defaults;

  const scatter = { ...defaults.scatter };
  for (const h of data.manifest.heights) {
    if (current.scatter[h] != null) scatter[h] = current.scatter[h];
  }

  const scatterDepth = { ...defaults.scatterDepth };
  for (const d of data.manifest.depths) {
    if (current.scatterDepth[d] != null) scatterDepth[d] = current.scatterDepth[d];
  }

  return {
    scatterMode: current.scatterMode,
    scatter,
    scatterDepth,
    corpora: current.corpora,
  };
}

export function buildVisibleUnitIds(
  data: StandardRunData,
  visibility: MapVisibility,
): globalThis.Set<number> {
  const set = new globalThis.Set<number>();
  const hiddenCorpora = new globalThis.Set(
    Object.entries(visibility.corpora)
      .filter(([, v]) => !v)
      .map(([k]) => Number(k)),
  );

  if (visibility.scatterMode === 'height') {
    for (const [h, layer] of data.layers) {
      if (visibility.scatter[h] === false) continue;
      for (let i = 0; i < layer.count; i++) {
        if (!hiddenCorpora.has(layer.corpusIds[i])) set.add(layer.unitIds[i]);
      }
    }
  } else {
    for (const [d, layer] of data.depthLayers) {
      if (visibility.scatterDepth[d] === false) continue;
      for (let i = 0; i < layer.count; i++) {
        if (!hiddenCorpora.has(layer.corpusIds[i])) set.add(layer.unitIds[i]);
      }
    }
  }

  return set;
}

export function buildVisibleCorpusIds(
  corpora: CorpusInfo[],
  visibility: MapVisibility,
): number[] {
  return corpora
    .filter((corpus) => visibility.corpora[corpus.id] !== false)
    .map((corpus) => corpus.id);
}

export function visibleHeightRange(
  data: StandardRunData,
  visibility: MapVisibility,
): NullableRange {
  if (visibility.scatterMode !== 'height') return { min: null, max: null };

  const visibleHeights = data.manifest.heights.filter((h) => visibility.scatter[h] !== false);
  if (visibleHeights.length === 0) return { min: null, max: null };

  return {
    min: Math.min(...visibleHeights),
    max: Math.max(...visibleHeights),
  };
}

export function visibleDepthRange(
  data: StandardRunData,
  visibility: MapVisibility,
): NullableRange {
  if (visibility.scatterMode !== 'depth') return { min: null, max: null };

  const visibleDepths = data.manifest.depths.filter((d) => visibility.scatterDepth[d] !== false);
  if (visibleDepths.length === 0) return { min: null, max: null };

  return {
    min: Math.min(...visibleDepths),
    max: Math.max(...visibleDepths),
  };
}
