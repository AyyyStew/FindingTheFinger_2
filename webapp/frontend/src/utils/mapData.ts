import type { CorpusInfo } from '../api/types';
import { defaultVisibility, type MapVisibility } from './mapLayers';
import type { StandardRunData } from './projectionLoader';

export interface NullableRange {
  min: number | null;
  max: number | null;
}

export function buildUnitPositionMap(data: StandardRunData): globalThis.Map<number, [number, number, number]> {
  const map = new globalThis.Map<number, [number, number, number]>();
  for (const [, layer] of data.layers) {
    const pos = layer.positions;
    for (let i = 0; i < layer.count; i++) {
      map.set(layer.unitIds[i], [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    }
  }
  for (const [, layer] of data.corpusVersionLayers) {
    const pos = layer.positions;
    for (let i = 0; i < layer.count; i++) {
      if (!map.has(layer.unitIds[i])) {
        map.set(layer.unitIds[i], [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
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
  for (const [, layer] of data.corpusVersionLayers) {
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
  const defaults = defaultVisibility(data.manifest.heights, data.manifest.corpus_version_ids);
  if (!current) return defaults;

  const scatter = { ...defaults.scatter };
  for (const h of data.manifest.heights) {
    if (current.scatter[h] != null) scatter[h] = current.scatter[h];
  }

  const scatterCorpusVersion = { ...defaults.scatterCorpusVersion };
  for (const cvid of data.manifest.corpus_version_ids) {
    if (current.scatterCorpusVersion[cvid] != null) {
      scatterCorpusVersion[cvid] = current.scatterCorpusVersion[cvid];
    }
  }

  return {
    scatterMode: current.scatterMode,
    scatter,
    scatterCorpusVersion,
    corpora: current.corpora,
    corpusVersions: current.corpusVersions,
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
  const hiddenVersions = new globalThis.Set(
    Object.entries(visibility.corpusVersions)
      .filter(([, v]) => !v)
      .map(([k]) => Number(k)),
  );

  if (visibility.scatterMode === 'height') {
    for (const [h, layer] of data.layers) {
      if (visibility.scatter[h] === false) continue;
      for (let i = 0; i < layer.count; i++) {
        if (
          !hiddenCorpora.has(layer.corpusIds[i]) &&
          !hiddenVersions.has(layer.corpusVersionIds[i])
        ) {
          set.add(layer.unitIds[i]);
        }
      }
    }
  } else {
    for (const [cvid, layer] of data.corpusVersionLayers) {
      if (visibility.scatterCorpusVersion[cvid] === false) continue;
      for (let i = 0; i < layer.count; i++) {
        if (
          !hiddenCorpora.has(layer.corpusIds[i]) &&
          !hiddenVersions.has(layer.corpusVersionIds[i])
        ) {
          set.add(layer.unitIds[i]);
        }
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
  if (visibility.scatterMode !== 'corpusVersion') return { min: null, max: null };
  return {
    min: 0,
    max: data.manifest.max_depth,
  };
}
