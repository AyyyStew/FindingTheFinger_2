import type { MapViewMode } from '../MapCanvas/MapCanvas';
import styles from './MapViewModeToggle.module.css';

interface MapViewModeToggleProps {
  viewMode: MapViewMode;
  onChange: (mode: MapViewMode) => void;
  onZoomToFit: () => void;
}

export function MapViewModeToggle({
  viewMode,
  onChange,
  onZoomToFit,
}: MapViewModeToggleProps) {
  return (
    <div className={styles.panel} aria-label="Map view controls">
      <div className={styles.modeRow}>
        <button
          type="button"
          className={`${styles.modeBtn} ${viewMode === '2d' ? styles.modeBtnActive : ''}`}
          onClick={() => onChange('2d')}
        >
          2D
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${viewMode === '3d' ? styles.modeBtnActive : ''}`}
          onClick={() => onChange('3d')}
        >
          3D
        </button>
      </div>
      <button
        type="button"
        className={styles.fitBtn}
        onClick={onZoomToFit}
      >
        Zoom to fit
      </button>
    </div>
  );
}

