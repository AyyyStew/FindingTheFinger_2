import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCorpora } from '../api/client';
import { useUmapData } from '../hooks/useUmapData';
import { buildCorpusColorMap, defaultVisibility, type MapVisibility } from '../utils/mapLayers';
import { MapCanvas, type HoverInfo } from '../components/MapCanvas/MapCanvas';
import { LayerPanel } from '../components/LayerPanel/LayerPanel';
import styles from './Map.module.css';

export function Map() {
  const { data: umapData, loading, message, error } = useUmapData();

  const { data: corpora = [] } = useQuery({
    queryKey: ['corpora'],
    queryFn: fetchCorpora,
    staleTime: Infinity,
  });

  const colorMap = useMemo(
    () => buildCorpusColorMap(corpora),
    [corpora],
  );

  const [visibility, setVisibility] = useState<MapVisibility | null>(null);

  // Initialise visibility once manifest is available.
  const resolvedVisibility = useMemo(() => {
    if (visibility) return visibility;
    if (!umapData) return null;
    return defaultVisibility(umapData.manifest.heights);
  }, [visibility, umapData]);

  const [hover, setHover] = useState<HoverInfo | null>(null);

  const corpusName = hover
    ? (corpora.find(c => c.id === hover.corpusId)?.name ?? `Corpus ${hover.corpusId}`)
    : null;

  const unitLabel = hover
    ? (umapData?.unitLabels[String(hover.unitId)] ?? `Unit ${hover.unitId}`)
    : null;

  if (error) {
    return (
      <div className={styles.centred}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  if (loading || !umapData || !resolvedVisibility) {
    return (
      <div className={styles.centred}>
        <p className={styles.loadingText}>{message}</p>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {/* Left sidebar — layer controls */}
      <LayerPanel
        manifest={umapData.manifest}
        visibility={resolvedVisibility}
        onChange={setVisibility}
      />

      {/* Main canvas */}
      <div className={styles.canvasWrap}>
        <MapCanvas
          data={umapData}
          visibility={resolvedVisibility}
          colorMap={colorMap}
          onHover={setHover}
        />

        {/* Hover tooltip */}
        {hover && (
          <div
            className={styles.tooltip}
            style={{ left: hover.screenX + 14, top: hover.screenY - 10 }}
          >
            <span className={styles.tooltipLabel}>{unitLabel}</span>
            <span className={styles.tooltipCorpus}>{corpusName}</span>
            <span className={styles.tooltipHeight}>h{hover.height}</span>
          </div>
        )}
      </div>

      {/* Right sidebar — search (placeholder for next phase) */}
      <aside className={styles.rightPanel}>
        <p className={styles.rightPlaceholder}>Search coming soon</p>
      </aside>
    </div>
  );
}
