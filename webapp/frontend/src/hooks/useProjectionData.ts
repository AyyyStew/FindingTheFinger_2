import { useState, useEffect } from 'react';
import {
  fetchLatestRunId,
  fetchManifest,
  fetchCorpusVersionBin,
  fetchSpanBin,
  fetchUnitLabels,
  computeBounds,
  type ProjectionMethod,
  type ProjectionRunData,
  type StandardRunData,
  type PcaRunData,
  type CorpusVersionLayerData,
  type PcaCorpusVersionLayerData,
  type SpanLayerData,
  type PcaSpanLayerData,
} from '../utils/projectionLoader';

export interface UseProjectionDataResult {
  data: ProjectionRunData | null;
  loading: boolean;
  message: string;
  error: string | null;
}

// Per-method module-level cache — navigating away and back skips re-fetch.
const _cache = new Map<string, ProjectionRunData>();

export function useProjectionData(method: ProjectionMethod, profileLabel = 'window-50'): UseProjectionDataResult {
  const cacheKey = `${method}:${profileLabel}`;
  const [state, setState] = useState<UseProjectionDataResult>(() => {
    const cached = _cache.get(cacheKey);
    return cached
      ? { data: cached, loading: false, message: '', error: null }
      : { data: null, loading: true, message: 'Connecting…', error: null };
  });

  useEffect(() => {
    // If this method is already cached, nothing to do.
    if (_cache.has(cacheKey)) {
      setState({ data: _cache.get(cacheKey)!, loading: false, message: '', error: null });
      return;
    }

    // Reset to loading when method changes and isn't cached.
    setState({ data: null, loading: true, message: 'Connecting…', error: null });

    let cancelled = false;

    async function load() {
      try {
        setState(s => ({ ...s, message: `Fetching latest ${method} run…` }));
        const runId = await fetchLatestRunId(method, profileLabel);
        if (cancelled) return;

        setState(s => ({ ...s, message: 'Loading manifest…' }));
        const manifest = await fetchManifest(runId, method, profileLabel);
        if (cancelled) return;

        setState(s => ({
          ...s,
          message: `Loading ${manifest.corpus_version_ids.length} corpus-version layers…`,
        }));

        const [corpusVersionLayerResults, spanLayerResult, unitLabels] = await Promise.all([
          Promise.all(
            manifest.corpus_version_ids.map(cvid => fetchCorpusVersionBin(runId, method, cvid, manifest, profileLabel)),
          ),
          fetchSpanBin(runId, method, manifest, profileLabel),
          fetchUnitLabels(runId, method, profileLabel),
        ]);
        if (cancelled) return;

        let result: ProjectionRunData;

        if (manifest.method === 'pca') {
          const corpusVersionLayers = new Map(
            corpusVersionLayerResults.map(
              l => [(l as PcaCorpusVersionLayerData).corpusVersionId, l as PcaCorpusVersionLayerData],
            ),
          );
          result = { manifest, corpusVersionLayers, spanLayer: spanLayerResult as PcaSpanLayerData | null, unitLabels } as PcaRunData;
        } else {
          const corpusVersionLayers = new Map(
            corpusVersionLayerResults.map(
              l => [(l as CorpusVersionLayerData).corpusVersionId, l as CorpusVersionLayerData],
            ),
          );
          const bounds = computeBounds(corpusVersionLayers);
          result = { manifest, corpusVersionLayers, spanLayer: spanLayerResult as SpanLayerData | null, unitLabels, bounds } as StandardRunData;
        }

        _cache.set(cacheKey, result);
        setState({ data: result, loading: false, message: '', error: null });
      } catch (err) {
        if (!cancelled) {
          setState({ data: null, loading: false, message: '', error: String(err) });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [cacheKey, method, profileLabel]);

  return state;
}
