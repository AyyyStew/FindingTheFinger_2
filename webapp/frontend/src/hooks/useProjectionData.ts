import { useState, useEffect } from 'react';
import {
  fetchLatestRunId,
  fetchManifest,
  fetchHeightBin,
  fetchCorpusVersionBin,
  fetchUnitLabels,
  computeBounds,
  type ProjectionMethod,
  type ProjectionRunData,
  type StandardRunData,
  type PcaRunData,
  type HeightLayerData,
  type PcaHeightLayerData,
  type CorpusVersionLayerData,
  type PcaCorpusVersionLayerData,
} from '../utils/projectionLoader';

export interface UseProjectionDataResult {
  data: ProjectionRunData | null;
  loading: boolean;
  message: string;
  error: string | null;
}

// Per-method module-level cache — navigating away and back skips re-fetch.
const _cache = new Map<ProjectionMethod, ProjectionRunData>();

export function useProjectionData(method: ProjectionMethod): UseProjectionDataResult {
  const [state, setState] = useState<UseProjectionDataResult>(() => {
    const cached = _cache.get(method);
    return cached
      ? { data: cached, loading: false, message: '', error: null }
      : { data: null, loading: true, message: 'Connecting…', error: null };
  });

  useEffect(() => {
    // If this method is already cached, nothing to do.
    if (_cache.has(method)) {
      setState({ data: _cache.get(method)!, loading: false, message: '', error: null });
      return;
    }

    // Reset to loading when method changes and isn't cached.
    setState({ data: null, loading: true, message: 'Connecting…', error: null });

    let cancelled = false;

    async function load() {
      try {
        setState(s => ({ ...s, message: `Fetching latest ${method} run…` }));
        const runId = await fetchLatestRunId(method);
        if (cancelled) return;

        setState(s => ({ ...s, message: 'Loading manifest…' }));
        const manifest = await fetchManifest(runId, method);
        if (cancelled) return;

        setState(s => ({
          ...s,
          message: `Loading ${manifest.heights.length} point layers…`,
        }));

        const [layerResults, corpusVersionLayerResults, unitLabels] = await Promise.all([
          Promise.all(
            manifest.heights.map(h => fetchHeightBin(runId, method, h, manifest)),
          ),
          Promise.all(
            manifest.corpus_version_ids.map(cvid => fetchCorpusVersionBin(runId, method, cvid, manifest)),
          ),
          fetchUnitLabels(runId, method),
        ]);
        if (cancelled) return;

        let result: ProjectionRunData;

        if (manifest.method === 'pca') {
          const layers = new Map(
            layerResults.map(l => [l.height, l as PcaHeightLayerData]),
          );
          const corpusVersionLayers = new Map(
            corpusVersionLayerResults.map(
              l => [(l as PcaCorpusVersionLayerData).corpusVersionId, l as PcaCorpusVersionLayerData],
            ),
          );
          result = { manifest, layers, corpusVersionLayers, unitLabels } as PcaRunData;
        } else {
          const layers = new Map(
            layerResults.map(l => [l.height, l as HeightLayerData]),
          );
          const corpusVersionLayers = new Map(
            corpusVersionLayerResults.map(
              l => [(l as CorpusVersionLayerData).corpusVersionId, l as CorpusVersionLayerData],
            ),
          );
          const bounds = computeBounds(layers);
          result = { manifest, layers, corpusVersionLayers, unitLabels, bounds } as StandardRunData;
        }

        _cache.set(method, result);
        setState({ data: result, loading: false, message: '', error: null });
      } catch (err) {
        if (!cancelled) {
          setState({ data: null, loading: false, message: '', error: String(err) });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [method]);

  return state;
}
