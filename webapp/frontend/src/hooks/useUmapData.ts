import { useState, useEffect } from 'react';
import {
  fetchLatestRunId,
  fetchManifest,
  fetchHeightBin,
  fetchUnitLabels,
  computeBounds,
  type UmapRunData,
} from '../utils/umapLoader';

export interface UseUmapDataResult {
  data: UmapRunData | null;
  loading: boolean;
  message: string;
  error: string | null;
}

// Module-level cache so navigating away and back doesn't re-fetch.
let _cached: UmapRunData | null = null;

export function useUmapData(): UseUmapDataResult {
  const [state, setState] = useState<UseUmapDataResult>(() =>
    _cached
      ? { data: _cached, loading: false, message: '', error: null }
      : { data: null, loading: true, message: 'Connecting…', error: null },
  );

  useEffect(() => {
    if (_cached) return;
    let cancelled = false;

    async function load() {
      try {
        setState(s => ({ ...s, message: 'Fetching latest run…' }));
        const runId = await fetchLatestRunId();
        if (cancelled) return;

        setState(s => ({ ...s, message: 'Loading manifest…' }));
        const manifest = await fetchManifest(runId);
        if (cancelled) return;

        setState(s => ({
          ...s,
          message: `Loading ${manifest.heights.length} point layers…`,
        }));

        const [layerResults, unitLabels] = await Promise.all([
          Promise.all(
            manifest.heights.map(h => fetchHeightBin(runId, h, manifest.max_height)),
          ),
          fetchUnitLabels(runId),
        ]);
        if (cancelled) return;

        const layers = new Map(layerResults.map(l => [l.height, l]));
        const bounds = computeBounds(layers);
        const result: UmapRunData = { manifest, layers, unitLabels, bounds };

        _cached = result;
        setState({ data: result, loading: false, message: '', error: null });
      } catch (err) {
        if (!cancelled) {
          setState({ data: null, loading: false, message: '', error: String(err) });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return state;
}
